import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { absolutePath } from "./common.mjs";
import { renderFactFiles } from "./facts.mjs";

const checkOnly = process.argv.includes("--check");
const files = await renderFactFiles();
let changed = false;

for (const [repoPath, content] of files) {
  let current = null;
  try {
    current = await readFile(absolutePath(repoPath), "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (current === content) continue;
  changed = true;
  if (checkOnly) {
    console.error(`[STALE] ${repoPath}`);
    continue;
  }
  await mkdir(path.dirname(absolutePath(repoPath)), { recursive: true });
  await writeFile(absolutePath(repoPath), content, "utf8");
  console.log(`[WRITE] ${repoPath}`);
}

if (checkOnly && changed) {
  console.error("自动生成事实已漂移，请运行 npm run ai:docs:build。 ");
  process.exitCode = 1;
} else if (!changed) {
  console.log("自动生成事实已是最新状态。");
}
