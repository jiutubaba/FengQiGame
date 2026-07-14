import pg from "pg";

const { Client } = pg;
const adminUrl = process.env.PG_ADMIN_DATABASE_URL;
const database = process.env.POSTGRES_DB || "fengqi";
const username = process.env.POSTGRES_USER || "fengqi";
const password = process.env.POSTGRES_PASSWORD;

if (!adminUrl || !password) {
  throw new Error("缺少 PG_ADMIN_DATABASE_URL 或 POSTGRES_PASSWORD");
}
if (!/^[a-z][a-z0-9_]{1,62}$/.test(database)) {
  throw new Error("数据库名格式不安全");
}
if (!/^[a-z][a-z0-9_]{1,62}$/.test(username)) {
  throw new Error("数据库用户名格式不安全");
}

const admin = new Client({ connectionString: adminUrl });
await admin.connect();
try {
  const roleExists = await admin.query(
    "SELECT 1 FROM pg_roles WHERE rolname=$1",
    [username],
  );
  const databaseResult = await admin.query(
    `SELECT r.rolname AS owner
       FROM pg_database d JOIN pg_roles r ON r.oid=d.datdba
      WHERE d.datname=$1`,
    [database],
  );
  const databaseOwner = databaseResult.rows[0]?.owner;
  if (databaseOwner && databaseOwner !== username) {
    throw new Error(
      `数据库 ${database} 已存在且属于其他角色 ${databaseOwner}，已拒绝覆盖`,
    );
  }
  if (roleExists.rowCount && !databaseOwner) {
    throw new Error(
      `角色 ${username} 已存在但数据库 ${database} 不存在，已拒绝覆盖`,
    );
  }
  if (!roleExists.rowCount && databaseOwner) {
    throw new Error(
      `数据库 ${database} 已存在但角色 ${username} 不存在，已拒绝覆盖`,
    );
  }
  const roleCommand = roleExists.rowCount
    ? "ALTER ROLE %I WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD %L"
    : "CREATE ROLE %I WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD %L";
  const formattedRole = await admin.query(
    "SELECT format($1::text, $2::text, $3::text) AS command",
    [roleCommand, username, password],
  );
  await admin.query(formattedRole.rows[0].command);

  if (!databaseOwner) {
    const createDatabase = await admin.query(
      "SELECT format('CREATE DATABASE %I OWNER %I ENCODING %L', $1::text, $2::text, 'UTF8'::text) AS command",
      [database, username],
    );
    await admin.query(createDatabase.rows[0].command);
  }
} finally {
  await admin.end();
}

process.stdout.write(`本机数据库已就绪：${database}（角色 ${username}）\n`);
