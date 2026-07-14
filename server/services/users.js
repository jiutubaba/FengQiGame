import { query } from "../db/index.js";
import { conflict } from "../lib/errors.js";
import { hashPassword } from "../lib/security.js";

export async function ensureInitialAdmin(config) {
  const existing = await query("SELECT COUNT(*)::int AS count FROM users");
  if (existing.rows[0].count > 0) return;
  if (!config.ADMIN_USERNAME || !config.ADMIN_PASSWORD) {
    throw new Error(
      "数据库中没有管理员。请在 .env 配置 ADMIN_USERNAME 和长度至少 12 位的 ADMIN_PASSWORD 后重新启动。",
    );
  }
  const passwordHash = await hashPassword(config.ADMIN_PASSWORD);
  await query(
    `INSERT INTO users(username,password_hash,display_name,role,status)
     VALUES($1,$2,$3,'admin','active')`,
    [config.ADMIN_USERNAME, passwordHash, config.ADMIN_DISPLAY_NAME],
  );
}

export async function createUser({
  username,
  password,
  displayName,
  phone = null,
  role = "user",
}) {
  const existing = await query("SELECT 1 FROM users WHERE username=$1", [
    username,
  ]);
  if (existing.rowCount) throw conflict("用户名已存在");
  const passwordHash = await hashPassword(password);
  const result = await query(
    `INSERT INTO users(username,password_hash,display_name,phone,role,status)
     VALUES($1,$2,$3,$4,$5,'active')
     RETURNING id,username,display_name,phone,role,status,created_at`,
    [username, passwordHash, displayName, phone, role],
  );
  return result.rows[0];
}
