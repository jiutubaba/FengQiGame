import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { HttpError } from "../../lib/errors.js";
import { errorHandler } from "../../middleware/errors.js";
import { validate } from "../../middleware/validation.js";

describe("请求校验", () => {
  it("PATCH 只保留客户端实际提交的字段，不注入 schema 默认值", () => {
    const schema = z
      .object({
        name: z.string().optional(),
        enabled: z.boolean().optional().default(true),
        count: z.number().optional().default(0),
      })
      .partial();
    const req = { method: "PATCH", body: { name: "只修改名称" } };
    const next = vi.fn();
    validate(schema)(req, {}, next);
    expect(req.body).toEqual({ name: "只修改名称" });
    expect(next).toHaveBeenCalledWith();
  });

  it("POST 会保留 schema 默认值", () => {
    const schema = z.object({
      name: z.string(),
      enabled: z.boolean().default(true),
    });
    const req = { method: "POST", body: { name: "新记录" } };
    const next = vi.fn();
    validate(schema)(req, {}, next);
    expect(req.body).toEqual({ name: "新记录", enabled: true });
  });
});

describe("错误响应", () => {
  function createResponse() {
    return {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
  }

  it("内部异常不向客户端泄露原始错误", () => {
    const req = { id: "request-1", log: { error: vi.fn() } };
    const res = createResponse();
    errorHandler(new Error("数据库连接口令不应泄露"), req, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: { code: "INTERNAL_ERROR", message: "服务器内部错误" },
      requestId: "request-1",
    });
    expect(req.log.error).toHaveBeenCalledOnce();
  });

  it("非法 JSON 返回稳定的 400 错误码", () => {
    const error = Object.assign(new SyntaxError("Unexpected token"), {
      status: 400,
      type: "entity.parse.failed",
    });
    const res = createResponse();
    errorHandler(error, { id: "request-2", log: { error: vi.fn() } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: { code: "INVALID_JSON", message: "请求数据不是有效的 JSON" },
      requestId: "request-2",
    });
  });

  it("显式服务端错误保留约定的错误码并记录日志", () => {
    const req = { id: "request-3", log: { error: vi.fn() } };
    const res = createResponse();
    errorHandler(
      new HttpError(500, "地图文件清理失败", "MAP_DELETE_FILE_CLEANUP_FAILED"),
      req,
      res,
    );
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: {
        code: "MAP_DELETE_FILE_CLEANUP_FAILED",
        message: "地图文件清理失败",
      },
      requestId: "request-3",
    });
    expect(req.log.error).toHaveBeenCalledOnce();
  });
});
