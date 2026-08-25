import { describe, expect, it } from "vitest";
import luaparse from "luaparse";
import {
  PRELOAD_ENTRY_PATH,
  bundlePreloadWorkspace,
  createPreloadWorkspace,
  normalizePreloadWorkspace,
  preloadWorkspaceBytes,
  preloadWorkspaceDiagnostics,
  preloadWorkspaceErrors,
} from "../../../shared/preload-workspace.js";

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

  it("词法不完整时保留源码，避免编辑过程因压缩中断", () => {
    const source = 'local value = "未结束';

    expect(bundlePreloadWorkspace(createPreloadWorkspace(source))).toBe(source);
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
        message: expect.stringContaining("无法静态检查"),
      }),
    ]);
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
  });
});
