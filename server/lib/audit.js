import { query } from "../db/index.js";

export async function writeAudit(
  req,
  { action, resourceType, resourceId = null, mapId = null, details = {} },
  client = null,
) {
  const execute = client ? client.query.bind(client) : query;
  const result = await execute(
    `INSERT INTO audit_logs(actor_user_id, action, resource_type, resource_id, map_id, ip, user_agent, details)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
     RETURNING id`,
    [
      req.user?.id || null,
      action,
      resourceType,
      resourceId == null ? null : String(resourceId),
      mapId,
      req.ip,
      req.get("user-agent") || null,
      JSON.stringify(details),
    ],
  );
  return Number(result.rows[0].id);
}
