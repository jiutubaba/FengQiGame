import { describe, expect, it } from "vitest";
import {
  PRELOAD_ENTRY_PATH,
  bundlePreloadWorkspace,
  createPreloadWorkspace,
  normalizePreloadWorkspace,
  preloadWorkspaceBytes,
  preloadWorkspaceErrors,
} from "../../../shared/preload-workspace.js";

describe("预加载代码文件工作区", () => {
  it("旧版单段代码转换为 main.lua 后保持下发文本不变", () => {
    const code = "function preload()\n  return true\nend";
    const workspace = createPreloadWorkspace(code);

    expect(workspace.entry).toBe(PRELOAD_ENTRY_PATH);
    expect(workspace.files).toEqual([{ path: "main.lua", content: code }]);
    expect(preloadWorkspaceErrors(workspace)).toEqual([]);
    expect(bundlePreloadWorkspace(workspace)).toBe(code);
  });

  it("多文件按路径稳定打包，并从 main.lua 加载模块", () => {
    const workspace = normalizePreloadWorkspace({
      version: 1,
      entry: "main.lua",
      folders: ["scripts"],
      files: [
        {
          path: "scripts/config.lua",
          content: "return { enabled = true }",
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
    expect(preloadWorkspaceBytes(workspace)).toBe(
      Buffer.byteLength(bundle, "utf8"),
    );
    expect(bundlePreloadWorkspace(workspace)).toBe(bundle);
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
});
