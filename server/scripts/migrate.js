import "dotenv/config";
import { closeDatabase } from "../db/index.js";
import { migrate } from "../db/migrate.js";

await migrate();
await closeDatabase();
process.stdout.write("数据库迁移完成。\n");
