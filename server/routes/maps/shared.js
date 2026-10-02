import { z } from "zod";
import { HttpError } from "../../lib/errors.js";

export const idSchema = z.coerce.number().int().positive();

export function pagination(input, defaultLimit = 20) {
  const page = Math.max(
      1,
      z.coerce
        .number()
        .int()
        .parse(input.page ?? 1),
    ),
    limit = Math.min(
      100,
      Math.max(
        1,
        z.coerce
          .number()
          .int()
          .parse(input.limit ?? defaultLimit),
      ),
    );
  const offset = (page - 1) * limit;
  if (!Number.isSafeInteger(offset))
    throw new HttpError(400, "分页范围超出限制", "VALIDATION_ERROR");
  return { page, limit, offset };
}
