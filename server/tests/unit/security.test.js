import { describe, expect, it } from "vitest";
import {
  createOpaqueToken,
  hashPassword,
  hashToken,
  normalizeRelativePath,
  sanitizeFileName,
  verifyPassword,
} from "../../lib/security.js";

describe("安全工具", () => {
  it("密码哈希可以验证正确密码并拒绝错误密码", async () => {
    const hash = await hashPassword("A-strong-password-2026");
    expect(hash).not.toContain("A-strong-password-2026");
    expect(await verifyPassword("A-strong-password-2026", hash)).toBe(true);
    expect(await verifyPassword("wrong-password", hash)).toBe(false);
  });

  it("Token 使用随机值并只保存固定长度哈希", () => {
    const first = createOpaqueToken("fqmap_");
    const second = createOpaqueToken("fqmap_");
    expect(first).not.toBe(second);
    expect(hashToken(first)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("文件名和相对目录不能保留路径穿越字符", () => {
    expect(sanitizeFileName("../evil.exe")).toBe(".._evil.exe");
    expect(normalizeRelativePath("../../safe\\folder/../file")).toBe(
      "safe/folder/file",
    );
  });
});
