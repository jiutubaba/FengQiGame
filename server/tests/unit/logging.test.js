import pino from "pino";
import { describe, expect, it } from "vitest";
import { LOG_REDACT_PATHS } from "../../app.js";

describe("日志脱敏", () => {
  it("请求凭据和响应 Set-Cookie 不写入日志", () => {
    const rows = [];
    const logger = pino(
      { redact: LOG_REDACT_PATHS },
      { write: (line) => rows.push(JSON.parse(line)) },
    );

    logger.info({
      req: {
        headers: {
          cookie: "fq_session=request-secret",
          authorization: "Bearer request-secret",
          "fq-map-key": "map-secret",
        },
      },
      res: {
        headers: {
          "set-cookie": "fq_session=response-secret; HttpOnly",
          "content-type": "application/json",
        },
      },
      password: "password-secret",
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].req.headers.cookie).toBe("[Redacted]");
    expect(rows[0].req.headers.authorization).toBe("[Redacted]");
    expect(rows[0].req.headers["fq-map-key"]).toBe("[Redacted]");
    expect(rows[0].res.headers["set-cookie"]).toBe("[Redacted]");
    expect(rows[0].res.headers["content-type"]).toBe("application/json");
    expect(rows[0].password).toBe("[Redacted]");
  });
});
