import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

export function toRepoPath(value) {
  return value.replaceAll("\\", "/").replace(/^\.\//, "");
}

export function absolutePath(repoPath) {
  return path.join(rootDir, ...toRepoPath(repoPath).split("/"));
}

export async function readUtf8(repoPath) {
  return readFile(absolutePath(repoPath), "utf8");
}

export async function pathExists(repoPath) {
  try {
    await stat(absolutePath(repoPath));
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

export async function walkFiles(repoPath, options = {}) {
  const excluded = new Set(options.exclude || []);
  const files = [];

  async function visit(currentRepoPath) {
    const entries = await readdir(absolutePath(currentRepoPath), {
      withFileTypes: true,
    });
    for (const entry of entries) {
      const child = toRepoPath(path.posix.join(currentRepoPath, entry.name));
      if (excluded.has(entry.name) || excluded.has(child)) continue;
      if (entry.isDirectory()) await visit(child);
      else if (!options.filter || options.filter(child)) files.push(child);
    }
  }

  await visit(toRepoPath(repoPath));
  return files.sort((a, b) => a.localeCompare(b, "zh-CN"));
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function lineCount(value) {
  return value === "" ? 0 : value.split(/\r?\n/).length;
}

export function stableUnique(values) {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b, "en"));
}
