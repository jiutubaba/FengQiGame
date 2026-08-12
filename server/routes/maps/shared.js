import { z } from "zod";

export const idSchema = z.coerce.number().int().positive();

export function pagination(input) {
  const page = Math.max(1, Number(input.page) || 1),
    limit = Math.min(100, Math.max(1, Number(input.limit) || 20));
  return { page, limit, offset: (page - 1) * limit };
}
