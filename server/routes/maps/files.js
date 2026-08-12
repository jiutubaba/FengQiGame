import { createReadStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import multer from "multer";
import { z } from "zod";
import { config } from "../../config.js";
import { query, transaction } from "../../db/index.js";
import { writeAudit } from "../../lib/audit.js";
import { HttpError, notFound } from "../../lib/errors.js";
import { normalizeRelativePath, sanitizeFileName } from "../../lib/security.js";
import { PERMISSIONS, requireMapPermission } from "../../middleware/auth.js";
import { validate } from "../../middleware/validation.js";
import { idSchema } from "./shared.js";

const forbiddenUploadExtensions = new Set([
  ".bat",
  ".cmd",
  ".com",
  ".cpl",
  ".exe",
  ".hta",
  ".jar",
  ".js",
  ".jse",
  ".lnk",
  ".mjs",
  ".msi",
  ".ps1",
  ".psm1",
  ".reg",
  ".scr",
  ".sh",
  ".vbs",
  ".wsf",
]);
const inlineImageTypes = new Set([
  "image/avif",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export function registerFileRoutes(router) {
  const upload = multer({
    storage: multer.diskStorage({
      destination(req, _file, callback) {
        const dir = path.join(config.uploadDir, `map-${req.params.mapId}`);
        mkdir(dir, { recursive: true }).then(
          () => callback(null, dir),
          callback,
        );
      },
      filename(_req, file, callback) {
        const ext = path
          .extname(sanitizeFileName(file.originalname))
          .slice(0, 16);
        callback(null, `${randomUUID()}${ext}`);
      },
    }),
    limits: {
      fileSize: config.uploadMaxBytes,
      files: 20,
      fields: 10,
      parts: 30,
    },
    fileFilter(_req, file, callback) {
      const forbiddenTypes = [
        "application/x-msdownload",
        "application/x-sh",
        "application/x-bat",
        "application/x-powershell",
      ];
      const extension = path
        .extname(sanitizeFileName(file.originalname))
        .toLowerCase();
      const rejected =
        forbiddenTypes.includes(file.mimetype) ||
        forbiddenUploadExtensions.has(extension);
      callback(
        rejected
          ? new HttpError(400, "不允许上传可执行脚本文件", "FILE_TYPE_REJECTED")
          : null,
        !rejected,
      );
    },
  });

  router.get(
    "/:mapId/files",
    requireMapPermission(PERMISSIONS.FILES_MANAGE),
    async (req, res) => {
      const mapId = idSchema.parse(req.params.mapId);
      const folder = normalizeRelativePath(String(req.query.folder || ""));
      const prefix = folder ? `${folder}/` : "";
      const result = await query(
        `SELECT * FROM map_files WHERE map_id=$1 AND relative_path LIKE $2
        AND POSITION('/' IN SUBSTRING(relative_path FROM $3::integer))=0 ORDER BY kind DESC,original_name`,
        [mapId, `${prefix}%`, prefix.length + 1],
      );
      res.json({ success: true, data: result.rows.map(fileRow), folder });
    },
  );

  router.post(
    "/:mapId/files/upload",
    requireMapPermission(PERMISSIONS.FILES_MANAGE),
    upload.array("files", 20),
    async (req, res) => {
      const mapId = idSchema.parse(req.params.mapId);
      const folder = normalizeRelativePath(String(req.query.folder || ""));
      if (!req.files?.length)
        throw new HttpError(400, "请选择需要上传的文件", "FILE_REQUIRED");
      let inserted = [];
      try {
        const files = await Promise.all(
          (req.files || []).map(async (file) => ({
            ...file,
            originalName: sanitizeFileName(file.originalname),
            hash: await fileSha256(file.path),
          })),
        );
        inserted = await transaction(async (client) => {
          const rows = [];
          for (const file of files) {
            const relativePath = [folder, file.originalName]
              .filter(Boolean)
              .join("/");
            const result = await client.query(
              `INSERT INTO map_files(map_id,kind,original_name,storage_name,relative_path,mime_type,size_bytes,sha256,uploaded_by)
             VALUES($1,'file',$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
              [
                mapId,
                file.originalName,
                file.filename,
                relativePath,
                file.mimetype,
                file.size,
                file.hash,
                req.user.id,
              ],
            );
            rows.push(result.rows[0]);
          }
          return rows;
        });
      } catch (error) {
        await Promise.all(
          (req.files || []).map((file) => rm(file.path, { force: true })),
        );
        throw error;
      }
      await writeAudit(req, {
        action: "file.upload",
        resourceType: "map_file",
        mapId,
        details: {
          count: inserted.length,
          folder,
          names: inserted.map((item) => item.original_name),
        },
      });
      res.status(201).json({ success: true, data: inserted.map(fileRow) });
    },
  );

  router.post(
    "/:mapId/files/folder",
    requireMapPermission(PERMISSIONS.FILES_MANAGE),
    validate(
      z.object({
        name: z.string().trim().min(1).max(180),
        parent: z.string().max(900).optional().default(""),
      }),
    ),
    async (req, res) => {
      const mapId = idSchema.parse(req.params.mapId);
      const name = sanitizeFileName(req.body.name),
        parent = normalizeRelativePath(req.body.parent);
      const relativePath = [parent, name].filter(Boolean).join("/");
      const result = await query(
        "INSERT INTO map_files(map_id,kind,original_name,relative_path,uploaded_by) VALUES($1,'folder',$2,$3,$4) RETURNING *",
        [mapId, name, relativePath, req.user.id],
      );
      await writeAudit(req, {
        action: "folder.create",
        resourceType: "map_file",
        resourceId: result.rows[0].id,
        mapId,
        details: { relativePath },
      });
      res.status(201).json({ success: true, data: fileRow(result.rows[0]) });
    },
  );

  router.get(
    "/:mapId/files/:fileId/download",
    requireMapPermission(PERMISSIONS.FILES_MANAGE),
    async (req, res, next) => {
      const mapId = idSchema.parse(req.params.mapId),
        fileId = idSchema.parse(req.params.fileId);
      const result = await query(
        "SELECT * FROM map_files WHERE id=$1 AND map_id=$2 AND kind='file'",
        [fileId, mapId],
      );
      const file = result.rows[0];
      if (!file) throw notFound("文件不存在");
      const absolute = safeStoragePath(mapId, file.storage_name);
      if (
        req.query.inline === "1" &&
        inlineImageTypes.has(file.mime_type || "")
      ) {
        res.type(file.mime_type || "application/octet-stream");
      } else {
        res.attachment(file.original_name);
        res.type(file.mime_type || "application/octet-stream");
      }
      return createReadStream(absolute).on("error", next).pipe(res);
    },
  );

  router.delete(
    "/:mapId/files/:fileId",
    requireMapPermission(PERMISSIONS.FILES_MANAGE),
    async (req, res) => {
      const mapId = idSchema.parse(req.params.mapId),
        fileId = idSchema.parse(req.params.fileId);
      const target = await query(
        "SELECT * FROM map_files WHERE id=$1 AND map_id=$2",
        [fileId, mapId],
      );
      if (!target.rows[0]) throw notFound("文件或文件夹不存在");
      const row = target.rows[0];
      const affected = await query(
        "DELETE FROM map_files WHERE map_id=$1 AND (relative_path=$2 OR relative_path LIKE $3) RETURNING storage_name",
        [mapId, row.relative_path, `${row.relative_path}/%`],
      );
      await Promise.all(
        affected.rows
          .filter((item) => item.storage_name)
          .map((item) =>
            rm(safeStoragePath(mapId, item.storage_name), { force: true }),
          ),
      );
      await writeAudit(req, {
        action: "file.delete",
        resourceType: "map_file",
        resourceId: fileId,
        mapId,
        details: { relativePath: row.relative_path, count: affected.rowCount },
      });
      res.json({ success: true });
    },
  );
}

function fileRow(row) {
  return {
    id: Number(row.id),
    kind: row.kind,
    name: row.original_name,
    relativePath: row.relative_path,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    sha256: row.sha256,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
async function fileSha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(filePath)
      .on("error", reject)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => resolve(hash.digest("hex")));
  });
}
function safeStoragePath(mapId, storageName) {
  const base = path.resolve(config.uploadDir, `map-${mapId}`),
    target = path.resolve(base, storageName);
  if (!target.startsWith(`${base}${path.sep}`)) throw new Error("非法文件路径");
  return target;
}
