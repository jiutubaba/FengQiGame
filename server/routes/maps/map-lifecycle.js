import path from "node:path";
import { z } from "zod";
import { query, transaction } from "../../db/index.js";
import { writeAudit } from "../../lib/audit.js";
import { conflict, HttpError, notFound } from "../../lib/errors.js";
import {
  removeDeletedMapUploadDirectories,
  restoreMapUploadDirectory,
  stageMapUploadDirectory,
} from "../../services/map-deletion.js";
import { getAutomaticMetrics } from "../../services/metrics.js";
import {
  ALL_MAP_PERMISSIONS,
  PERMISSIONS,
  requireAdmin,
  requireAuth,
  requireMapPermission,
} from "../../middleware/auth.js";
import { validate } from "../../middleware/validation.js";
import { idSchema } from "./shared.js";

const mapSchema = z.object({
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(4000).optional().default(""),
  ownerUserId: z.coerce.number().int().positive().nullable().optional(),
  coverPath: z.string().trim().max(1000).nullable().optional(),
});

export function registerMapLifecycleRoutes(router) {
  router.get("/", requireAuth, async (req, res) => {
    const params = [];
    let accessJoin = "";
    let accessSelect = "$1::text[] AS permissions";
    let where = "m.status='active'";
    if (req.user.role === "admin") {
      params.push(ALL_MAP_PERMISSIONS);
    } else {
      params.push(req.user.id);
      accessJoin =
        "JOIN map_permissions mp ON mp.map_id=m.id AND mp.user_id=$1";
      accessSelect = "mp.permissions";
      where += " AND 'map.view'=ANY(mp.permissions)";
    }
    const result = await query(
      `SELECT m.id,m.name,m.description,m.status,m.cover_path,m.created_at,m.updated_at,
              u.display_name AS owner_name,${accessSelect},
              (SELECT COUNT(*)::int FROM players p WHERE p.map_id=m.id) AS player_count,
              COALESCE(
                CASE WHEN automatic_sessions.epoch IS NOT NULL
                  THEN automatic_activity.cumulative_users
                  ELSE snapshot.cumulative_users
                END,
                0
              ) AS cumulative_users,
              COALESCE(
                CASE WHEN automatic_sessions.epoch IS NOT NULL
                  THEN automatic_sessions.total_game_count
                  ELSE snapshot.total_game_count
                END,
                0
              ) AS total_game_count,
              COALESCE(
                CASE WHEN automatic_sessions.epoch IS NOT NULL
                  THEN automatic_activity.online_users
                  ELSE snapshot.online_users
                END,
                0
              ) AS online_users
         FROM maps m ${accessJoin}
         LEFT JOIN users u ON u.id=m.owner_user_id
         LEFT JOIN LATERAL (
           SELECT MIN(started_at) AS epoch,
                  COUNT(*) FILTER (
                    WHERE COALESCE(ended_at,last_heartbeat_at)
                      >started_at+INTERVAL '10 minutes'
                  )::bigint AS total_game_count
             FROM fq_metric_sessions s
            WHERE s.map_id=m.id
         ) automatic_sessions ON TRUE
         LEFT JOIN LATERAL (
           SELECT COUNT(DISTINCT a.player_uid)::bigint AS cumulative_users,
                  COUNT(DISTINCT a.player_uid) FILTER (
                    WHERE s.ended_at IS NULL
                      AND a.active_date=(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai')::date
                      AND a.last_seen_at>CURRENT_TIMESTAMP-INTERVAL '120 seconds'
                  )::bigint AS online_users
             FROM fq_metric_session_activity a
             JOIN fq_metric_sessions s
               ON s.map_id=a.map_id
              AND s.session_id=a.session_id
            WHERE a.map_id=m.id
         ) automatic_activity ON TRUE
         LEFT JOIN LATERAL (
           SELECT cumulative_users,total_game_count,online_users
             FROM map_metrics mm
            WHERE mm.map_id=m.id
            ORDER BY metric_date DESC
            LIMIT 1
         ) snapshot ON TRUE
        WHERE ${where} ORDER BY m.updated_at DESC`,
      params,
    );
    res.json({ success: true, data: result.rows.map(mapRow) });
  });

  router.post(
    "/",
    requireAuth,
    requireAdmin,
    validate(mapSchema),
    async (req, res) => {
      const result = await transaction(async (client) => {
        const created = await client.query(
          `INSERT INTO maps(name,description,owner_user_id,cover_path)
         VALUES($1,$2,$3,$4) RETURNING *`,
          [
            req.body.name,
            req.body.description,
            req.body.ownerUserId || req.user.id,
            req.body.coverPath || null,
          ],
        );
        await client.query(
          "INSERT INTO map_configs(map_id,updated_by) VALUES($1,$2)",
          [created.rows[0].id, req.user.id],
        );
        return created.rows[0];
      });
      await writeAudit(req, {
        action: "map.create",
        resourceType: "map",
        resourceId: result.id,
        mapId: result.id,
        details: { name: result.name },
      });
      res.status(201).json({
        success: true,
        data: mapRow({ ...result, permissions: ALL_MAP_PERMISSIONS }),
      });
    },
  );

  router.get(
    "/:mapId",
    requireMapPermission(PERMISSIONS.MAP_VIEW),
    async (req, res) => {
      const mapId = idSchema.parse(req.params.mapId);
      const result = await query(
        `SELECT m.*,u.display_name AS owner_name FROM maps m LEFT JOIN users u ON u.id=m.owner_user_id WHERE m.id=$1`,
        [mapId],
      );
      if (!result.rows[0]) throw notFound("地图不存在");
      res.json({
        success: true,
        data: mapRow({ ...result.rows[0], permissions: req.mapPermissions }),
      });
    },
  );

  router.patch(
    "/:mapId",
    requireMapPermission(PERMISSIONS.MAP_EDIT),
    validate(mapSchema.partial()),
    async (req, res) => {
      const mapId = idSchema.parse(req.params.mapId);
      const current = await query("SELECT * FROM maps WHERE id=$1", [mapId]);
      if (!current.rows[0]) throw notFound("地图不存在");
      const next = {
        ...current.rows[0],
        ...{
          name: req.body.name ?? current.rows[0].name,
          description: req.body.description ?? current.rows[0].description,
          owner_user_id:
            req.body.ownerUserId === undefined
              ? current.rows[0].owner_user_id
              : req.body.ownerUserId,
          cover_path:
            req.body.coverPath === undefined
              ? current.rows[0].cover_path
              : req.body.coverPath,
        },
      };
      const result = await query(
        `UPDATE maps SET name=$1,description=$2,owner_user_id=$3,cover_path=$4,updated_at=NOW()
        WHERE id=$5 RETURNING *`,
        [
          next.name,
          next.description,
          next.owner_user_id,
          next.cover_path,
          mapId,
        ],
      );
      await writeAudit(req, {
        action: "map.update",
        resourceType: "map",
        resourceId: mapId,
        mapId,
        details: req.body,
      });
      res.json({
        success: true,
        data: mapRow({ ...result.rows[0], permissions: req.mapPermissions }),
      });
    },
  );

  router.delete("/:mapId", requireAuth, requireAdmin, async (req, res) => {
    const mapId = idSchema.parse(req.params.mapId);
    const result = await query(
      "UPDATE maps SET status='archived',updated_at=NOW() WHERE id=$1 AND status<>'archived' RETURNING id,name",
      [mapId],
    );
    if (!result.rows[0]) throw notFound("地图不存在或已经归档");
    await writeAudit(req, {
      action: "map.archive",
      resourceType: "map",
      resourceId: mapId,
      mapId,
      details: { name: result.rows[0].name },
    });
    res.json({ success: true });
  });

  router.delete(
    "/:mapId/permanent",
    requireAuth,
    requireAdmin,
    validate(
      z.object({
        confirmMapId: z.coerce.number().int().positive(),
        confirmName: z.string().trim().min(1).max(160),
      }),
    ),
    async (req, res) => {
      const mapId = idSchema.parse(req.params.mapId);
      let stagedUpload = null;
      let deletedMap = null;
      try {
        deletedMap = await transaction(async (client) => {
          const result = await client.query(
            "SELECT id,name FROM maps WHERE id=$1 FOR UPDATE",
            [mapId],
          );
          const map = result.rows[0];
          if (!map) throw notFound("地图不存在");
          if (
            req.body.confirmMapId !== Number(map.id) ||
            req.body.confirmName !== map.name
          )
            throw new HttpError(
              409,
              "地图删除确认信息不匹配",
              "MAP_DELETE_CONFIRMATION_MISMATCH",
            );

          stagedUpload = await stageMapUploadDirectory(mapId);
          const auditId = await writeAudit(
            req,
            {
              action: "map.delete",
              resourceType: "map",
              resourceId: mapId,
              mapId,
              details: {
                mapId,
                name: map.name,
                deletedAt: new Date().toISOString(),
                fileCleanup: stagedUpload.existed ? "pending" : "not_found",
              },
            },
            client,
          );
          await client.query("DELETE FROM maps WHERE id=$1", [mapId]);
          return { id: Number(map.id), name: map.name, auditId };
        });
      } catch (error) {
        let restoreError = null;
        if (stagedUpload?.staged) {
          try {
            await restoreMapUploadDirectory(stagedUpload);
          } catch (caughtError) {
            restoreError = caughtError;
            req.log?.error(
              {
                err: caughtError,
                mapId,
                directory: path.basename(stagedUpload.staged),
              },
              "map delete upload restore failed",
            );
          }
        }
        if (restoreError)
          throw new HttpError(
            500,
            "地图数据库删除已回滚，但服务器上传目录恢复失败，请立即检查服务器文件",
            "MAP_DELETE_FILE_RESTORE_FAILED",
          );
        throw error;
      }

      let fileCleanup;
      try {
        fileCleanup = await removeDeletedMapUploadDirectories(
          mapId,
          stagedUpload,
        );
      } catch (error) {
        req.log?.error(
          { err: error, mapId, auditId: deletedMap.auditId },
          "map delete file cleanup failed",
        );
        try {
          await query(
            `UPDATE audit_logs
                SET details=details || $1::jsonb
              WHERE id=$2`,
            [
              JSON.stringify({
                fileCleanup: "failed",
                cleanupError: "filesystem_cleanup_failed",
              }),
              deletedMap.auditId,
            ],
          );
        } catch (auditError) {
          req.log?.error(
            { err: auditError, mapId, auditId: deletedMap.auditId },
            "map delete cleanup audit update failed",
          );
        }
        throw new HttpError(
          500,
          "地图数据库数据已删除，但服务器上传目录清理失败；系统将在下次启动时重试",
          "MAP_DELETE_FILE_CLEANUP_FAILED",
        );
      }

      try {
        await query(
          `UPDATE audit_logs
              SET details=details || $1::jsonb
            WHERE id=$2`,
          [
            JSON.stringify({ fileCleanup: "completed", ...fileCleanup }),
            deletedMap.auditId,
          ],
        );
      } catch (error) {
        req.log?.error(
          { err: error, mapId, auditId: deletedMap.auditId },
          "map delete audit finalization failed",
        );
        throw new HttpError(
          500,
          "地图及服务器文件已删除，但审计状态更新失败，请检查服务器日志",
          "MAP_DELETE_AUDIT_UPDATE_FAILED",
        );
      }

      res.json({
        success: true,
        data: {
          id: deletedMap.id,
          name: deletedMap.name,
          fileCleanup,
        },
      });
    },
  );

  router.get(
    "/:mapId/metrics",
    requireMapPermission(PERMISSIONS.METRICS_VIEW),
    async (req, res) => {
      const mapId = idSchema.parse(req.params.mapId);
      const automatic = await getAutomaticMetrics(mapId);
      const trend = automatic
        ? null
        : await query(
            "SELECT * FROM map_metrics WHERE map_id=$1 ORDER BY metric_date DESC LIMIT 30",
            [mapId],
          );
      const rows = automatic ? automatic.rows : trend.rows.reverse();
      const latest = rows.at(-1) || emptyMetrics(mapId);
      res.json({
        success: true,
        data: {
          source: automatic?.source || "snapshot",
          epochDate: formatChinaDate(automatic?.epochDate),
          summary: metricRow(latest),
          trends: rows.map(metricRow),
          calculatedAt: latest.updated_at || null,
        },
      });
    },
  );

  router.get(
    "/:mapId/config",
    requireMapPermission(PERMISSIONS.MAP_VIEW),
    async (req, res) => {
      const mapId = idSchema.parse(req.params.mapId);
      const result = await query(
        "SELECT config,updated_at FROM map_configs WHERE map_id=$1",
        [mapId],
      );
      if (!result.rows[0]) throw notFound("地图配置不存在");
      res.json({
        success: true,
        data: {
          ...result.rows[0].config,
          updatedAt: result.rows[0].updated_at,
        },
      });
    },
  );

  router.put(
    "/:mapId/config",
    requireMapPermission(PERMISSIONS.MAP_EDIT),
    validate(
      z
        .object({
          ranks: z.array(z.record(z.string(), z.unknown())).max(500).optional(),
          gifts: z
            .array(z.record(z.string(), z.unknown()))
            .max(1000)
            .optional(),
          anchorGifts: z
            .array(z.record(z.string(), z.unknown()))
            .max(1000)
            .optional(),
          globals: z
            .array(z.record(z.string(), z.unknown()))
            .max(1000)
            .optional(),
          dayLimits: z
            .array(z.record(z.string(), z.unknown()))
            .max(1000)
            .optional(),
          randomGroups: z
            .array(z.record(z.string(), z.unknown()))
            .max(1000)
            .optional(),
          preloadCode: z
            .string()
            .refine(
              (value) => Buffer.byteLength(value, "utf8") <= 256 * 1024,
              "预加载代码不能超过 256 KiB",
            )
            .optional(),
        })
        .strict(),
    ),
    async (req, res) => {
      const mapId = idSchema.parse(req.params.mapId);
      if (Object.hasOwn(req.body, "preloadCode") && req.user.role !== "admin") {
        throw new HttpError(403, "仅管理员可以修改预加载代码", "FORBIDDEN");
      }
      const result = await query(
        `UPDATE map_configs SET config=config || $1::jsonb,updated_by=$2,updated_at=NOW()
        WHERE map_id=$3 RETURNING config,updated_at`,
        [JSON.stringify(req.body), req.user.id, mapId],
      );
      if (!result.rows[0]) throw notFound("地图配置不存在");
      await writeAudit(req, {
        action: "map.config.update",
        resourceType: "map_config",
        resourceId: mapId,
        mapId,
        details: { sections: Object.keys(req.body) },
      });
      res.json({
        success: true,
        data: {
          ...result.rows[0].config,
          updatedAt: result.rows[0].updated_at,
        },
      });
    },
  );
}

export function registerRuntimeRoutes(router) {
  router.post(
    "/:mapId/runtime/clear",
    requireAuth,
    requireAdmin,
    validate(
      z.object({
        confirmName: z.string().trim().min(1).max(160),
      }),
    ),
    async (req, res) => {
      const mapId = idSchema.parse(req.params.mapId);
      const mapResult = await query("SELECT name FROM maps WHERE id=$1", [
        mapId,
      ]);
      const map = mapResult.rows[0];
      if (!map) throw notFound("地图不存在");
      if (req.body.confirmName !== map.name)
        throw conflict("地图名称确认不匹配");
      const counts = await transaction(async (client) => {
        const messages = await client.query(
          "DELETE FROM player_messages WHERE map_id=$1",
          [mapId],
        );
        const entitlements = await client.query(
          "DELETE FROM gift_entitlements WHERE map_id=$1",
          [mapId],
        );
        const leaderboardSnapshots = await client.query(
          `DELETE FROM leaderboard_snapshots s USING leaderboards l
            WHERE s.leaderboard_id=l.id AND l.map_id=$1`,
          [mapId],
        );
        const leaderboardDailyCollections = await client.query(
          `DELETE FROM leaderboard_daily_collections c USING leaderboards l
            WHERE c.leaderboard_id=l.id AND l.map_id=$1`,
          [mapId],
        );
        const leaderboardEntries = await client.query(
          `DELETE FROM leaderboard_entries e USING leaderboards l
            WHERE e.leaderboard_id=l.id AND l.map_id=$1`,
          [mapId],
        );
        const riskEvents = await client.query(
          "DELETE FROM risk_events WHERE map_id=$1",
          [mapId],
        );
        const playerArchives = await client.query(
          "DELETE FROM fq_player_archives WHERE map_id=$1",
          [mapId],
        );
        const globalArchives = await client.query(
          "DELETE FROM fq_global_archives WHERE map_id=$1",
          [mapId],
        );
        const players = await client.query(
          "DELETE FROM players WHERE map_id=$1",
          [mapId],
        );
        const logs = await client.query(
          "DELETE FROM map_logs WHERE map_id=$1",
          [mapId],
        );
        const metrics = await client.query(
          "DELETE FROM map_metrics WHERE map_id=$1",
          [mapId],
        );
        const automaticMetricSessions = await client.query(
          "DELETE FROM fq_metric_sessions WHERE map_id=$1",
          [mapId],
        );
        await client.query(
          "UPDATE tracking_points SET trigger_count=0,updated_at=NOW() WHERE map_id=$1",
          [mapId],
        );
        return {
          messages: messages.rowCount,
          entitlements: entitlements.rowCount,
          leaderboardSnapshots: leaderboardSnapshots.rowCount,
          leaderboardDailyCollections: leaderboardDailyCollections.rowCount,
          leaderboardEntries: leaderboardEntries.rowCount,
          riskEvents: riskEvents.rowCount,
          playerArchives: playerArchives.rowCount,
          globalArchives: globalArchives.rowCount,
          players: players.rowCount,
          logs: logs.rowCount,
          metrics: metrics.rowCount,
          automaticMetricSessions: automaticMetricSessions.rowCount,
        };
      });
      await writeAudit(req, {
        action: "map.runtime.clear",
        resourceType: "map",
        resourceId: mapId,
        mapId,
        details: { counts },
      });
      res.json({ success: true, data: counts });
    },
  );
}

function mapRow(row) {
  return {
    id: Number(row.id),
    name: row.name,
    description: row.description || "",
    status: row.status,
    coverPath: row.cover_path,
    ownerName: row.owner_name || null,
    permissions: row.permissions || [],
    playerCount: Number(row.player_count || 0),
    cumulativeUsers: Number(row.cumulative_users || 0),
    totalGameCount: Number(row.total_game_count || 0),
    onlineUsers: Number(row.online_users || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
function metricRow(row) {
  return {
    date: formatChinaDate(row.metric_date),
    cumulativeUsers: Number(row.cumulative_users),
    onlineUsers: Number(row.online_users),
    totalGameCount: Number(row.total_game_count),
    validGameCount: nullableNumber(row.valid_game_count),
    dailyNewUsers: Number(row.daily_new_users),
    dailyActiveUsers: Number(row.daily_active_users),
    lostUserCount: Number(row.lost_user_count),
    returnUserCount: Number(row.return_user_count),
    activeUserRetentionRate: Number(row.active_user_retention_rate),
    newUserRetentionRate: Number(row.new_user_retention_rate),
    sevenDayRetentionRate: Number(row.seven_day_retention_rate),
    replayRate: Number(row.replay_rate),
    activeUserRetainedCount: nullableNumber(row.active_user_retained_count),
    activeUserCohortCount: nullableNumber(row.active_user_cohort_count),
    newUserRetainedCount: nullableNumber(row.new_user_retained_count),
    newUserCohortCount: nullableNumber(row.new_user_cohort_count),
    sevenDayRetainedCount: nullableNumber(row.seven_day_retained_count),
    sevenDayCohortCount: nullableNumber(row.seven_day_cohort_count),
    replayUserCount: nullableNumber(row.replay_user_count),
    replayCohortCount: nullableNumber(row.replay_cohort_count),
  };
}
function nullableNumber(value) {
  return value === undefined || value === null ? null : Number(value);
}
function formatChinaDate(value) {
  if (!value) return null;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" });
}
function emptyMetrics(mapId) {
  return {
    map_id: mapId,
    metric_date: new Date().toLocaleDateString("sv-SE", {
      timeZone: "Asia/Shanghai",
    }),
    cumulative_users: 0,
    online_users: 0,
    total_game_count: 0,
    daily_new_users: 0,
    daily_active_users: 0,
    lost_user_count: 0,
    return_user_count: 0,
    active_user_retention_rate: 0,
    new_user_retention_rate: 0,
    seven_day_retention_rate: 0,
    replay_rate: 0,
    updated_at: null,
  };
}
