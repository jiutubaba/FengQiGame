import { z } from "zod";
import { query, transaction } from "../../db/index.js";
import { writeAudit } from "../../lib/audit.js";
import { HttpError, notFound } from "../../lib/errors.js";
import { PERMISSIONS, requireMapPermission } from "../../middleware/auth.js";
import { validate } from "../../middleware/validation.js";
import { idSchema, pagination } from "./shared.js";

export function registerLeaderboardRoutes(router) {
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
    scoreUpdateMode: z.enum(["latest", "best"]).default("latest"),
    enabled: z.boolean().default(true),
  });

  router.get(
    "/:mapId/leaderboards",
    requireMapPermission(PERMISSIONS.LEADERBOARDS_VIEW),
    async (req, res) => {
      const mapId = idSchema.parse(req.params.mapId);
      const result = await query(
        `SELECT l.*,
                COUNT(e.id) FILTER (WHERE p.rank_ban IS DISTINCT FROM TRUE)::int AS entry_count,
                latest.id AS latest_snapshot_id,
                latest.entry_count AS latest_snapshot_count,
                latest.published_at AS latest_published_at
           FROM leaderboards l
           LEFT JOIN leaderboard_entries e ON e.leaderboard_id=l.id
           LEFT JOIN players p ON p.map_id=l.map_id AND p.uid=e.player_uid
           LEFT JOIN LATERAL (
             SELECT id,entry_count,published_at FROM leaderboard_snapshots
              WHERE leaderboard_id=l.id ORDER BY published_at DESC,id DESC LIMIT 1
           ) latest ON TRUE
          WHERE l.map_id=$1
          GROUP BY l.id,latest.id,latest.entry_count,latest.published_at
          ORDER BY l.created_at`,
        [mapId],
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
        `INSERT INTO leaderboards(map_id,leaderboard_key,name,value_label,sort_direction,score_update_mode,enabled)
         VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [
          mapId,
          req.body.leaderboardKey,
          req.body.name,
          req.body.valueLabel,
          req.body.sortDirection,
          req.body.scoreUpdateMode,
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
      const current = await query(
        "SELECT * FROM leaderboards WHERE id=$1 AND map_id=$2",
        [leaderboardId, mapId],
      );
      if (!current.rows[0]) throw notFound("排行榜不存在");
      const row = current.rows[0];
      if (
        req.body.leaderboardKey !== undefined &&
        req.body.leaderboardKey !== row.leaderboard_key
      ) {
        throw new HttpError(
          400,
          "榜单 Key 创建后不可修改",
          "LEADERBOARD_KEY_IMMUTABLE",
        );
      }
      const result = await query(
        `UPDATE leaderboards SET leaderboard_key=$1,name=$2,value_label=$3,sort_direction=$4,score_update_mode=$5,enabled=$6,updated_at=NOW()
          WHERE id=$7 AND map_id=$8 RETURNING *`,
        [
          row.leaderboard_key,
          req.body.name ?? row.name,
          req.body.valueLabel ?? row.value_label,
          req.body.sortDirection ?? row.sort_direction,
          req.body.scoreUpdateMode ?? row.score_update_mode,
          req.body.enabled ?? row.enabled,
          leaderboardId,
          mapId,
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
        "DELETE FROM leaderboards WHERE id=$1 AND map_id=$2 RETURNING id,leaderboard_key",
        [leaderboardId, mapId],
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
      const { page, limit, offset } = pagination(req.query);
      const q = String(req.query.q || "").trim();
      const leaderboardResult = await query(
        "SELECT * FROM leaderboards WHERE id=$1 AND map_id=$2",
        [leaderboardId, mapId],
      );
      const leaderboard = leaderboardResult.rows[0];
      if (!leaderboard) throw notFound("排行榜不存在");
      const snapshots = await query(
        `SELECT id,entry_count,published_at FROM leaderboard_snapshots
          WHERE leaderboard_id=$1 ORDER BY published_at DESC,id DESC LIMIT 30`,
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
          `SELECT rank,player_uid,player_name,game_level,score,game_count,metadata,achieved_at AS updated_at
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
            LEFT JOIN players p ON p.map_id=$2 AND p.uid=e.player_uid
           WHERE e.leaderboard_id=$1 AND p.rank_ban IS DISTINCT FROM TRUE
        )`;
        const liveParams = [leaderboardId, mapId];
        let liveFilter = "TRUE";
        if (q) {
          liveParams.push(`%${q}%`);
          liveFilter = `(player_uid ILIKE $3 OR player_name ILIKE $3)`;
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
        limit: z.coerce.number().int().min(1).max(100).default(100),
      }),
    ),
    async (req, res) => {
      const mapId = idSchema.parse(req.params.mapId);
      const leaderboardId = idSchema.parse(req.params.leaderboardId);
      const snapshot = await transaction(async (client) => {
        const current = await client.query(
          "SELECT * FROM leaderboards WHERE id=$1 AND map_id=$2 FOR UPDATE",
          [leaderboardId, mapId],
        );
        const leaderboard = current.rows[0];
        if (!leaderboard) throw notFound("排行榜不存在");
        const created = await client.query(
          "INSERT INTO leaderboard_snapshots(leaderboard_id,published_by) VALUES($1,$2) RETURNING *",
          [leaderboardId, req.user.id],
        );
        const direction = leaderboard.sort_direction === "asc" ? "ASC" : "DESC";
        const inserted = await client.query(
          `INSERT INTO leaderboard_snapshot_entries(snapshot_id,rank,player_uid,player_name,game_level,score,game_count,metadata,achieved_at)
           SELECT $1,(ROW_NUMBER() OVER (ORDER BY e.score ${direction},e.updated_at,e.id))::int,e.player_uid,e.player_name,e.game_level,e.score,e.game_count,e.metadata,e.updated_at
             FROM leaderboard_entries e
             LEFT JOIN players p ON p.map_id=$2 AND p.uid=e.player_uid
            WHERE e.leaderboard_id=$3 AND p.rank_ban IS DISTINCT FROM TRUE
            ORDER BY e.score ${direction},e.updated_at,e.id LIMIT $4`,
          [created.rows[0].id, mapId, leaderboardId, req.body.limit],
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
            AND l.map_id=$3 RETURNING e.id,e.player_uid`,
        [entryId, leaderboardId, mapId],
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

  router.post(
    "/:mapId/leaderboards/:leaderboardId/entries/:entryId/rank-ban",
    requireMapPermission(PERMISSIONS.LEADERBOARDS_MANAGE),
    async (req, res) => {
      const mapId = idSchema.parse(req.params.mapId);
      const leaderboardId = idSchema.parse(req.params.leaderboardId);
      const entryId = idSchema.parse(req.params.entryId);
      const blocked = await transaction(async (client) => {
        const entryResult = await client.query(
          `SELECT e.id,e.player_uid,e.player_name
             FROM leaderboard_entries e
             JOIN leaderboards l ON l.id=e.leaderboard_id
            WHERE e.id=$1 AND e.leaderboard_id=$2 AND l.map_id=$3
            FOR UPDATE OF e`,
          [entryId, leaderboardId, mapId],
        );
        const entry = entryResult.rows[0];
        if (!entry) throw notFound("排行榜记录不存在");
        const playerResult = await client.query(
          `INSERT INTO players(map_id,uid,name,rank_ban)
           VALUES($1,$2,$3,TRUE)
           ON CONFLICT(map_id,uid) DO UPDATE SET
             rank_ban=TRUE,
             updated_at=NOW()
           RETURNING id,uid,name,rank_ban`,
          [mapId, entry.player_uid, entry.player_name],
        );
        return { entry, player: playerResult.rows[0] };
      });
      await writeAudit(req, {
        action: "leaderboard.player.ban",
        resourceType: "player",
        resourceId: blocked.player.id,
        mapId,
        details: {
          leaderboardId,
          entryId,
          uid: blocked.entry.player_uid,
        },
      });
      res.json({
        success: true,
        data: {
          entryId: Number(blocked.entry.id),
          playerId: Number(blocked.player.id),
          uid: blocked.player.uid,
          rankBan: Boolean(blocked.player.rank_ban),
        },
      });
    },
  );
}

function leaderboardRow(row) {
  return {
    id: Number(row.id),
    leaderboardKey: row.leaderboard_key,
    name: row.name,
    valueLabel: row.value_label,
    sortDirection: row.sort_direction,
    scoreUpdateMode: row.score_update_mode,
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
