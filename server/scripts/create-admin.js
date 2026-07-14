import "dotenv/config";
import { closeDatabase, query } from "../db/index.js";
import { migrate } from "../db/migrate.js";
import { hashPassword } from "../lib/security.js";

const args = Object.fromEntries(
  process.argv.slice(2).map((item) => {
    const [key, ...rest] = item.replace(/^--/, "").split("=");
    return [key, rest.join("=")];
  }),
);
const username = args.username || process.env.ADMIN_USERNAME;
const password = args.password || process.env.ADMIN_PASSWORD;
const displayName = args.name || process.env.ADMIN_DISPLAY_NAME || "系统管理员";

if (!username || !password || password.length < 12) {
  process.stderr.write(
    "用法：npm run admin:create -- --username=admin --password=至少12位强密码 --name=系统管理员\n",
  );
  process.exit(1);
}

await migrate();
const passwordHash = await hashPassword(password);
const result = await query(
  `INSERT INTO users(username,password_hash,display_name,role,status)
   VALUES($1,$2,$3,'admin','active')
   ON CONFLICT(username) DO UPDATE SET password_hash=EXCLUDED.password_hash,display_name=EXCLUDED.display_name,role='admin',status='active',updated_at=NOW()
   RETURNING id,username,display_name`,
  [username, passwordHash, displayName],
);
await closeDatabase();
process.stdout.write(`管理员已创建或更新：${result.rows[0].username}\n`);
