import pg from "pg";
import { config } from "../config.js";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: config.DATABASE_URL,
  max: config.NODE_ENV === "test" ? 4 : 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 8_000,
  application_name: "fengqi-game-admin",
});

pool.on("error", (error) => {
  process.stderr.write(
    `${JSON.stringify({ level: "error", event: "postgres_pool_error", message: error.message })}\n`,
  );
});

export function query(text, params) {
  return pool.query(text, params);
}

export async function transaction(callback) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function closeDatabase() {
  await pool.end();
}
