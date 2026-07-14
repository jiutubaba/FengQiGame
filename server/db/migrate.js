import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import { query, transaction } from "./index.js";

export async function migrate() {
  await query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const files = (await readdir(config.migrationDir))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  const appliedRows = await query("SELECT name FROM schema_migrations");
  const applied = new Set(appliedRows.rows.map((row) => row.name));

  for (const name of files) {
    if (applied.has(name)) continue;
    const sql = await readFile(path.join(config.migrationDir, name), "utf8");
    await transaction(async (client) => {
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations(name) VALUES($1)", [
        name,
      ]);
    });
  }
}
