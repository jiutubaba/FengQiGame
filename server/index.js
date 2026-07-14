import "dotenv/config";
import { mkdir } from "node:fs/promises";
import { app } from "./app.js";
import { config } from "./config.js";
import { closeDatabase, query } from "./db/index.js";
import { migrate } from "./db/migrate.js";
import { ensureInitialAdmin } from "./services/users.js";

await mkdir(config.uploadDir, { recursive: true });
await migrate();
await ensureInitialAdmin(config);
await query("DELETE FROM sessions WHERE expires_at<=NOW()");

const server = app.listen(config.PORT, "0.0.0.0", () => {
  process.stdout.write(
    `${JSON.stringify({ level: "info", event: "server_started", port: config.PORT, env: config.NODE_ENV })}\n`,
  );
});

async function shutdown(signal) {
  process.stdout.write(
    `${JSON.stringify({ level: "info", event: "server_stopping", signal })}\n`,
  );
  server.close(async () => {
    await closeDatabase();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
