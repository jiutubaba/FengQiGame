import {
  access,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  cleanupPendingMapDeletionDirectories,
  removeDeletedMapUploadDirectories,
  restoreMapUploadDirectory,
  stageMapUploadDirectory,
} from "../../services/map-deletion.js";

const scratchDirectories = [];

async function createScratch() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "fengqi-map-delete-"));
  scratchDirectories.push(directory);
  return directory;
}

async function exists(target) {
  try {
    await access(target);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

afterEach(async () => {
  await Promise.all(
    scratchDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("地图上传目录永久删除", () => {
  it("数据库流程失败时可以恢复暂存目录", async () => {
    const uploadDir = await createScratch();
    const mapDir = path.join(uploadDir, "map-12");
    await mkdir(mapDir);
    await writeFile(path.join(mapDir, "archive.dat"), "test");

    const staged = await stageMapUploadDirectory(12, uploadDir);
    expect(staged.existed).toBe(true);
    expect(await exists(mapDir)).toBe(false);
    expect(await exists(staged.staged)).toBe(true);

    await restoreMapUploadDirectory(staged);
    expect(await exists(mapDir)).toBe(true);
    expect(await exists(staged.staged)).toBe(false);
  });

  it("成功删除时同时清理暂存目录和并发重建的原目录", async () => {
    const uploadDir = await createScratch();
    const mapDir = path.join(uploadDir, "map-18");
    await mkdir(mapDir);
    const staged = await stageMapUploadDirectory(18, uploadDir);
    await mkdir(mapDir);
    await writeFile(path.join(mapDir, "late-upload.dat"), "test");

    const result = await removeDeletedMapUploadDirectories(
      18,
      staged,
      uploadDir,
    );
    expect(result.directoryExisted).toBe(true);
    expect(await exists(mapDir)).toBe(false);
    expect(await exists(staged.staged)).toBe(false);
  });

  it("启动清理仅删除地图已不存在的受控残留目录", async () => {
    const uploadDir = await createScratch();
    const removable = ".deleting-map-21-12345678-1234-1234-1234-123456789abc";
    const retained = ".deleting-map-22-12345678-1234-1234-1234-123456789abc";
    await mkdir(path.join(uploadDir, removable));
    await mkdir(path.join(uploadDir, retained));
    await mkdir(path.join(uploadDir, ".deleting-map-invalid"));
    await writeFile(
      path.join(uploadDir, ".deleting-map-23-not-a-directory"),
      "",
    );

    const results = await cleanupPendingMapDeletionDirectories({
      uploadDir,
      shouldRemove: async (mapId) => mapId === 21,
    });

    expect(results.map(({ mapId, status }) => [mapId, status])).toEqual([
      [21, "removed"],
      [22, "skipped"],
    ]);
    expect(await exists(path.join(uploadDir, removable))).toBe(false);
    expect(await exists(path.join(uploadDir, retained))).toBe(true);
    expect(await readdir(uploadDir)).toContain(".deleting-map-invalid");
  });
});
