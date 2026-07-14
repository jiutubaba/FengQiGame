import { Router } from "express";
import { query } from "../db/index.js";
import { requireAdmin, requireAuth } from "../middleware/auth.js";

const router = Router();

router.get("/health", async (_req, res) => {
  await query("SELECT 1");
  res.json({
    success: true,
    data: { status: "ok", time: new Date().toISOString() },
  });
});

router.get("/status", requireAuth, requireAdmin, async (_req, res) => {
  const [users, maps, sessions, audit] = await Promise.all([
    query("SELECT COUNT(*)::int AS count FROM users"),
    query("SELECT COUNT(*)::int AS count FROM maps"),
    query("SELECT COUNT(*)::int AS count FROM sessions WHERE expires_at>NOW()"),
    query(
      "SELECT COUNT(*)::int AS count FROM audit_logs WHERE created_at>NOW()-INTERVAL '24 hours'",
    ),
  ]);
  res.json({
    success: true,
    data: {
      users: users.rows[0].count,
      maps: maps.rows[0].count,
      activeSessions: sessions.rows[0].count,
      auditEvents24h: audit.rows[0].count,
    },
  });
});

router.get("/audit", requireAuth, requireAdmin, async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 30));
  const result = await query(
    `SELECT a.id,a.action,a.resource_type,a.resource_id,a.map_id,a.ip,a.details,a.created_at,
            u.username,u.display_name
       FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_user_id
      ORDER BY a.created_at DESC LIMIT $1 OFFSET $2`,
    [limit, (page - 1) * limit],
  );
  const total = await query("SELECT COUNT(*)::int AS count FROM audit_logs");
  res.json({
    success: true,
    data: result.rows,
    pagination: { page, limit, total: total.rows[0].count },
  });
});

export default router;
