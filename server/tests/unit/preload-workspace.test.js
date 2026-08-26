import { describe, expect, it } from "vitest";
import luaparse from "luaparse";
import {
  PRELOAD_CODE_LIMIT_BYTES,
  PRELOAD_ENTRY_PATH,
  bundlePreloadWorkspace,
  createPreloadWorkspace,
  normalizePreloadWorkspace,
  preloadWorkspaceBytes,
  preloadWorkspaceDiagnostics,
  preloadWorkspaceErrors,
} from "../../../shared/preload-workspace.js";

function bundleSource(source) {
  return bundlePreloadWorkspace(createPreloadWorkspace(source));
}

function luaTokenSignature(source) {
  const lexer = luaparse.parse(source, {
    extendedIdentifiers: true,
    luaVersion: "5.3",
    ranges: true,
    wait: true,
  });
  const tokens = [];
  while (true) {
    const token = lexer.lex();
    if (token.type === luaparse.tokenTypes.EOF) return tokens;
    tokens.push([token.type, source.slice(...token.range)]);
  }
}

describe("预加载代码文件工作区", () => {
  it("旧版单段代码转换为 main.lua，并只压缩打包结果", () => {
    const code = [
      "-- 入口说明",
      'local  text <const> = "空格  和 -- 字符串内容保留"',
      "local value--[[ 行内注释 ]]= [[第一行",
      "  第二行]]",
      "if  text then -- 行尾注释",
      "  return  text, value",
      "end",
    ].join("\r\n");
    const workspace = createPreloadWorkspace(code);
    const bundle = bundlePreloadWorkspace(workspace);

    expect(workspace.entry).toBe(PRELOAD_ENTRY_PATH);
    expect(workspace.files).toEqual([{ path: "main.lua", content: code }]);
    expect(preloadWorkspaceErrors(workspace)).toEqual([]);
    expect(bundle).not.toContain("入口说明");
    expect(bundle).not.toContain("行内注释");
    expect(bundle).not.toContain("行尾注释");
    expect(bundle).toContain(
      'local text <const> = "空格  和 -- 字符串内容保留"',
    );
    expect(bundle).toContain("local value = [[第一行\r\n  第二行]]");
    expect(bundle).toContain("\nreturn text, value\n");
    expect(bundle.split("\n")).toHaveLength(code.split("\r\n").length);
    expect(Buffer.byteLength(bundle, "utf8")).toBeLessThan(
      Buffer.byteLength(code, "utf8"),
    );
  });

  it("多文件按路径稳定打包，并从 main.lua 加载模块", () => {
    const workspace = normalizePreloadWorkspace({
      version: 1,
      entry: "main.lua",
      folders: ["scripts"],
      files: [
        {
          path: "scripts/config.lua",
          content: "-- 配置说明\nreturn  { enabled = true }",
        },
        {
          path: "main.lua",
          content:
            'local config = require("scripts/config.lua")\nreturn config.enabled',
        },
      ],
    });
    const bundle = bundlePreloadWorkspace(workspace);

    expect(bundle).toContain('__fq_preload_modules["main.lua"]');
    expect(bundle).toContain('__fq_preload_modules["scripts/config.lua"]');
    expect(bundle).toContain('return __fq_preload_require("main.lua")');
    expect(bundle).not.toContain("配置说明");
    expect(preloadWorkspaceBytes(workspace)).toBe(
      Buffer.byteLength(bundle, "utf8"),
    );
    expect(bundlePreloadWorkspace(workspace)).toBe(bundle);
    expect(() => luaparse.parse(bundle, { luaVersion: "5.3" })).not.toThrow();
  });

  it("注释引用和未引用文件不进入发布产物，原始工作区保持完整", () => {
    const workspace = normalizePreloadWorkspace({
      version: 1,
      entry: "main.lua",
      folders: [],
      files: [
        {
          path: "main.lua",
          content: [
            '-- require("单位数据.lua")',
            "--[[ require('技能重载.lua') ]]",
          ].join("\n"),
        },
        { path: "单位数据.lua", content: 'return "UNUSED_UNIT_DATA"' },
        { path: "技能重载.lua", content: 'return "UNUSED_SKILL_RELOAD"' },
      ],
    });

    expect(bundlePreloadWorkspace(workspace)).toBe("");
    expect(preloadWorkspaceBytes(workspace)).toBe(0);
    expect(workspace.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "单位数据.lua",
          content: 'return "UNUSED_UNIT_DATA"',
        }),
        expect.objectContaining({
          path: "技能重载.lua",
          content: 'return "UNUSED_SKILL_RELOAD"',
        }),
      ]),
    );
    expect(
      preloadWorkspaceDiagnostics(workspace).filter(({ message }) =>
        message.includes("未被 main.lua"),
      ),
    ).toHaveLength(2);
  });

  it("递归打包入口可达文件并稳定排除无关文件", () => {
    const workspace = normalizePreloadWorkspace({
      version: 1,
      entry: "main.lua",
      folders: [],
      files: [
        {
          path: "main.lua",
          content: 'local value = require("a.lua")\nreturn value',
        },
        {
          path: "a.lua",
          content:
            'local value = require("b.lua")\nreturn "REACHABLE_A" .. value',
        },
        { path: "b.lua", content: 'return "REACHABLE_B"' },
        { path: "unused.lua", content: 'return "UNUSED_MODULE"' },
      ],
    });
    const bundle = bundlePreloadWorkspace(workspace);

    expect(bundle).toContain("REACHABLE_A");
    expect(bundle).toContain("REACHABLE_B");
    expect(bundle).not.toContain("UNUSED_MODULE");
    expect(bundlePreloadWorkspace(workspace)).toBe(bundle);
  });

  it("词法不完整时拒绝生成发布产物，编辑器容量预览仍可计算", () => {
    const source = 'local value = "未结束';
    let shebangError;

    try {
      bundleSource("#!/usr/bin/lua\nreturn true");
    } catch (error) {
      shebangError = error;
    }

    expect(shebangError?.message).toContain("预加载代码精简失败：Lua 语法错误：");
    expect(shebangError?.message).not.toContain("Cannot read properties");
    expect(() => bundleSource(source)).toThrow("预加载代码打包失败");
    expect(bundleSource("return true -- 后续合法发布不受污染")).toBe(
      "return true",
    );
    expect(preloadWorkspaceBytes(createPreloadWorkspace(source))).toBe(
      Buffer.byteLength(source, "utf8"),
    );
  });

  it("纯注释、纯空白和空输入统一生成空字符串", () => {
    expect(bundleSource("-- 只有单行注释\n")).toBe("");
    expect(bundleSource("--[[只有长注释\n第二行]]\n")).toBe("");
    expect(bundleSource(" \t\r\n\n")).toBe("");
    expect(bundleSource("")).toBe("");
  });

  it("按 Lua 词法删除行尾注释并保留字符串和长字符串正文", () => {
    const source = [
      'local single = \'--[[普通字符串]]\'',
      'local double = "转义引号 \\\" -- 仍是正文" -- 删除我',
      "local long = [=[--[[长字符串正文]]",
      "--[==[仍是正文]==]]=]",
      "return single, double, long -- 中文 !@#$%^&*()",
    ].join("\n");
    const bundle = bundleSource(source);

    expect(bundle).toContain("'--[[普通字符串]]'");
    expect(bundle).toContain('"转义引号 \\\" -- 仍是正文"');
    expect(bundle).toContain("[=[--[[长字符串正文]]\n--[==[仍是正文]==]]=]");
    expect(bundle).not.toContain("删除我");
    expect(bundle).not.toContain("中文 !@#$%^&*()");
    expect(bundle.split("\n")).toHaveLength(source.split("\n").length);
  });

  it("删除所有 Lua 长注释形式并避免相邻 token 拼接", () => {
    const source = [
      "local a = 1--[[普通长注释]]+2",
      "local b = a--[=[一级长注释]=]and true",
      "return b--[==[二级长注释]==]or false",
    ].join("\n");
    const bundle = bundleSource(source);

    expect(bundle).toBe(
      ["local a = 1 +2", "local b = a and true", "return b or false"].join(
        "\n",
      ),
    );
    expect(luaTokenSignature(bundle)).toEqual(luaTokenSignature(source));
  });

  it("删除多行长注释时保留换行数量和 UTF-8 token", () => {
    const source = "local 中文值 = 1--[=[第一行\r\n第二行\n第三行]=]and true";
    const bundle = bundleSource(source);

    expect(bundle).toBe("local 中文值 = 1\n\nand true");
    expect(bundle.match(/\n/g)).toHaveLength(2);
    expect(luaTokenSignature(bundle)).toEqual(luaTokenSignature(source));
  });

  it("边界容量按精简后的 UTF-8 字节计算且结果稳定", () => {
    const atLimit = createPreloadWorkspace(
      `return "${"x".repeat(PRELOAD_CODE_LIMIT_BYTES - 9)}"`,
    );
    const overLimit = createPreloadWorkspace(
      `return "${"x".repeat(PRELOAD_CODE_LIMIT_BYTES - 8)}"`,
    );
    const repeated = createPreloadWorkspace(
      "-- 中文注释\nlocal text = '固定 -- 正文'\nreturn text",
    );

    expect(preloadWorkspaceBytes(atLimit)).toBe(PRELOAD_CODE_LIMIT_BYTES);
    expect(preloadWorkspaceBytes(overLimit)).toBe(
      PRELOAD_CODE_LIMIT_BYTES + 1,
    );
    expect(Buffer.byteLength(bundlePreloadWorkspace(atLimit), "utf8")).toBe(
      PRELOAD_CODE_LIMIT_BYTES,
    );
    expect(Buffer.byteLength(bundlePreloadWorkspace(overLimit), "utf8")).toBe(
      PRELOAD_CODE_LIMIT_BYTES + 1,
    );
    expect(bundlePreloadWorkspace(repeated)).toBe(
      bundlePreloadWorkspace(repeated),
    );
  });

  it("拒绝路径穿越、缺失父目录和删除入口文件", () => {
    const invalid = {
      version: 1,
      entry: "main.lua",
      folders: [],
      files: [{ path: "../scripts/config.lua", content: "return true" }],
    };

    expect(preloadWorkspaceErrors(invalid)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("路径层级不符合要求"),
        expect.stringContaining("必须保留入口文件"),
        expect.stringContaining("父文件夹不存在"),
      ]),
    );
    expect(() => bundlePreloadWorkspace(invalid)).toThrow();
  });

  it("检查全部 Lua 文件并接受能解析到真实文件的 require", () => {
    const workspace = normalizePreloadWorkspace({
      version: 1,
      entry: "main.lua",
      folders: [],
      files: [
        { path: "main.lua", content: "local data = require '单位数据.lua'" },
        { path: "单位数据.lua", content: "return { enabled = true }" },
      ],
    });

    expect(preloadWorkspaceDiagnostics(workspace)).toEqual([]);
  });

  it("忽略被局部变量遮蔽的 require", () => {
    const workspace = createPreloadWorkspace(
      [
        "local require = function(name)",
        "  return name",
        "end",
        'return require("并非模块.lua")',
      ].join("\n"),
    );

    expect(preloadWorkspaceDiagnostics(workspace)).toEqual([]);
  });

  it("报告 require 缺失、大小写不一致和动态引用", () => {
    const missing = createPreloadWorkspace('require("缺失.lua")');
    expect(preloadWorkspaceDiagnostics(missing)).toEqual([
      expect.objectContaining({
        path: "main.lua",
        severity: "error",
        message: "require 引用的文件不存在：缺失.lua",
      }),
    ]);

    const wrongCase = normalizePreloadWorkspace({
      version: 1,
      entry: "main.lua",
      folders: [],
      files: [
        { path: "main.lua", content: 'require("config.lua")' },
        { path: "Config.lua", content: "return true" },
      ],
    });
    expect(preloadWorkspaceDiagnostics(wrongCase)).toEqual([
      expect.objectContaining({
        severity: "error",
        message: "require 路径大小写不匹配：config.lua，应为 Config.lua",
      }),
    ]);

    const dynamic = createPreloadWorkspace("require(moduleName)");
    expect(preloadWorkspaceDiagnostics(dynamic)).toEqual([
      expect.objectContaining({
        severity: "warning",
        message: expect.stringContaining("发布时将保守打包全部文件"),
      }),
    ]);
    expect(bundlePreloadWorkspace(dynamic)).toBe("require(moduleName)");
  });

  it("兼容可达的动态和间接 require，并忽略未引用文件中的动态加载", () => {
    for (const source of [
      "local loader = require\nreturn loader(moduleName)",
      'return pcall(require, "模块.lua")',
    ]) {
      const workspace = createPreloadWorkspace(source);
      expect(preloadWorkspaceDiagnostics(workspace)).toEqual([
        expect.objectContaining({
          severity: "warning",
          message: expect.stringContaining("require 被间接使用"),
        }),
      ]);
      expect(bundlePreloadWorkspace(workspace)).toContain("require");
      expect(preloadWorkspaceBytes(workspace)).toBeGreaterThan(0);
    }

    const dynamicWorkspace = normalizePreloadWorkspace({
      version: 1,
      entry: "main.lua",
      folders: [],
      files: [
        {
          path: "main.lua",
          content: "return require(moduleName)",
        },
        { path: "dynamic.lua", content: 'return "DYNAMIC_MODULE"' },
        { path: "fallback.lua", content: 'return "FALLBACK_MODULE"' },
      ],
    });
    const dynamicBundle = bundlePreloadWorkspace(dynamicWorkspace);
    expect(dynamicBundle).toContain("DYNAMIC_MODULE");
    expect(dynamicBundle).toContain("FALLBACK_MODULE");
    expect(() =>
      luaparse.parse(dynamicBundle, { luaVersion: "5.3" }),
    ).not.toThrow();

    const dynamicWithInvalidFile = normalizePreloadWorkspace({
      version: 1,
      entry: "main.lua",
      folders: [],
      files: [
        { path: "main.lua", content: "return require(moduleName)" },
        { path: "invalid.lua", content: "local value =" },
      ],
    });
    expect(() => bundlePreloadWorkspace(dynamicWithInvalidFile)).toThrow(
      "invalid.lua",
    );

    const unreachableDynamic = normalizePreloadWorkspace({
      version: 1,
      entry: "main.lua",
      folders: [],
      files: [
        { path: "main.lua", content: "return true" },
        {
          path: "unused.lua",
          content: "local loader = require\nreturn loader(moduleName)",
        },
      ],
    });
    expect(bundlePreloadWorkspace(unreachableDynamic)).toBe("return true");
    expect(preloadWorkspaceDiagnostics(unreachableDynamic)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "unused.lua",
          severity: "warning",
          message: expect.stringContaining("require 被间接使用"),
        }),
        expect.objectContaining({
          path: "unused.lua",
          severity: "warning",
          message: "文件未被 main.lua 的 require 链加载",
        }),
      ]),
    );
  });

  it("报告循环依赖、语法错误和未被入口加载的文件", () => {
    const cyclic = normalizePreloadWorkspace({
      version: 1,
      entry: "main.lua",
      folders: [],
      files: [
        { path: "main.lua", content: 'require("helper.lua")' },
        { path: "helper.lua", content: 'require("main.lua")' },
      ],
    });
    expect(
      preloadWorkspaceDiagnostics(cyclic).filter(({ message }) =>
        message.includes("循环依赖"),
      ),
    ).toHaveLength(2);

    const invalidAndUnused = normalizePreloadWorkspace({
      version: 1,
      entry: "main.lua",
      folders: [],
      files: [
        { path: "main.lua", content: "return true" },
        { path: "unused.lua", content: "local value =" },
      ],
    });
    const diagnostics = preloadWorkspaceDiagnostics(invalidAndUnused);
    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "unused.lua",
          source: "Lua 语法",
          severity: "error",
        }),
        expect.objectContaining({
          path: "unused.lua",
          message: "文件未被 main.lua 的 require 链加载",
          severity: "warning",
        }),
      ]),
    );
    expect(bundlePreloadWorkspace(invalidAndUnused)).toBe("return true");
  });
});
