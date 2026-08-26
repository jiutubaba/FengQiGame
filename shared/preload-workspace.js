import luaparse from "luaparse";

export const PRELOAD_CODE_LIMIT_BYTES = 256 * 1024;
export const PRELOAD_ENTRY_PATH = "main.lua";
export const PRELOAD_WORKSPACE_VERSION = 1;
export const PRELOAD_MAX_FILES = 200;
export const PRELOAD_MAX_FOLDERS = 200;
export const PRELOAD_MAX_PATH_LENGTH = 240;

const invalidPathCharacters = /[\u0000-\u001f\u007f<>:"|?*\\]/;

export class PreloadBuildError extends Error {
  constructor(message) {
    super(message);
    this.name = "PreloadBuildError";
  }
}

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

export function preloadWorkspaceDiagnostics(workspace) {
  return preloadWorkspaceAnalysis(workspace).diagnostics;
}

export function preloadWorkspaceAnalysis(workspace) {
  const files = Array.isArray(workspace?.files)
    ? workspace.files.filter(
        (file) =>
          file &&
          typeof file.path === "string" &&
          typeof file.content === "string",
      )
    : [];
  const analysis = analyzePreloadWorkspaceReferences(files);
  return {
    diagnostics: analysis.diagnostics,
    activePaths: [...analysis.activePaths].sort(comparePaths),
    inactivePaths: files
      .map((file) => file.path)
      .filter((path) => !analysis.activePaths.has(path))
      .sort(comparePaths),
  };
}

function analyzePreloadWorkspaceReferences(files) {
  const filePaths = new Set(files.map((file) => file.path));
  const filesByPath = new Map(files.map((file) => [file.path, file]));
  const filePathsByLowerCase = new Map(
    files.map((file) => [file.path.toLocaleLowerCase("en-US"), file.path]),
  );
  const dependencyGraph = new Map(files.map((file) => [file.path, []]));
  const diagnostics = [];
  const references = [];
  const analyzedPaths = new Set();
  const dynamicRequirePaths = new Set();
  const dynamicRequires = [];

  const analyzeFile = (path) => {
    if (analyzedPaths.has(path)) return;
    const file = filesByPath.get(path);
    if (!file) return;
    analyzedPaths.add(path);

    let ast;
    try {
      ast = luaparse.parse(luaParserSource(file.content), {
        comments: false,
        extendedIdentifiers: true,
        locations: true,
        luaVersion: "5.3",
        ranges: true,
        scope: true,
      });
    } catch (error) {
      diagnostics.push(luaSyntaxDiagnostic(file.path, file.content, error));
      return;
    }

    walkLuaAst(ast, (node, parent, key) => {
      const requireCall = readRequireCall(file.content, node);
      if (requireCall) {
        if (requireCall.path === null) {
          dynamicRequirePaths.add(file.path);
          dynamicRequires.push({
            path: file.path,
            location: requireCall.location,
            message:
              'require 引用无法静态检查，请使用 require("文件名.lua") 的字符串形式',
          });
          return;
        }

        const exactTarget = filePaths.has(requireCall.path)
          ? requireCall.path
          : null;
        const caseInsensitiveTarget = filePathsByLowerCase.get(
          requireCall.path.toLocaleLowerCase("en-US"),
        );
        const resolvedTarget = exactTarget || caseInsensitiveTarget || null;
        const reference = {
          sourcePath: file.path,
          requestedPath: requireCall.path,
          resolvedTarget,
          location: requireCall.location,
        };
        references.push(reference);
        if (resolvedTarget) {
          dependencyGraph.get(file.path)?.push(resolvedTarget);
        }

        if (exactTarget) return;
        if (caseInsensitiveTarget) {
          diagnostics.push(
            luaReferenceDiagnostic(
              file.path,
              requireCall.location,
              "error",
              `require 路径大小写不匹配：${requireCall.path}，应为 ${caseInsensitiveTarget}`,
            ),
          );
          return;
        }
        diagnostics.push(
          luaReferenceDiagnostic(
            file.path,
            requireCall.location,
            "error",
            `require 引用的文件不存在：${requireCall.path}`,
          ),
        );
        return;
      }

      if (isIndirectGlobalRequire(node, parent, key)) {
        dynamicRequirePaths.add(file.path);
        dynamicRequires.push({
          path: file.path,
          location: luaNodeLocation(node, file.content),
          message:
            'require 被间接使用，无法静态检查，请直接使用 require("文件名.lua")',
        });
      }
    });
  };

  const reachablePaths = new Set();
  const pendingPaths = filePaths.has(PRELOAD_ENTRY_PATH)
    ? [PRELOAD_ENTRY_PATH]
    : [];
  while (pendingPaths.length) {
    const path = pendingPaths.pop();
    if (reachablePaths.has(path)) continue;
    reachablePaths.add(path);
    analyzeFile(path);
    for (const dependency of dependencyGraph.get(path) || []) {
      pendingPaths.push(dependency);
    }
  }

  const requiresFullWorkspace = [...reachablePaths].some((path) =>
    dynamicRequirePaths.has(path),
  );
  if (requiresFullWorkspace) {
    for (const file of files) analyzeFile(file.path);
  }
  const activePaths = requiresFullWorkspace
    ? new Set(filePaths)
    : reachablePaths;

  for (const reference of references) {
    if (!reference.resolvedTarget) continue;
    const cyclePath = findDependencyPath(
      dependencyGraph,
      reference.resolvedTarget,
      reference.sourcePath,
    );
    if (!cyclePath) continue;
    diagnostics.push(
      luaReferenceDiagnostic(
        reference.sourcePath,
        reference.location,
        "error",
        `require 存在循环依赖：${[reference.sourcePath, ...cyclePath].join(
          " → ",
        )}`,
      ),
    );
  }

  for (const dynamicRequire of dynamicRequires) {
    diagnostics.push(
      luaReferenceDiagnostic(
        dynamicRequire.path,
        dynamicRequire.location,
        "warning",
        requiresFullWorkspace
          ? `${dynamicRequire.message}；发布时将保守打包全部文件`
          : dynamicRequire.message,
      ),
    );
  }

  diagnostics.sort((left, right) => {
    const pathOrder = comparePaths(left.path, right.path);
    if (pathOrder) return pathOrder;
    if (left.from !== right.from) return left.from - right.from;
    return left.severity === right.severity
      ? left.message.localeCompare(right.message, "zh-CN")
      : left.severity === "error"
        ? -1
        : 1;
  });
  return {
    diagnostics,
    activePaths,
    requiresFullWorkspace,
  };
}

export function bundlePreloadWorkspace(workspace) {
  const plan = preloadWorkspaceBundlePlan(workspace);
  if (plan.buildFailure) {
    throw new PreloadBuildError(
      `预加载代码打包失败：${plan.buildFailure.path} ${plan.buildFailure.message}`,
    );
  }
  return compactLuaSource(preloadWorkspaceBundleSource(plan.files));
}

function preloadWorkspaceBundlePlan(workspace) {
  const normalized = normalizePreloadWorkspace(workspace);
  const errors = preloadWorkspaceErrors(normalized);
  if (errors.length) throw new Error(errors[0]);
  const analysis = analyzePreloadWorkspaceReferences(normalized.files);
  const buildFailure = analysis.diagnostics.find(
    (diagnostic) => diagnostic.source === "Lua 语法",
  );
  return {
    buildFailure,
    files:
      buildFailure || analysis.requiresFullWorkspace
        ? normalized.files
        : normalized.files.filter((file) =>
            analysis.activePaths.has(file.path),
          ),
  };
}

function preloadWorkspaceBundleSource(files) {
  if (files.length === 1 && files[0].path === PRELOAD_ENTRY_PATH) {
    return files[0].content;
  }

  const output = [
    "local __fq_preload_modules = {}",
    "local __fq_preload_cache = {}",
    "local __fq_preload_loading = {}",
    "local __fq_preload_require",
  ];
  for (const file of files) {
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
  const plan = preloadWorkspaceBundlePlan(workspace);
  const source = preloadWorkspaceBundleSource(plan.files);
  try {
    return new TextEncoder().encode(compactLuaSource(source)).byteLength;
  } catch (error) {
    if (!(error instanceof PreloadBuildError)) throw error;
    return new TextEncoder().encode(source).byteLength;
  }
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

function compactLuaSource(source) {
  try {
    const lexer = luaparse.parse(source, {
      extendedIdentifiers: true,
      luaVersion: "5.3",
      ranges: true,
      wait: true,
    });
    const output = [];
    let cursor = 0;
    let hasToken = false;
    while (true) {
      const token = lexer.lex();
      if (token.type === luaparse.tokenTypes.EOF) break;
      const gap = source.slice(cursor, token.range[0]);
      const newlineCount = countLuaNewlines(gap);
      if (newlineCount) {
        output.push("\n".repeat(newlineCount));
      } else if (hasToken && gap) {
        output.push(" ");
      }
      output.push(source.slice(...token.range));
      cursor = token.range[1];
      hasToken = true;
    }
    if (!hasToken) return "";
    output.push("\n".repeat(countLuaNewlines(source.slice(cursor))));
    return output.join("");
  } catch (error) {
    throw new PreloadBuildError(
      `预加载代码精简失败：${formatLuaError(error)}`,
    );
  }
}

function countLuaNewlines(value) {
  return value.match(/\r\n|\r|\n/g)?.length || 0;
}

function luaParserSource(source) {
  // luaparse 以 Lua 5.3 为上限；等长移除 5.4 局部变量属性，保留诊断偏移。
  return source.replace(/<(?:const|close)>/g, (attribute) =>
    " ".repeat(attribute.length),
  );
}

function luaSyntaxDiagnostic(path, source, error) {
  const from = Math.min(
    source.length,
    Math.max(0, Number.isInteger(error.index) ? error.index : 0),
  );
  return {
    path,
    from,
    to: Math.min(source.length, from + 1),
    severity: "error",
    source: "Lua 语法",
    message: formatLuaError(error),
    line: Math.max(1, Number(error.line) || 1),
    column: Math.max(1, (Number(error.column) || 0) + 1),
  };
}

function formatLuaError(error) {
  const detail = String(error.message || "")
    .replace(/^\[\d+:\d+\]\s*/, "")
    .trim();
  if (/Cannot read properties of undefined/.test(detail)) {
    return "Lua 语法错误：源码包含无法识别的符号";
  }
  const expected = detail.match(/^(.*?) expected near '([^']*)'$/);
  if (expected) {
    return `Lua 语法错误：缺少${formatLuaToken(expected[1])}，错误靠近${formatLuaToken(expected[2])}`;
  }
  const unexpected = detail.match(
    /^unexpected symbol '([^']*)' near '([^']*)'$/,
  );
  if (unexpected) {
    return `Lua 语法错误：意外的符号${formatLuaToken(unexpected[1])}，错误靠近${formatLuaToken(unexpected[2])}`;
  }
  if (detail.startsWith("unfinished string")) {
    return "Lua 语法错误：字符串没有正确结束";
  }
  if (detail.startsWith("malformed number")) {
    return "Lua 语法错误：数字格式不正确";
  }
  return detail ? `Lua 语法错误：${detail}` : "Lua 语法错误";
}

function formatLuaToken(value) {
  if (value === "<name>") return "变量或函数名称";
  if (value === "<eof>") return "文件结尾";
  return `“${String(value).replace(/^'(.*)'$/, "$1")}”`;
}

function walkLuaAst(value, visit, parent = null, parentKey = null) {
  if (!value || typeof value !== "object") return;
  if (typeof value.type === "string") visit(value, parent, parentKey);
  for (const [key, child] of Object.entries(value)) {
    if (key === "globals" || key === "loc" || key === "range") continue;
    if (Array.isArray(child)) {
      for (const item of child) walkLuaAst(item, visit, value, key);
    } else {
      walkLuaAst(child, visit, value, key);
    }
  }
}

function isIndirectGlobalRequire(node, parent, parentKey) {
  if (
    node.type !== "Identifier" ||
    node.name !== "require" ||
    node.isLocal !== false
  ) {
    return false;
  }
  return !(
    parentKey === "base" &&
    ["CallExpression", "StringCallExpression", "TableCallExpression"].includes(
      parent?.type,
    )
  );
}

function readRequireCall(source, node) {
  if (
    node.base?.type !== "Identifier" ||
    node.base.name !== "require" ||
    node.base.isLocal
  ) {
    return null;
  }
  let argument;
  if (node.type === "CallExpression") {
    [argument] = node.arguments;
  } else if (node.type === "StringCallExpression") {
    argument = node.argument;
  } else if (node.type === "TableCallExpression") {
    argument = node.arguments;
  } else {
    return null;
  }
  if (argument?.type !== "StringLiteral") {
    return { path: null, location: luaNodeLocation(node.base, source) };
  }
  const path = decodeLuaString(source.slice(...argument.range));
  return {
    path,
    location: luaNodeLocation(argument, source),
  };
}

function decodeLuaString(raw) {
  const longString = raw.match(/^\[(=*)\[([\s\S]*)\]\1\]$/);
  if (longString) return longString[2].replace(/^\r?\n/, "");
  const quote = raw[0];
  if ((quote !== '"' && quote !== "'") || raw.at(-1) !== quote) return null;

  let result = "";
  for (let index = 1; index < raw.length - 1; index += 1) {
    const character = raw[index];
    if (character !== "\\") {
      result += character;
      continue;
    }
    index += 1;
    const escaped = raw[index];
    const simpleEscapes = {
      a: "\u0007",
      b: "\b",
      f: "\f",
      n: "\n",
      r: "\r",
      t: "\t",
      v: "\u000b",
      "\\": "\\",
      '"': '"',
      "'": "'",
    };
    if (Object.hasOwn(simpleEscapes, escaped)) {
      result += simpleEscapes[escaped];
      continue;
    }
    if (escaped === "\n") continue;
    if (escaped === "\r") {
      if (raw[index + 1] === "\n") index += 1;
      continue;
    }
    if (escaped === "z") {
      while (/\s/.test(raw[index + 1] || "")) index += 1;
      continue;
    }
    if (escaped === "x") {
      const hex = raw.slice(index + 1, index + 3);
      if (!/^[\da-f]{2}$/i.test(hex)) return null;
      result += String.fromCharCode(Number.parseInt(hex, 16));
      index += 2;
      continue;
    }
    if (escaped === "u" && raw[index + 1] === "{") {
      const end = raw.indexOf("}", index + 2);
      const hex = end === -1 ? "" : raw.slice(index + 2, end);
      if (!/^[\da-f]+$/i.test(hex)) return null;
      try {
        result += String.fromCodePoint(Number.parseInt(hex, 16));
      } catch {
        return null;
      }
      index = end;
      continue;
    }
    if (/\d/.test(escaped || "")) {
      const decimal = raw.slice(index).match(/^\d{1,3}/)?.[0] || "";
      const code = Number.parseInt(decimal, 10);
      if (code > 255) return null;
      result += String.fromCharCode(code);
      index += decimal.length - 1;
      continue;
    }
    return null;
  }
  return result;
}

function luaNodeLocation(node, source) {
  const from = Math.max(0, node.range?.[0] || 0);
  const to = Math.min(
    source.length,
    Math.max(from + 1, node.range?.[1] || from + 1),
  );
  return {
    from,
    to,
    line: Math.max(1, node.loc?.start?.line || 1),
    column: Math.max(1, (node.loc?.start?.column || 0) + 1),
  };
}

function luaReferenceDiagnostic(path, location, severity, message) {
  return {
    path,
    ...location,
    severity,
    source: "Lua 引用",
    message,
  };
}

function findDependencyPath(graph, start, goal) {
  const pending = [[start, [start]]];
  const visited = new Set();
  while (pending.length) {
    const [path, chain] = pending.shift();
    if (path === goal) return chain;
    if (visited.has(path)) continue;
    visited.add(path);
    for (const dependency of graph.get(path) || []) {
      pending.push([dependency, [...chain, dependency]]);
    }
  }
  return null;
}

function luaString(value) {
  return JSON.stringify(value);
}
