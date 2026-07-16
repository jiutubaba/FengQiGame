import path from "node:path";
import { existsSync } from "node:fs";
import compression from "compression";
import cookieParser from "cookie-parser";
import express from "express";
import helmet from "helmet";
import pinoHttp from "pino-http";
import pino from "pino";
import { config } from "./config.js";
import { requestId } from "./lib/security.js";
import { loadSession } from "./middleware/auth.js";
import { errorHandler, notFoundHandler } from "./middleware/errors.js";
import authRouter from "./routes/auth.js";
import adminRouter from "./routes/admin.js";
import gameRouter from "./routes/game.js";
import mapsRouter from "./routes/maps.js";
import publicRouter from "./routes/public.js";
import systemRouter from "./routes/system.js";

export const LOG_REDACT_PATHS = [
  "req.headers.cookie",
  "req.headers.authorization",
  "req.headers.fq-map-key",
  'res.headers["set-cookie"]',
  "password",
  "*.password",
];
const logger = pino({
  level: config.LOG_LEVEL,
  redact: LOG_REDACT_PATHS,
});
export const app = express();

app.disable("x-powered-by");
app.set("trust proxy", config.TRUST_PROXY);
app.use(
  pinoHttp({
    logger,
    genReqId: (req, res) =>
      req.headers["x-request-id"] ||
      (res.setHeader("x-request-id", requestId()),
      res.getHeader("x-request-id")),
  }),
);
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "blob:"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: config.cookieSecure ? [] : null,
      },
    },
    crossOriginResourcePolicy: { policy: "same-site" },
    ...(config.cookieSecure ? {} : { strictTransportSecurity: false }),
  }),
);
app.use(compression());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false, limit: "256kb" }));
app.use(cookieParser());

app.use((req, _res, next) => {
  if (
    ["GET", "HEAD", "OPTIONS"].includes(req.method) ||
    req.path.startsWith("/api/fq/")
  )
    return next();
  const origin = req.get("origin");
  if (!origin) return next();
  const expected = `${req.protocol}://${req.get("host")}`;
  if (origin !== expected)
    return next(
      Object.assign(new Error("跨站请求已拒绝"), {
        status: 403,
        code: "CSRF_REJECTED",
      }),
    );
  return next();
});

app.use(loadSession);
app.use("/api/auth", authRouter);
app.use("/api/admin", adminRouter);
app.use("/api/fq", gameRouter);
app.use("/api/maps", mapsRouter);
app.use("/api/public", publicRouter);
app.use("/api/system", systemRouter);

if (existsSync(config.distDir)) {
  app.use(
    express.static(config.distDir, {
      index: false,
      maxAge: config.isProduction ? "1h" : 0,
    }),
  );
  app.get("*path", (req, res, next) => {
    if (req.path.startsWith("/api/") || req.path.startsWith("/uploads/"))
      return next();
    return res.sendFile(path.join(config.distDir, "index.html"));
  });
}

app.use(notFoundHandler);
app.use(errorHandler);
