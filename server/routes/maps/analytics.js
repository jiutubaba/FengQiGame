import { z } from "zod";
import { ANALYTICS_KEYS } from "../../../shared/analytics.js";
import { transaction } from "../../db/index.js";
import { writeAudit } from "../../lib/audit.js";
import { HttpError, notFound } from "../../lib/errors.js";
import {
  PERMISSIONS,
  requireAdmin,
  requireMapPermission,
} from "../../middleware/auth.js";
import { validate } from "../../middleware/validation.js";
import {
  analyticsQuerySchema,
  getAnalytics,
} from "../../services/analytics.js";

export function registerAnalyticsRoutes(router) {
  router.put(
    "/:mapId/analytics-features",
    requireMapPermission(PERMISSIONS.MAP_VIEW),
    requireAdmin,
    validate(
      z
        .object({
          features: z
            .array(z.enum(ANALYTICS_KEYS))
            .max(ANALYTICS_KEYS.length)
            .refine((items) => new Set(items).size === items.length),
          revision: z.number().int().min(0),
        })
        .strict(),
    ),
    async (req, res) => {
      const mapId = Number(req.params.mapId);
      const data = await transaction(async (client) => {
        const current = await client.query(
          "SELECT analytics_revision,analytics_features FROM maps WHERE id=$1 FOR UPDATE",
          [mapId],
        );
        if (!current.rows[0]) throw notFound("地图不存在");
        if (current.rows[0].analytics_revision !== req.body.revision)
          throw new HttpError(
            409,
            "功能配置已被更新，请重新读取后保存",
            "FEATURES_CONFLICT",
          );
        const result = await client.query(
          "UPDATE maps SET analytics_features=$2,analytics_revision=analytics_revision+1 WHERE id=$1 RETURNING analytics_features,analytics_revision",
          [mapId, req.body.features],
        );
        await writeAudit(
          req,
          {
            action: "map.analytics.configure",
            resourceType: "map",
            resourceId: mapId,
            mapId,
            details: {
              before: current.rows[0].analytics_features,
              after: req.body.features,
            },
          },
          client,
        );
        return {
          features: result.rows[0].analytics_features,
          revision: result.rows[0].analytics_revision,
        };
      });
      res.json({ success: true, data });
    },
  );
  router.get(
    "/:mapId/analytics/:feature",
    requireMapPermission(PERMISSIONS.METRICS_VIEW),
    async (req, res) => {
      const parsedFeature = z
        .enum(ANALYTICS_KEYS)
        .safeParse(req.params.feature);
      const parsedFilters = analyticsQuerySchema.safeParse(req.query);
      if (!parsedFeature.success || !parsedFilters.success)
        throw new HttpError(
          400,
          "分析类型或查询条件无效，请使用有效日期",
          "INVALID_ANALYTICS_QUERY",
        );
      const feature = parsedFeature.data;
      const filters = parsedFilters.data;
      res.json({
        success: true,
        data: await getAnalytics(Number(req.params.mapId), feature, filters),
      });
    },
  );
}
