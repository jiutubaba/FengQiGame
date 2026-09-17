import { z } from "zod";
import { ANALYTICS_KEYS } from "../../shared/analytics.js";
import { transaction } from "../db/index.js";
import { HttpError, notFound } from "../lib/errors.js";
import { hashToken } from "../lib/security.js";

const key = z.string().trim().min(1).max(128);
const name = z.string().trim().min(1).max(160);
const dimensions = {
  objectKey: key,
  objectName: name,
  version: z.string().trim().min(1).max(64),
  difficulty: z.string().trim().max(64).default(""),
};
export const analyticsEventSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("start"),
      eventId: key,
      feature: z.enum(["progression", "challenges", "stages"]),
      runId: key,
      ...dimensions,
      uids: z
        .array(key)
        .min(1)
        .max(24)
        .refine(
          (values) => new Set(values).size === values.length,
          "UID 不能重复",
        ),
    })
    .strict(),
  z
    .object({
      type: z.literal("end"),
      eventId: key,
      feature: z.enum(["progression", "challenges", "stages"]),
      runId: key,
      outcome: z.enum(["success", "failure", "exit"]),
      durationSeconds: z.number().finite().min(0).max(604800),
      reason: z.string().trim().max(160).default(""),
      remainingPercent: z.number().finite().min(0).max(100).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("choice"),
      eventId: key,
      feature: z.literal("choices"),
      choiceId: key,
      uid: key,
      ...dimensions,
      position: z.number().int().min(1).max(1000),
      candidates: z.array(z.object({ key, name }).strict()).min(1).max(100),
      selectedKey: key.nullable(),
    })
    .strict()
    .refine(
      (event) =>
        new Set(event.candidates.map((item) => item.key)).size ===
        event.candidates.length,
      "候选 Key 不能重复",
    )
    .refine(
      (event) =>
        event.selectedKey === null ||
        event.candidates.some((item) => item.key === event.selectedKey),
      "选择必须属于候选集合",
    ),
]);

export const analyticsQuerySchema = z.object({
  date: z.iso.date(),
  version: z.string().trim().max(64).optional(),
  difficulty: z.string().trim().max(64).optional(),
});

export async function lockAnalyticsFeature(client, mapId, feature) {
  const result = await client.query(
    "SELECT analytics_features FROM maps WHERE id=$1 FOR SHARE",
    [mapId],
  );
  if (!result.rows[0]) throw notFound("地图不存在");
  if (!result.rows[0].analytics_features.includes(feature)) {
    throw new HttpError(403, "当前地图未开放此分析功能", "FEATURE_DISABLED");
  }
}

export async function recordAnalyticsEvent(mapId, event) {
  return transaction(async (client) => {
    await lockAnalyticsFeature(client, mapId, event.feature);
    const digest = hashToken(JSON.stringify(event));
    const inserted = await client.query(
      "INSERT INTO analytics_events(map_id,event_id,payload_hash) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING event_id",
      [mapId, event.eventId, digest],
    );
    if (!inserted.rowCount) {
      const previous = await client.query(
        "SELECT payload_hash FROM analytics_events WHERE map_id=$1 AND event_id=$2",
        [mapId, event.eventId],
      );
      if (previous.rows[0].payload_hash !== digest)
        throw new HttpError(409, "相同事件 ID 不能修改内容", "EVENT_CONFLICT");
      return;
    }
    if (event.type === "start") {
      const result = await client.query(
        `INSERT INTO analytics_attempts(map_id,feature,run_id,object_key,object_name,version,difficulty,uids)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING RETURNING run_id`,
        [
          mapId,
          event.feature,
          event.runId,
          event.objectKey,
          event.objectName,
          event.version,
          event.difficulty,
          event.uids,
        ],
      );
      if (!result.rowCount)
        throw new HttpError(
          409,
          "该尝试已开始，请使用原事件 ID 重试",
          "RUN_CONFLICT",
        );
    } else if (event.type === "end") {
      const result = await client.query(
        `UPDATE analytics_attempts SET ended_at=NOW(),outcome=$4,duration_seconds=$5,reason=$6,remaining_percent=$7
         WHERE map_id=$1 AND feature=$2 AND run_id=$3 AND ended_at IS NULL RETURNING run_id`,
        [
          mapId,
          event.feature,
          event.runId,
          event.outcome,
          event.durationSeconds,
          event.reason,
          event.remainingPercent ?? null,
        ],
      );
      if (!result.rowCount)
        throw new HttpError(
          409,
          "请先确认开始事件成功，已结算的尝试不能再次结算",
          "RUN_NOT_OPEN",
        );
    } else {
      const result = await client.query(
        `INSERT INTO analytics_choices(map_id,choice_id,player_uid,object_key,object_name,version,difficulty,position,candidates,selected_key)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10) ON CONFLICT DO NOTHING RETURNING choice_id`,
        [
          mapId,
          event.choiceId,
          event.uid,
          event.objectKey,
          event.objectName,
          event.version,
          event.difficulty,
          event.position,
          JSON.stringify(event.candidates),
          event.selectedKey,
        ],
      );
      if (!result.rowCount)
        throw new HttpError(
          409,
          "该选择已记录，请使用原事件 ID 重试",
          "CHOICE_CONFLICT",
        );
    }
  });
}

export async function getAnalytics(mapId, feature, filters) {
  z.enum(ANALYTICS_KEYS).parse(feature);
  return transaction(async (client) => {
    await lockAnalyticsFeature(client, mapId, feature);
    const params = [
      mapId,
      filters.date,
      filters.version ?? null,
      filters.difficulty ?? null,
    ];
    const timestamp = feature === "choices" ? "created_at" : "started_at";
    const where = `map_id=$1 AND ${timestamp} >= ($2::date::timestamp AT TIME ZONE 'Asia/Shanghai')
      AND ${timestamp} < (($2::date+1)::timestamp AT TIME ZONE 'Asia/Shanghai')
      AND ($3::text IS NULL OR version=$3) AND ($4::text IS NULL OR difficulty=$4)`;
    let rows;
    if (feature === "choices") {
      rows = (
        await client.query(
          `SELECT object_key,MAX(object_name) AS object_name,position,candidate->>'key' AS candidate_key,
          MAX(candidate->>'name') AS candidate_name,COUNT(*)::int AS offered,
          COUNT(*) FILTER(WHERE selected_key=candidate->>'key')::int AS selected,
          COUNT(DISTINCT player_uid)::int AS offered_users,
          COUNT(DISTINCT player_uid) FILTER(WHERE selected_key=candidate->>'key')::int AS selected_users
         FROM analytics_choices CROSS JOIN LATERAL jsonb_array_elements(candidates) candidate
         WHERE ${where} GROUP BY object_key,position,candidate->>'key' ORDER BY object_key,position,offered DESC,candidate_key`,
          params,
        )
      ).rows;
    } else {
      params.push(feature);
      rows = (
        await client.query(
          `WITH attempts AS (SELECT * FROM analytics_attempts WHERE ${where} AND feature=$5),
         people AS (SELECT object_key,COUNT(DISTINCT uid)::int AS users,
           COUNT(DISTINCT uid) FILTER(WHERE outcome='success')::int AS successful_users
           FROM attempts CROSS JOIN LATERAL unnest(uids) uid GROUP BY object_key)
         SELECT a.object_key,MAX(a.object_name) AS object_name,COUNT(*)::int AS attempts,
           COUNT(*) FILTER(WHERE outcome='success')::int AS successes,
           COUNT(*) FILTER(WHERE outcome='failure')::int AS failures,
           COUNT(*) FILTER(WHERE outcome='exit')::int AS exits,
           COUNT(*) FILTER(WHERE outcome IS NULL)::int AS unresolved,
           percentile_cont(0.5) WITHIN GROUP(ORDER BY duration_seconds) FILTER(WHERE outcome='success') AS median_seconds,
           AVG(remaining_percent) FILTER(WHERE outcome='failure') AS remaining_percent,
           COUNT(remaining_percent) FILTER(WHERE outcome='failure')::int AS remaining_samples,
           MAX(p.users) AS users,MAX(p.successful_users) AS successful_users
         FROM attempts a JOIN people p ON p.object_key=a.object_key
         GROUP BY a.object_key ORDER BY a.object_key`,
          params,
        )
      ).rows;
    }
    const reasons =
      feature === "choices"
        ? []
        : (
            await client.query(
              `SELECT object_key,COALESCE(NULLIF(reason,''),'未填写') AS reason,outcome,COUNT(*)::int AS count
       FROM analytics_attempts WHERE ${where} AND feature=$5 AND outcome IN ('failure','exit')
       GROUP BY object_key,reason,outcome ORDER BY count DESC,object_key`,
              params,
            )
          ).rows;
    return { feature, date: filters.date, rows, reasons };
  });
}
