import { Router } from "express";
import { z } from "zod";
import { query, transaction } from "../db/index.js";
import { loadApiKey, requireApiPermission } from "../middleware/auth.js";
import { validate } from "../middleware/validation.js";

const router = Router();
router.use(loadApiKey);

router.post(
  "/players/upsert",
  requireApiPermission("game.players.write"),
  validate(
    z.object({
      uid: z.string().trim().min(1).max(128),
      name: z.string().trim().min(1).max(160),
      level: z.coerce
        .number()
        .int()
        .min(0)
        .max(1_000_000)
        .optional()
        .default(0),
      gameLevel: z.string().trim().max(32).optional().default(""),
      profile: z.record(z.string(), z.unknown()).optional().default({}),
    }),
  ),
  async (req, res) => {
    const result = await query(
      `INSERT INTO players(map_id,environment,uid,name,level,game_level,profile,last_active_at)
     VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,NOW())
     ON CONFLICT(map_id,environment,uid) DO UPDATE SET name=EXCLUDED.name,level=EXCLUDED.level,game_level=EXCLUDED.game_level,profile=EXCLUDED.profile,last_active_at=NOW(),updated_at=NOW()
     RETURNING id,uid,name,last_active_at`,
      [
        req.apiKey.map_id,
        req.apiKey.environment,
        req.body.uid,
        req.body.name,
        req.body.level,
        req.body.gameLevel,
        JSON.stringify(req.body.profile),
      ],
    );
    res.json({ success: true, data: result.rows[0] });
  },
);

router.post(
  "/logs",
  requireApiPermission("game.logs.write"),
  validate(
    z.object({
      context: z.string().trim().min(1).max(100_000),
      playerCount: z.coerce.number().int().min(0).optional().default(1),
    }),
  ),
  async (req, res) => {
    const result = await query(
      `INSERT INTO map_logs(map_id,environment,context,player_count,upload_count)
     VALUES($1,$2,$3,$4,1)
     ON CONFLICT(map_id,environment,context) DO UPDATE SET player_count=GREATEST(map_logs.player_count,EXCLUDED.player_count),upload_count=map_logs.upload_count+1,updated_at=NOW()
     RETURNING id,player_count,upload_count,updated_at`,
      [
        req.apiKey.map_id,
        req.apiKey.environment,
        req.body.context,
        req.body.playerCount,
      ],
    );
    res.json({ success: true, data: result.rows[0] });
  },
);

router.post(
  "/metrics",
  requireApiPermission("game.metrics.write"),
  validate(
    z.object({
      date: z.iso
        .date()
        .optional()
        .default(() => new Date().toISOString().slice(0, 10)),
      cumulativeUsers: z.coerce.number().int().min(0).default(0),
      onlineUsers: z.coerce.number().int().min(0).default(0),
      totalGameCount: z.coerce.number().int().min(0).default(0),
      dailyNewUsers: z.coerce.number().int().min(0).default(0),
      dailyActiveUsers: z.coerce.number().int().min(0).default(0),
      lostUserCount: z.coerce.number().int().min(0).default(0),
      returnUserCount: z.coerce.number().int().min(0).default(0),
      activeUserRetentionRate: z.coerce.number().min(0).max(100).default(0),
      newUserRetentionRate: z.coerce.number().min(0).max(100).default(0),
      sevenDayRetentionRate: z.coerce.number().min(0).max(100).default(0),
      replayRate: z.coerce.number().min(0).max(100).default(0),
    }),
  ),
  async (req, res) => {
    const b = req.body;
    await query(
      `INSERT INTO map_metrics(map_id,environment,metric_date,cumulative_users,online_users,total_game_count,daily_new_users,daily_active_users,lost_user_count,return_user_count,active_user_retention_rate,new_user_retention_rate,seven_day_retention_rate,replay_rate)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT(map_id,environment,metric_date) DO UPDATE SET cumulative_users=EXCLUDED.cumulative_users,online_users=EXCLUDED.online_users,total_game_count=EXCLUDED.total_game_count,daily_new_users=EXCLUDED.daily_new_users,daily_active_users=EXCLUDED.daily_active_users,lost_user_count=EXCLUDED.lost_user_count,return_user_count=EXCLUDED.return_user_count,active_user_retention_rate=EXCLUDED.active_user_retention_rate,new_user_retention_rate=EXCLUDED.new_user_retention_rate,seven_day_retention_rate=EXCLUDED.seven_day_retention_rate,replay_rate=EXCLUDED.replay_rate,updated_at=NOW()`,
      [
        req.apiKey.map_id,
        req.apiKey.environment,
        b.date,
        b.cumulativeUsers,
        b.onlineUsers,
        b.totalGameCount,
        b.dailyNewUsers,
        b.dailyActiveUsers,
        b.lostUserCount,
        b.returnUserCount,
        b.activeUserRetentionRate,
        b.newUserRetentionRate,
        b.sevenDayRetentionRate,
        b.replayRate,
      ],
    );
    res.json({ success: true });
  },
);

router.post(
  "/points/:pointKey/increment",
  requireApiPermission("game.points.write"),
  validate(
    z.object({
      amount: z.coerce.number().int().min(1).max(1_000_000).default(1),
    }),
  ),
  async (req, res) => {
    const result = await query(
      `UPDATE tracking_points SET trigger_count=trigger_count+$1,updated_at=NOW()
      WHERE map_id=$2 AND environment=$3 AND point_key=$4 AND enabled=TRUE RETURNING id,point_key,trigger_count`,
      [
        req.body.amount,
        req.apiKey.map_id,
        req.apiKey.environment,
        req.params.pointKey,
      ],
    );
    if (!result.rows[0])
      return res.status(404).json({
        success: false,
        error: { code: "POINT_NOT_FOUND", message: "埋点不存在或已停用" },
      });
    res.json({ success: true, data: result.rows[0] });
  },
);

const leaderboardEntrySchema = z.object({
  uid: z.string().trim().min(1).max(128),
  name: z.string().trim().min(1).max(160),
  gameLevel: z.string().trim().max(64).optional().default(""),
  score: z.coerce.number().finite().min(-1e15).max(1e15),
  gameCount: z.coerce.number().int().min(0).max(1e12).optional().default(0),
  metadata: z.record(z.string(), z.unknown()).optional().default({}),
});

router.post(
  "/leaderboards/:leaderboardKey/entries",
  requireApiPermission("game.leaderboards.write"),
  validate(
    z.object({
      entries: z.array(leaderboardEntrySchema).min(1).max(500),
    }),
  ),
  async (req, res) => {
    const leaderboardKey = z
      .string()
      .trim()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9._-]+$/)
      .parse(req.params.leaderboardKey);
    const leaderboardResult = await query(
      `SELECT id FROM leaderboards
        WHERE map_id=$1 AND environment=$2 AND leaderboard_key=$3 AND enabled=TRUE`,
      [req.apiKey.map_id, req.apiKey.environment, leaderboardKey],
    );
    const leaderboard = leaderboardResult.rows[0];
    if (!leaderboard)
      return res.status(404).json({
        success: false,
        error: {
          code: "LEADERBOARD_NOT_FOUND",
          message: "排行榜不存在或已停用",
        },
      });

    await transaction(async (client) => {
      for (const entry of req.body.entries) {
        await client.query(
          `INSERT INTO leaderboard_entries(leaderboard_id,player_uid,player_name,game_level,score,game_count,metadata)
           VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)
           ON CONFLICT(leaderboard_id,player_uid) DO UPDATE SET
             player_name=EXCLUDED.player_name,
             game_level=EXCLUDED.game_level,
             score=EXCLUDED.score,
             game_count=EXCLUDED.game_count,
             metadata=EXCLUDED.metadata,
             updated_at=NOW()`,
          [
            leaderboard.id,
            entry.uid,
            entry.name,
            entry.gameLevel,
            entry.score,
            entry.gameCount,
            JSON.stringify(entry.metadata),
          ],
        );
      }
    });
    res.json({
      success: true,
      data: { leaderboardKey, accepted: req.body.entries.length },
    });
  },
);

router.post(
  "/risk/events",
  requireApiPermission("game.risk.write"),
  validate(
    z.object({
      eventId: z.string().trim().min(1).max(128),
      ruleKey: z.string().trim().min(1).max(128),
      uid: z.string().trim().min(1).max(128),
      playerName: z.string().trim().min(1).max(160),
      count: z.coerce.number().int().min(1).max(1_000_000).default(1),
      details: z.record(z.string(), z.unknown()).optional().default({}),
      occurredAt: z.iso.datetime({ offset: true }).optional(),
    }),
  ),
  async (req, res) => {
    const ruleResult = await query(
      `SELECT id,rule_key,name,severity FROM risk_rules
        WHERE map_id=$1 AND environment=$2 AND rule_key=$3 AND enabled=TRUE`,
      [req.apiKey.map_id, req.apiKey.environment, req.body.ruleKey],
    );
    const rule = ruleResult.rows[0];
    if (!rule)
      return res.status(404).json({
        success: false,
        error: {
          code: "RISK_RULE_NOT_FOUND",
          message: "风控规则不存在或已停用",
        },
      });

    const inserted = await query(
      `INSERT INTO risk_events(map_id,environment,event_key,rule_id,rule_key,rule_name,severity,player_uid,player_name,occurrence_count,details,occurred_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,COALESCE($12::timestamptz,NOW()))
       ON CONFLICT(map_id,environment,event_key) DO NOTHING
       RETURNING id,event_key,status,occurred_at`,
      [
        req.apiKey.map_id,
        req.apiKey.environment,
        req.body.eventId,
        rule.id,
        rule.rule_key,
        rule.name,
        rule.severity,
        req.body.uid,
        req.body.playerName,
        req.body.count,
        JSON.stringify(req.body.details),
        req.body.occurredAt || null,
      ],
    );
    if (inserted.rows[0])
      return res.status(201).json({
        success: true,
        data: { ...inserted.rows[0], created: true },
      });
    const existing = await query(
      `SELECT id,event_key,status,occurred_at FROM risk_events
        WHERE map_id=$1 AND environment=$2 AND event_key=$3`,
      [req.apiKey.map_id, req.apiKey.environment, req.body.eventId],
    );
    return res.json({
      success: true,
      data: { ...existing.rows[0], created: false },
    });
  },
);

router.get(
  "/players/:uid/messages",
  requireApiPermission("game.messages.read"),
  async (req, res) => {
    const result = await query(
      `SELECT pm.id,pm.subject,pm.content,pm.attachments,pm.created_at
       FROM player_messages pm JOIN players p ON p.id=pm.player_id
      WHERE pm.map_id=$1 AND pm.environment=$2 AND p.uid=$3 AND pm.status='pending'
      ORDER BY pm.created_at LIMIT 100`,
      [req.apiKey.map_id, req.apiKey.environment, req.params.uid],
    );
    res.json({ success: true, data: result.rows });
  },
);

router.post(
  "/messages/:messageId/ack",
  requireApiPermission("game.messages.read"),
  validate(z.object({ uid: z.string().trim().min(1).max(128) })),
  async (req, res) => {
    const result = await query(
      `UPDATE player_messages pm SET status='delivered',delivered_at=NOW()
      FROM players p WHERE pm.id=$1 AND pm.player_id=p.id AND pm.map_id=$2 AND pm.environment=$3
        AND p.uid=$4 AND pm.status='pending' RETURNING pm.id,pm.delivered_at`,
      [
        req.params.messageId,
        req.apiKey.map_id,
        req.apiKey.environment,
        req.body.uid,
      ],
    );
    if (!result.rows[0])
      return res.status(404).json({
        success: false,
        error: { code: "MESSAGE_NOT_FOUND", message: "消息不存在或已经确认" },
      });
    res.json({ success: true, data: result.rows[0] });
  },
);

router.get(
  "/players/:uid/gifts",
  requireApiPermission("game.gifts.read"),
  async (req, res) => {
    const result = await query(
      `SELECT gg.id,g.gift_key,g.name,gg.quantity,gg.boolean_value,gg.granted_at
       FROM gift_grants gg JOIN gifts g ON g.id=gg.gift_id JOIN players p ON p.id=gg.player_id
      WHERE gg.map_id=$1 AND gg.environment=$2 AND p.uid=$3 AND gg.delivered_at IS NULL
      ORDER BY gg.granted_at LIMIT 100`,
      [req.apiKey.map_id, req.apiKey.environment, req.params.uid],
    );
    res.json({ success: true, data: result.rows });
  },
);

router.post(
  "/gifts/:grantId/ack",
  requireApiPermission("game.gifts.read"),
  validate(z.object({ uid: z.string().trim().min(1).max(128) })),
  async (req, res) => {
    const result = await query(
      `UPDATE gift_grants gg SET delivered_at=NOW()
      FROM players p WHERE gg.id=$1 AND gg.player_id=p.id AND gg.map_id=$2 AND gg.environment=$3
        AND p.uid=$4 AND gg.delivered_at IS NULL RETURNING gg.id,gg.delivered_at`,
      [
        req.params.grantId,
        req.apiKey.map_id,
        req.apiKey.environment,
        req.body.uid,
      ],
    );
    if (!result.rows[0])
      return res.status(404).json({
        success: false,
        error: { code: "GIFT_NOT_FOUND", message: "礼包不存在或已经确认" },
      });
    res.json({ success: true, data: result.rows[0] });
  },
);

export default router;
