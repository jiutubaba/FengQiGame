import { query, transaction } from "../db/index.js";
import { HttpError } from "../lib/errors.js";

const CHINA_TIME_ZONE = "Asia/Shanghai";

export async function recordMetricSessionEvent({
  mapId,
  environment,
  sessionId,
  uids,
  event,
  now = new Date(),
}) {
  const occurredAt = new Date(now);
  const uniqueUids = [...new Set(uids)];
  return transaction(async (client) => {
    let session;
    if (event === "start") {
      session = await client.query(
        `INSERT INTO fq_metric_sessions(
           map_id,environment,session_id,started_at,last_heartbeat_at
         ) VALUES($1,$2,$3,$4,$4)
         ON CONFLICT(map_id,environment,session_id) DO UPDATE
           SET last_heartbeat_at=GREATEST(
                 fq_metric_sessions.last_heartbeat_at,
                 EXCLUDED.last_heartbeat_at
               ),
               updated_at=NOW()
         RETURNING session_id,started_at,last_heartbeat_at,ended_at`,
        [mapId, environment, sessionId, occurredAt],
      );
    } else if (event === "heartbeat") {
      session = await client.query(
        `UPDATE fq_metric_sessions
            SET last_heartbeat_at=GREATEST(last_heartbeat_at,$4),
                updated_at=NOW()
          WHERE map_id=$1 AND environment=$2 AND session_id=$3
          RETURNING session_id,started_at,last_heartbeat_at,ended_at`,
        [mapId, environment, sessionId, occurredAt],
      );
    } else if (event === "end") {
      session = await client.query(
        `UPDATE fq_metric_sessions
            SET last_heartbeat_at=GREATEST(last_heartbeat_at,$4),
                ended_at=COALESCE(ended_at,$4),
                updated_at=NOW()
          WHERE map_id=$1 AND environment=$2 AND session_id=$3
          RETURNING session_id,started_at,last_heartbeat_at,ended_at`,
        [mapId, environment, sessionId, occurredAt],
      );
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

    if (uniqueUids.length) {
      await client.query(
        `INSERT INTO fq_metric_session_activity(
           map_id,environment,session_id,player_uid,active_date,first_seen_at,last_seen_at
         )
         SELECT $1,$2,$3,uid,($4::timestamptz AT TIME ZONE '${CHINA_TIME_ZONE}')::date,$4,$4
           FROM UNNEST($5::text[]) AS uid
         ON CONFLICT(map_id,environment,session_id,player_uid,active_date)
         DO UPDATE SET last_seen_at=GREATEST(
           fq_metric_session_activity.last_seen_at,
           EXCLUDED.last_seen_at
         )`,
        [mapId, environment, sessionId, occurredAt, uniqueUids],
      );
    }

    return session.rows[0];
  });
}

export async function getAutomaticMetrics(
  mapId,
  environment,
  now = new Date(),
) {
  const calculatedAt = new Date(now);
  const epoch = await query(
    `SELECT MIN((started_at AT TIME ZONE '${CHINA_TIME_ZONE}')::date) AS epoch_date
       FROM fq_metric_sessions
      WHERE map_id=$1 AND environment=$2`,
    [mapId, environment],
  );
  const epochDate = epoch.rows[0]?.epoch_date;
  if (!epochDate) return null;

  const result = await query(
    `WITH params AS (
       SELECT $1::bigint AS map_id,
              $2::text AS environment,
              $3::timestamptz AS now_at,
              ($3::timestamptz AT TIME ZONE '${CHINA_TIME_ZONE}')::date AS today,
              $4::date AS epoch_date
     ),
     days AS (
       SELECT GENERATE_SERIES(
                GREATEST(epoch_date,today-29),
                today,
                INTERVAL '1 day'
              )::date AS metric_date
         FROM params
     ),
     session_base AS (
       SELECT s.session_id,
              (s.started_at AT TIME ZONE '${CHINA_TIME_ZONE}')::date AS started_date,
              s.last_heartbeat_at,
              s.ended_at
         FROM fq_metric_sessions s, params p
        WHERE s.map_id=p.map_id AND s.environment=p.environment
     ),
     activity_rows AS (
       SELECT a.session_id,a.player_uid,a.active_date,a.last_seen_at
         FROM fq_metric_session_activity a, params p
        WHERE a.map_id=p.map_id AND a.environment=p.environment
     ),
     user_days AS (
       SELECT DISTINCT player_uid,active_date FROM activity_rows
     ),
     first_days AS (
       SELECT player_uid,MIN(active_date) AS first_date
         FROM user_days
        GROUP BY player_uid
     ),
     daily_active AS (
       SELECT active_date,COUNT(*)::bigint AS value
         FROM user_days
        GROUP BY active_date
     ),
     daily_new AS (
       SELECT first_date,COUNT(*)::bigint AS value
         FROM first_days
        GROUP BY first_date
     ),
     return_candidates AS (
       SELECT player_uid,
              active_date,
              LAG(active_date) OVER (
                PARTITION BY player_uid ORDER BY active_date
              ) AS previous_active_date
         FROM user_days
     ),
     daily_return AS (
       SELECT active_date,COUNT(*)::bigint AS value
         FROM return_candidates
        WHERE previous_active_date IS NOT NULL
          AND active_date-previous_active_date>=31
        GROUP BY active_date
     ),
     daily_lost AS (
       SELECT d.metric_date,COUNT(u.player_uid)::bigint AS value
         FROM days d
         JOIN user_days u ON u.active_date=d.metric_date-30
        WHERE NOT EXISTS (
          SELECT 1
            FROM user_days later
           WHERE later.player_uid=u.player_uid
             AND later.active_date>u.active_date
             AND later.active_date<=d.metric_date
        )
        GROUP BY d.metric_date
     ),
     session_players AS (
       SELECT DISTINCT session_id,player_uid FROM activity_rows
     ),
     replay_users AS (
       SELECT s.started_date,sp.player_uid
         FROM session_base s
         JOIN session_players sp ON sp.session_id=s.session_id
        GROUP BY s.started_date,sp.player_uid
       HAVING COUNT(DISTINCT s.session_id)>=4
     ),
     daily_replay AS (
       SELECT started_date,COUNT(*)::bigint AS value
         FROM replay_users
        GROUP BY started_date
     ),
     online_now AS (
       SELECT COUNT(DISTINCT a.player_uid)::bigint AS value
         FROM activity_rows a
         JOIN session_base s ON s.session_id=a.session_id
         CROSS JOIN params p
        WHERE s.ended_at IS NULL
          AND a.active_date=p.today
          AND a.last_seen_at>p.now_at-INTERVAL '120 seconds'
          AND a.last_seen_at<=p.now_at
     )
     SELECT d.metric_date,
            (SELECT COUNT(*)::bigint FROM first_days f WHERE f.first_date<=d.metric_date)
              AS cumulative_users,
            CASE WHEN d.metric_date=p.today THEN o.value ELSE 0 END AS online_users,
            (SELECT COUNT(*)::bigint FROM session_base s WHERE s.started_date<=d.metric_date)
              AS total_game_count,
            COALESCE(dn.value,0) AS daily_new_users,
            COALESCE(da.value,0) AS daily_active_users,
            COALESCE(dl.value,0) AS lost_user_count,
            COALESCE(dr.value,0) AS return_user_count,
            COALESCE(ROUND(
              100.0*(SELECT COUNT(*)
                       FROM user_days current_day
                       JOIN user_days previous_day
                         ON previous_day.player_uid=current_day.player_uid
                        AND previous_day.active_date=d.metric_date-1
                      WHERE current_day.active_date=d.metric_date)
              /NULLIF((SELECT COUNT(*) FROM user_days WHERE active_date=d.metric_date-1),0),
              2
            ),0) AS active_user_retention_rate,
            COALESCE(ROUND(
              100.0*(SELECT COUNT(*)
                       FROM first_days f
                       JOIN user_days current_day ON current_day.player_uid=f.player_uid
                      WHERE f.first_date=d.metric_date-1
                        AND current_day.active_date=d.metric_date)
              /NULLIF((SELECT COUNT(*) FROM first_days WHERE first_date=d.metric_date-1),0),
              2
            ),0) AS new_user_retention_rate,
            COALESCE(ROUND(
              100.0*(SELECT COUNT(*)
                       FROM first_days f
                       JOIN user_days current_day ON current_day.player_uid=f.player_uid
                      WHERE f.first_date=d.metric_date-7
                        AND current_day.active_date=d.metric_date)
              /NULLIF((SELECT COUNT(*) FROM first_days WHERE first_date=d.metric_date-7),0),
              2
            ),0) AS seven_day_retention_rate,
            COALESCE(ROUND(
              100.0*COALESCE(dp.value,0)/NULLIF(da.value,0),
              2
            ),0) AS replay_rate
       FROM days d
       CROSS JOIN params p
       CROSS JOIN online_now o
       LEFT JOIN daily_new dn ON dn.first_date=d.metric_date
       LEFT JOIN daily_active da ON da.active_date=d.metric_date
       LEFT JOIN daily_lost dl ON dl.metric_date=d.metric_date
       LEFT JOIN daily_return dr ON dr.active_date=d.metric_date
       LEFT JOIN daily_replay dp ON dp.started_date=d.metric_date
      ORDER BY d.metric_date`,
    [mapId, environment, calculatedAt, epochDate],
  );

  return {
    source: "automatic",
    rows: result.rows.map((row) => ({
      ...row,
      updated_at: calculatedAt.toISOString(),
    })),
  };
}
