import { z } from "zod";
import { query, transaction } from "../../db/index.js";
import { writeAudit } from "../../lib/audit.js";
import { notFound } from "../../lib/errors.js";
import { PERMISSIONS, requireMapPermission } from "../../middleware/auth.js";
import { validate } from "../../middleware/validation.js";
import { idSchema, pagination } from "./shared.js";

export function registerRiskRoutes(router) {
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
        `SELECT * FROM risk_rules WHERE map_id=$1 ORDER BY created_at`,
        [idSchema.parse(req.params.mapId)],
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
      const result = await transaction(
        async (client) => {
          const result = await client.query(
            `INSERT INTO risk_rules(map_id,rule_key,name,severity,enabled)
         VALUES($1,$2,$3,$4,$5) RETURNING *`,
            [
              mapId,
              req.body.ruleKey,
              req.body.name,
              req.body.severity,
              req.body.enabled,
            ],
          );
          await writeAudit(
            req,
            {
              action: "risk_rule.create",
              resourceType: "risk_rule",
              resourceId: result.rows[0].id,
              mapId,
              details: { ruleKey: req.body.ruleKey },
            },
            client,
          );
          return result;
        },
        { mapId },
      );
      res
        .status(201)
        .json({ success: true, data: riskRuleRow(result.rows[0]) });
    },
  );

  router.patch(
    "/:mapId/risk/rules/:ruleId",
    requireMapPermission(PERMISSIONS.RISK_MANAGE),
    validate(riskRuleSchema.partial()),
    async (req, res) => {
      const mapId = idSchema.parse(req.params.mapId);
      const ruleId = idSchema.parse(req.params.ruleId);
      const result = await transaction(
        async (client) => {
          const current = await client.query(
            "SELECT * FROM risk_rules WHERE id=$1 AND map_id=$2",
            [ruleId, mapId],
          );
          if (!current.rows[0]) throw notFound("风控规则不存在");
          const row = current.rows[0];
          const result = await client.query(
            `UPDATE risk_rules SET rule_key=$1,name=$2,severity=$3,enabled=$4,updated_at=NOW()
          WHERE id=$5 AND map_id=$6 RETURNING *`,
            [
              req.body.ruleKey ?? row.rule_key,
              req.body.name ?? row.name,
              req.body.severity ?? row.severity,
              req.body.enabled ?? row.enabled,
              ruleId,
              mapId,
            ],
          );
          await writeAudit(
            req,
            {
              action: "risk_rule.update",
              resourceType: "risk_rule",
              resourceId: ruleId,
              mapId,
              details: { fields: Object.keys(req.body) },
            },
            client,
          );
          return result;
        },
        { mapId },
      );
      res.json({ success: true, data: riskRuleRow(result.rows[0]) });
    },
  );

  router.delete(
    "/:mapId/risk/rules/:ruleId",
    requireMapPermission(PERMISSIONS.RISK_MANAGE),
    async (req, res) => {
      const mapId = idSchema.parse(req.params.mapId);
      const ruleId = idSchema.parse(req.params.ruleId);
      await transaction(
        async (client) => {
          const result = await client.query(
            "DELETE FROM risk_rules WHERE id=$1 AND map_id=$2 RETURNING id,rule_key",
            [ruleId, mapId],
          );
          if (!result.rows[0]) throw notFound("风控规则不存在");
          await writeAudit(
            req,
            {
              action: "risk_rule.delete",
              resourceType: "risk_rule",
              resourceId: ruleId,
              mapId,
              details: { ruleKey: result.rows[0].rule_key },
            },
            client,
          );
        },
        { mapId },
      );
      res.json({ success: true });
    },
  );

  router.get(
    "/:mapId/risk/events",
    requireMapPermission(PERMISSIONS.RISK_VIEW),
    async (req, res) => {
      const mapId = idSchema.parse(req.params.mapId);
      const { page, limit, offset } = pagination(req.query);
      const params = [mapId];
      let where = "r.map_id=$1";
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
           FROM risk_events WHERE map_id=$1`,
        [mapId],
      );
      params.push(limit, offset);
      const result = await query(
        `SELECT r.*,p.item_ban,p.data_ban,p.rank_ban
           FROM risk_events r
           LEFT JOIN players p ON p.map_id=r.map_id AND p.uid=r.player_uid
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
      const updated = await transaction(
        async (client) => {
          const current = await client.query(
            "SELECT * FROM risk_events WHERE id=$1 AND map_id=$2 FOR UPDATE",
            [eventId, mapId],
          );
          const event = current.rows[0];
          if (!event) throw notFound("风控事件不存在");
          const hasBanChange = ["itemBan", "dataBan", "rankBan"].some(
            (key) => req.body[key] !== undefined,
          );
          const playerResult = hasBanChange
            ? await client.query(
                `INSERT INTO players(map_id,uid,name,item_ban,data_ban,rank_ban)
               VALUES($1,$2,$3,COALESCE($4::boolean,FALSE),COALESCE($5::boolean,FALSE),COALESCE($6::boolean,FALSE))
               ON CONFLICT(map_id,uid) DO UPDATE SET
                 item_ban=COALESCE($4::boolean,players.item_ban),
                 data_ban=COALESCE($5::boolean,players.data_ban),
                 rank_ban=COALESCE($6::boolean,players.rank_ban),updated_at=NOW()
               RETURNING item_ban,data_ban,rank_ban`,
                [
                  mapId,
                  event.player_uid,
                  event.player_name,
                  req.body.itemBan ?? null,
                  req.body.dataBan ?? null,
                  req.body.rankBan ?? null,
                ],
              )
            : await client.query(
                "SELECT item_ban,data_ban,rank_ban FROM players WHERE map_id=$1 AND uid=$2",
                [mapId, event.player_uid],
              );
          const result = await client.query(
            `UPDATE risk_events SET status=$1,handled_by=$2,handled_at=NOW(),updated_at=NOW(),
             details=CASE WHEN $3='' THEN details ELSE details || jsonb_build_object('resolutionNote',$3::text) END
           WHERE id=$4 RETURNING *`,
            [req.body.status, req.user.id, req.body.note ?? "", eventId],
          );
          await writeAudit(
            req,
            {
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
            },
            client,
          );
          return { ...result.rows[0], ...playerResult.rows[0] };
        },
        { mapId },
      );
      res.json({ success: true, data: riskEventRow(updated) });
    },
  );
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
