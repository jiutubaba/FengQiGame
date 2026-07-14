import { query } from "../db/index.js";

export async function writeAudit(
  req,
  { action, resourceType, resourceId = null, mapId = null, details = {} },
) {
  await query(
    `INSERT INTO audit_logs(actor_user_id, action, resource_type, resource_id, map_id, ip, user_agent, details)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
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
}
