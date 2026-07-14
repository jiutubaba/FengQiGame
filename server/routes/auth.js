import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { config } from "../config.js";
import { query, transaction } from "../db/index.js";
import { writeAudit } from "../lib/audit.js";
import { conflict, HttpError } from "../lib/errors.js";
import {
  createOpaqueToken,
  hashPassword,
  hashToken,
  verifyPassword,
} from "../lib/security.js";
import { requireAuth } from "../middleware/auth.js";
import { validate } from "../middleware/validation.js";
import { createUser } from "../services/users.js";

const router = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      code: "TOO_MANY_ATTEMPTS",
      message: "登录尝试过于频繁，请 15 分钟后再试",
    },
  },
});

const loginSchema = z.object({
  username: z.string().trim().min(2).max(64),
  password: z.string().min(1).max(256),
  remember: z.boolean().optional().default(false),
});

router.post("/login", loginLimiter, validate(loginSchema), async (req, res) => {
  const result = await query(
    "SELECT id,username,password_hash,display_name,phone,role,status,profile FROM users WHERE username=$1",
    [req.body.username],
  );
  const user = result.rows[0];
  const valid =
    user && (await verifyPassword(req.body.password, user.password_hash));
  if (!valid)
    throw new HttpError(401, "用户名或密码错误", "INVALID_CREDENTIALS");
  if (user.status !== "active")
    throw new HttpError(403, "账号已停用，请联系管理员", "ACCOUNT_DISABLED");

  const token = createOpaqueToken("fq_");
  const ttlHours = req.body.remember
    ? Math.min(config.SESSION_TTL_HOURS * 30, 720)
    : config.SESSION_TTL_HOURS;
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);

  await transaction(async (client) => {
    await client.query("DELETE FROM sessions WHERE expires_at <= NOW()");
    await client.query(
      "INSERT INTO sessions(token_hash,user_id,ip,user_agent,expires_at) VALUES($1,$2,$3,$4,$5)",
      [
        hashToken(token),
        user.id,
        req.ip,
        req.get("user-agent") || null,
        expiresAt,
      ],
    );
    await client.query(
      "UPDATE users SET last_login_at=NOW(),updated_at=NOW() WHERE id=$1",
      [user.id],
    );
  });

  req.user = user;
  await writeAudit(req, {
    action: "auth.login",
    resourceType: "user",
    resourceId: user.id,
  });
  res.cookie(config.SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: "strict",
    path: "/",
    expires: expiresAt,
  });
  res.json({ success: true, data: { user: sanitizeUser(user) } });
});

router.post("/logout", requireAuth, async (req, res) => {
  const token = req.cookies?.[config.SESSION_COOKIE_NAME];
  if (token)
    await query("DELETE FROM sessions WHERE token_hash=$1", [hashToken(token)]);
  await writeAudit(req, {
    action: "auth.logout",
    resourceType: "user",
    resourceId: req.user.id,
  });
  res.clearCookie(config.SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: "strict",
    path: "/",
  });
  res.json({ success: true });
});

router.get("/me", requireAuth, async (req, res) => {
  const access =
    req.user.role === "admin"
      ? []
      : (
          await query(
            `SELECT mp.map_id, m.name AS map_name, mp.permissions
       FROM map_permissions mp JOIN maps m ON m.id=mp.map_id
      WHERE mp.user_id=$1 AND m.status='active' ORDER BY m.name`,
            [req.user.id],
          )
        ).rows;
  res.json({
    success: true,
    data: { user: sanitizeUser(req.user), mapAccess: access },
  });
});

router.post(
  "/register",
  validate(
    z.object({
      username: z.string().trim().min(2).max(64),
      password: z.string().min(12).max(256),
      displayName: z.string().trim().min(1).max(100),
      phone: z.string().trim().max(32).optional(),
    }),
  ),
  async (req, res) => {
    if (!config.publicRegistration)
      throw new HttpError(
        403,
        "当前未开放自主注册，请联系管理员创建账号",
        "REGISTRATION_DISABLED",
      );
    const user = await createUser({ ...req.body, role: "user" });
    res.status(201).json({ success: true, data: { user } });
  },
);

router.patch(
  "/profile",
  requireAuth,
  validate(
    z.object({
      displayName: z.string().trim().min(1).max(100),
      phone: z.string().trim().max(32).nullable().optional(),
      profile: z.record(z.string(), z.unknown()).optional().default({}),
    }),
  ),
  async (req, res) => {
    const result = await query(
      `UPDATE users SET display_name=$1,phone=$2,profile=$3::jsonb,updated_at=NOW()
      WHERE id=$4 RETURNING id,username,display_name,phone,role,status,profile,last_login_at,created_at`,
      [
        req.body.displayName,
        req.body.phone || null,
        JSON.stringify(req.body.profile),
        req.user.id,
      ],
    );
    await writeAudit(req, {
      action: "profile.update",
      resourceType: "user",
      resourceId: req.user.id,
    });
    res.json({ success: true, data: { user: result.rows[0] } });
  },
);

router.post(
  "/password",
  requireAuth,
  validate(
    z.object({
      currentPassword: z.string().min(1).max(256),
      newPassword: z.string().min(12).max(256),
    }),
  ),
  async (req, res) => {
    const current = await query("SELECT password_hash FROM users WHERE id=$1", [
      req.user.id,
    ]);
    if (
      !(await verifyPassword(
        req.body.currentPassword,
        current.rows[0].password_hash,
      ))
    ) {
      throw new HttpError(400, "当前密码不正确", "INVALID_CURRENT_PASSWORD");
    }
    if (req.body.currentPassword === req.body.newPassword)
      throw conflict("新密码不能与当前密码相同");
    const newHash = await hashPassword(req.body.newPassword);
    const currentToken = req.cookies?.[config.SESSION_COOKIE_NAME];
    await transaction(async (client) => {
      await client.query(
        "UPDATE users SET password_hash=$1,updated_at=NOW() WHERE id=$2",
        [newHash, req.user.id],
      );
      await client.query(
        "DELETE FROM sessions WHERE user_id=$1 AND token_hash<>$2",
        [req.user.id, currentToken ? hashToken(currentToken) : ""],
      );
    });
    await writeAudit(req, {
      action: "auth.password_changed",
      resourceType: "user",
      resourceId: req.user.id,
    });
    res.json({ success: true });
  },
);

function sanitizeUser(user) {
  return {
    id: Number(user.id),
    username: user.username,
    displayName: user.display_name,
    phone: user.phone,
    role: user.role,
    status: user.status,
    profile: user.profile || {},
    lastLoginAt: user.last_login_at || null,
  };
}

export default router;
