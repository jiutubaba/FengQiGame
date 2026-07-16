import { config } from "../config.js";
import { query } from "../db/index.js";
import { forbidden, HttpError } from "../lib/errors.js";
import { hashToken } from "../lib/security.js";

export const PERMISSIONS = Object.freeze({
  MAP_VIEW: "map.view",
  MAP_EDIT: "map.edit",
  METRICS_VIEW: "metrics.view",
  PLAYERS_VIEW: "players.view",
  PLAYERS_MANAGE: "players.manage",
  LEADERBOARDS_VIEW: "leaderboards.view",
  LEADERBOARDS_MANAGE: "leaderboards.manage",
  RISK_VIEW: "risk.view",
  RISK_MANAGE: "risk.manage",
  GIFTS_MANAGE: "gifts.manage",
  ANCHORS_MANAGE: "anchors.manage",
  POINTS_MANAGE: "points.manage",
  LOGS_VIEW: "logs.view",
  FILES_MANAGE: "files.manage",
  API_KEYS_MANAGE: "api_keys.manage",
});

export const ALL_MAP_PERMISSIONS = Object.freeze(Object.values(PERMISSIONS));

export async function loadSession(req, _res, next) {
  const token = req.cookies?.[config.SESSION_COOKIE_NAME];
  if (!token) return next();
  const result = await query(
    `SELECT u.id, u.username, u.display_name, u.phone, u.role, u.status, u.profile, u.last_login_at,
            s.expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > NOW()`,
    [hashToken(token)],
  );
  const user = result.rows[0];
  if (user?.status === "active") req.user = user;
  return next();
}

export function requireAuth(req, _res, next) {
  if (!req.user) return next(new HttpError(401, "请先登录", "UNAUTHENTICATED"));
  return next();
}

export function requireAdmin(req, _res, next) {
  if (!req.user) return next(new HttpError(401, "请先登录", "UNAUTHENTICATED"));
  if (req.user.role !== "admin")
    return next(forbidden("仅管理员可以执行此操作"));
  return next();
}

export function requireMapPermission(permission) {
  return async (req, _res, next) => {
    if (!req.user)
      return next(new HttpError(401, "请先登录", "UNAUTHENTICATED"));
    const mapId = Number(
      req.params.mapId || req.params.id || req.body?.mapId || req.query?.mapId,
    );
    if (!Number.isSafeInteger(mapId) || mapId <= 0)
      return next(new HttpError(400, "地图 ID 无效", "INVALID_MAP_ID"));
    if (req.user.role === "admin") {
      req.mapPermissions = ALL_MAP_PERMISSIONS;
      return next();
    }
    const result = await query(
      "SELECT permissions FROM map_permissions WHERE map_id=$1 AND user_id=$2",
      [mapId, req.user.id],
    );
    const permissions = result.rows[0]?.permissions || [];
    if (
      !permissions.includes(PERMISSIONS.MAP_VIEW) ||
      !permissions.includes(permission)
    )
      return next(forbidden());
    req.mapPermissions = permissions;
    return next();
  };
}

export async function loadApiKey(req, _res, next) {
  const token = req.get("fq-map-key");
  if (!token)
    return next(
      new HttpError(401, "缺少 FQ 地图 API Key", "FQ_MISSING_API_KEY"),
    );
  const result = await query(
    `UPDATE api_keys SET last_used_at=NOW()
      WHERE token_hash=$1 AND status='active'
      RETURNING id, map_id, environment, name, permissions`,
    [hashToken(token)],
  );
  if (!result.rows[0])
    return next(
      new HttpError(401, "FQ 地图 API Key 无效", "FQ_INVALID_API_KEY"),
    );
  req.apiKey = result.rows[0];
  return next();
}

export function requireApiPermission(permission) {
  return (req, _res, next) =>
    req.apiKey?.permissions.includes(permission)
      ? next()
      : next(forbidden("API Key 没有该接口权限"));
}
