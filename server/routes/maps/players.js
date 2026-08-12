import { z } from "zod";
import { query, transaction } from "../../db/index.js";
import { writeAudit } from "../../lib/audit.js";
import { conflict, HttpError, notFound } from "../../lib/errors.js";
import { PERMISSIONS, requireMapPermission } from "../../middleware/auth.js";
import { validate } from "../../middleware/validation.js";
import { idSchema, pagination } from "./shared.js";

export function registerPlayerRoutes(router) {
  router.get(
    "/:mapId/players",
    requireMapPermission(PERMISSIONS.PLAYERS_VIEW),
    async (req, res) => {
      const mapId = idSchema.parse(req.params.mapId);
      const { page, limit, offset } = pagination(req.query);
      const q = String(req.query.q || "").trim();
      const sortBy = z
        .enum(["level", "lastActiveAt"])
        .default("lastActiveAt")
        .parse(req.query.sortBy);
      const sortDirection = z
        .enum(["asc", "desc"])
        .default("desc")
        .parse(req.query.sortDirection);
      const sortColumn = sortBy === "level" ? "level" : "last_active_at";
      const sortSql = sortDirection === "asc" ? "ASC" : "DESC";
      const params = [mapId];
      let where = "p.map_id=$1";
      if (q) {
        params.push(`%${q}%`);
        where += ` AND (p.uid ILIKE $${params.length} OR p.name ILIKE $${params.length})`;
      }
      const count = await query(
        `SELECT COUNT(*)::int AS count FROM players p WHERE ${where}`,
        params,
      );
      params.push(limit, offset);
      const result = await query(
        `SELECT p.id,p.uid,p.name,p.level,p.game_level,p.item_ban,p.data_ban,p.rank_ban,
                p.profile,p.last_active_at,p.created_at,p.updated_at,
                ${playerUidLockSql("p")} AS uid_locked
           FROM players p
          WHERE ${where}
          ORDER BY p.${sortColumn} ${sortSql} NULLS LAST,p.id DESC
          LIMIT $${params.length - 1} OFFSET $${params.length}`,
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
      const result = await query(
        `INSERT INTO players(map_id,uid,name,level,game_level,item_ban,data_ban,rank_ban,profile)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb) RETURNING *`,
        [
          mapId,
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
      const playerId = idSchema.parse(req.params.playerId);
      const result = await transaction(async (client) => {
        const current = await client.query(
          `SELECT p.*,${playerUidLockSql("p")} AS uid_locked
             FROM players p
            WHERE p.id=$1 AND p.map_id=$2
            FOR UPDATE`,
          [playerId, mapId],
        );
        if (!current.rows[0]) throw notFound("玩家不存在");
        const row = current.rows[0];
        const nextUid = req.body.uid ?? row.uid;
        if (nextUid !== row.uid && row.uid_locked) {
          throw new HttpError(
            409,
            "该玩家已有游戏或运营数据，UID 已锁定；其他资料仍可单独修改",
            "PLAYER_UID_LOCKED",
          );
        }
        try {
          const updated = await client.query(
            `UPDATE players SET uid=$1,name=$2,level=$3,game_level=$4,item_ban=$5,data_ban=$6,rank_ban=$7,profile=$8::jsonb,updated_at=NOW()
            WHERE id=$9 AND map_id=$10 RETURNING *`,
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
            ],
          );
          updated.rows[0].uid_locked = row.uid_locked;
          return updated;
        } catch (error) {
          if (error.code === "23505") {
            throw new HttpError(
              409,
              "当前地图已存在相同 UID 的玩家",
              "PLAYER_UID_CONFLICT",
            );
          }
          throw error;
        }
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
      const playerId = idSchema.parse(req.params.playerId);
      const result = await transaction(async (client) => {
        const deleted = await client.query(
          "DELETE FROM players WHERE id=$1 AND map_id=$2 RETURNING id,uid,name",
          [playerId, mapId],
        );
        if (!deleted.rows[0]) throw notFound("玩家不存在");
        await client.query(
          "DELETE FROM fq_player_archives WHERE map_id=$1 AND player_uid=$2",
          [mapId, deleted.rows[0].uid],
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
}

export function registerMessageRoutes(router) {
  router.get(
    "/:mapId/messages",
    requireMapPermission(PERMISSIONS.PLAYERS_VIEW),
    async (req, res) => {
      const mapId = idSchema.parse(req.params.mapId);
      const { page, limit, offset } = pagination(req.query);
      const result = await query(
        `SELECT pm.id,pm.subject,pm.content,pm.attachments,pm.status,pm.created_at,pm.delivered_at,
              p.id AS player_id,p.uid,p.name AS player_name
         FROM player_messages pm JOIN players p ON p.id=pm.player_id
        WHERE pm.map_id=$1 ORDER BY pm.created_at DESC LIMIT $2 OFFSET $3`,
        [mapId, limit, offset],
      );
      const total = await query(
        "SELECT COUNT(*)::int AS count FROM player_messages WHERE map_id=$1",
        [mapId],
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
      const inserted = await query(
        `INSERT INTO player_messages(map_id,player_id,subject,content,attachments,created_by)
       SELECT $1::bigint,p.id,$2::varchar,$3::text,$4::jsonb,$5::bigint FROM players p
        WHERE p.map_id=$1 AND p.id=ANY($6::bigint[])
       RETURNING id`,
        [
          mapId,
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
      res
        .status(201)
        .json({ success: true, data: { count: inserted.rowCount } });
    },
  );
}

function playerUidLockSql(alias) {
  return `(
    ${alias}.last_active_at IS NOT NULL
    OR EXISTS (SELECT 1 FROM player_messages pm WHERE pm.map_id=${alias}.map_id AND pm.player_id=${alias}.id)
    OR EXISTS (SELECT 1 FROM gift_entitlements ge WHERE ge.map_id=${alias}.map_id AND ge.player_id=${alias}.id)
    OR EXISTS (SELECT 1 FROM fq_player_archives fa WHERE fa.map_id=${alias}.map_id AND fa.player_uid=${alias}.uid)
    OR EXISTS (SELECT 1 FROM fq_metric_session_activity ma WHERE ma.map_id=${alias}.map_id AND ma.player_uid=${alias}.uid)
    OR EXISTS (SELECT 1 FROM risk_events re WHERE re.map_id=${alias}.map_id AND re.player_uid=${alias}.uid)
    OR EXISTS (
      SELECT 1 FROM leaderboard_entries le
      JOIN leaderboards l ON l.id=le.leaderboard_id
      WHERE l.map_id=${alias}.map_id AND le.player_uid=${alias}.uid
    )
    OR EXISTS (
      SELECT 1 FROM leaderboard_daily_collections ldc
      JOIN leaderboards l ON l.id=ldc.leaderboard_id
      WHERE l.map_id=${alias}.map_id AND ldc.player_uid=${alias}.uid
    )
    OR EXISTS (
      SELECT 1 FROM leaderboard_snapshot_entries lse
      JOIN leaderboard_snapshots ls ON ls.id=lse.snapshot_id
      JOIN leaderboards l ON l.id=ls.leaderboard_id
      WHERE l.map_id=${alias}.map_id AND lse.player_uid=${alias}.uid
    )
    OR EXISTS (
      SELECT 1 FROM lottery_entries le
      JOIN lottery_campaigns lc ON lc.id=le.campaign_id
      WHERE lc.map_id=${alias}.map_id AND le.player_uid=${alias}.uid
    )
  )`;
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
    uidLocked: Boolean(row.uid_locked || row.last_active_at),
    lastActiveAt: row.last_active_at,
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
