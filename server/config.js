import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
  DATABASE_URL: z
    .string()
    .min(1)
    .default("postgres://fengqi:fengqi_dev@127.0.0.1:5432/fengqi"),
  SESSION_COOKIE_NAME: z
    .string()
    .regex(/^[A-Za-z0-9_-]+$/)
    .default("fq_session"),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(12),
  COOKIE_SECURE: z.enum(["true", "false"]).optional(),
  ADMIN_USERNAME: z.string().min(2).max(64).optional(),
  ADMIN_PASSWORD: z.string().min(12).max(256).optional(),
  ADMIN_DISPLAY_NAME: z.string().min(1).max(100).default("系统管理员"),
  PUBLIC_REGISTRATION: z.enum(["true", "false"]).default("false"),
  UPLOAD_MAX_MB: z.coerce.number().int().min(1).max(500).default(50),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  throw new Error(
    `环境变量配置错误：${parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`,
  );
}

export const config = Object.freeze({
  ...parsed.data,
  rootDir,
  distDir: path.join(rootDir, "dist"),
  uploadDir: path.join(
    rootDir,
    parsed.data.NODE_ENV === "test" ? ".test-artifacts/uploads" : "uploads",
  ),
  migrationDir: path.join(rootDir, "server", "db", "migrations"),
  isProduction: parsed.data.NODE_ENV === "production",
  cookieSecure: parsed.data.COOKIE_SECURE
    ? parsed.data.COOKIE_SECURE === "true"
    : parsed.data.NODE_ENV === "production",
  publicRegistration: parsed.data.PUBLIC_REGISTRATION === "true",
  uploadMaxBytes: parsed.data.UPLOAD_MAX_MB * 1024 * 1024,
});
