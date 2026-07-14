export class ApiError extends Error {
  constructor(message, status, code, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  const body = options.body;
  if (
    body !== undefined &&
    !(body instanceof FormData) &&
    !headers.has("content-type")
  ) {
    headers.set("content-type", "application/json");
  }
  const response = await fetch(path, {
    credentials: "same-origin",
    ...options,
    headers,
    body:
      body === undefined || body instanceof FormData || typeof body === "string"
        ? body
        : JSON.stringify(body),
  });
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json")
    ? await response.json()
    : null;
  if (!response.ok) {
    if (response.status === 401)
      window.dispatchEvent(new CustomEvent("fq:unauthenticated"));
    throw new ApiError(
      payload?.error?.message || `请求失败（${response.status}）`,
      response.status,
      payload?.error?.code,
      payload?.error?.details,
    );
  }
  return payload?.data;
}

export function withEnvironment(path, environment) {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}environment=${encodeURIComponent(environment)}`;
}

export async function download(path, fileName) {
  const response = await fetch(path, { credentials: "same-origin" });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new ApiError(
      payload?.error?.message || "下载失败",
      response.status,
      payload?.error?.code,
    );
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}
