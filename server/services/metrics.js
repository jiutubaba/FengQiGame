import { query, transaction } from "../db/index.js";
import { HttpError } from "../lib/errors.js";

const CHINA_TIME_ZONE = "Asia/Shanghai";

export async function recordMetricSessionEvent({
  mapId,
  sessionId,
  uids,
  event,
  now = new Date(),
}) {
  const occurredAt = new Date(now);
  const uniqueUids = [...new Set(uids)];
  return transaction(
    async (client) => {
      let session;
      let activityAt = occurredAt;
      let shouldRecordActivity = true;
      if (event === "start") {
        session = await client.query(
          `INSERT INTO fq_metric_sessions(
           map_id,session_id,started_at,last_heartbeat_at
         ) VALUES($1,$2,$3,$3)
         ON CONFLICT(map_id,session_id) DO UPDATE
           SET updated_at=fq_metric_sessions.updated_at
         RETURNING session_id,started_at,last_heartbeat_at,ended_at`,
          [mapId, sessionId, occurredAt],
        );
        activityAt = session.rows[0].started_at;
        shouldRecordActivity = !session.rows[0].ended_at;
      } else if (event === "heartbeat") {
        session = await client.query(
          `UPDATE fq_metric_sessions
            SET last_heartbeat_at=GREATEST(last_heartbeat_at,$3),
                updated_at=NOW()
          WHERE map_id=$1 AND session_id=$2 AND ended_at IS NULL
          RETURNING session_id,started_at,last_heartbeat_at,ended_at`,
          [mapId, sessionId, occurredAt],
        );
        if (!session.rows[0]) {
          session = await client.query(
            `SELECT session_id,started_at,last_heartbeat_at,ended_at
             FROM fq_metric_sessions
            WHERE map_id=$1 AND session_id=$2`,
            [mapId, sessionId],
          );
          shouldRecordActivity = false;
        }
      } else if (event === "end") {
        session = await client.query(
          `UPDATE fq_metric_sessions
            SET last_heartbeat_at=GREATEST(last_heartbeat_at,COALESCE(ended_at,$3)),
                ended_at=COALESCE(ended_at,$3),
                updated_at=NOW()
          WHERE map_id=$1 AND session_id=$2
          RETURNING session_id,started_at,last_heartbeat_at,ended_at`,
          [mapId, sessionId, occurredAt],
        );
        activityAt = session.rows[0]?.ended_at || occurredAt;
      } else {
        throw new Error(`未知指标会话事件：${event}`);
      }

      if (!session.rows[0]) {
        throw new HttpError(
          404,
          "指标会话不存在，请先上报对局开始",
          "FQ_METRIC_SESSION_NOT_FOUND",
        );
      }

      if (shouldRecordActivity && uniqueUids.length) {
        await client.query(
          `INSERT INTO fq_metric_session_activity(
           map_id,session_id,player_uid,active_date,first_seen_at,last_seen_at
         )
         SELECT $1,$2,uid,($3::timestamptz AT TIME ZONE '${CHINA_TIME_ZONE}')::date,$3,$3
           FROM UNNEST($4::text[]) AS uid
         ON CONFLICT(map_id,session_id,player_uid,active_date)
         DO UPDATE SET last_seen_at=GREATEST(
           fq_metric_session_activity.last_seen_at,
           EXCLUDED.last_seen_at
         )`,
          [mapId, sessionId, activityAt, uniqueUids],
        );
      }

      return session.rows[0];
    },
    { mapId },
  );
}

export async function getAutomaticMetrics(mapId, now = new Date()) {
  const calculatedAt = new Date(now);
  const epoch = await query(
    `SELECT (MIN(started_at) AT TIME ZONE '${CHINA_TIME_ZONE}')::date AS epoch_date
       FROM fq_metric_sessions
      WHERE map_id=$1`,
    [mapId],
  );
  const epochDate = epoch.rows[0]?.epoch_date;
  if (!epochDate) return null;

  const result = await query(
    `WITH params AS NOT MATERIALIZED (
       SELECT $1::bigint AS map_id,
              $2::timestamptz AS now_at,
              ($2::timestamptz AT TIME ZONE '${CHINA_TIME_ZONE}')::date AS today,
              $3::date AS epoch_date
     ),
     days AS (
       SELECT today-offset_days AS metric_date
         FROM params
         CROSS JOIN LATERAL GENERATE_SERIES(
           0,LEAST(29,today-epoch_date)
         ) AS offset_days
     ),
     user_days AS (
       SELECT DISTINCT player_uid,active_date
         FROM fq_metric_session_activity
        WHERE map_id=$1
     ),
     user_activity AS (
       SELECT player_uid,active_date,
              MIN(active_date) OVER player_history AS first_date,
              LAG(active_date) OVER player_history AS previous_active_date,
              LEAD(active_date) OVER player_history AS next_active_date
         FROM user_days
       WINDOW player_history AS (
         PARTITION BY player_uid ORDER BY active_date
         ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
       )
     ),
     daily_users AS (
       SELECT active_date,
              COUNT(*)::bigint AS active_users,
              COUNT(*) FILTER (WHERE first_date=active_date)::bigint AS new_users,
              COUNT(*) FILTER (
                WHERE active_date-previous_active_date>=31
              )::bigint AS return_users,
              COUNT(*) FILTER (
                WHERE previous_active_date=active_date-1
              )::bigint AS active_retained,
              COUNT(*) FILTER (
                WHERE first_date=active_date-1
              )::bigint AS new_retained,
              COUNT(*) FILTER (
                WHERE first_date=active_date-7
              )::bigint AS seven_day_retained
         FROM user_activity
        GROUP BY active_date
     ),
     daily_lost AS (
       SELECT active_date+30 AS metric_date,COUNT(*)::bigint AS value
         FROM user_activity
        WHERE next_active_date IS NULL OR next_active_date>active_date+30
        GROUP BY active_date
     ),
     session_players AS (
       SELECT session_id,player_uid,MIN(active_date) AS joined_date
         FROM fq_metric_session_activity
        WHERE map_id=$1
        GROUP BY session_id,player_uid
     ),
     replay_users AS (
       SELECT joined_date,player_uid
         FROM session_players
        GROUP BY joined_date,player_uid
       HAVING COUNT(*)>=4
     ),
     daily_replay AS (
       SELECT joined_date,COUNT(*)::bigint AS value
         FROM replay_users
        GROUP BY joined_date
     ),
     daily_valid_games AS (
       SELECT (started_at AT TIME ZONE '${CHINA_TIME_ZONE}')::date AS started_date,
              COUNT(*)::bigint AS value
         FROM fq_metric_sessions
        WHERE map_id=$1
          AND COALESCE(ended_at,last_heartbeat_at)>started_at+INTERVAL '10 minutes'
        GROUP BY started_date
     ),
     opening_totals AS (
       SELECT (SELECT COALESCE(SUM(new_users),0)
                 FROM daily_users
                WHERE active_date<GREATEST(p.epoch_date,p.today-29)) AS users,
              (SELECT COALESCE(SUM(value),0)
                 FROM daily_valid_games
                WHERE started_date<GREATEST(p.epoch_date,p.today-29)) AS games
         FROM params p
     ),
     online_now AS (
       SELECT COUNT(DISTINCT a.player_uid)::bigint AS value
         FROM fq_metric_session_activity a
         JOIN fq_metric_sessions s
           ON s.map_id=a.map_id AND s.session_id=a.session_id
         CROSS JOIN params p
        WHERE a.map_id=$1
          AND s.ended_at IS NULL
          AND a.active_date=p.today
          AND a.last_seen_at>p.now_at-INTERVAL '120 seconds'
          AND a.last_seen_at<=p.now_at
     )
     SELECT d.metric_date,
            (ot.users+SUM(COALESCE(du.new_users,0)) OVER metric_days)::bigint
              AS cumulative_users,
            CASE WHEN d.metric_date=p.today THEN o.value ELSE 0 END AS online_users,
            (ot.games+SUM(COALESCE(dvg.value,0)) OVER metric_days)::bigint
              AS total_game_count,
            COALESCE(dvg.value,0) AS valid_game_count,
            COALESCE(du.new_users,0) AS daily_new_users,
            COALESCE(du.active_users,0) AS daily_active_users,
            COALESCE(dl.value,0) AS lost_user_count,
            COALESCE(du.return_users,0) AS return_user_count,
            COALESCE(du.active_retained,0) AS active_user_retained_count,
            COALESCE(previous.active_users,0) AS active_user_cohort_count,
            COALESCE(ROUND(
              100.0*COALESCE(du.active_retained,0)/NULLIF(previous.active_users,0),2
            ),0) AS active_user_retention_rate,
            COALESCE(du.new_retained,0) AS new_user_retained_count,
            COALESCE(previous.new_users,0) AS new_user_cohort_count,
            COALESCE(ROUND(
              100.0*COALESCE(du.new_retained,0)/NULLIF(previous.new_users,0),2
            ),0) AS new_user_retention_rate,
            COALESCE(du.seven_day_retained,0) AS seven_day_retained_count,
            COALESCE(seven_days_ago.new_users,0) AS seven_day_cohort_count,
            COALESCE(ROUND(
              100.0*COALESCE(du.seven_day_retained,0)/NULLIF(seven_days_ago.new_users,0),2
            ),0) AS seven_day_retention_rate,
            COALESCE(dp.value,0) AS replay_user_count,
            COALESCE(du.active_users,0) AS replay_cohort_count,
            COALESCE(ROUND(
              100.0*COALESCE(dp.value,0)/NULLIF(du.active_users,0),2
            ),0) AS replay_rate
       FROM days d
       CROSS JOIN params p
       CROSS JOIN online_now o
       CROSS JOIN opening_totals ot
       LEFT JOIN daily_users du ON du.active_date=d.metric_date
       LEFT JOIN daily_users previous ON previous.active_date=d.metric_date-1
       LEFT JOIN daily_users seven_days_ago ON seven_days_ago.active_date=d.metric_date-7
       LEFT JOIN daily_lost dl ON dl.metric_date=d.metric_date
       LEFT JOIN daily_replay dp ON dp.joined_date=d.metric_date
       LEFT JOIN daily_valid_games dvg ON dvg.started_date=d.metric_date
       WINDOW metric_days AS (ORDER BY d.metric_date)
      ORDER BY d.metric_date`,
    [mapId, calculatedAt, epochDate],
  );

  return {
    source: "automatic",
    epochDate,
    rows: result.rows.map((row) => ({
      ...row,
      updated_at: calculatedAt.toISOString(),
    })),
  };
}
