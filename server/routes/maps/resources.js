import { z } from "zod";
import { query } from "../../db/index.js";
import { writeAudit } from "../../lib/audit.js";
import { notFound } from "../../lib/errors.js";
import { PERMISSIONS, requireMapPermission } from "../../middleware/auth.js";
import { validate } from "../../middleware/validation.js";
import { idSchema, pagination } from "./shared.js";

export function registerResourceRoutes(router) {
  addSimpleResourceRoutes({
    router,
    pathName: "anchors",
    table: "anchors",
    permission: PERMISSIONS.ANCHORS_MANAGE,
    schema: z.object({
      name: z.string().trim().min(1).max(160),
      enabled: z.boolean().optional().default(true),
      giftConfig: z.record(z.string(), z.unknown()).optional().default({}),
    }),
    columns: { name: "name", enabled: "enabled", giftConfig: "gift_config" },
    rowMapper: anchorRow,
  });
  addSimpleResourceRoutes({
    router,
    pathName: "points",
    table: "tracking_points",
    permission: PERMISSIONS.POINTS_MANAGE,
    schema: z.object({
      pointKey: z.string().trim().min(1).max(128),
      name: z.string().trim().min(1).max(160),
      enabled: z.boolean().optional().default(true),
    }),
    columns: { pointKey: "point_key", name: "name", enabled: "enabled" },
    rowMapper: pointRow,
  });

  router.get(
    "/:mapId/logs",
    requireMapPermission(PERMISSIONS.LOGS_VIEW),
    async (req, res) => {
      const mapId = idSchema.parse(req.params.mapId),
        { page, limit, offset } = pagination(req.query);
      const result = await query(
        "SELECT * FROM map_logs WHERE map_id=$1 ORDER BY updated_at DESC LIMIT $2 OFFSET $3",
        [mapId, limit, offset],
      );
      const total = await query(
        "SELECT COUNT(*)::int AS count FROM map_logs WHERE map_id=$1",
        [mapId],
      );
      res.json({
        success: true,
        data: result.rows.map(logRow),
        pagination: { page, limit, total: total.rows[0].count },
      });
    },
  );
  router.delete(
    "/:mapId/logs/:logId",
    requireMapPermission(PERMISSIONS.MAP_EDIT),
    async (req, res) => {
      const mapId = idSchema.parse(req.params.mapId),
        logId = idSchema.parse(req.params.logId);
      const result = await query(
        "DELETE FROM map_logs WHERE id=$1 AND map_id=$2 RETURNING id",
        [logId, mapId],
      );
      if (!result.rows[0]) throw notFound("日志不存在");
      await writeAudit(req, {
        action: "log.delete",
        resourceType: "map_log",
        resourceId: logId,
        mapId,
      });
      res.json({ success: true });
    },
  );
}

function addSimpleResourceRoutes({
  router: target,
  pathName,
  table,
  permission,
  schema,
  columns,
  rowMapper,
}) {
  target.get(
    `/:mapId/${pathName}`,
    requireMapPermission(permission),
    async (req, res) => {
      const mapId = idSchema.parse(req.params.mapId);
      const result = await query(
        `SELECT * FROM ${table} WHERE map_id=$1 ORDER BY created_at DESC`,
        [mapId],
      );
      res.json({ success: true, data: result.rows.map(rowMapper) });
    },
  );
  target.post(
    `/:mapId/${pathName}`,
    requireMapPermission(permission),
    validate(schema),
    async (req, res) => {
      const mapId = idSchema.parse(req.params.mapId);
      const entries = Object.entries(columns);
      const values = entries.map(([apiKey]) =>
        apiKey === "giftConfig"
          ? JSON.stringify(req.body[apiKey])
          : req.body[apiKey],
      );
      const shiftedPlaceholders = values.map(
        (_, index) =>
          `$${index + 2}${entries[index][0] === "giftConfig" ? "::jsonb" : ""}`,
      );
      const result = await query(
        `INSERT INTO ${table}(map_id,${entries.map(([, db]) => db).join(",")}) VALUES($1,${shiftedPlaceholders.join(",")}) RETURNING *`,
        [mapId, ...values],
      );
      await writeAudit(req, {
        action: `${pathName}.create`,
        resourceType: table,
        resourceId: result.rows[0].id,
        mapId,
      });
      res.status(201).json({ success: true, data: rowMapper(result.rows[0]) });
    },
  );
  target.patch(
    `/:mapId/${pathName}/:resourceId`,
    requireMapPermission(permission),
    validate(schema.partial()),
    async (req, res) => {
      const mapId = idSchema.parse(req.params.mapId),
        resourceId = idSchema.parse(req.params.resourceId);
      const current = await query(
        `SELECT * FROM ${table} WHERE id=$1 AND map_id=$2`,
        [resourceId, mapId],
      );
      if (!current.rows[0]) throw notFound("记录不存在");
      const entries = Object.entries(columns);
      const values = entries.map(([apiKey, dbKey]) =>
        apiKey === "giftConfig"
          ? JSON.stringify(req.body[apiKey] ?? current.rows[0][dbKey])
          : (req.body[apiKey] ?? current.rows[0][dbKey]),
      );
      const assignments = entries.map(
        ([, dbKey], index) =>
          `${dbKey}=$${index + 1}${dbKey === "gift_config" ? "::jsonb" : ""}`,
      );
      const result = await query(
        `UPDATE ${table} SET ${assignments.join(",")},updated_at=NOW() WHERE id=$${values.length + 1} AND map_id=$${values.length + 2} RETURNING *`,
        [...values, resourceId, mapId],
      );
      await writeAudit(req, {
        action: `${pathName}.update`,
        resourceType: table,
        resourceId,
        mapId,
        details: { fields: Object.keys(req.body) },
      });
      res.json({ success: true, data: rowMapper(result.rows[0]) });
    },
  );
  target.delete(
    `/:mapId/${pathName}/:resourceId`,
    requireMapPermission(permission),
    async (req, res) => {
      const mapId = idSchema.parse(req.params.mapId),
        resourceId = idSchema.parse(req.params.resourceId);
      const result = await query(
        `DELETE FROM ${table} WHERE id=$1 AND map_id=$2 RETURNING id`,
        [resourceId, mapId],
      );
      if (!result.rows[0]) throw notFound("记录不存在");
      await writeAudit(req, {
        action: `${pathName}.delete`,
        resourceType: table,
        resourceId,
        mapId,
      });
      res.json({ success: true });
    },
  );
}

function anchorRow(row) {
  return {
    id: Number(row.id),
    name: row.name,
    enabled: row.enabled,
    giftConfig: row.gift_config || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
function pointRow(row) {
  return {
    id: Number(row.id),
    pointKey: row.point_key,
    name: row.name,
    enabled: row.enabled,
    triggerCount: Number(row.trigger_count),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
function logRow(row) {
  return {
    id: Number(row.id),
    context: row.context,
    playerCount: Number(row.player_count),
    uploadCount: Number(row.upload_count),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
