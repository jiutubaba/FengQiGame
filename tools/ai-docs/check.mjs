import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import {
  absolutePath,
  pathExists,
  readUtf8,
  rootDir,
  toRepoPath,
  walkFiles,
} from "./common.mjs";
import { renderFactFiles } from "./facts.mjs";
import { baseDocuments, contextRules } from "./routing.mjs";

const errors = [];
const requiredPaths = [
  "AGENTS.md",
  ...baseDocuments,
  ".ai/operations.md",
  ".ai/backlog.md",
  ".ai/sessions.md",
  ".ai/systems/账号与权限.md",
  ".ai/systems/地图与环境.md",
  ".ai/systems/客户端协议.md",
  ".ai/systems/玩家与运营内容.md",
  ".ai/systems/排行榜与风控.md",
  ".ai/systems/群抽与文件.md",
  ".ai/systems/部署与恢复.md",
  ".ai/decisions/README.md",
];

for (const repoPath of requiredPaths)
  if (!(await pathExists(repoPath))) errors.push(`缺少治理文件：${repoPath}`);

const expectedFacts = await renderFactFiles();
for (const [repoPath, expected] of expectedFacts) {
  let actual = null;
  try {
    actual = await readFile(absolutePath(repoPath), "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (actual !== expected)
    errors.push(
      `自动生成事实已漂移：${repoPath}，请运行 npm run ai:docs:build`,
    );
}

const generatedDirectory = absolutePath(".ai/generated");
try {
  const generatedNames = (await readdir(generatedDirectory)).sort();
  const expectedNames = [...expectedFacts.keys()]
    .map((repoPath) => path.basename(repoPath))
    .sort();
  if (JSON.stringify(generatedNames) !== JSON.stringify(expectedNames))
    errors.push(".ai/generated 只能包含事实生成器管理的文件");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

const markdownFiles = await walkFiles(".ai", {
  filter: (file) => file.endsWith(".md"),
});
for (const file of markdownFiles) {
  const source = await readUtf8(file);
  for (const match of source.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    let target = match[1].trim().replace(/^<|>$/g, "").split("#")[0];
    if (!target || /^(https?:|mailto:)/i.test(target)) continue;
    target = decodeURIComponent(target);
    const resolved = path.resolve(path.dirname(absolutePath(file)), target);
    const relativeToRoot = path.relative(rootDir, resolved);
    if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
      errors.push(`文档链接越界：${file} -> ${match[1]}`);
      continue;
    }
    try {
      await stat(resolved);
    } catch (error) {
      if (error.code === "ENOENT")
        errors.push(`文档断链：${file} -> ${match[1]}`);
      else throw error;
    }
  }
}

const sessions = await readUtf8(".ai/sessions.md");
const sessionCount = (sessions.match(/^## \d{4}-\d{2}-\d{2} /gm) || []).length;
if (sessionCount > 5)
  errors.push(`.ai/sessions.md 只能保留最近 5 条，当前为 ${sessionCount} 条`);

const decisionFiles = (
  await walkFiles(".ai/decisions", {
    filter: (file) => file.endsWith(".md") && !file.endsWith("/README.md"),
  })
).sort();
if (!decisionFiles.length) errors.push("至少需要一份已编号 ADR");
for (const file of decisionFiles) {
  const source = await readUtf8(file);
  for (const heading of [
    "- 状态：",
    "- 日期：",
    "## 背景",
    "## 决策",
    "## 后果",
    "## 验证",
  ])
    if (!source.includes(heading)) errors.push(`ADR 缺少“${heading}”：${file}`);
}

const routerSource = await readUtf8(".ai/router.md");
for (const document of new Set(
  contextRules.flatMap((rule) => rule.documents),
)) {
  if (!(await pathExists(document)))
    errors.push(`上下文路由文档不存在：${document}`);
  if (!routerSource.includes(document.replace(".ai/", "")))
    errors.push(`router.md 未列出上下文文档：${document}`);
}

const textExtensions = new Set([
  "",
  ".bat",
  ".css",
  ".example",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mjs",
  ".ps1",
  ".sql",
  ".txt",
  ".yaml",
  ".yml",
]);
const scanFiles = await walkFiles(".", {
  exclude: [
    ".git",
    "node_modules",
    "dist",
    "coverage",
    ".runtime",
    ".test-artifacts",
    "uploads",
    "backups",
    "public/data",
  ],
  filter: (file) =>
    textExtensions.has(path.extname(file)) ||
    ["Dockerfile", "Caddyfile"].includes(path.basename(file)),
});
const forbiddenPatterns = [
  ["旧站密码", new RegExp(["fq", "666888"].join(""), "i")],
  ["旧站域名", new RegExp(["kz", "xiyu2360", "com"].join("\\."), "i")],
  ["旧测试域名", new RegExp(["fengqi", "games"].join("\\."), "i")],
  ["旧项目目录名", new RegExp(["风起后台", "北沐"].join("\\(") + "\\)", "i")],
  ["旧平台密码标识", new RegExp(["Platform", "Password"].join(""), "i")],
  [
    "旧站标题",
    new RegExp(
      ["WAR3", "地图管理"].join("") + "|" + ["War3", " 地图管理"].join(""),
      "i",
    ),
  ],
  ["私钥", /BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY/],
  ["完整地图 API Key", /fqmap_[A-Za-z0-9_-]{24,}/],
];
for (const file of scanFiles) {
  const source = await readUtf8(file);
  for (const [label, pattern] of forbiddenPatterns)
    if (pattern.test(source)) errors.push(`发现${label}：${toRepoPath(file)}`);
}

if (errors.length) {
  console.error("AI 文档治理检查失败：");
  errors.forEach((error) => console.error(`- ${error}`));
  process.exitCode = 1;
} else {
  console.log(
    `AI 文档治理检查通过：${requiredPaths.length} 个必需入口、${markdownFiles.length} 份文档、${expectedFacts.size} 份生成事实。`,
  );
}
