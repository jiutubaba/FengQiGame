import { z } from "zod";
import { query, transaction } from "../../db/index.js";
import { writeAudit } from "../../lib/audit.js";
import { conflict, HttpError, notFound } from "../../lib/errors.js";
import { createOpaqueToken } from "../../lib/security.js";
import { PERMISSIONS, requireMapPermission } from "../../middleware/auth.js";
import { validate } from "../../middleware/validation.js";
import { idSchema, pagination } from "./shared.js";

export function registerGiftRoutes(router) {
  router.get(
    "/:mapId/gifts",
    requireMapPermission(PERMISSIONS.GIFTS_MANAGE),
    async (req, res) => {
      const mapId = idSchema.parse(req.params.mapId);
      const result = await query(
        `SELECT g.*,COUNT(ge.id) FILTER (WHERE ge.value>0)::int AS entitlement_count
           FROM gifts g
           LEFT JOIN gift_entitlements ge
             ON ge.gift_id=g.id AND ge.map_id=g.map_id
          WHERE g.map_id=$1
          GROUP BY g.id
          ORDER BY g.created_at DESC`,
        [mapId],
      );
      res.json({ success: true, data: result.rows.map(giftRow) });
    },
  );

  const giftSchema = z.object({
    giftKey: z.string().trim().min(1).max(128),
    name: z.string().trim().min(1).max(160),
    description: z.string().trim().max(2000).optional().default(""),
    defaultValue: z.coerce.number().finite().optional().default(0),
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

  router.get(
    "/:mapId/gifts/entitlements/players",
    requireMapPermission(PERMISSIONS.GIFTS_MANAGE),
    async (req, res) => {
      const mapId = idSchema.parse(req.params.mapId);
      const { page, limit, offset } = pagination(req.query);
      const q = String(req.query.q || "").trim();
      const parsedGiftFilterIds = z
        .array(idSchema)
        .max(100)
        .safeParse(
          String(req.query.giftIds || "")
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean),
        );
      if (!parsedGiftFilterIds.success) {
        throw new HttpError(
          400,
          "礼包筛选参数不符合要求",
          "VALIDATION_ERROR",
          parsedGiftFilterIds.error.flatten(),
        );
      }
      const giftFilterIds = parsedGiftFilterIds.data;
      const params = [mapId];
      let where = "p.map_id=$1";
      if (q) {
        params.push(`%${q}%`);
        where += ` AND (p.uid ILIKE $${params.length} OR p.name ILIKE $${params.length})`;
      }
      if (giftFilterIds.length) {
        params.push(giftFilterIds);
        where += ` AND EXISTS (
          SELECT 1
            FROM gift_entitlements filter_ge
            JOIN gifts filter_g
              ON filter_g.id=filter_ge.gift_id AND filter_g.map_id=$1
           WHERE filter_ge.map_id=$1
             AND filter_ge.player_id=p.id
             AND filter_ge.value>0
             AND filter_ge.gift_id=ANY($${params.length}::bigint[])
        )`;
      }
      const total = await query(
        `SELECT COUNT(*)::int AS count FROM players p WHERE ${where}`,
        params,
      );
      params.push(limit, offset);
      const players = await query(
        `SELECT p.id,p.uid,p.name,p.last_active_at
           FROM players p
          WHERE ${where}
          ORDER BY p.last_active_at DESC NULLS LAST,p.id DESC
          LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );
      const playerIds = players.rows.map((player) => player.id);
      const entitlements = playerIds.length
        ? await query(
            `SELECT ge.player_id,ge.gift_id,ge.value,ge.updated_at
               FROM gift_entitlements ge
               JOIN gifts g ON g.id=ge.gift_id
              WHERE ge.map_id=$1 AND g.map_id=$1
                AND ge.player_id=ANY($2::bigint[])
              ORDER BY ge.player_id,ge.gift_id`,
            [mapId, playerIds],
          )
        : { rows: [] };
      const entitlementsByPlayer = new Map();
      for (const row of entitlements.rows) {
        const playerId = Number(row.player_id);
        if (!entitlementsByPlayer.has(playerId)) {
          entitlementsByPlayer.set(playerId, []);
        }
        entitlementsByPlayer.get(playerId).push({
          giftId: Number(row.gift_id),
          value: Number(row.value),
          updatedAt: row.updated_at,
        });
      }
      res.json({
        success: true,
        data: players.rows.map((player) => ({
          id: Number(player.id),
          uid: player.uid,
          name: player.name,
          lastActiveAt: player.last_active_at,
          entitlements: entitlementsByPlayer.get(Number(player.id)) || [],
        })),
        pagination: { page, limit, total: total.rows[0].count },
      });
    },
  );

  router.get(
    "/:mapId/gifts/entitlements",
    requireMapPermission(PERMISSIONS.GIFTS_MANAGE),
    async (req, res) => {
      const mapId = idSchema.parse(req.params.mapId);
      const result = await query(
        `SELECT ge.player_id,ge.gift_id,ge.value,ge.updated_at
           FROM gift_entitlements ge
           JOIN players p ON p.id=ge.player_id
           JOIN gifts g ON g.id=ge.gift_id
          WHERE ge.map_id=$1 AND p.map_id=$1 AND g.map_id=$1
          ORDER BY ge.player_id,ge.gift_id`,
        [mapId],
      );
      res.json({
        success: true,
        data: result.rows.map((row) => ({
          playerId: Number(row.player_id),
          giftId: Number(row.gift_id),
          value: Number(row.value),
          updatedAt: row.updated_at,
        })),
      });
    },
  );

  router.put(
    "/:mapId/gifts/entitlements",
    requireMapPermission(PERMISSIONS.GIFTS_MANAGE),
    validate(
      z
        .object({
          playerIds: z
            .array(z.coerce.number().int().positive())
            .min(1)
            .max(500)
            .transform((ids) => [...new Set(ids)]),
          gifts: z
            .array(
              z.object({
                giftId: z.coerce.number().int().positive(),
                value: z.coerce.number().finite().min(0).max(1_000_000),
              }),
            )
            .min(1)
            .max(100),
        })
        .superRefine((body, context) => {
          const giftIds = body.gifts.map((gift) => gift.giftId);
          if (new Set(giftIds).size !== giftIds.length)
            context.addIssue({
              code: "custom",
              path: ["gifts"],
              message: "同一礼包不能重复设置",
            });
        }),
    ),
    async (req, res) => {
      const mapId = idSchema.parse(req.params.mapId);
      const counts = await transaction(async (client) => {
        const players = await client.query(
          "SELECT id FROM players WHERE map_id=$1 AND id=ANY($2::bigint[])",
          [mapId, req.body.playerIds],
        );
        if (players.rowCount !== req.body.playerIds.length)
          throw conflict("存在不属于当前地图的玩家");

        const giftIds = req.body.gifts.map((gift) => gift.giftId);
        const gifts = await client.query(
          "SELECT id FROM gifts WHERE map_id=$1 AND id=ANY($2::bigint[])",
          [mapId, giftIds],
        );
        if (gifts.rowCount !== giftIds.length)
          throw conflict("存在不属于当前地图的礼包");

        let upserted = 0;
        let removed = 0;
        for (const gift of req.body.gifts) {
          if (gift.value === 0) {
            const deleted = await client.query(
              `DELETE FROM gift_entitlements
                WHERE map_id=$1 AND gift_id=$2
                  AND player_id=ANY($3::bigint[])`,
              [mapId, gift.giftId, req.body.playerIds],
            );
            removed += deleted.rowCount;
            continue;
          }
          const updated = await client.query(
            `INSERT INTO gift_entitlements(map_id,gift_id,player_id,value,updated_by)
             SELECT $1::bigint,$2::bigint,p.id,$3::numeric,$4::bigint
               FROM players p
              WHERE p.map_id=$1 AND p.id=ANY($5::bigint[])
             ON CONFLICT(map_id,player_id,gift_id) DO UPDATE
             SET value=EXCLUDED.value,updated_by=EXCLUDED.updated_by,updated_at=NOW()`,
            [mapId, gift.giftId, gift.value, req.user.id, req.body.playerIds],
          );
          upserted += updated.rowCount;
        }
        return { upserted, removed };
      });
      await writeAudit(req, {
        action: "gift.entitlements.set",
        resourceType: "gift_entitlement",
        mapId,
        details: {
          playerCount: req.body.playerIds.length,
          giftCount: req.body.gifts.length,
          values: req.body.gifts,
          ...counts,
        },
      });
      res.json({
        success: true,
        data: {
          count: req.body.playerIds.length * req.body.gifts.length,
          ...counts,
        },
      });
    },
  );
}

export function registerLotteryRoutes(router) {
  router.get(
    "/:mapId/lotteries",
    requireMapPermission(PERMISSIONS.GIFTS_MANAGE),
    async (req, res) => {
      const mapId = idSchema.parse(req.params.mapId);
      const result = await query(
        `SELECT c.*,COUNT(e.id)::int AS participant_count,COUNT(e.id) FILTER(WHERE e.is_winner)::int AS actual_winner_count
         FROM lottery_campaigns c LEFT JOIN lottery_entries e ON e.campaign_id=c.id
        WHERE c.map_id=$1 GROUP BY c.id ORDER BY c.created_at DESC`,
        [mapId],
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
      const token = createOpaqueToken("lot_");
      const result = await query(
        `INSERT INTO lottery_campaigns(map_id,public_token,title,description,draw_at,winner_count,reward_config,created_by)
       VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8) RETURNING *`,
        [
          mapId,
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
        details: { title: req.body.title },
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

  router.delete(
    "/:mapId/lotteries/:campaignId/permanent",
    requireMapPermission(PERMISSIONS.GIFTS_MANAGE),
    async (req, res) => {
      const mapId = idSchema.parse(req.params.mapId);
      const campaignId = idSchema.parse(req.params.campaignId);
      const deleted = await transaction(async (client) => {
        const campaignResult = await client.query(
          `SELECT id,title,status,draw_at
             FROM lottery_campaigns
            WHERE id=$1 AND map_id=$2
            FOR UPDATE`,
          [campaignId, mapId],
        );
        const campaign = campaignResult.rows[0];
        if (!campaign) throw notFound("抽奖活动不存在");
        const canDelete =
          campaign.status === "drawn" ||
          campaign.status === "cancelled" ||
          (campaign.status === "open" &&
            campaign.draw_at &&
            new Date(campaign.draw_at) <= new Date());
        if (!canDelete) {
          throw new HttpError(
            409,
            "抽奖活动仍在报名期内或未设置开奖时间，不能永久删除",
            "LOTTERY_DELETE_NOT_ALLOWED",
            { status: campaign.status, drawAt: campaign.draw_at },
          );
        }
        const result = await client.query(
          `DELETE FROM lottery_campaigns
            WHERE id=$1 AND map_id=$2
            RETURNING id,title,status,draw_at`,
          [campaignId, mapId],
        );
        await writeAudit(
          req,
          {
            action: "lottery.delete",
            resourceType: "lottery_campaign",
            resourceId: campaignId,
            mapId,
            details: {
              title: campaign.title,
              status: campaign.status,
              drawAt: campaign.draw_at,
            },
          },
          client,
        );
        return result.rows[0];
      });
      res.json({ success: true, data: { id: Number(deleted.id) } });
    },
  );
}

function giftRow(row) {
  return {
    id: Number(row.id),
    giftKey: row.gift_key,
    name: row.name,
    description: row.description,
    defaultValue: Number(row.default_value),
    enabled: row.enabled,
    entitlementCount: Number(row.entitlement_count || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
function lotteryAdminRow(row) {
  return {
    id: Number(row.id),
    title: row.title,
    description: row.description,
    status: row.status,
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
