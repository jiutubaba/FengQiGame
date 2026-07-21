import { Router } from "express";
import { z } from "zod";
import { query, transaction } from "../db/index.js";
import { HttpError } from "../lib/errors.js";
import { hashToken } from "../lib/security.js";
import { loadApiKey, requireApiPermission } from "../middleware/auth.js";
import { validate } from "../middleware/validation.js";

const router = Router();
router.use(loadApiKey);

const playerUidSchema = z.string().trim().min(1).max(128);
const fqRequestIdSchema = z
  .string()
  .trim()
  .min(4)
  .max(128)
  .regex(
    /^FQ-[A-Za-z0-9._:-]+$/,
    "requestId 必须以 FQ- 开头，且只能包含字母、数字、点、下划线、冒号和连字符",
  );
const archiveValuesSchema = z
  .record(z.string().trim().min(1).max(128), z.unknown())
  .refine(
    (values) => Buffer.byteLength(JSON.stringify(values), "utf8") <= 512 * 1024,
    "单份存档不能超过 512 KiB",
  );
const archiveSaveSchema = z.object({
  requestId: fqRequestIdSchema,
  expectedRevision: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  values: archiveValuesSchema,
});

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalJson(value[key])]),
    );
  }
  return value;
}

function archiveRequestHash(operation, target, body) {
  return hashToken(
    JSON.stringify(
      canonicalJson({
        operation,
        target,
        expectedRevision: body.expectedRevision,
        values: body.values,
      }),
    ),
  );
}

function playerArchiveRow(row, uid, dataBanned = false) {
  if (dataBanned) {
    return {
      uid,
      dataBanned: true,
      revision: 0,
      values: {},
      updatedAt: null,
    };
  }
  return {
    uid,
    dataBanned: false,
    revision: Number(row?.revision || 0),
    values: row?.archive_data || {},
    updatedAt: row?.updated_at || null,
  };
}

function globalArchiveRow(row) {
  return {
    revision: Number(row?.revision || 0),
    values: row?.archive_data || {},
    updatedAt: row?.updated_at || null,
  };
}

function assertMatchingRequest(row, requestId, requestHash) {
  if (row.last_request_id !== requestId) return false;
  if (row.last_request_hash !== requestHash) {
    throw new HttpError(
      409,
      "同一个 FQ requestId 不能提交不同内容",
      "FQ_REQUEST_REUSED",
    );
  }
  return true;
}

function assertExpectedRevision(expectedRevision, currentRevision) {
  if (expectedRevision === currentRevision) return;
  throw new HttpError(
    409,
    "存档版本已变化，请重新读取后再保存",
    "FQ_ARCHIVE_REVISION_CONFLICT",
    { currentRevision },
  );
}

router.post(
  "/bootstrap",
  requireApiPermission("game.archives.read"),
  validate(
    z.object({
      uids: z
        .array(playerUidSchema)
        .min(1)
        .max(24)
        .transform((uids) => [...new Set(uids)]),
      includeGlobal: z.boolean().optional().default(true),
    }),
  ),
  async (req, res) => {
    const [archives, bannedPlayers, globalArchive] = await Promise.all([
      query(
        `SELECT player_uid,archive_data,revision,updated_at
           FROM fq_player_archives
          WHERE map_id=$1 AND environment=$2 AND player_uid=ANY($3::text[])`,
        [req.apiKey.map_id, req.apiKey.environment, req.body.uids],
      ),
      query(
        `SELECT uid FROM players
          WHERE map_id=$1 AND environment=$2 AND uid=ANY($3::text[]) AND data_ban=TRUE`,
        [req.apiKey.map_id, req.apiKey.environment, req.body.uids],
      ),
      req.body.includeGlobal
        ? query(
            `SELECT archive_data,revision,updated_at
               FROM fq_global_archives
              WHERE map_id=$1 AND environment=$2`,
            [req.apiKey.map_id, req.apiKey.environment],
          )
        : Promise.resolve({ rows: [] }),
    ]);
    const archiveByUid = new Map(
      archives.rows.map((row) => [row.player_uid, row]),
    );
    const bannedUids = new Set(bannedPlayers.rows.map((row) => row.uid));
    res.json({
      success: true,
      data: {
        mapId: Number(req.apiKey.map_id),
        environment: req.apiKey.environment,
        players: req.body.uids.map((uid) =>
          playerArchiveRow(archiveByUid.get(uid), uid, bannedUids.has(uid)),
        ),
        ...(req.body.includeGlobal
          ? { global: globalArchiveRow(globalArchive.rows[0]) }
          : {}),
      },
    });
  },
);

router.get(
  "/archives/players/:uid",
  requireApiPermission("game.archives.read"),
  validate(z.object({ uid: playerUidSchema }), "params"),
  async (req, res) => {
    const [archive, player] = await Promise.all([
      query(
        `SELECT archive_data,revision,updated_at
           FROM fq_player_archives
          WHERE map_id=$1 AND environment=$2 AND player_uid=$3`,
        [req.apiKey.map_id, req.apiKey.environment, req.params.uid],
      ),
      query(
        `SELECT data_ban FROM players
          WHERE map_id=$1 AND environment=$2 AND uid=$3`,
        [req.apiKey.map_id, req.apiKey.environment, req.params.uid],
      ),
    ]);
    if (player.rows[0]?.data_ban) {
      throw new HttpError(403, "玩家存档已被后台封禁", "FQ_ARCHIVE_BANNED");
    }
    res.json({
      success: true,
      data: playerArchiveRow(archive.rows[0], req.params.uid),
    });
  },
);

router.post(
  "/archives/players/:uid/save",
  requireApiPermission("game.archives.write"),
  validate(z.object({ uid: playerUidSchema }), "params"),
  validate(archiveSaveSchema),
  async (req, res) => {
    const requestHash = archiveRequestHash(
      "player.save",
      req.params.uid,
      req.body,
    );
    const result = await transaction(async (client) => {
      const player = await client.query(
        `SELECT data_ban FROM players
          WHERE map_id=$1 AND environment=$2 AND uid=$3`,
        [req.apiKey.map_id, req.apiKey.environment, req.params.uid],
      );
      if (player.rows[0]?.data_ban) {
        throw new HttpError(403, "玩家存档已被后台封禁", "FQ_ARCHIVE_BANNED");
      }
      await client.query(
        `INSERT INTO fq_player_archives(map_id,environment,player_uid)
         VALUES($1,$2,$3)
         ON CONFLICT(map_id,environment,player_uid) DO NOTHING`,
        [req.apiKey.map_id, req.apiKey.environment, req.params.uid],
      );
      const currentResult = await client.query(
        `SELECT archive_data,revision,last_request_id,last_request_hash,updated_at
           FROM fq_player_archives
          WHERE map_id=$1 AND environment=$2 AND player_uid=$3
          FOR UPDATE`,
        [req.apiKey.map_id, req.apiKey.environment, req.params.uid],
      );
      const current = currentResult.rows[0];
      if (assertMatchingRequest(current, req.body.requestId, requestHash)) {
        return {
          replayed: true,
          archive: playerArchiveRow(current, req.params.uid),
        };
      }
      const currentRevision = Number(current.revision);
      assertExpectedRevision(req.body.expectedRevision, currentRevision);
      const saved = await client.query(
        `UPDATE fq_player_archives
            SET archive_data=$4::jsonb,
                revision=revision+1,
                last_request_id=$5,
                last_request_hash=$6,
                updated_at=NOW()
          WHERE map_id=$1 AND environment=$2 AND player_uid=$3
          RETURNING archive_data,revision,updated_at`,
        [
          req.apiKey.map_id,
          req.apiKey.environment,
          req.params.uid,
          JSON.stringify(req.body.values),
          req.body.requestId,
          requestHash,
        ],
      );
      return {
        replayed: false,
        archive: playerArchiveRow(saved.rows[0], req.params.uid),
      };
    });
    res.json({
      success: true,
      data: { requestId: req.body.requestId, ...result },
    });
  },
);

router.get(
  "/archives/global",
  requireApiPermission("game.archives.read"),
  async (req, res) => {
    const result = await query(
      `SELECT archive_data,revision,updated_at
         FROM fq_global_archives
        WHERE map_id=$1 AND environment=$2`,
      [req.apiKey.map_id, req.apiKey.environment],
    );
    res.json({ success: true, data: globalArchiveRow(result.rows[0]) });
  },
);

router.post(
  "/archives/global/save",
  requireApiPermission("game.archives.write"),
  validate(archiveSaveSchema),
  async (req, res) => {
    const requestHash = archiveRequestHash("global.save", "global", req.body);
    const result = await transaction(async (client) => {
      await client.query(
        `INSERT INTO fq_global_archives(map_id,environment)
         VALUES($1,$2)
         ON CONFLICT(map_id,environment) DO NOTHING`,
        [req.apiKey.map_id, req.apiKey.environment],
      );
      const currentResult = await client.query(
        `SELECT archive_data,revision,last_request_id,last_request_hash,updated_at
           FROM fq_global_archives
          WHERE map_id=$1 AND environment=$2
          FOR UPDATE`,
        [req.apiKey.map_id, req.apiKey.environment],
      );
      const current = currentResult.rows[0];
      if (assertMatchingRequest(current, req.body.requestId, requestHash)) {
        return { replayed: true, archive: globalArchiveRow(current) };
      }
      const currentRevision = Number(current.revision);
      assertExpectedRevision(req.body.expectedRevision, currentRevision);
      const saved = await client.query(
        `UPDATE fq_global_archives
            SET archive_data=$3::jsonb,
                revision=revision+1,
                last_request_id=$4,
                last_request_hash=$5,
                updated_at=NOW()
          WHERE map_id=$1 AND environment=$2
          RETURNING archive_data,revision,updated_at`,
        [
          req.apiKey.map_id,
          req.apiKey.environment,
          JSON.stringify(req.body.values),
          req.body.requestId,
          requestHash,
        ],
      );
      return {
        replayed: false,
        archive: globalArchiveRow(saved.rows[0]),
      };
    });
    res.json({
      success: true,
      data: { requestId: req.body.requestId, ...result },
    });
  },
);

router.post(
  "/players/upsert",
  requireApiPermission("game.players.write"),
  validate(
    z
      .object({
        players: z
          .array(
            z.object({
              uid: playerUidSchema,
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
          )
          .min(1)
          .max(24),
      })
      .superRefine(({ players }, context) => {
        const uids = new Set();
        for (const [index, player] of players.entries()) {
          if (uids.has(player.uid)) {
            context.addIssue({
              code: "custom",
              message: "同一批玩家资料不能包含重复 UID",
              path: ["players", index, "uid"],
            });
          }
          uids.add(player.uid);
        }
      }),
  ),
  async (req, res) => {
    const players = await transaction(async (client) => {
      const rows = [];
      for (const player of req.body.players) {
        const result = await client.query(
          `INSERT INTO players(map_id,environment,uid,name,level,game_level,profile,last_active_at)
           VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,NOW())
           ON CONFLICT(map_id,environment,uid) DO UPDATE SET name=EXCLUDED.name,level=EXCLUDED.level,game_level=EXCLUDED.game_level,profile=EXCLUDED.profile,last_active_at=NOW(),updated_at=NOW()
           RETURNING id,uid,name,last_active_at`,
          [
            req.apiKey.map_id,
            req.apiKey.environment,
            player.uid,
            player.name,
            player.level,
            player.gameLevel,
            JSON.stringify(player.profile),
          ],
        );
        rows.push(result.rows[0]);
      }
      return rows;
    });
    res.json({ success: true, data: { players } });
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

const leaderboardKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._-]+$/);
const leaderboardEntrySchema = z.object({
  uid: z.string().trim().min(1).max(128),
  name: z.string().trim().min(1).max(160),
  gameLevel: z.string().trim().max(64).optional().default(""),
  score: z.coerce.number().finite().min(-1e15).max(1e15),
  gameCount: z.coerce.number().int().min(0).max(1e12).optional().default(0),
  metadata: z.record(z.string(), z.unknown()).optional().default({}),
});
const leaderboardQuerySchema = z.object({
  uids: z.array(playerUidSchema).max(24).optional().default([]),
  limit: z.coerce.number().int().min(1).max(100).optional().default(100),
});
const fqChinaTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function fqChinaTime(value) {
  if (!value) return "";
  const parts = Object.fromEntries(
    fqChinaTimeFormatter
      .formatToParts(new Date(value))
      .map((part) => [part.type, part.value]),
  );
  return `${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

function gameLeaderboardEntryRow(row) {
  return {
    rank: Number(row.rank),
    uid: row.player_uid,
    name: row.player_name,
    gameLevel: row.game_level,
    score: Number(row.score),
    gameCount: Number(row.game_count),
    metadata: row.metadata,
    achievedAt: row.updated_at,
    achievedAtText: fqChinaTime(row.updated_at),
  };
}

router.post(
  "/leaderboards/:leaderboardKey/query",
  requireApiPermission("game.leaderboards.read"),
  validate(leaderboardQuerySchema),
  async (req, res) => {
    const leaderboardKey = leaderboardKeySchema.parse(
      req.params.leaderboardKey,
    );
    const leaderboardResult = await query(
      `SELECT l.id,l.name,l.value_label,
              latest.id AS snapshot_id,latest.entry_count,latest.published_at,
              (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai')::date::text AS collection_date
         FROM leaderboards l
         LEFT JOIN LATERAL (
           SELECT id,entry_count,published_at
             FROM leaderboard_snapshots
            WHERE leaderboard_id=l.id
            ORDER BY published_at DESC,id DESC LIMIT 1
         ) latest ON TRUE
        WHERE l.map_id=$1 AND l.environment=$2 AND l.leaderboard_key=$3 AND l.enabled=TRUE`,
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

    const submittedToday = await query(
      `SELECT player_uid FROM leaderboard_entries
        WHERE leaderboard_id=$1 AND player_uid=ANY($2::text[])
          AND last_submitted_on=$3::date`,
      [leaderboard.id, req.body.uids, leaderboard.collection_date],
    );
    let entries = [];
    let playerRanks = [];
    if (leaderboard.snapshot_id) {
      const [entriesResult, playerRanksResult] = await Promise.all([
        query(
          `SELECT rank,player_uid,player_name,game_level,score,game_count,metadata,achieved_at AS updated_at
             FROM leaderboard_snapshot_entries
            WHERE snapshot_id=$1 ORDER BY rank LIMIT $2`,
          [leaderboard.snapshot_id, req.body.limit],
        ),
        query(
          `SELECT rank,player_uid,player_name,game_level,score,game_count,metadata,achieved_at AS updated_at
             FROM leaderboard_snapshot_entries
            WHERE snapshot_id=$1 AND player_uid=ANY($2::text[]) ORDER BY rank`,
          [leaderboard.snapshot_id, req.body.uids],
        ),
      ]);
      entries = entriesResult.rows.map(gameLeaderboardEntryRow);
      playerRanks = playerRanksResult.rows.map(gameLeaderboardEntryRow);
    }
    res.json({
      success: true,
      data: {
        leaderboardKey,
        name: leaderboard.name,
        valueLabel: leaderboard.value_label,
        published: Boolean(leaderboard.snapshot_id),
        snapshotId: leaderboard.snapshot_id
          ? Number(leaderboard.snapshot_id)
          : null,
        publishedAt: leaderboard.published_at || null,
        publishedAtText: fqChinaTime(leaderboard.published_at),
        totalEntries: Number(leaderboard.entry_count || 0),
        entries,
        playerRanks,
        collectionDate: leaderboard.collection_date,
        submittedTodayUids: submittedToday.rows.map((row) => row.player_uid),
      },
    });
  },
);

router.post(
  "/leaderboards/:leaderboardKey/entries",
  requireApiPermission("game.leaderboards.write"),
  validate(
    z
      .object({
        entries: z.array(leaderboardEntrySchema).min(1).max(500),
      })
      .superRefine(({ entries }, context) => {
        const uids = new Set();
        for (const [index, entry] of entries.entries()) {
          if (uids.has(entry.uid)) {
            context.addIssue({
              code: "custom",
              message: "同一批排行榜条目不能包含重复 UID",
              path: ["entries", index, "uid"],
            });
          }
          uids.add(entry.uid);
        }
      }),
  ),
  async (req, res) => {
    const leaderboardKey = leaderboardKeySchema.parse(
      req.params.leaderboardKey,
    );
    const leaderboardResult = await query(
      `SELECT id,sort_direction,score_update_mode,
              (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai')::date::text AS collection_date
         FROM leaderboards
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

    const acceptedUids = await transaction(async (client) => {
      const accepted = [];
      for (const entry of req.body.entries) {
        const result = await client.query(
          `INSERT INTO leaderboard_entries(leaderboard_id,player_uid,player_name,game_level,score,game_count,metadata,last_submitted_on)
           VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$10::date)
           ON CONFLICT(leaderboard_id,player_uid) DO UPDATE SET
              player_name=EXCLUDED.player_name,
              game_level=CASE
                WHEN $8='latest' OR ($8='best' AND (($9='desc' AND EXCLUDED.score>leaderboard_entries.score) OR ($9='asc' AND EXCLUDED.score<leaderboard_entries.score)))
                THEN EXCLUDED.game_level ELSE leaderboard_entries.game_level END,
              score=CASE
                WHEN $8='latest' OR ($8='best' AND (($9='desc' AND EXCLUDED.score>leaderboard_entries.score) OR ($9='asc' AND EXCLUDED.score<leaderboard_entries.score)))
                THEN EXCLUDED.score ELSE leaderboard_entries.score END,
              game_count=CASE
                WHEN $8='latest' OR ($8='best' AND (($9='desc' AND EXCLUDED.score>leaderboard_entries.score) OR ($9='asc' AND EXCLUDED.score<leaderboard_entries.score)))
                THEN EXCLUDED.game_count ELSE leaderboard_entries.game_count END,
              metadata=CASE
                WHEN $8='latest' OR ($8='best' AND (($9='desc' AND EXCLUDED.score>leaderboard_entries.score) OR ($9='asc' AND EXCLUDED.score<leaderboard_entries.score)))
                THEN EXCLUDED.metadata ELSE leaderboard_entries.metadata END,
              updated_at=CASE
                WHEN $8='latest' OR ($8='best' AND (($9='desc' AND EXCLUDED.score>leaderboard_entries.score) OR ($9='asc' AND EXCLUDED.score<leaderboard_entries.score)))
                THEN NOW() ELSE leaderboard_entries.updated_at END,
              last_submitted_on=EXCLUDED.last_submitted_on
           WHERE leaderboard_entries.last_submitted_on IS DISTINCT FROM EXCLUDED.last_submitted_on
           RETURNING player_uid`,
          [
            leaderboard.id,
            entry.uid,
            entry.name,
            entry.gameLevel,
            entry.score,
            entry.gameCount,
            JSON.stringify(entry.metadata),
            leaderboard.score_update_mode,
            leaderboard.sort_direction,
            leaderboard.collection_date,
          ],
        );
        if (result.rows[0]) accepted.push(result.rows[0].player_uid);
      }
      return accepted;
    });
    const accepted = new Set(acceptedUids);
    res.json({
      success: true,
      data: {
        leaderboardKey,
        collectionDate: leaderboard.collection_date,
        acceptedUids,
        skippedUids: req.body.entries
          .filter((entry) => !accepted.has(entry.uid))
          .map((entry) => entry.uid),
      },
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

router.post(
  "/deliveries/query",
  requireApiPermission("game.messages.read"),
  requireApiPermission("game.gifts.read"),
  validate(
    z.object({
      uids: z
        .array(playerUidSchema)
        .min(1)
        .max(24)
        .transform((uids) => [...new Set(uids)]),
    }),
  ),
  async (req, res) => {
    const [messages, gifts] = await Promise.all([
      query(
        `SELECT * FROM (
           SELECT p.uid,pm.id,pm.subject,pm.content,pm.attachments,pm.created_at,
                  ROW_NUMBER() OVER (PARTITION BY p.uid ORDER BY pm.created_at) AS item_order
             FROM player_messages pm JOIN players p ON p.id=pm.player_id
            WHERE pm.map_id=$1 AND pm.environment=$2 AND p.uid=ANY($3::text[])
              AND p.data_ban IS DISTINCT FROM TRUE AND pm.status='pending'
         ) pending WHERE item_order<=100 ORDER BY uid,item_order`,
        [req.apiKey.map_id, req.apiKey.environment, req.body.uids],
      ),
      query(
        `SELECT * FROM (
           SELECT p.uid,gg.id,g.gift_key,g.name,gg.quantity,gg.boolean_value,gg.granted_at,
                  ROW_NUMBER() OVER (PARTITION BY p.uid ORDER BY gg.granted_at) AS item_order
             FROM gift_grants gg JOIN gifts g ON g.id=gg.gift_id JOIN players p ON p.id=gg.player_id
            WHERE gg.map_id=$1 AND gg.environment=$2 AND p.uid=ANY($3::text[])
              AND p.data_ban IS DISTINCT FROM TRUE AND gg.delivered_at IS NULL
         ) pending WHERE item_order<=100 ORDER BY uid,item_order`,
        [req.apiKey.map_id, req.apiKey.environment, req.body.uids],
      ),
    ]);
    const byUid = new Map(
      req.body.uids.map((uid) => [uid, { uid, messages: [], gifts: [] }]),
    );
    for (const message of messages.rows) {
      const { uid, item_order: _itemOrder, ...data } = message;
      byUid.get(uid)?.messages.push(data);
    }
    for (const gift of gifts.rows) {
      const { uid, item_order: _itemOrder, ...data } = gift;
      byUid.get(uid)?.gifts.push(data);
    }
    res.json({ success: true, data: { players: [...byUid.values()] } });
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
