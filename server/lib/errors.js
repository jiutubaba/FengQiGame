export class HttpError extends Error {
  constructor(status, message, code = "REQUEST_FAILED", details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function notFound(message = "请求的资源不存在") {
  return new HttpError(404, message, "NOT_FOUND");
}

export function forbidden(message = "没有执行此操作的权限") {
  return new HttpError(403, message, "FORBIDDEN");
}

export function conflict(message) {
  return new HttpError(409, message, "CONFLICT");
}
