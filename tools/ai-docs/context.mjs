import { pathExists, toRepoPath } from "./common.mjs";
import { baseDocuments, contextRules } from "./routing.mjs";

const input = process.argv.slice(2).find((value) => value !== "--");
if (!input) {
  console.error("用法：npm run ai:context -- <仓库内路径>");
  process.exit(1);
}

const target = toRepoPath(input);
if (!(await pathExists(target))) {
  console.error(`路径不存在：${target}`);
  process.exit(1);
}

const matched = contextRules.filter((rule) =>
  rule.matches.some((pattern) => pattern.test(target)),
);
const documents = new Set(baseDocuments);
const checks = new Set(["npm run ai:docs:check", "npm run check"]);
for (const rule of matched) {
  rule.documents.forEach((document) => documents.add(document));
  rule.checks.forEach((check) => checks.add(check));
}

console.log(`目标路径：${target}`);
console.log(
  `命中领域：${matched.map((rule) => rule.name).join("、") || "通用"}`,
);
console.log("\n必读文档：");
for (const document of documents) console.log(`- ${document}`);
console.log("\n建议验证：");
for (const check of checks) console.log(`- ${check}`);
