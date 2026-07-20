import { access, readdir, rename, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { config } from "../config.js";

const pendingDirectoryPattern =
  /^\.deleting-map-(?<mapId>[1-9]\d*)-(?<nonce>[0-9a-f-]{36})$/i;

function mapDirectoryName(mapId) {
  return `map-${Number(mapId)}`;
}

function pendingDirectoryName(mapId) {
  return `.deleting-map-${Number(mapId)}-${randomUUID()}`;
}

function resolveInsideUploadRoot(uploadDir, directoryName) {
  const root = path.resolve(uploadDir);
  const target = path.resolve(root, directoryName);
  if (path.dirname(target) !== root) throw new Error("非法地图上传目录");
  return target;
}

async function pathExists(target) {
  try {
    await access(target);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

export async function stageMapUploadDirectory(
  mapId,
  uploadDir = config.uploadDir,
) {
  const source = resolveInsideUploadRoot(uploadDir, mapDirectoryName(mapId));
  const staged = resolveInsideUploadRoot(
    uploadDir,
    pendingDirectoryName(mapId),
  );
  try {
    await rename(source, staged);
    return { source, staged, existed: true };
  } catch (error) {
    if (error.code === "ENOENT")
      return { source, staged: null, existed: false };
    throw error;
  }
}

export async function restoreMapUploadDirectory(stagedUpload) {
  if (!stagedUpload?.staged) return;
  if (await pathExists(stagedUpload.source))
    throw new Error("地图上传目录已被重新创建，无法安全恢复");
  await rename(stagedUpload.staged, stagedUpload.source);
}

export async function removeDeletedMapUploadDirectories(
  mapId,
  stagedUpload,
  uploadDir = config.uploadDir,
) {
  const canonical = resolveInsideUploadRoot(uploadDir, mapDirectoryName(mapId));
  const pendingTargets = [stagedUpload?.staged].filter(Boolean);
  try {
    if (await pathExists(canonical)) {
      const lateUpload = resolveInsideUploadRoot(
        uploadDir,
        pendingDirectoryName(mapId),
      );
      await rename(canonical, lateUpload);
      pendingTargets.push(lateUpload);
    }
    await Promise.all(
      pendingTargets.map((target) =>
        rm(target, { recursive: true, force: true }),
      ),
    );
    await rm(canonical, { recursive: true, force: true });
  } catch (error) {
    if (await pathExists(canonical)) {
      try {
        await rename(
          canonical,
          resolveInsideUploadRoot(uploadDir, pendingDirectoryName(mapId)),
        );
      } catch {
        // 保留原始异常，由请求日志记录；无法改名的目录需要人工检查。
      }
    }
    throw error;
  }
  const remaining = [];
  for (const target of [...pendingTargets, canonical]) {
    if (await pathExists(target)) remaining.push(path.basename(target));
  }
  if (remaining.length)
    throw new Error(`地图上传目录仍然存在：${remaining.join(", ")}`);
  return {
    directoryExisted: Boolean(stagedUpload?.existed),
    directoriesRemoved: pendingTargets.map((target) => path.basename(target)),
  };
}

export async function cleanupPendingMapDeletionDirectories({
  uploadDir = config.uploadDir,
  shouldRemove,
  onRemoved,
  onSkipped,
  onError,
}) {
  const entries = await readdir(uploadDir, { withFileTypes: true });
  const results = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const match = pendingDirectoryPattern.exec(entry.name);
    if (!match) continue;
    const mapId = Number(match.groups.mapId);
    const target = resolveInsideUploadRoot(uploadDir, entry.name);
    try {
      if (!(await shouldRemove(mapId, entry.name))) {
        const result = { mapId, directory: entry.name, status: "skipped" };
        results.push(result);
        onSkipped?.(result);
        continue;
      }
      await rm(target, { recursive: true, force: true });
      const result = { mapId, directory: entry.name, status: "removed" };
      results.push(result);
      onRemoved?.(result);
    } catch (error) {
      const result = {
        mapId,
        directory: entry.name,
        status: "failed",
        error,
      };
      results.push(result);
      onError?.(result);
    }
  }
  return results;
}
