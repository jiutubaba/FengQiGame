import { createReadStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { config } from "../config.js";
import { query, transaction } from "../db/index.js";
import { writeAudit } from "../lib/audit.js";
import { conflict, HttpError, notFound } from "../lib/errors.js";
import {
  createOpaqueToken,
  hashToken,
  normalizeRelativePath,
  sanitizeFileName,
} from "../lib/security.js";
import {
  removeDeletedMapUploadDirectories,
  restoreMapUploadDirectory,
  stageMapUploadDirectory,
} from "../services/map-deletion.js";
import {
  ALL_MAP_PERMISSIONS,
  PERMISSIONS,
  requireAdmin,
  requireAuth,
  requireMapPermission,
} from "../middleware/auth.js";
import { validate } from "../middleware/validation.js";

const router = Router();
const idSchema = z.coerce.number().int().positive();
const forbiddenUploadExtensions = new Set([
  ".bat",
  ".cmd",
  ".com",
  ".cpl",
  ".exe",
  ".hta",
  ".jar",
  ".js",
  ".jse",
  ".lnk",
  ".mjs",
  ".msi",
  ".ps1",
  ".psm1",
  ".reg",
  ".scr",
  ".sh",
  ".vbs",
  ".wsf",
]);
const inlineImageTypes = new Set([
  "image/avif",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const mapSchema = z.object({
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(4000).optional().default(""),
  runtimeEnv: z
    .enum(["release", "lobby", "test"])
    .optional()
    .default("release"),
  ownerUserId: z.coerce.number().int().positive().nullable().optional(),
  coverPath: z.string().trim().max(1000).nullable().optional(),
});

router.get("/", requireAuth, async (req, res) => {
  const params = [];
  let accessJoin = "";
  let accessSelect = "$1::text[] AS permissions";
  let where = "m.status='active'";
  if (req.user.role === "admin") {
    params.push(ALL_MAP_PERMISSIONS);
  } else {
    params.push(req.user.id);
    accessJoin = "JOIN map_permissions mp ON mp.map_id=m.id AND mp.user_id=$1";
    accessSelect = "mp.permissions";
    where += " AND 'map.view'=ANY(mp.permissions)";
  }
  const result = await query(
    `SELECT m.id,m.name,m.description,m.status,m.runtime_env,m.cover_path,m.created_at,m.updated_at,
            u.display_name AS owner_name,${accessSelect},
            (SELECT COUNT(*)::int FROM players p WHERE p.map_id=m.id AND p.environment=m.runtime_env) AS player_count,
            COALESCE((SELECT cumulative_users FROM map_metrics mm WHERE mm.map_id=m.id AND mm.environment=m.runtime_env ORDER BY metric_date DESC LIMIT 1),0) AS cumulative_users,
            COALESCE((SELECT total_game_count FROM map_metrics mm WHERE mm.map_id=m.id AND mm.environment=m.runtime_env ORDER BY metric_date DESC LIMIT 1),0) AS total_game_count,
            COALESCE((SELECT online_users FROM map_metrics mm WHERE mm.map_id=m.id AND mm.environment=m.runtime_env ORDER BY metric_date DESC LIMIT 1),0) AS online_users
       FROM maps m ${accessJoin}
       LEFT JOIN users u ON u.id=m.owner_user_id
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
        `INSERT INTO maps(name,description,runtime_env,owner_user_id,cover_path)
       VALUES($1,$2,$3,$4,$5) RETURNING *`,
        [
          req.body.name,
          req.body.description,
          req.body.runtimeEnv,
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
        runtime_env: req.body.runtimeEnv ?? current.rows[0].runtime_env,
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
      `UPDATE maps SET name=$1,description=$2,runtime_env=$3,owner_user_id=$4,cover_path=$5,updated_at=NOW()
      WHERE id=$6 RETURNING *`,
      [
        next.name,
        next.description,
        next.runtime_env,
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
        await client.query("DELETE FROM gift_grants WHERE map_id=$1", [mapId]);
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
    const environment = envFrom(req);
    const trend = await query(
      "SELECT * FROM map_metrics WHERE map_id=$1 AND environment=$2 ORDER BY metric_date DESC LIMIT 30",
      [mapId, environment],
    );
    const rows = trend.rows.reverse();
    const latest = rows.at(-1) || emptyMetrics(mapId);
    res.json({
      success: true,
      data: {
        environment,
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
      data: { ...result.rows[0].config, updatedAt: result.rows[0].updated_at },
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
        gifts: z.array(z.record(z.string(), z.unknown())).max(1000).optional(),
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
        preloadCode: z.string().max(2_000_000).optional(),
      })
      .strict(),
  ),
  async (req, res) => {
    const mapId = idSchema.parse(req.params.mapId);
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
      data: { ...result.rows[0].config, updatedAt: result.rows[0].updated_at },
    });
  },
);

router.get(
  "/:mapId/players",
  requireMapPermission(PERMISSIONS.PLAYERS_VIEW),
  async (req, res) => {
    const mapId = idSchema.parse(req.params.mapId);
    const environment = envFrom(req);
    const { page, limit, offset } = pagination(req.query);
    const q = String(req.query.q || "").trim();
    const params = [mapId, environment];
    let where = "map_id=$1 AND environment=$2";
    if (q) {
      params.push(`%${q}%`);
      where += ` AND (uid ILIKE $${params.length} OR name ILIKE $${params.length})`;
    }
    const count = await query(
      `SELECT COUNT(*)::int AS count FROM players WHERE ${where}`,
      params,
    );
    params.push(limit, offset);
    const result = await query(
      `SELECT id,uid,name,level,game_level,item_ban,data_ban,rank_ban,profile,last_active_at,created_at,updated_at
       FROM players WHERE ${where} ORDER BY last_active_at DESC NULLS LAST,id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    res.json({
      success: true,
      data: result.rows.map(playerRow),
      pagination: { page, limit, total: count.rows[0].count },
    });
  },
);

const playerSchema = z.object({
  uid: z.string().trim().min(1).max(128),
  name: z.string().trim().min(1).max(160),
  level: z.coerce.number().int().min(0).max(1_000_000).optional().default(0),
  gameLevel: z.string().trim().max(32).optional().default(""),
  itemBan: z.boolean().optional().default(false),
  dataBan: z.boolean().optional().default(false),
  rankBan: z.boolean().optional().default(false),
  profile: z.record(z.string(), z.unknown()).optional().default({}),
});

router.post(
  "/:mapId/players",
  requireMapPermission(PERMISSIONS.PLAYERS_MANAGE),
  validate(playerSchema),
  async (req, res) => {
    const mapId = idSchema.parse(req.params.mapId);
    const environment = envFrom(req);
    const result = await query(
      `INSERT INTO players(map_id,environment,uid,name,level,game_level,item_ban,data_ban,rank_ban,profile)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb) RETURNING *`,
      [
        mapId,
        environment,
        req.body.uid,
        req.body.name,
        req.body.level,
        req.body.gameLevel,
        req.body.itemBan,
        req.body.dataBan,
        req.body.rankBan,
        JSON.stringify(req.body.profile),
      ],
    );
    await writeAudit(req, {
      action: "player.create",
      resourceType: "player",
      resourceId: result.rows[0].id,
      mapId,
      details: { uid: req.body.uid, name: req.body.name },
    });
    res.status(201).json({ success: true, data: playerRow(result.rows[0]) });
  },
);

router.patch(
  "/:mapId/players/:playerId",
  requireMapPermission(PERMISSIONS.PLAYERS_MANAGE),
  validate(playerSchema.partial()),
  async (req, res) => {
    const mapId = idSchema.parse(req.params.mapId);
    const environment = envFrom(req);
    const playerId = idSchema.parse(req.params.playerId);
    const current = await query(
      "SELECT * FROM players WHERE id=$1 AND map_id=$2 AND environment=$3",
      [playerId, mapId, environment],
    );
    if (!current.rows[0]) throw notFound("玩家不存在");
    const row = current.rows[0];
    const nextUid = req.body.uid ?? row.uid;
    const result = await transaction(async (client) => {
      const updated = await client.query(
        `UPDATE players SET uid=$1,name=$2,level=$3,game_level=$4,item_ban=$5,data_ban=$6,rank_ban=$7,profile=$8::jsonb,updated_at=NOW()
        WHERE id=$9 AND map_id=$10 AND environment=$11 RETURNING *`,
        [
          nextUid,
          req.body.name ?? row.name,
          req.body.level ?? row.level,
          req.body.gameLevel ?? row.game_level,
          req.body.itemBan ?? row.item_ban,
          req.body.dataBan ?? row.data_ban,
          req.body.rankBan ?? row.rank_ban,
          JSON.stringify(req.body.profile ?? row.profile),
          playerId,
          mapId,
          environment,
        ],
      );
      if (nextUid !== row.uid) {
        await client.query(
          `UPDATE fq_player_archives SET player_uid=$1,updated_at=NOW()
            WHERE map_id=$2 AND environment=$3 AND player_uid=$4`,
          [nextUid, mapId, environment, row.uid],
        );
      }
      return updated;
    });
    await writeAudit(req, {
      action: "player.update",
      resourceType: "player",
      resourceId: playerId,
      mapId,
      details: { fields: Object.keys(req.body) },
    });
    res.json({ success: true, data: playerRow(result.rows[0]) });
  },
);

router.delete(
  "/:mapId/players/:playerId",
  requireMapPermission(PERMISSIONS.PLAYERS_MANAGE),
  async (req, res) => {
    const mapId = idSchema.parse(req.params.mapId);
    const environment = envFrom(req);
    const playerId = idSchema.parse(req.params.playerId);
    const result = await transaction(async (client) => {
      const deleted = await client.query(
        "DELETE FROM players WHERE id=$1 AND map_id=$2 AND environment=$3 RETURNING id,uid,name",
        [playerId, mapId, environment],
      );
      if (!deleted.rows[0]) throw notFound("玩家不存在");
      await client.query(
        "DELETE FROM fq_player_archives WHERE map_id=$1 AND environment=$2 AND player_uid=$3",
        [mapId, environment, deleted.rows[0].uid],
      );
      return deleted;
    });
    await writeAudit(req, {
      action: "player.delete",
      resourceType: "player",
      resourceId: playerId,
      mapId,
      details: { uid: result.rows[0].uid, name: result.rows[0].name },
    });
    res.json({ success: true });
  },
);

const leaderboardSchema = z.object({
  leaderboardKey: z
    .string()
    .trim()
    .min(1)
    .max(128)
    .regex(
      /^[A-Za-z0-9._-]+$/,
      "榜单 Key 只能包含字母、数字、点、下划线和连字符",
    ),
  name: z.string().trim().min(1).max(160),
  valueLabel: z.string().trim().min(1).max(80).default("积分"),
  sortDirection: z.enum(["asc", "desc"]).default("desc"),
  enabled: z.boolean().default(true),
});

router.get(
  "/:mapId/leaderboards",
  requireMapPermission(PERMISSIONS.LEADERBOARDS_VIEW),
  async (req, res) => {
    const mapId = idSchema.parse(req.params.mapId);
    const environment = envFrom(req);
    const result = await query(
      `SELECT l.*,
              COUNT(e.id) FILTER (WHERE p.rank_ban IS DISTINCT FROM TRUE)::int AS entry_count,
              latest.id AS latest_snapshot_id,
              latest.entry_count AS latest_snapshot_count,
              latest.published_at AS latest_published_at
         FROM leaderboards l
         LEFT JOIN leaderboard_entries e ON e.leaderboard_id=l.id
         LEFT JOIN players p ON p.map_id=l.map_id AND p.environment=l.environment AND p.uid=e.player_uid
         LEFT JOIN LATERAL (
           SELECT id,entry_count,published_at FROM leaderboard_snapshots
            WHERE leaderboard_id=l.id ORDER BY published_at DESC LIMIT 1
         ) latest ON TRUE
        WHERE l.map_id=$1 AND l.environment=$2
        GROUP BY l.id,latest.id,latest.entry_count,latest.published_at
        ORDER BY l.created_at`,
      [mapId, environment],
    );
    res.json({ success: true, data: result.rows.map(leaderboardRow) });
  },
);

router.post(
  "/:mapId/leaderboards",
  requireMapPermission(PERMISSIONS.LEADERBOARDS_MANAGE),
  validate(leaderboardSchema),
  async (req, res) => {
    const mapId = idSchema.parse(req.params.mapId);
    const result = await query(
      `INSERT INTO leaderboards(map_id,environment,leaderboard_key,name,value_label,sort_direction,enabled)
       VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [
        mapId,
        envFrom(req),
        req.body.leaderboardKey,
        req.body.name,
        req.body.valueLabel,
        req.body.sortDirection,
        req.body.enabled,
      ],
    );
    await writeAudit(req, {
      action: "leaderboard.create",
      resourceType: "leaderboard",
      resourceId: result.rows[0].id,
      mapId,
      details: { leaderboardKey: req.body.leaderboardKey },
    });
    res.status(201).json({
      success: true,
      data: leaderboardRow(result.rows[0]),
    });
  },
);

router.patch(
  "/:mapId/leaderboards/:leaderboardId",
  requireMapPermission(PERMISSIONS.LEADERBOARDS_MANAGE),
  validate(leaderboardSchema.partial()),
  async (req, res) => {
    const mapId = idSchema.parse(req.params.mapId);
    const leaderboardId = idSchema.parse(req.params.leaderboardId);
    const environment = envFrom(req);
    const current = await query(
      "SELECT * FROM leaderboards WHERE id=$1 AND map_id=$2 AND environment=$3",
      [leaderboardId, mapId, environment],
    );
    if (!current.rows[0]) throw notFound("排行榜不存在");
    const row = current.rows[0];
    const result = await query(
      `UPDATE leaderboards SET leaderboard_key=$1,name=$2,value_label=$3,sort_direction=$4,enabled=$5,updated_at=NOW()
        WHERE id=$6 AND map_id=$7 AND environment=$8 RETURNING *`,
      [
        req.body.leaderboardKey ?? row.leaderboard_key,
        req.body.name ?? row.name,
        req.body.valueLabel ?? row.value_label,
        req.body.sortDirection ?? row.sort_direction,
        req.body.enabled ?? row.enabled,
        leaderboardId,
        mapId,
        environment,
      ],
    );
    await writeAudit(req, {
      action: "leaderboard.update",
      resourceType: "leaderboard",
      resourceId: leaderboardId,
      mapId,
      details: { fields: Object.keys(req.body) },
    });
    res.json({ success: true, data: leaderboardRow(result.rows[0]) });
  },
);

router.delete(
  "/:mapId/leaderboards/:leaderboardId",
  requireMapPermission(PERMISSIONS.LEADERBOARDS_MANAGE),
  async (req, res) => {
    const mapId = idSchema.parse(req.params.mapId);
    const leaderboardId = idSchema.parse(req.params.leaderboardId);
    const result = await query(
      "DELETE FROM leaderboards WHERE id=$1 AND map_id=$2 AND environment=$3 RETURNING id,leaderboard_key",
      [leaderboardId, mapId, envFrom(req)],
    );
    if (!result.rows[0]) throw notFound("排行榜不存在");
    await writeAudit(req, {
      action: "leaderboard.delete",
      resourceType: "leaderboard",
      resourceId: leaderboardId,
      mapId,
      details: { leaderboardKey: result.rows[0].leaderboard_key },
    });
    res.json({ success: true });
  },
);

router.get(
  "/:mapId/leaderboards/:leaderboardId/entries",
  requireMapPermission(PERMISSIONS.LEADERBOARDS_VIEW),
  async (req, res) => {
    const mapId = idSchema.parse(req.params.mapId);
    const leaderboardId = idSchema.parse(req.params.leaderboardId);
    const environment = envFrom(req);
    const { page, limit, offset } = pagination(req.query);
    const q = String(req.query.q || "").trim();
    const leaderboardResult = await query(
      "SELECT * FROM leaderboards WHERE id=$1 AND map_id=$2 AND environment=$3",
      [leaderboardId, mapId, environment],
    );
    const leaderboard = leaderboardResult.rows[0];
    if (!leaderboard) throw notFound("排行榜不存在");
    const snapshots = await query(
      `SELECT id,entry_count,published_at FROM leaderboard_snapshots
        WHERE leaderboard_id=$1 ORDER BY published_at DESC LIMIT 30`,
      [leaderboardId],
    );
    const snapshotId = req.query.snapshotId
      ? idSchema.parse(req.query.snapshotId)
      : null;
    const params = [snapshotId || leaderboardId];
    let filter = "TRUE";
    if (q) {
      params.push(`%${q}%`);
      filter = `(player_uid ILIKE $2 OR player_name ILIKE $2)`;
    }
    let rows;
    let count;
    if (snapshotId) {
      const belongs = snapshots.rows.some(
        (snapshot) => Number(snapshot.id) === snapshotId,
      );
      if (!belongs) throw notFound("排行榜快照不存在");
      count = await query(
        `SELECT COUNT(*)::int AS count FROM leaderboard_snapshot_entries
          WHERE snapshot_id=$1 AND ${filter}`,
        params,
      );
      params.push(limit, offset);
      rows = await query(
        `SELECT rank,player_uid,player_name,game_level,score,game_count,metadata,NULL::timestamptz AS updated_at
           FROM leaderboard_snapshot_entries WHERE snapshot_id=$1 AND ${filter}
          ORDER BY rank LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );
    } else {
      const direction = leaderboard.sort_direction === "asc" ? "ASC" : "DESC";
      const ranked = `WITH ranked AS (
        SELECT e.id,ROW_NUMBER() OVER (ORDER BY e.score ${direction},e.updated_at,e.id) AS rank,
               e.player_uid,e.player_name,e.game_level,e.score,e.game_count,e.metadata,e.updated_at
          FROM leaderboard_entries e
          LEFT JOIN players p ON p.map_id=$2 AND p.environment=$3 AND p.uid=e.player_uid
         WHERE e.leaderboard_id=$1 AND p.rank_ban IS DISTINCT FROM TRUE
      )`;
      const liveParams = [leaderboardId, mapId, environment];
      let liveFilter = "TRUE";
      if (q) {
        liveParams.push(`%${q}%`);
        liveFilter = `(player_uid ILIKE $4 OR player_name ILIKE $4)`;
      }
      count = await query(
        `${ranked} SELECT COUNT(*)::int AS count FROM ranked WHERE ${liveFilter}`,
        liveParams,
      );
      liveParams.push(limit, offset);
      rows = await query(
        `${ranked} SELECT * FROM ranked WHERE ${liveFilter} ORDER BY rank LIMIT $${liveParams.length - 1} OFFSET $${liveParams.length}`,
        liveParams,
      );
    }
    res.json({
      success: true,
      data: {
        leaderboard: leaderboardRow(leaderboard),
        snapshots: snapshots.rows.map(snapshotRow),
        entries: rows.rows.map(leaderboardEntryRow),
      },
      pagination: { page, limit, total: count.rows[0].count },
    });
  },
);

router.post(
  "/:mapId/leaderboards/:leaderboardId/publish",
  requireMapPermission(PERMISSIONS.LEADERBOARDS_MANAGE),
  validate(
    z.object({
      limit: z.coerce.number().int().min(1).max(1000).default(100),
    }),
  ),
  async (req, res) => {
    const mapId = idSchema.parse(req.params.mapId);
    const leaderboardId = idSchema.parse(req.params.leaderboardId);
    const environment = envFrom(req);
    const snapshot = await transaction(async (client) => {
      const current = await client.query(
        "SELECT * FROM leaderboards WHERE id=$1 AND map_id=$2 AND environment=$3 FOR UPDATE",
        [leaderboardId, mapId, environment],
      );
      const leaderboard = current.rows[0];
      if (!leaderboard) throw notFound("排行榜不存在");
      const created = await client.query(
        "INSERT INTO leaderboard_snapshots(leaderboard_id,published_by) VALUES($1,$2) RETURNING *",
        [leaderboardId, req.user.id],
      );
      const direction = leaderboard.sort_direction === "asc" ? "ASC" : "DESC";
      const inserted = await client.query(
        `INSERT INTO leaderboard_snapshot_entries(snapshot_id,rank,player_uid,player_name,game_level,score,game_count,metadata)
         SELECT $1,(ROW_NUMBER() OVER (ORDER BY e.score ${direction},e.updated_at,e.id))::int,e.player_uid,e.player_name,e.game_level,e.score,e.game_count,e.metadata
           FROM leaderboard_entries e
           LEFT JOIN players p ON p.map_id=$2 AND p.environment=$3 AND p.uid=e.player_uid
          WHERE e.leaderboard_id=$4 AND p.rank_ban IS DISTINCT FROM TRUE
          ORDER BY e.score ${direction},e.updated_at,e.id LIMIT $5`,
        [created.rows[0].id, mapId, environment, leaderboardId, req.body.limit],
      );
      const updated = await client.query(
        "UPDATE leaderboard_snapshots SET entry_count=$1 WHERE id=$2 RETURNING *",
        [inserted.rowCount, created.rows[0].id],
      );
      return updated.rows[0];
    });
    await writeAudit(req, {
      action: "leaderboard.publish",
      resourceType: "leaderboard_snapshot",
      resourceId: snapshot.id,
      mapId,
      details: { leaderboardId, entryCount: snapshot.entry_count },
    });
    res.status(201).json({ success: true, data: snapshotRow(snapshot) });
  },
);

router.delete(
  "/:mapId/leaderboards/:leaderboardId/entries/:entryId",
  requireMapPermission(PERMISSIONS.LEADERBOARDS_MANAGE),
  async (req, res) => {
    const mapId = idSchema.parse(req.params.mapId);
    const leaderboardId = idSchema.parse(req.params.leaderboardId);
    const entryId = idSchema.parse(req.params.entryId);
    const result = await query(
      `DELETE FROM leaderboard_entries e USING leaderboards l
        WHERE e.id=$1 AND e.leaderboard_id=$2 AND l.id=e.leaderboard_id
          AND l.map_id=$3 AND l.environment=$4 RETURNING e.id,e.player_uid`,
      [entryId, leaderboardId, mapId, envFrom(req)],
    );
    if (!result.rows[0]) throw notFound("排行榜记录不存在");
    await writeAudit(req, {
      action: "leaderboard.entry.delete",
      resourceType: "leaderboard_entry",
      resourceId: entryId,
      mapId,
      details: { leaderboardId, uid: result.rows[0].player_uid },
    });
    res.json({ success: true });
  },
);

const riskRuleSchema = z.object({
  ruleKey: z
    .string()
    .trim()
    .min(1)
    .max(128)
    .regex(
      /^[A-Za-z0-9._-]+$/,
      "规则 Key 只能包含字母、数字、点、下划线和连字符",
    ),
  name: z.string().trim().min(1).max(160),
  severity: z.enum(["low", "medium", "high", "critical"]).default("medium"),
  enabled: z.boolean().default(true),
});

router.get(
  "/:mapId/risk/rules",
  requireMapPermission(PERMISSIONS.RISK_VIEW),
  async (req, res) => {
    const result = await query(
      `SELECT * FROM risk_rules WHERE map_id=$1 AND environment=$2 ORDER BY created_at`,
      [idSchema.parse(req.params.mapId), envFrom(req)],
    );
    res.json({ success: true, data: result.rows.map(riskRuleRow) });
  },
);

router.post(
  "/:mapId/risk/rules",
  requireMapPermission(PERMISSIONS.RISK_MANAGE),
  validate(riskRuleSchema),
  async (req, res) => {
    const mapId = idSchema.parse(req.params.mapId);
    const result = await query(
      `INSERT INTO risk_rules(map_id,environment,rule_key,name,severity,enabled)
       VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
      [
        mapId,
        envFrom(req),
        req.body.ruleKey,
        req.body.name,
        req.body.severity,
        req.body.enabled,
      ],
    );
    await writeAudit(req, {
      action: "risk_rule.create",
      resourceType: "risk_rule",
      resourceId: result.rows[0].id,
      mapId,
      details: { ruleKey: req.body.ruleKey },
    });
    res.status(201).json({ success: true, data: riskRuleRow(result.rows[0]) });
  },
);

router.patch(
  "/:mapId/risk/rules/:ruleId",
  requireMapPermission(PERMISSIONS.RISK_MANAGE),
  validate(riskRuleSchema.partial()),
  async (req, res) => {
    const mapId = idSchema.parse(req.params.mapId);
    const ruleId = idSchema.parse(req.params.ruleId);
    const environment = envFrom(req);
    const current = await query(
      "SELECT * FROM risk_rules WHERE id=$1 AND map_id=$2 AND environment=$3",
      [ruleId, mapId, environment],
    );
    if (!current.rows[0]) throw notFound("风控规则不存在");
    const row = current.rows[0];
    const result = await query(
      `UPDATE risk_rules SET rule_key=$1,name=$2,severity=$3,enabled=$4,updated_at=NOW()
        WHERE id=$5 AND map_id=$6 AND environment=$7 RETURNING *`,
      [
        req.body.ruleKey ?? row.rule_key,
        req.body.name ?? row.name,
        req.body.severity ?? row.severity,
        req.body.enabled ?? row.enabled,
        ruleId,
        mapId,
        environment,
      ],
    );
    await writeAudit(req, {
      action: "risk_rule.update",
      resourceType: "risk_rule",
      resourceId: ruleId,
      mapId,
      details: { fields: Object.keys(req.body) },
    });
    res.json({ success: true, data: riskRuleRow(result.rows[0]) });
  },
);

router.delete(
  "/:mapId/risk/rules/:ruleId",
  requireMapPermission(PERMISSIONS.RISK_MANAGE),
  async (req, res) => {
    const mapId = idSchema.parse(req.params.mapId);
    const ruleId = idSchema.parse(req.params.ruleId);
    const result = await query(
      "DELETE FROM risk_rules WHERE id=$1 AND map_id=$2 AND environment=$3 RETURNING id,rule_key",
      [ruleId, mapId, envFrom(req)],
    );
    if (!result.rows[0]) throw notFound("风控规则不存在");
    await writeAudit(req, {
      action: "risk_rule.delete",
      resourceType: "risk_rule",
      resourceId: ruleId,
      mapId,
      details: { ruleKey: result.rows[0].rule_key },
    });
    res.json({ success: true });
  },
);

router.get(
  "/:mapId/risk/events",
  requireMapPermission(PERMISSIONS.RISK_VIEW),
  async (req, res) => {
    const mapId = idSchema.parse(req.params.mapId);
    const environment = envFrom(req);
    const { page, limit, offset } = pagination(req.query);
    const params = [mapId, environment];
    let where = "r.map_id=$1 AND r.environment=$2";
    const q = String(req.query.q || "").trim();
    if (q) {
      params.push(`%${q}%`);
      where += ` AND (r.player_uid ILIKE $${params.length} OR r.player_name ILIKE $${params.length} OR r.rule_name ILIKE $${params.length})`;
    }
    const status = String(req.query.status || "");
    if (["open", "reviewed", "blocked", "ignored"].includes(status)) {
      params.push(status);
      where += ` AND r.status=$${params.length}`;
    }
    const count = await query(
      `SELECT COUNT(*)::int AS count FROM risk_events r WHERE ${where}`,
      params,
    );
    const summary = await query(
      `SELECT COUNT(*) FILTER (WHERE status='open')::int AS open_count,
              COUNT(*) FILTER (WHERE severity='critical' AND status='open')::int AS critical_count,
              COUNT(*) FILTER (WHERE status='blocked')::int AS blocked_count,
              COUNT(*)::int AS total_count
         FROM risk_events WHERE map_id=$1 AND environment=$2`,
      [mapId, environment],
    );
    params.push(limit, offset);
    const result = await query(
      `SELECT r.*,p.item_ban,p.data_ban,p.rank_ban
         FROM risk_events r
         LEFT JOIN players p ON p.map_id=r.map_id AND p.environment=r.environment AND p.uid=r.player_uid
        WHERE ${where} ORDER BY r.occurred_at DESC,r.id DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    res.json({
      success: true,
      data: {
        items: result.rows.map(riskEventRow),
        summary: riskSummaryRow(summary.rows[0]),
      },
      pagination: { page, limit, total: count.rows[0].count },
    });
  },
);

router.patch(
  "/:mapId/risk/events/:eventId",
  requireMapPermission(PERMISSIONS.RISK_MANAGE),
  validate(
    z.object({
      status: z.enum(["open", "reviewed", "blocked", "ignored"]),
      itemBan: z.boolean().optional(),
      dataBan: z.boolean().optional(),
      rankBan: z.boolean().optional(),
      note: z.string().trim().max(1000).optional().default(""),
    }),
  ),
  async (req, res) => {
    const mapId = idSchema.parse(req.params.mapId);
    const eventId = idSchema.parse(req.params.eventId);
    const environment = envFrom(req);
    const updated = await transaction(async (client) => {
      const current = await client.query(
        "SELECT * FROM risk_events WHERE id=$1 AND map_id=$2 AND environment=$3 FOR UPDATE",
        [eventId, mapId, environment],
      );
      const event = current.rows[0];
      if (!event) throw notFound("风控事件不存在");
      const hasBanChange = ["itemBan", "dataBan", "rankBan"].some(
        (key) => req.body[key] !== undefined,
      );
      if (hasBanChange) {
        const playerResult = await client.query(
          "SELECT * FROM players WHERE map_id=$1 AND environment=$2 AND uid=$3",
          [mapId, environment, event.player_uid],
        );
        const player = playerResult.rows[0];
        if (player) {
          await client.query(
            `UPDATE players SET item_ban=$1,data_ban=$2,rank_ban=$3,updated_at=NOW()
              WHERE id=$4`,
            [
              req.body.itemBan ?? player.item_ban,
              req.body.dataBan ?? player.data_ban,
              req.body.rankBan ?? player.rank_ban,
              player.id,
            ],
          );
        } else {
          await client.query(
            `INSERT INTO players(map_id,environment,uid,name,item_ban,data_ban,rank_ban)
             VALUES($1,$2,$3,$4,$5,$6,$7)`,
            [
              mapId,
              environment,
              event.player_uid,
              event.player_name,
              req.body.itemBan ?? false,
              req.body.dataBan ?? false,
              req.body.rankBan ?? false,
            ],
          );
        }
      }
      const result = await client.query(
        `UPDATE risk_events SET status=$1,handled_by=$2,handled_at=NOW(),updated_at=NOW(),
           details=CASE WHEN $3='' THEN details ELSE details || jsonb_build_object('resolutionNote',$3::text) END
         WHERE id=$4 RETURNING *`,
        [req.body.status, req.user.id, req.body.note, eventId],
      );
      return result.rows[0];
    });
    await writeAudit(req, {
      action: "risk_event.resolve",
      resourceType: "risk_event",
      resourceId: eventId,
      mapId,
      details: {
        status: req.body.status,
        bans: {
          itemBan: req.body.itemBan,
          dataBan: req.body.dataBan,
          rankBan: req.body.rankBan,
        },
      },
    });
    res.json({ success: true, data: riskEventRow(updated) });
  },
);

router.get(
  "/:mapId/gifts",
  requireMapPermission(PERMISSIONS.GIFTS_MANAGE),
  async (req, res) => {
    const mapId = idSchema.parse(req.params.mapId);
    const result = await query(
      "SELECT * FROM gifts WHERE map_id=$1 ORDER BY created_at DESC",
      [mapId],
    );
    res.json({ success: true, data: result.rows.map(giftRow) });
  },
);

const giftSchema = z.object({
  giftKey: z.string().trim().min(1).max(128),
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(2000).optional().default(""),
  defaultValue: z.coerce.number().finite().optional().default(1),
  enabled: z.boolean().optional().default(true),
});
router.post(
  "/:mapId/gifts",
  requireMapPermission(PERMISSIONS.GIFTS_MANAGE),
  validate(giftSchema),
  async (req, res) => {
    const mapId = idSchema.parse(req.params.mapId);
    const result = await query(
      "INSERT INTO gifts(map_id,gift_key,name,description,default_value,enabled) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
      [
        mapId,
        req.body.giftKey,
        req.body.name,
        req.body.description,
        req.body.defaultValue,
        req.body.enabled,
      ],
    );
    await writeAudit(req, {
      action: "gift.create",
      resourceType: "gift",
      resourceId: result.rows[0].id,
      mapId,
      details: { giftKey: req.body.giftKey },
    });
    res.status(201).json({ success: true, data: giftRow(result.rows[0]) });
  },
);
router.patch(
  "/:mapId/gifts/:giftId",
  requireMapPermission(PERMISSIONS.GIFTS_MANAGE),
  validate(giftSchema.partial()),
  async (req, res) => {
    const mapId = idSchema.parse(req.params.mapId),
      giftId = idSchema.parse(req.params.giftId);
    const current = await query(
      "SELECT * FROM gifts WHERE id=$1 AND map_id=$2",
      [giftId, mapId],
    );
    if (!current.rows[0]) throw notFound("礼包不存在");
    const row = current.rows[0];
    const result = await query(
      "UPDATE gifts SET gift_key=$1,name=$2,description=$3,default_value=$4,enabled=$5,updated_at=NOW() WHERE id=$6 RETURNING *",
      [
        req.body.giftKey ?? row.gift_key,
        req.body.name ?? row.name,
        req.body.description ?? row.description,
        req.body.defaultValue ?? row.default_value,
        req.body.enabled ?? row.enabled,
        giftId,
      ],
    );
    await writeAudit(req, {
      action: "gift.update",
      resourceType: "gift",
      resourceId: giftId,
      mapId,
      details: { fields: Object.keys(req.body) },
    });
    res.json({ success: true, data: giftRow(result.rows[0]) });
  },
);
router.delete(
  "/:mapId/gifts/:giftId",
  requireMapPermission(PERMISSIONS.GIFTS_MANAGE),
  async (req, res) => {
    const mapId = idSchema.parse(req.params.mapId),
      giftId = idSchema.parse(req.params.giftId);
    const result = await query(
      "DELETE FROM gifts WHERE id=$1 AND map_id=$2 RETURNING id",
      [giftId, mapId],
    );
    if (!result.rows[0]) throw notFound("礼包不存在");
    await writeAudit(req, {
      action: "gift.delete",
      resourceType: "gift",
      resourceId: giftId,
      mapId,
    });
    res.json({ success: true });
  },
);

router.post(
  "/:mapId/gifts/grant",
  requireMapPermission(PERMISSIONS.GIFTS_MANAGE),
  validate(
    z.object({
      playerIds: z.array(z.coerce.number().int().positive()).min(1).max(500),
      grants: z
        .array(
          z.object({
            giftId: z.coerce.number().int().positive(),
            quantity: z.coerce.number().finite().min(0).max(1_000_000),
            booleanValue: z.boolean().optional().default(false),
          }),
        )
        .min(1)
        .max(100),
    }),
  ),
  async (req, res) => {
    const mapId = idSchema.parse(req.params.mapId);
    const environment = envFrom(req);
    const count = await transaction(async (client) => {
      let inserted = 0;
      for (const playerId of req.body.playerIds) {
        for (const grant of req.body.grants) {
          const result = await client.query(
            `INSERT INTO gift_grants(map_id,environment,gift_id,player_id,quantity,boolean_value,granted_by)
           SELECT $1::bigint,$2::varchar,$3::bigint,$4::bigint,$5::numeric,$6::boolean,$7::bigint
            WHERE EXISTS(SELECT 1 FROM players WHERE id=$4 AND map_id=$1 AND environment=$2)
              AND EXISTS(SELECT 1 FROM gifts WHERE id=$3 AND map_id=$1)`,
            [
              mapId,
              environment,
              grant.giftId,
              playerId,
              grant.quantity,
              grant.booleanValue,
              req.user.id,
            ],
          );
          inserted += result.rowCount;
        }
      }
      return inserted;
    });
    if (!count) throw conflict("没有匹配到可发放的玩家和礼包");
    await writeAudit(req, {
      action: "gift.grant",
      resourceType: "gift_grant",
      mapId,
      details: {
        playerCount: req.body.playerIds.length,
        grantCount: req.body.grants.length,
        inserted: count,
      },
    });
    res.json({ success: true, data: { count } });
  },
);

router.get(
  "/:mapId/messages",
  requireMapPermission(PERMISSIONS.PLAYERS_VIEW),
  async (req, res) => {
    const mapId = idSchema.parse(req.params.mapId);
    const environment = envFrom(req);
    const { page, limit, offset } = pagination(req.query);
    const result = await query(
      `SELECT pm.id,pm.subject,pm.content,pm.attachments,pm.status,pm.created_at,pm.delivered_at,
            p.id AS player_id,p.uid,p.name AS player_name
       FROM player_messages pm JOIN players p ON p.id=pm.player_id
      WHERE pm.map_id=$1 AND pm.environment=$2 ORDER BY pm.created_at DESC LIMIT $3 OFFSET $4`,
      [mapId, environment, limit, offset],
    );
    const total = await query(
      "SELECT COUNT(*)::int AS count FROM player_messages WHERE map_id=$1 AND environment=$2",
      [mapId, environment],
    );
    res.json({
      success: true,
      data: result.rows.map(messageRow),
      pagination: { page, limit, total: total.rows[0].count },
    });
  },
);

router.post(
  "/:mapId/messages",
  requireMapPermission(PERMISSIONS.PLAYERS_MANAGE),
  validate(
    z.object({
      playerIds: z.array(z.coerce.number().int().positive()).min(1).max(500),
      subject: z.string().trim().min(1).max(160),
      content: z.string().trim().min(1).max(10_000),
      attachments: z
        .array(
          z.object({
            key: z.string().trim().min(1).max(128),
            value: z.coerce.number().finite(),
          }),
        )
        .max(50)
        .optional()
        .default([]),
    }),
  ),
  async (req, res) => {
    const mapId = idSchema.parse(req.params.mapId);
    const environment = envFrom(req);
    const inserted = await query(
      `INSERT INTO player_messages(map_id,environment,player_id,subject,content,attachments,created_by)
     SELECT $1::bigint,$2::varchar,p.id,$3::varchar,$4::text,$5::jsonb,$6::bigint FROM players p
      WHERE p.map_id=$1 AND p.environment=$2 AND p.id=ANY($7::bigint[])
     RETURNING id`,
      [
        mapId,
        environment,
        req.body.subject,
        req.body.content,
        JSON.stringify(req.body.attachments),
        req.user.id,
        req.body.playerIds,
      ],
    );
    if (!inserted.rowCount) throw conflict("没有匹配到可发送的玩家");
    await writeAudit(req, {
      action: "player.message.send",
      resourceType: "player_message",
      mapId,
      details: { count: inserted.rowCount, subject: req.body.subject },
    });
    res.status(201).json({ success: true, data: { count: inserted.rowCount } });
  },
);

router.get(
  "/:mapId/lotteries",
  requireMapPermission(PERMISSIONS.GIFTS_MANAGE),
  async (req, res) => {
    const mapId = idSchema.parse(req.params.mapId);
    const environment = envFrom(req);
    const result = await query(
      `SELECT c.*,COUNT(e.id)::int AS participant_count,COUNT(e.id) FILTER(WHERE e.is_winner)::int AS actual_winner_count
       FROM lottery_campaigns c LEFT JOIN lottery_entries e ON e.campaign_id=c.id
      WHERE c.map_id=$1 AND c.environment=$2 GROUP BY c.id ORDER BY c.created_at DESC`,
      [mapId, environment],
    );
    res.json({ success: true, data: result.rows.map(lotteryAdminRow) });
  },
);

router.post(
  "/:mapId/lotteries",
  requireMapPermission(PERMISSIONS.GIFTS_MANAGE),
  validate(
    z.object({
      title: z.string().trim().min(1).max(160),
      description: z.string().trim().max(4000).optional().default(""),
      drawAt: z.iso.datetime().nullable().optional(),
      winnerCount: z.coerce.number().int().min(1).max(100).default(1),
      rewardConfig: z
        .array(
          z.object({
            giftId: z.coerce.number().int().positive(),
            quantity: z.coerce.number().finite().min(0).max(1_000_000),
          }),
        )
        .max(100)
        .optional()
        .default([]),
    }),
  ),
  async (req, res) => {
    const mapId = idSchema.parse(req.params.mapId);
    const environment = envFrom(req);
    const token = createOpaqueToken("lot_");
    const result = await query(
      `INSERT INTO lottery_campaigns(map_id,environment,public_token,title,description,draw_at,winner_count,reward_config,created_by)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9) RETURNING *`,
      [
        mapId,
        environment,
        token,
        req.body.title,
        req.body.description,
        req.body.drawAt || null,
        req.body.winnerCount,
        JSON.stringify(req.body.rewardConfig),
        req.user.id,
      ],
    );
    await writeAudit(req, {
      action: "lottery.create",
      resourceType: "lottery_campaign",
      resourceId: result.rows[0].id,
      mapId,
      details: { title: req.body.title, environment },
    });
    res.status(201).json({
      success: true,
      data: {
        ...lotteryAdminRow(result.rows[0]),
        publicPath: `/lottery/${token}`,
      },
    });
  },
);

router.post(
  "/:mapId/lotteries/:campaignId/draw",
  requireMapPermission(PERMISSIONS.GIFTS_MANAGE),
  async (req, res) => {
    const mapId = idSchema.parse(req.params.mapId);
    const campaignId = idSchema.parse(req.params.campaignId);
    const winners = await transaction(async (client) => {
      const campaignResult = await client.query(
        "SELECT * FROM lottery_campaigns WHERE id=$1 AND map_id=$2 FOR UPDATE",
        [campaignId, mapId],
      );
      const campaign = campaignResult.rows[0];
      if (!campaign) throw notFound("抽奖活动不存在");
      if (campaign.status !== "open") throw conflict("该活动已经开奖或取消");
      const selected = await client.query(
        `SELECT id,player_name,player_uid FROM lottery_entries WHERE campaign_id=$1
       ORDER BY RANDOM() LIMIT $2`,
        [campaignId, campaign.winner_count],
      );
      if (!selected.rowCount) throw conflict("当前没有参与者，无法开奖");
      await client.query(
        "UPDATE lottery_entries SET is_winner=TRUE WHERE id=ANY($1::bigint[])",
        [selected.rows.map((row) => row.id)],
      );
      await client.query(
        "UPDATE lottery_campaigns SET status='drawn',drawn_at=NOW(),updated_at=NOW() WHERE id=$1",
        [campaignId],
      );
      return selected.rows;
    });
    await writeAudit(req, {
      action: "lottery.draw",
      resourceType: "lottery_campaign",
      resourceId: campaignId,
      mapId,
      details: { winnerCount: winners.length },
    });
    res.json({ success: true, data: winners });
  },
);

router.delete(
  "/:mapId/lotteries/:campaignId",
  requireMapPermission(PERMISSIONS.GIFTS_MANAGE),
  async (req, res) => {
    const mapId = idSchema.parse(req.params.mapId);
    const campaignId = idSchema.parse(req.params.campaignId);
    const result = await query(
      "UPDATE lottery_campaigns SET status='cancelled',updated_at=NOW() WHERE id=$1 AND map_id=$2 AND status='open' RETURNING id",
      [campaignId, mapId],
    );
    if (!result.rows[0]) throw conflict("活动不存在或不能取消");
    await writeAudit(req, {
      action: "lottery.cancel",
      resourceType: "lottery_campaign",
      resourceId: campaignId,
      mapId,
    });
    res.json({ success: true });
  },
);

router.post(
  "/:mapId/runtime/clear",
  requireAuth,
  requireAdmin,
  validate(
    z.object({
      environment: z.enum(["release", "lobby", "test"]),
      confirmName: z.string().trim().min(1).max(160),
    }),
  ),
  async (req, res) => {
    const mapId = idSchema.parse(req.params.mapId);
    const mapResult = await query("SELECT name FROM maps WHERE id=$1", [mapId]);
    const map = mapResult.rows[0];
    if (!map) throw notFound("地图不存在");
    if (req.body.confirmName !== map.name) throw conflict("地图名称确认不匹配");
    const counts = await transaction(async (client) => {
      const messages = await client.query(
        "DELETE FROM player_messages WHERE map_id=$1 AND environment=$2",
        [mapId, req.body.environment],
      );
      const grants = await client.query(
        "DELETE FROM gift_grants WHERE map_id=$1 AND environment=$2",
        [mapId, req.body.environment],
      );
      const leaderboardSnapshots = await client.query(
        `DELETE FROM leaderboard_snapshots s USING leaderboards l
          WHERE s.leaderboard_id=l.id AND l.map_id=$1 AND l.environment=$2`,
        [mapId, req.body.environment],
      );
      const leaderboardEntries = await client.query(
        `DELETE FROM leaderboard_entries e USING leaderboards l
          WHERE e.leaderboard_id=l.id AND l.map_id=$1 AND l.environment=$2`,
        [mapId, req.body.environment],
      );
      const riskEvents = await client.query(
        "DELETE FROM risk_events WHERE map_id=$1 AND environment=$2",
        [mapId, req.body.environment],
      );
      const playerArchives = await client.query(
        "DELETE FROM fq_player_archives WHERE map_id=$1 AND environment=$2",
        [mapId, req.body.environment],
      );
      const globalArchives = await client.query(
        "DELETE FROM fq_global_archives WHERE map_id=$1 AND environment=$2",
        [mapId, req.body.environment],
      );
      const players = await client.query(
        "DELETE FROM players WHERE map_id=$1 AND environment=$2",
        [mapId, req.body.environment],
      );
      const logs = await client.query(
        "DELETE FROM map_logs WHERE map_id=$1 AND environment=$2",
        [mapId, req.body.environment],
      );
      const metrics = await client.query(
        "DELETE FROM map_metrics WHERE map_id=$1 AND environment=$2",
        [mapId, req.body.environment],
      );
      await client.query(
        "UPDATE tracking_points SET trigger_count=0,updated_at=NOW() WHERE map_id=$1 AND environment=$2",
        [mapId, req.body.environment],
      );
      return {
        messages: messages.rowCount,
        grants: grants.rowCount,
        leaderboardSnapshots: leaderboardSnapshots.rowCount,
        leaderboardEntries: leaderboardEntries.rowCount,
        riskEvents: riskEvents.rowCount,
        playerArchives: playerArchives.rowCount,
        globalArchives: globalArchives.rowCount,
        players: players.rowCount,
        logs: logs.rowCount,
        metrics: metrics.rowCount,
      };
    });
    await writeAudit(req, {
      action: "map.runtime.clear",
      resourceType: "map",
      resourceId: mapId,
      mapId,
      details: { environment: req.body.environment, counts },
    });
    res.json({ success: true, data: counts });
  },
);

addSimpleResourceRoutes({
  router,
  pathName: "anchors",
  table: "anchors",
  permission: PERMISSIONS.ANCHORS_MANAGE,
  schema: z.object({
    name: z.string().trim().min(1).max(160),
    enabled: z.boolean().optional().default(true),
    giftConfig: z.record(z.string(), z.unknown()).optional().default({}),
  }),
  columns: { name: "name", enabled: "enabled", giftConfig: "gift_config" },
  rowMapper: anchorRow,
});
addSimpleResourceRoutes({
  router,
  pathName: "points",
  table: "tracking_points",
  permission: PERMISSIONS.POINTS_MANAGE,
  schema: z.object({
    pointKey: z.string().trim().min(1).max(128),
    name: z.string().trim().min(1).max(160),
    enabled: z.boolean().optional().default(true),
  }),
  columns: { pointKey: "point_key", name: "name", enabled: "enabled" },
  rowMapper: pointRow,
});

router.get(
  "/:mapId/logs",
  requireMapPermission(PERMISSIONS.LOGS_VIEW),
  async (req, res) => {
    const mapId = idSchema.parse(req.params.mapId),
      { page, limit, offset } = pagination(req.query);
    const environment = envFrom(req);
    const result = await query(
      "SELECT * FROM map_logs WHERE map_id=$1 AND environment=$2 ORDER BY updated_at DESC LIMIT $3 OFFSET $4",
      [mapId, environment, limit, offset],
    );
    const total = await query(
      "SELECT COUNT(*)::int AS count FROM map_logs WHERE map_id=$1 AND environment=$2",
      [mapId, environment],
    );
    res.json({
      success: true,
      data: result.rows.map(logRow),
      pagination: { page, limit, total: total.rows[0].count },
    });
  },
);
router.delete(
  "/:mapId/logs/:logId",
  requireMapPermission(PERMISSIONS.MAP_EDIT),
  async (req, res) => {
    const mapId = idSchema.parse(req.params.mapId),
      logId = idSchema.parse(req.params.logId);
    const result = await query(
      "DELETE FROM map_logs WHERE id=$1 AND map_id=$2 AND environment=$3 RETURNING id",
      [logId, mapId, envFrom(req)],
    );
    if (!result.rows[0]) throw notFound("日志不存在");
    await writeAudit(req, {
      action: "log.delete",
      resourceType: "map_log",
      resourceId: logId,
      mapId,
    });
    res.json({ success: true });
  },
);

const upload = multer({
  storage: multer.diskStorage({
    destination(req, _file, callback) {
      const dir = path.join(config.uploadDir, `map-${req.params.mapId}`);
      mkdir(dir, { recursive: true }).then(() => callback(null, dir), callback);
    },
    filename(_req, file, callback) {
      const ext = path
        .extname(sanitizeFileName(file.originalname))
        .slice(0, 16);
      callback(null, `${randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: config.uploadMaxBytes, files: 20, fields: 10, parts: 30 },
  fileFilter(_req, file, callback) {
    const forbiddenTypes = [
      "application/x-msdownload",
      "application/x-sh",
      "application/x-bat",
      "application/x-powershell",
    ];
    const extension = path
      .extname(sanitizeFileName(file.originalname))
      .toLowerCase();
    const rejected =
      forbiddenTypes.includes(file.mimetype) ||
      forbiddenUploadExtensions.has(extension);
    callback(
      rejected
        ? new HttpError(400, "不允许上传可执行脚本文件", "FILE_TYPE_REJECTED")
        : null,
      !rejected,
    );
  },
});

router.get(
  "/:mapId/files",
  requireMapPermission(PERMISSIONS.FILES_MANAGE),
  async (req, res) => {
    const mapId = idSchema.parse(req.params.mapId);
    const folder = normalizeRelativePath(String(req.query.folder || ""));
    const prefix = folder ? `${folder}/` : "";
    const result = await query(
      `SELECT * FROM map_files WHERE map_id=$1 AND relative_path LIKE $2
      AND POSITION('/' IN SUBSTRING(relative_path FROM $3::integer))=0 ORDER BY kind DESC,original_name`,
      [mapId, `${prefix}%`, prefix.length + 1],
    );
    res.json({ success: true, data: result.rows.map(fileRow), folder });
  },
);

router.post(
  "/:mapId/files/upload",
  requireMapPermission(PERMISSIONS.FILES_MANAGE),
  upload.array("files", 20),
  async (req, res) => {
    const mapId = idSchema.parse(req.params.mapId);
    const folder = normalizeRelativePath(String(req.query.folder || ""));
    if (!req.files?.length)
      throw new HttpError(400, "请选择需要上传的文件", "FILE_REQUIRED");
    let inserted = [];
    try {
      const files = await Promise.all(
        (req.files || []).map(async (file) => ({
          ...file,
          originalName: sanitizeFileName(file.originalname),
          hash: await fileSha256(file.path),
        })),
      );
      inserted = await transaction(async (client) => {
        const rows = [];
        for (const file of files) {
          const relativePath = [folder, file.originalName]
            .filter(Boolean)
            .join("/");
          const result = await client.query(
            `INSERT INTO map_files(map_id,kind,original_name,storage_name,relative_path,mime_type,size_bytes,sha256,uploaded_by)
           VALUES($1,'file',$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
            [
              mapId,
              file.originalName,
              file.filename,
              relativePath,
              file.mimetype,
              file.size,
              file.hash,
              req.user.id,
            ],
          );
          rows.push(result.rows[0]);
        }
        return rows;
      });
    } catch (error) {
      await Promise.all(
        (req.files || []).map((file) => rm(file.path, { force: true })),
      );
      throw error;
    }
    await writeAudit(req, {
      action: "file.upload",
      resourceType: "map_file",
      mapId,
      details: {
        count: inserted.length,
        folder,
        names: inserted.map((item) => item.original_name),
      },
    });
    res.status(201).json({ success: true, data: inserted.map(fileRow) });
  },
);

router.post(
  "/:mapId/files/folder",
  requireMapPermission(PERMISSIONS.FILES_MANAGE),
  validate(
    z.object({
      name: z.string().trim().min(1).max(180),
      parent: z.string().max(900).optional().default(""),
    }),
  ),
  async (req, res) => {
    const mapId = idSchema.parse(req.params.mapId);
    const name = sanitizeFileName(req.body.name),
      parent = normalizeRelativePath(req.body.parent);
    const relativePath = [parent, name].filter(Boolean).join("/");
    const result = await query(
      "INSERT INTO map_files(map_id,kind,original_name,relative_path,uploaded_by) VALUES($1,'folder',$2,$3,$4) RETURNING *",
      [mapId, name, relativePath, req.user.id],
    );
    await writeAudit(req, {
      action: "folder.create",
      resourceType: "map_file",
      resourceId: result.rows[0].id,
      mapId,
      details: { relativePath },
    });
    res.status(201).json({ success: true, data: fileRow(result.rows[0]) });
  },
);

router.get(
  "/:mapId/files/:fileId/download",
  requireMapPermission(PERMISSIONS.FILES_MANAGE),
  async (req, res, next) => {
    const mapId = idSchema.parse(req.params.mapId),
      fileId = idSchema.parse(req.params.fileId);
    const result = await query(
      "SELECT * FROM map_files WHERE id=$1 AND map_id=$2 AND kind='file'",
      [fileId, mapId],
    );
    const file = result.rows[0];
    if (!file) throw notFound("文件不存在");
    const absolute = safeStoragePath(mapId, file.storage_name);
    if (
      req.query.inline === "1" &&
      inlineImageTypes.has(file.mime_type || "")
    ) {
      res.type(file.mime_type || "application/octet-stream");
    } else {
      res.attachment(file.original_name);
      res.type(file.mime_type || "application/octet-stream");
    }
    return createReadStream(absolute).on("error", next).pipe(res);
  },
);

router.delete(
  "/:mapId/files/:fileId",
  requireMapPermission(PERMISSIONS.FILES_MANAGE),
  async (req, res) => {
    const mapId = idSchema.parse(req.params.mapId),
      fileId = idSchema.parse(req.params.fileId);
    const target = await query(
      "SELECT * FROM map_files WHERE id=$1 AND map_id=$2",
      [fileId, mapId],
    );
    if (!target.rows[0]) throw notFound("文件或文件夹不存在");
    const row = target.rows[0];
    const affected = await query(
      "DELETE FROM map_files WHERE map_id=$1 AND (relative_path=$2 OR relative_path LIKE $3) RETURNING storage_name",
      [mapId, row.relative_path, `${row.relative_path}/%`],
    );
    await Promise.all(
      affected.rows
        .filter((item) => item.storage_name)
        .map((item) =>
          rm(safeStoragePath(mapId, item.storage_name), { force: true }),
        ),
    );
    await writeAudit(req, {
      action: "file.delete",
      resourceType: "map_file",
      resourceId: fileId,
      mapId,
      details: { relativePath: row.relative_path, count: affected.rowCount },
    });
    res.json({ success: true });
  },
);

router.get(
  "/:mapId/api-keys",
  requireMapPermission(PERMISSIONS.API_KEYS_MANAGE),
  async (req, res) => {
    const mapId = idSchema.parse(req.params.mapId);
    const result = await query(
      "SELECT id,name,environment,token_prefix,permissions,status,last_used_at,created_at FROM api_keys WHERE map_id=$1 ORDER BY created_at DESC",
      [mapId],
    );
    res.json({ success: true, data: result.rows });
  },
);
router.post(
  "/:mapId/api-keys",
  requireMapPermission(PERMISSIONS.API_KEYS_MANAGE),
  validate(
    z.object({
      name: z.string().trim().min(1).max(100),
      environment: z.enum(["release", "lobby", "test"]).default("release"),
      permissions: z
        .array(
          z.enum([
            "game.players.write",
            "game.archives.read",
            "game.archives.write",
            "game.logs.write",
            "game.metrics.write",
            "game.points.write",
            "game.leaderboards.write",
            "game.risk.write",
            "game.messages.read",
            "game.gifts.read",
          ]),
        )
        .min(1),
    }),
  ),
  async (req, res) => {
    const mapId = idSchema.parse(req.params.mapId),
      token = createOpaqueToken("fqmap_");
    const result = await query(
      "INSERT INTO api_keys(map_id,environment,name,token_hash,token_prefix,permissions,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,name,environment,token_prefix,permissions,status,created_at",
      [
        mapId,
        req.body.environment,
        req.body.name,
        hashToken(token),
        token.slice(0, 12),
        req.body.permissions,
        req.user.id,
      ],
    );
    await writeAudit(req, {
      action: "api_key.create",
      resourceType: "api_key",
      resourceId: result.rows[0].id,
      mapId,
      details: { name: req.body.name, permissions: req.body.permissions },
    });
    res.status(201).json({ success: true, data: { ...result.rows[0], token } });
  },
);
router.delete(
  "/:mapId/api-keys/:keyId",
  requireMapPermission(PERMISSIONS.API_KEYS_MANAGE),
  async (req, res) => {
    const mapId = idSchema.parse(req.params.mapId),
      keyId = idSchema.parse(req.params.keyId);
    const result = await query(
      "UPDATE api_keys SET status='disabled' WHERE id=$1 AND map_id=$2 RETURNING id",
      [keyId, mapId],
    );
    if (!result.rows[0]) throw notFound("API Key 不存在");
    await writeAudit(req, {
      action: "api_key.disable",
      resourceType: "api_key",
      resourceId: keyId,
      mapId,
    });
    res.json({ success: true });
  },
);

function addSimpleResourceRoutes({
  router: target,
  pathName,
  table,
  permission,
  schema,
  columns,
  rowMapper,
}) {
  target.get(
    `/:mapId/${pathName}`,
    requireMapPermission(permission),
    async (req, res) => {
      const mapId = idSchema.parse(req.params.mapId);
      const environment = envFrom(req);
      const result = await query(
        `SELECT * FROM ${table} WHERE map_id=$1 AND environment=$2 ORDER BY created_at DESC`,
        [mapId, environment],
      );
      res.json({ success: true, data: result.rows.map(rowMapper) });
    },
  );
  target.post(
    `/:mapId/${pathName}`,
    requireMapPermission(permission),
    validate(schema),
    async (req, res) => {
      const mapId = idSchema.parse(req.params.mapId);
      const environment = envFrom(req);
      const entries = Object.entries(columns);
      const values = entries.map(([apiKey]) =>
        apiKey === "giftConfig"
          ? JSON.stringify(req.body[apiKey])
          : req.body[apiKey],
      );
      const shiftedPlaceholders = values.map(
        (_, index) =>
          `$${index + 3}${entries[index][0] === "giftConfig" ? "::jsonb" : ""}`,
      );
      const result = await query(
        `INSERT INTO ${table}(map_id,environment,${entries.map(([, db]) => db).join(",")}) VALUES($1,$2,${shiftedPlaceholders.join(",")}) RETURNING *`,
        [mapId, environment, ...values],
      );
      await writeAudit(req, {
        action: `${pathName}.create`,
        resourceType: table,
        resourceId: result.rows[0].id,
        mapId,
      });
      res.status(201).json({ success: true, data: rowMapper(result.rows[0]) });
    },
  );
  target.patch(
    `/:mapId/${pathName}/:resourceId`,
    requireMapPermission(permission),
    validate(schema.partial()),
    async (req, res) => {
      const mapId = idSchema.parse(req.params.mapId),
        resourceId = idSchema.parse(req.params.resourceId);
      const environment = envFrom(req);
      const current = await query(
        `SELECT * FROM ${table} WHERE id=$1 AND map_id=$2 AND environment=$3`,
        [resourceId, mapId, environment],
      );
      if (!current.rows[0]) throw notFound("记录不存在");
      const entries = Object.entries(columns);
      const values = entries.map(([apiKey, dbKey]) =>
        apiKey === "giftConfig"
          ? JSON.stringify(req.body[apiKey] ?? current.rows[0][dbKey])
          : (req.body[apiKey] ?? current.rows[0][dbKey]),
      );
      const assignments = entries.map(
        ([, dbKey], index) =>
          `${dbKey}=$${index + 1}${dbKey === "gift_config" ? "::jsonb" : ""}`,
      );
      const result = await query(
        `UPDATE ${table} SET ${assignments.join(",")},updated_at=NOW() WHERE id=$${values.length + 1} AND map_id=$${values.length + 2} AND environment=$${values.length + 3} RETURNING *`,
        [...values, resourceId, mapId, environment],
      );
      await writeAudit(req, {
        action: `${pathName}.update`,
        resourceType: table,
        resourceId,
        mapId,
        details: { fields: Object.keys(req.body) },
      });
      res.json({ success: true, data: rowMapper(result.rows[0]) });
    },
  );
  target.delete(
    `/:mapId/${pathName}/:resourceId`,
    requireMapPermission(permission),
    async (req, res) => {
      const mapId = idSchema.parse(req.params.mapId),
        resourceId = idSchema.parse(req.params.resourceId);
      const result = await query(
        `DELETE FROM ${table} WHERE id=$1 AND map_id=$2 AND environment=$3 RETURNING id`,
        [resourceId, mapId, envFrom(req)],
      );
      if (!result.rows[0]) throw notFound("记录不存在");
      await writeAudit(req, {
        action: `${pathName}.delete`,
        resourceType: table,
        resourceId,
        mapId,
      });
      res.json({ success: true });
    },
  );
}

function pagination(input) {
  const page = Math.max(1, Number(input.page) || 1),
    limit = Math.min(100, Math.max(1, Number(input.limit) || 20));
  return { page, limit, offset: (page - 1) * limit };
}
function envFrom(req) {
  const value = String(
    req.query.environment || req.body?.environment || "release",
  );
  return ["release", "lobby", "test"].includes(value) ? value : "release";
}
function mapRow(row) {
  return {
    id: Number(row.id),
    name: row.name,
    description: row.description || "",
    status: row.status,
    runtimeEnv: row.runtime_env,
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
function playerRow(row) {
  return {
    id: Number(row.id),
    uid: row.uid,
    name: row.name,
    level: row.level,
    gameLevel: row.game_level,
    itemBan: row.item_ban,
    dataBan: row.data_ban,
    rankBan: row.rank_ban,
    profile: row.profile || {},
    lastActiveAt: row.last_active_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
function leaderboardRow(row) {
  return {
    id: Number(row.id),
    leaderboardKey: row.leaderboard_key,
    name: row.name,
    valueLabel: row.value_label,
    sortDirection: row.sort_direction,
    enabled: row.enabled,
    entryCount: Number(row.entry_count || 0),
    latestSnapshotId: row.latest_snapshot_id
      ? Number(row.latest_snapshot_id)
      : null,
    latestSnapshotCount: Number(row.latest_snapshot_count || 0),
    latestPublishedAt: row.latest_published_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
function leaderboardEntryRow(row) {
  return {
    id: row.id ? Number(row.id) : null,
    rank: Number(row.rank),
    uid: row.player_uid,
    name: row.player_name,
    gameLevel: row.game_level,
    score: Number(row.score),
    gameCount: Number(row.game_count),
    metadata: row.metadata || {},
    updatedAt: row.updated_at,
  };
}
function snapshotRow(row) {
  return {
    id: Number(row.id),
    entryCount: Number(row.entry_count || 0),
    publishedAt: row.published_at,
  };
}
function riskRuleRow(row) {
  return {
    id: Number(row.id),
    ruleKey: row.rule_key,
    name: row.name,
    severity: row.severity,
    enabled: row.enabled,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
function riskEventRow(row) {
  return {
    id: Number(row.id),
    eventKey: row.event_key,
    ruleKey: row.rule_key,
    ruleName: row.rule_name,
    severity: row.severity,
    uid: row.player_uid,
    playerName: row.player_name,
    count: Number(row.occurrence_count),
    status: row.status,
    details: row.details || {},
    occurredAt: row.occurred_at,
    handledAt: row.handled_at,
    itemBan: Boolean(row.item_ban),
    dataBan: Boolean(row.data_ban),
    rankBan: Boolean(row.rank_ban),
  };
}
function riskSummaryRow(row) {
  return {
    open: Number(row.open_count || 0),
    critical: Number(row.critical_count || 0),
    blocked: Number(row.blocked_count || 0),
    total: Number(row.total_count || 0),
  };
}
function giftRow(row) {
  return {
    id: Number(row.id),
    giftKey: row.gift_key,
    name: row.name,
    description: row.description,
    defaultValue: Number(row.default_value),
    enabled: row.enabled,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
function messageRow(row) {
  return {
    id: Number(row.id),
    playerId: Number(row.player_id),
    uid: row.uid,
    playerName: row.player_name,
    subject: row.subject,
    content: row.content,
    attachments: row.attachments || [],
    status: row.status,
    createdAt: row.created_at,
    deliveredAt: row.delivered_at,
  };
}
function lotteryAdminRow(row) {
  return {
    id: Number(row.id),
    title: row.title,
    description: row.description,
    status: row.status,
    environment: row.environment,
    drawAt: row.draw_at,
    drawnAt: row.drawn_at,
    winnerCount: Number(row.winner_count),
    actualWinnerCount: Number(row.actual_winner_count || 0),
    participantCount: Number(row.participant_count || 0),
    rewardConfig: row.reward_config || [],
    publicPath: `/lottery/${row.public_token}`,
    createdAt: row.created_at,
  };
}
function anchorRow(row) {
  return {
    id: Number(row.id),
    name: row.name,
    enabled: row.enabled,
    giftConfig: row.gift_config || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
function pointRow(row) {
  return {
    id: Number(row.id),
    pointKey: row.point_key,
    name: row.name,
    enabled: row.enabled,
    triggerCount: Number(row.trigger_count),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
function logRow(row) {
  return {
    id: Number(row.id),
    context: row.context,
    playerCount: Number(row.player_count),
    uploadCount: Number(row.upload_count),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
function fileRow(row) {
  return {
    id: Number(row.id),
    kind: row.kind,
    name: row.original_name,
    relativePath: row.relative_path,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    sha256: row.sha256,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
function metricRow(row) {
  return {
    date: row.metric_date,
    cumulativeUsers: Number(row.cumulative_users),
    onlineUsers: Number(row.online_users),
    totalGameCount: Number(row.total_game_count),
    dailyNewUsers: Number(row.daily_new_users),
    dailyActiveUsers: Number(row.daily_active_users),
    lostUserCount: Number(row.lost_user_count),
    returnUserCount: Number(row.return_user_count),
    activeUserRetentionRate: Number(row.active_user_retention_rate),
    newUserRetentionRate: Number(row.new_user_retention_rate),
    sevenDayRetentionRate: Number(row.seven_day_retention_rate),
    replayRate: Number(row.replay_rate),
  };
}
function emptyMetrics(mapId) {
  return {
    map_id: mapId,
    metric_date: new Date().toISOString().slice(0, 10),
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
async function fileSha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(filePath)
      .on("error", reject)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => resolve(hash.digest("hex")));
  });
}
function safeStoragePath(mapId, storageName) {
  const base = path.resolve(config.uploadDir, `map-${mapId}`),
    target = path.resolve(base, storageName);
  if (!target.startsWith(`${base}${path.sep}`)) throw new Error("非法文件路径");
  return target;
}

export default router;
