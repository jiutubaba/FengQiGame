import { z } from "zod";
import { query, transaction } from "../../db/index.js";
import { writeAudit } from "../../lib/audit.js";
import { HttpError, notFound } from "../../lib/errors.js";
import { PERMISSIONS, requireMapPermission } from "../../middleware/auth.js";
import { validate } from "../../middleware/validation.js";
import { idSchema, pagination } from "./shared.js";

const averageScoreSql =
  "(onboarding_score+visuals_score+gameplay_score+rewards_score+progression_score)::numeric/5";

const feedbackQuerySchema = z.object({
  q: z.string().trim().max(200).optional().default(""),
  starred: z.enum(["all", "starred", "unstarred"]).optional().default("all"),
  contact: z.enum(["all", "qq", "wechat", "both"]).optional().default("all"),
  score: z.enum(["all", "5", "4", "3", "low"]).optional().default("all"),
  sort: z
    .enum(["created_desc", "created_asc", "score_desc", "score_asc", "starred"])
    .optional()
    .default("created_desc"),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});

const batchSchema = z
  .object({
    responseIds: z
      .array(z.number().int().positive().safe())
      .min(1)
      .max(100)
      .refine((ids) => new Set(ids).size === ids.length, "反馈 ID 不能重复"),
    action: z.enum(["star", "unstar", "delete"]),
  })
  .strict();

const orderBySql = Object.freeze({
  created_desc: "created_at DESC,id DESC",
  created_asc: "created_at ASC,id ASC",
  score_desc: `${averageScoreSql} DESC,created_at DESC,id DESC`,
  score_asc: `${averageScoreSql} ASC,created_at DESC,id DESC`,
  starred: "is_starred DESC,created_at DESC,id DESC",
});

export function registerFeedbackRoutes(router) {
  router.get(
    "/:mapId/feedback",
    requireMapPermission(PERMISSIONS.FEEDBACK_VIEW),
    validateFeedbackQuery,
    async (req, res) => {
      const mapId = idSchema.parse(req.params.mapId);
      const filters = req.feedbackQuery;
      const { page, limit, offset } = pagination(filters);
      const { whereSql, params } = feedbackFilters(mapId, filters);
      const responseParams = [...params, limit, offset];
      const [mapResult, summaryResult, countResult, responsesResult] =
        await Promise.all([
          query("SELECT feedback_token FROM maps WHERE id=$1", [mapId]),
          query(
            `SELECT COUNT(*)::int AS response_count,
                  ROUND(AVG((onboarding_score+visuals_score+gameplay_score+rewards_score+progression_score)::numeric/5),2) AS average_score,
                  ROUND(AVG(onboarding_score),2) AS onboarding_score,
                  ROUND(AVG(visuals_score),2) AS visuals_score,
                  ROUND(AVG(gameplay_score),2) AS gameplay_score,
                  ROUND(AVG(rewards_score),2) AS rewards_score,
                  ROUND(AVG(progression_score),2) AS progression_score
             FROM feedback_responses
            WHERE map_id=$1`,
            [mapId],
          ),
          query(
            `SELECT COUNT(*)::int AS response_count
             FROM feedback_responses
            WHERE ${whereSql}`,
            params,
          ),
          query(
            `SELECT id,onboarding_score,visuals_score,gameplay_score,rewards_score,progression_score,
                  qq,wechat,optimization_suggestion,future_content,is_starred,created_at,
                  ROUND(${averageScoreSql},2) AS average_score
             FROM feedback_responses
            WHERE ${whereSql}
            ORDER BY ${orderBySql[filters.sort]}
            LIMIT $${responseParams.length - 1} OFFSET $${responseParams.length}`,
            responseParams,
          ),
        ]);
      if (!mapResult.rows[0]) throw notFound("项目不存在");
      const summary = summaryRow(summaryResult.rows[0]);
      res.json({
        success: true,
        data: {
          publicPath: `/feedback/${mapResult.rows[0].feedback_token}`,
          summary,
          responses: responsesResult.rows.map(responseRow),
          pagination: {
            page,
            limit,
            total: Number(countResult.rows[0].response_count),
          },
        },
      });
    },
  );

  router.post(
    "/:mapId/feedback/responses/batch",
    requireMapPermission(PERMISSIONS.FEEDBACK_MANAGE),
    validate(batchSchema),
    async (req, res) => {
      const mapId = idSchema.parse(req.params.mapId);
      const { action, responseIds } = req.body;
      const changedIds = await transaction(async (client) => {
        const current = await client.query(
          `SELECT id
             FROM feedback_responses
            WHERE map_id=$1 AND id=ANY($2::bigint[])
            FOR UPDATE`,
          [mapId, responseIds],
        );
        if (current.rowCount !== responseIds.length)
          throw notFound("反馈不存在或不属于当前项目");

        const result =
          action === "delete"
            ? await client.query(
                `DELETE FROM feedback_responses
                  WHERE map_id=$1 AND id=ANY($2::bigint[])
                  RETURNING id`,
                [mapId, responseIds],
              )
            : await client.query(
                `UPDATE feedback_responses
                    SET is_starred=$3
                  WHERE map_id=$1 AND id=ANY($2::bigint[])
                  RETURNING id`,
                [mapId, responseIds, action === "star"],
              );
        const ids = result.rows.map((row) => Number(row.id));
        await writeAudit(
          req,
          {
            action: `feedback.${action}`,
            resourceType: "feedback_response",
            resourceId: ids.length === 1 ? ids[0] : null,
            mapId,
            details: { responseIds: ids, count: ids.length },
          },
          client,
        );
        return ids;
      });
      res.json({
        success: true,
        data: { action, count: changedIds.length, responseIds: changedIds },
      });
    },
  );
}

function validateFeedbackQuery(req, _res, next) {
  const result = feedbackQuerySchema.safeParse(req.query);
  if (!result.success)
    return next(
      new HttpError(
        400,
        "查询条件不符合要求",
        "VALIDATION_ERROR",
        result.error.flatten(),
      ),
    );
  req.feedbackQuery = result.data;
  return next();
}

function feedbackFilters(mapId, filters) {
  const conditions = ["map_id=$1"];
  const params = [mapId];
  const addValue = (value) => {
    params.push(value);
    return `$${params.length}`;
  };

  if (filters.q) {
    const placeholder = addValue(`%${filters.q}%`);
    conditions.push(
      `(COALESCE(qq,'') ILIKE ${placeholder}
        OR COALESCE(wechat,'') ILIKE ${placeholder}
        OR optimization_suggestion ILIKE ${placeholder}
        OR future_content ILIKE ${placeholder})`,
    );
  }
  if (filters.starred !== "all")
    conditions.push(`is_starred=${addValue(filters.starred === "starred")}`);
  if (filters.contact === "qq")
    conditions.push("NULLIF(BTRIM(COALESCE(qq,'')),'') IS NOT NULL");
  if (filters.contact === "wechat")
    conditions.push("NULLIF(BTRIM(COALESCE(wechat,'')),'') IS NOT NULL");
  if (filters.contact === "both")
    conditions.push(
      "NULLIF(BTRIM(COALESCE(qq,'')),'') IS NOT NULL AND NULLIF(BTRIM(COALESCE(wechat,'')),'') IS NOT NULL",
    );
  if (filters.score === "5") conditions.push(`${averageScoreSql}=5`);
  if (filters.score === "4")
    conditions.push(`${averageScoreSql}>=4 AND ${averageScoreSql}<5`);
  if (filters.score === "3")
    conditions.push(`${averageScoreSql}>=3 AND ${averageScoreSql}<4`);
  if (filters.score === "low") conditions.push(`${averageScoreSql}<3`);

  return { whereSql: conditions.join(" AND "), params };
}

function summaryRow(row) {
  return {
    responseCount: Number(row.response_count || 0),
    averageScore: nullableNumber(row.average_score),
    dimensions: {
      onboarding: nullableNumber(row.onboarding_score),
      visuals: nullableNumber(row.visuals_score),
      gameplay: nullableNumber(row.gameplay_score),
      rewards: nullableNumber(row.rewards_score),
      progression: nullableNumber(row.progression_score),
    },
  };
}

function responseRow(row) {
  return {
    id: Number(row.id),
    averageScore: Number(row.average_score),
    ratings: {
      onboarding: Number(row.onboarding_score),
      visuals: Number(row.visuals_score),
      gameplay: Number(row.gameplay_score),
      rewards: Number(row.rewards_score),
      progression: Number(row.progression_score),
    },
    qq: row.qq || "",
    wechat: row.wechat || "",
    isStarred: Boolean(row.is_starred),
    optimizationSuggestion: row.optimization_suggestion || "",
    futureContent: row.future_content || "",
    createdAt: row.created_at,
  };
}

function nullableNumber(value) {
  return value === null || value === undefined ? null : Number(value);
}
