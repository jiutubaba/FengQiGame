import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { query } from "../db/index.js";
import { conflict, HttpError, notFound } from "../lib/errors.js";
import { validate } from "../middleware/validation.js";

const router = Router();
const entryLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      code: "TOO_MANY_ATTEMPTS",
      message: "参与次数过于频繁，请稍后再试",
    },
  },
});

router.get("/lotteries/:token", async (req, res) => {
  const result = await query(
    `SELECT c.id,c.title,c.description,c.status,c.draw_at,c.winner_count,c.reward_config,c.drawn_at,
            m.name AS map_name,COUNT(e.id)::int AS participant_count
       FROM lottery_campaigns c JOIN maps m ON m.id=c.map_id
       LEFT JOIN lottery_entries e ON e.campaign_id=c.id
      WHERE c.public_token=$1 GROUP BY c.id,m.name`,
    [req.params.token],
  );
  const campaign = result.rows[0];
  if (!campaign) throw notFound("抽奖活动不存在");
  const winners =
    campaign.status === "drawn"
      ? (
          await query(
            "SELECT player_name,player_uid FROM lottery_entries WHERE campaign_id=$1 AND is_winner=TRUE ORDER BY id",
            [campaign.id],
          )
        ).rows
      : [];
  res.json({ success: true, data: lotteryRow(campaign, winners) });
});

router.post(
  "/lotteries/:token/entries",
  entryLimiter,
  validate(
    z.object({
      playerName: z.string().trim().min(1).max(160),
      playerUid: z.string().trim().max(128).optional(),
      contact: z.string().trim().max(160).optional(),
    }),
  ),
  async (req, res) => {
    const campaignResult = await query(
      "SELECT id,status,draw_at FROM lottery_campaigns WHERE public_token=$1",
      [req.params.token],
    );
    const campaign = campaignResult.rows[0];
    if (!campaign) throw notFound("抽奖活动不存在");
    if (campaign.status !== "open") throw conflict("抽奖活动已结束");
    if (campaign.draw_at && new Date(campaign.draw_at) <= new Date())
      throw new HttpError(409, "报名已截止，等待开奖", "LOTTERY_CLOSED");
    const participantKey = String(req.body.playerUid || req.body.playerName)
      .trim()
      .toLocaleLowerCase("zh-CN");
    try {
      const result = await query(
        `INSERT INTO lottery_entries(campaign_id,participant_key,player_name,player_uid,contact,ip)
       VALUES($1,$2,$3,$4,$5,$6) RETURNING id,player_name,created_at`,
        [
          campaign.id,
          participantKey,
          req.body.playerName,
          req.body.playerUid || null,
          req.body.contact || null,
          req.ip,
        ],
      );
      res.status(201).json({ success: true, data: result.rows[0] });
    } catch (error) {
      if (error.code === "23505") throw conflict("该玩家已经参与过本次抽奖");
      throw error;
    }
  },
);

function lotteryRow(row, winners) {
  return {
    title: row.title,
    description: row.description,
    mapName: row.map_name,
    status: row.status,
    drawAt: row.draw_at,
    drawnAt: row.drawn_at,
    winnerCount: Number(row.winner_count),
    rewardConfig: row.reward_config || [],
    participantCount: Number(row.participant_count || 0),
    winners,
  };
}

export default router;
