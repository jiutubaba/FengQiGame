import multer from "multer";
import { HttpError } from "../lib/errors.js";

export function notFoundHandler(req, _res, next) {
  next(
    new HttpError(
      404,
      `接口不存在：${req.method} ${req.path}`,
      "API_NOT_FOUND",
    ),
  );
}

export function errorHandler(error, req, res, _next) {
  let status = error.status || 500;
  let code = error.code || "INTERNAL_ERROR";
  let message = error.message || "服务器内部错误";
  let details = error.details;

  if (error.type === "entity.parse.failed") {
    status = 400;
    code = "INVALID_JSON";
    message = "请求数据不是有效的 JSON";
    details = undefined;
  } else if (error instanceof multer.MulterError) {
    status = 400;
    code = error.code;
    message =
      error.code === "LIMIT_FILE_SIZE"
        ? "上传文件超过大小限制"
        : "文件上传失败";
  } else if (error.code === "23505") {
    status = 409;
    code = "DUPLICATE_RESOURCE";
    message = "记录已存在，请勿重复提交";
  } else if (error.code === "23503") {
    status = 409;
    code = "RESOURCE_IN_USE";
    message = "该记录仍被其它数据引用，暂时无法删除";
  }

  if (status >= 500) {
    req.log?.error({ err: error }, "request failed");
    if (!(error instanceof HttpError)) {
      code = "INTERNAL_ERROR";
      message = "服务器内部错误";
      details = undefined;
    }
  }
  res.status(status).json({
    success: false,
    error: { code, message, ...(details ? { details } : {}) },
    requestId: req.id,
  });
}
