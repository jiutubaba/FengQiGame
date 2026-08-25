export const PRELOAD_CODE_LIMIT_BYTES = 256 * 1024;
export const PRELOAD_ENTRY_PATH = "main.lua";
export const PRELOAD_WORKSPACE_VERSION = 1;
export const PRELOAD_MAX_FILES = 200;
export const PRELOAD_MAX_FOLDERS = 200;
export const PRELOAD_MAX_PATH_LENGTH = 240;

const invalidPathCharacters = /[\u0000-\u001f\u007f<>:"|?*\\]/;

export function createPreloadWorkspace(preloadCode = "") {
  return {
    version: PRELOAD_WORKSPACE_VERSION,
    entry: PRELOAD_ENTRY_PATH,
    folders: [],
    files: [{ path: PRELOAD_ENTRY_PATH, content: String(preloadCode || "") }],
  };
}

export function normalizePreloadWorkspace(workspace) {
  return {
    version: PRELOAD_WORKSPACE_VERSION,
    entry: PRELOAD_ENTRY_PATH,
    folders: [...workspace.folders].sort(comparePaths),
    files: workspace.files
      .map((file) => ({ path: file.path, content: file.content }))
      .sort((left, right) => comparePaths(left.path, right.path)),
  };
}

export function preloadWorkspaceErrors(workspace) {
  if (!workspace || typeof workspace !== "object" || Array.isArray(workspace)) {
    return ["预加载代码工作区格式不正确"];
  }
  if (workspace.version !== PRELOAD_WORKSPACE_VERSION) {
    return ["预加载代码工作区版本不受支持"];
  }
  if (workspace.entry !== PRELOAD_ENTRY_PATH) {
    return [`预加载代码入口必须是 ${PRELOAD_ENTRY_PATH}`];
  }
  if (!Array.isArray(workspace.folders) || !Array.isArray(workspace.files)) {
    return ["预加载代码文件夹或文件列表格式不正确"];
  }
  if (workspace.folders.length > PRELOAD_MAX_FOLDERS) {
    return [`预加载代码文件夹不能超过 ${PRELOAD_MAX_FOLDERS} 个`];
  }
  if (workspace.files.length > PRELOAD_MAX_FILES) {
    return [`预加载代码文件不能超过 ${PRELOAD_MAX_FILES} 个`];
  }

  const errors = [];
  const folderKeys = new Set();
  const fileKeys = new Set();
  for (const folder of workspace.folders) {
    const pathError = validatePath(folder, "folder");
    if (pathError) errors.push(pathError);
    const key = String(folder).toLocaleLowerCase("en-US");
    if (folderKeys.has(key)) errors.push(`文件夹路径重复：${folder}`);
    folderKeys.add(key);
  }
  for (const file of workspace.files) {
    if (!file || typeof file !== "object" || Array.isArray(file)) {
      errors.push("预加载代码文件格式不正确");
      continue;
    }
    const pathError = validatePath(file.path, "file");
    if (pathError) errors.push(pathError);
    if (typeof file.content !== "string") {
      errors.push(`文件内容必须是文本：${String(file.path || "未知文件")}`);
    }
    const key = String(file.path).toLocaleLowerCase("en-US");
    if (fileKeys.has(key)) errors.push(`文件路径重复：${file.path}`);
    if (folderKeys.has(key)) errors.push(`文件与文件夹路径冲突：${file.path}`);
    fileKeys.add(key);
  }
  if (!fileKeys.has(PRELOAD_ENTRY_PATH)) {
    errors.push(`必须保留入口文件 ${PRELOAD_ENTRY_PATH}`);
  }

  for (const folder of workspace.folders) {
    const parent = parentPath(folder);
    if (parent && !folderKeys.has(parent.toLocaleLowerCase("en-US"))) {
      errors.push(`父文件夹不存在：${parent}`);
    }
    if (hasFileAncestor(folder, fileKeys)) {
      errors.push(`文件夹不能位于文件路径下：${folder}`);
    }
  }
  for (const file of workspace.files) {
    if (!file || typeof file.path !== "string") continue;
    const parent = parentPath(file.path);
    if (parent && !folderKeys.has(parent.toLocaleLowerCase("en-US"))) {
      errors.push(`父文件夹不存在：${parent}`);
    }
    if (hasFileAncestor(file.path, fileKeys)) {
      errors.push(`文件不能位于另一个文件路径下：${file.path}`);
    }
  }
  return [...new Set(errors)];
}

export function bundlePreloadWorkspace(workspace) {
  const normalized = normalizePreloadWorkspace(workspace);
  const errors = preloadWorkspaceErrors(normalized);
  if (errors.length) throw new Error(errors[0]);

  if (
    normalized.files.length === 1 &&
    normalized.files[0].path === PRELOAD_ENTRY_PATH
  ) {
    return normalized.files[0].content;
  }

  const output = [
    "local __fq_preload_modules = {}",
    "local __fq_preload_cache = {}",
    "local __fq_preload_loading = {}",
    "local __fq_preload_require",
  ];
  for (const file of normalized.files) {
    output.push(
      `__fq_preload_modules[${luaString(file.path)}] = function(...)`,
      "local require = __fq_preload_require",
      file.content,
      "end",
    );
  }
  output.push(
    "__fq_preload_require = function(path)",
    "local cached = __fq_preload_cache[path]",
    "if cached ~= nil then return cached end",
    "local loader = __fq_preload_modules[path]",
    'if not loader then error("预加载模块不存在: " .. tostring(path), 2) end',
    'if __fq_preload_loading[path] then error("预加载模块循环依赖: " .. tostring(path), 2) end',
    "__fq_preload_loading[path] = true",
    "local result = loader()",
    "__fq_preload_loading[path] = nil",
    "if result == nil then result = true end",
    "__fq_preload_cache[path] = result",
    "return result",
    "end",
    `return __fq_preload_require(${luaString(PRELOAD_ENTRY_PATH)})`,
  );
  return output.join("\n");
}

export function preloadWorkspaceBytes(workspace) {
  return new TextEncoder().encode(bundlePreloadWorkspace(workspace)).byteLength;
}

function validatePath(value, kind) {
  if (typeof value !== "string" || !value) {
    return kind === "file" ? "文件路径不能为空" : "文件夹路径不能为空";
  }
  if (value !== value.trim() || value.length > PRELOAD_MAX_PATH_LENGTH) {
    return `路径长度或首尾空格不符合要求：${value}`;
  }
  if (
    value.startsWith("/") ||
    value.endsWith("/") ||
    value.includes("//") ||
    invalidPathCharacters.test(value)
  ) {
    return `路径包含不允许的字符：${value}`;
  }
  const segments = value.split("/");
  if (
    segments.some(
      (segment) =>
        !segment ||
        segment === "." ||
        segment === ".." ||
        segment.length > 80 ||
        segment.endsWith(".") ||
        segment.endsWith(" "),
    )
  ) {
    return `路径层级不符合要求：${value}`;
  }
  if (kind === "file" && !value.toLocaleLowerCase("en-US").endsWith(".lua")) {
    return `预加载文件必须使用 .lua 扩展名：${value}`;
  }
  return "";
}

function parentPath(value) {
  const index = value.lastIndexOf("/");
  return index === -1 ? "" : value.slice(0, index);
}

function hasFileAncestor(value, fileKeys) {
  const segments = value.split("/");
  for (let index = 1; index < segments.length; index += 1) {
    if (
      fileKeys.has(
        segments.slice(0, index).join("/").toLocaleLowerCase("en-US"),
      )
    ) {
      return true;
    }
  }
  return false;
}

function comparePaths(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function luaString(value) {
  return JSON.stringify(value);
}
