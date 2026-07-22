import { Router } from "express";
import { z } from "zod";
import { query, transaction } from "../db/index.js";
import { writeAudit } from "../lib/audit.js";
import { conflict, notFound } from "../lib/errors.js";
import { hashPassword } from "../lib/security.js";
import {
  ALL_MAP_PERMISSIONS,
  requireAdmin,
  requireAuth,
} from "../middleware/auth.js";
import { validate } from "../middleware/validation.js";
import { createUser } from "../services/users.js";

const router = Router();
router.use(requireAuth, requireAdmin);

router.get("/permissions", (_req, res) => {
  res.json({
    success: true,
    data: ALL_MAP_PERMISSIONS.map((value) => ({
      value,
      label: permissionLabels[value],
    })),
  });
});

router.get("/users", async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
  const q = String(req.query.q || "").trim();
  const params = [];
  let where = "TRUE";
  if (q) {
    params.push(`%${q}%`);
    where = `(u.username ILIKE $1 OR u.display_name ILIKE $1 OR COALESCE(u.phone,'') ILIKE $1)`;
  }
  const count = await query(
    `SELECT COUNT(*)::int AS count FROM users u WHERE ${where}`,
    params,
  );
  params.push(limit, (page - 1) * limit);
  const result = await query(
    `SELECT u.id,u.username,u.display_name,u.phone,u.role,u.status,u.profile,u.last_login_at,u.created_at,u.updated_at,
            COUNT(mp.map_id)::int AS map_count
       FROM users u LEFT JOIN map_permissions mp ON mp.user_id=u.id
      WHERE ${where} GROUP BY u.id ORDER BY u.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  res.json({
    success: true,
    data: result.rows.map(userRow),
    pagination: { page, limit, total: count.rows[0].count },
  });
});

router.post(
  "/users",
  validate(
    z.object({
      username: z.string().trim().min(2).max(64),
      password: z.string().min(6).max(256),
      displayName: z.string().trim().min(1).max(100),
      phone: z.string().trim().max(32).nullable().optional(),
      role: z.enum(["admin", "user"]).default("user"),
    }),
  ),
  async (req, res) => {
    const user = await createUser(req.body);
    await writeAudit(req, {
      action: "user.create",
      resourceType: "user",
      resourceId: user.id,
      details: { username: user.username, role: user.role },
    });
    res.status(201).json({ success: true, data: userRow(user) });
  },
);

router.patch(
  "/users/:userId",
  validate(
    z.object({
      displayName: z.string().trim().min(1).max(100).optional(),
      phone: z.string().trim().max(32).nullable().optional(),
      role: z.enum(["admin", "user"]).optional(),
      status: z.enum(["active", "disabled"]).optional(),
    }),
  ),
  async (req, res) => {
    const userId = Number(req.params.userId);
    if (!Number.isSafeInteger(userId) || userId <= 0)
      throw notFound("用户不存在");
    const current = await query("SELECT * FROM users WHERE id=$1", [userId]);
    if (!current.rows[0]) throw notFound("用户不存在");
    if (userId === Number(req.user.id) && req.body.status === "disabled")
      throw conflict("不能停用当前登录账号");
    if (userId === Number(req.user.id) && req.body.role === "user")
      throw conflict("不能降低当前登录管理员的角色");
    const row = current.rows[0];
    const result = await query(
      `UPDATE users SET display_name=$1,phone=$2,role=$3,status=$4,updated_at=NOW() WHERE id=$5
     RETURNING id,username,display_name,phone,role,status,profile,last_login_at,created_at,updated_at`,
      [
        req.body.displayName ?? row.display_name,
        req.body.phone === undefined ? row.phone : req.body.phone,
        req.body.role ?? row.role,
        req.body.status ?? row.status,
        userId,
      ],
    );
    if (req.body.status === "disabled")
      await query("DELETE FROM sessions WHERE user_id=$1", [userId]);
    await writeAudit(req, {
      action: "user.update",
      resourceType: "user",
      resourceId: userId,
      details: { fields: Object.keys(req.body) },
    });
    res.json({ success: true, data: userRow(result.rows[0]) });
  },
);

router.post(
  "/users/:userId/password",
  validate(z.object({ password: z.string().min(6).max(256) })),
  async (req, res) => {
    const userId = Number(req.params.userId);
    const passwordHash = await hashPassword(req.body.password);
    const result = await transaction(async (client) => {
      const updated = await client.query(
        "UPDATE users SET password_hash=$1,updated_at=NOW() WHERE id=$2 RETURNING id",
        [passwordHash, userId],
      );
      if (!updated.rows[0]) throw notFound("用户不存在");
      await client.query("DELETE FROM sessions WHERE user_id=$1", [userId]);
      return updated.rows[0];
    });
    await writeAudit(req, {
      action: "user.password_reset",
      resourceType: "user",
      resourceId: result.id,
    });
    res.json({ success: true });
  },
);

router.get("/users/:userId/maps", async (req, res) => {
  const userId = Number(req.params.userId);
  const result = await query(
    `SELECT m.id,m.name,m.status,COALESCE(mp.permissions,ARRAY[]::TEXT[]) AS permissions
       FROM maps m LEFT JOIN map_permissions mp ON mp.map_id=m.id AND mp.user_id=$1
      WHERE m.status='active' ORDER BY m.name`,
    [userId],
  );
  res.json({ success: true, data: result.rows });
});

router.put(
  "/users/:userId/maps/:mapId",
  validate(
    z.object({
      permissions: z
        .array(z.enum(ALL_MAP_PERMISSIONS))
        .max(ALL_MAP_PERMISSIONS.length),
    }),
  ),
  async (req, res) => {
    const userId = Number(req.params.userId),
      mapId = Number(req.params.mapId);
    if (userId === Number(req.user.id))
      throw conflict("管理员自身不需要地图级授权");
    if (!req.body.permissions.length) {
      await query(
        "DELETE FROM map_permissions WHERE user_id=$1 AND map_id=$2",
        [userId, mapId],
      );
    } else {
      const permissions = [...new Set(["map.view", ...req.body.permissions])];
      await query(
        `INSERT INTO map_permissions(map_id,user_id,permissions,granted_by)
       VALUES($1,$2,$3,$4)
       ON CONFLICT(map_id,user_id) DO UPDATE SET permissions=EXCLUDED.permissions,granted_by=EXCLUDED.granted_by,updated_at=NOW()`,
        [mapId, userId, permissions, req.user.id],
      );
    }
    await writeAudit(req, {
      action: "user.map_permissions.update",
      resourceType: "map_permission",
      resourceId: `${userId}:${mapId}`,
      mapId,
      details: { userId, permissions: req.body.permissions },
    });
    res.json({ success: true });
  },
);

router.get("/settings", async (_req, res) => {
  const result = await query(
    "SELECT setting_key,value,updated_at FROM system_settings ORDER BY setting_key",
  );
  res.json({
    success: true,
    data: Object.fromEntries(
      result.rows.map((row) => [row.setting_key, row.value]),
    ),
  });
});

router.put(
  "/settings",
  validate(z.record(z.string().min(1).max(120), z.unknown())),
  async (req, res) => {
    await transaction(async (client) => {
      for (const [key, value] of Object.entries(req.body)) {
        await client.query(
          `INSERT INTO system_settings(setting_key,value,updated_by) VALUES($1,$2::jsonb,$3)
         ON CONFLICT(setting_key) DO UPDATE SET value=EXCLUDED.value,updated_by=EXCLUDED.updated_by,updated_at=NOW()`,
          [key, JSON.stringify(value), req.user.id],
        );
      }
    });
    await writeAudit(req, {
      action: "system.settings.update",
      resourceType: "system_settings",
      details: { keys: Object.keys(req.body) },
    });
    res.json({ success: true });
  },
);

const permissionLabels = {
  "map.view": "查看地图",
  "map.edit": "编辑地图与配置",
  "metrics.view": "查看数据指标",
  "players.view": "查看玩家",
  "players.manage": "管理玩家",
  "leaderboards.view": "查看排行榜",
  "leaderboards.manage": "管理排行榜",
  "risk.view": "查看风控事件",
  "risk.manage": "处置风控事件",
  "gifts.manage": "管理礼包资格与定义",
  "anchors.manage": "管理主播",
  "points.manage": "管理埋点",
  "logs.view": "查看日志",
  "files.manage": "管理文件",
  "api_keys.manage": "管理游戏 API Key",
};

function userRow(row) {
  return {
    id: Number(row.id),
    username: row.username,
    displayName: row.display_name,
    phone: row.phone,
    role: row.role,
    status: row.status,
    profile: row.profile || {},
    mapCount: Number(row.map_count || 0),
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export default router;
