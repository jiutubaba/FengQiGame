import { readdir } from "node:fs/promises";
import {
  absolutePath,
  lineCount,
  readUtf8,
  sha256,
  stableUnique,
  walkFiles,
} from "./common.mjs";

function collectSimpleResources(source) {
  return [...source.matchAll(/addSimpleResourceRoutes\(\{([\s\S]*?)\}\);/g)]
    .map((match) => ({
      pathName: match[1].match(/pathName:\s*["']([^"']+)["']/)?.[1],
      permission: match[1].match(
        /permission:\s*PERMISSIONS\.([A-Z0-9_]+)/,
      )?.[1],
    }))
    .filter((resource) => resource.pathName && resource.permission);
}

function collectGuardNames(source) {
  const guards = [];
  if (/\brequireAuth\b/.test(source)) guards.push("requireAuth");
  if (/\brequireAdmin\b/.test(source)) guards.push("requireAdmin");
  for (const match of source.matchAll(
    /requireMapPermission\(PERMISSIONS\.([A-Z0-9_]+)\)/g,
  ))
    guards.push(`map:${match[1]}`);
  for (const match of source.matchAll(
    /requireApiPermission\(["']([^"']+)["']\)/g,
  ))
    guards.push(`api:${match[1]}`);
  if (/\bloadApiKey\b/.test(source)) guards.push("loadApiKey");
  return stableUnique(guards);
}

async function collectApiRoutes() {
  const appSource = await readUtf8("server/app.js");
  const imports = new Map();
  for (const match of appSource.matchAll(
    /import\s+(\w+)\s+from\s+["']\.\/routes\/([^"']+)\.js["'];/g,
  ))
    imports.set(match[1], `server/routes/${match[2]}.js`);

  const mounts = new Map();
  for (const match of appSource.matchAll(
    /app\.use\(\s*["']([^"']+)["']\s*,\s*(\w+)\s*\)/g,
  ))
    mounts.set(match[2], match[1]);

  const routes = [];
  for (const [routerName, file] of imports) {
    const source = await readUtf8(file);
    const routeMatches = [
      ...source.matchAll(
        /router\.(get|post|put|patch|delete)\(\s*["'`]([^"'`]+)["'`]/g,
      ),
    ];
    const fileGuardMatch = source.match(/router\.use\(([^;]+)\);/);
    const fileGuards = fileGuardMatch
      ? collectGuardNames(fileGuardMatch[1])
      : [];
    for (let index = 0; index < routeMatches.length; index += 1) {
      const match = routeMatches[index];
      const end = routeMatches[index + 1]?.index ?? source.length;
      const routeSource = source.slice(match.index, end);
      const prefix = mounts.get(routerName) || "";
      routes.push({
        method: match[1].toUpperCase(),
        path: `${prefix}${match[2]}`,
        source: file,
        guards: stableUnique([
          ...fileGuards,
          ...collectGuardNames(routeSource),
        ]),
      });
    }
    for (const resource of collectSimpleResources(source)) {
      for (const method of ["GET", "POST"])
        routes.push({
          method,
          path: `${mounts.get(routerName) || ""}/:mapId/${resource.pathName}`,
          source: file,
          guards: [`map:${resource.permission}`],
        });
      for (const method of ["PATCH", "DELETE"])
        routes.push({
          method,
          path: `${mounts.get(routerName) || ""}/:mapId/${resource.pathName}/:resourceId`,
          source: file,
          guards: [`map:${resource.permission}`],
        });
    }
  }
  return routes.sort(
    (a, b) =>
      a.path.localeCompare(b.path, "en") || a.method.localeCompare(b.method),
  );
}

async function collectPermissions() {
  const authSource = await readUtf8("server/middleware/auth.js");
  const objectBody = authSource.match(
    /export const PERMISSIONS = Object\.freeze\(\{([\s\S]*?)\}\);/,
  )?.[1];
  const mapPermissions = objectBody
    ? [...objectBody.matchAll(/([A-Z0-9_]+):\s*["']([^"']+)["']/g)].map(
        ([, name, value]) => ({ name, value }),
      )
    : [];

  const routeFiles = await walkFiles("server/routes", {
    filter: (file) => file.endsWith(".js"),
  });
  const apiPermissions = [];
  const auditActions = [];
  for (const file of routeFiles) {
    const source = await readUtf8(file);
    apiPermissions.push(
      ...[...source.matchAll(/["'](game\.[a-z_.]+)["']/g)].map(
        (match) => match[1],
      ),
    );
    auditActions.push(
      ...[...source.matchAll(/action:\s*["']([^"']+)["']/g)].map(
        (match) => match[1],
      ),
    );
    for (const resource of collectSimpleResources(source))
      auditActions.push(
        `${resource.pathName}.create`,
        `${resource.pathName}.update`,
        `${resource.pathName}.delete`,
      );
  }
  return {
    mapPermissions,
    apiPermissions: stableUnique(apiPermissions),
    auditActions: stableUnique(auditActions),
  };
}

async function collectMigrations() {
  const names = (await readdir(absolutePath("server/db/migrations")))
    .filter((name) => name.endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b, "en"));
  return Promise.all(
    names.map(async (name) => {
      const file = `server/db/migrations/${name}`;
      const source = await readUtf8(file);
      return {
        file,
        sha256: sha256(source),
        tables: stableUnique(
          [...source.matchAll(/CREATE TABLE IF NOT EXISTS\s+([a-z_]+)/gi)].map(
            (match) => match[1],
          ),
        ),
        alteredTables: stableUnique(
          [...source.matchAll(/ALTER TABLE\s+([a-z_]+)/gi)].map(
            (match) => match[1],
          ),
        ),
      };
    }),
  );
}

async function collectEnvironmentVariables() {
  const configSource = await readUtf8("server/config.js");
  const schemaBody = configSource.match(
    /const envSchema = z\.object\(\{([\s\S]*?)\n\}\);/,
  )?.[1];
  const runtime = schemaBody
    ? [...schemaBody.matchAll(/^\s{2}([A-Z][A-Z0-9_]+):/gm)].map(
        (match) => match[1],
      )
    : [];
  const exampleSource = await readUtf8(".env.example");
  const deployment = [...exampleSource.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map(
    (match) => match[1],
  );
  return {
    runtime: stableUnique(runtime),
    deployment: stableUnique(deployment),
  };
}

async function collectFrontendRoutes() {
  const source = await readUtf8("src/App.jsx");
  return stableUnique(
    [...source.matchAll(/\bpath=["']([^"']+)["']/g)].map((match) => match[1]),
  );
}

async function collectTests() {
  const files = await walkFiles("server/tests", {
    filter: (file) => file.endsWith(".test.js"),
  });
  return Promise.all(
    files.map(async (file) => {
      const source = await readUtf8(file);
      return {
        file,
        tests: [
          ...source.matchAll(/\b(?:it|test)\(\s*["'`]([^"'`]+)["'`]/g),
        ].map((match) => match[1]),
      };
    }),
  );
}

async function collectSourceFiles() {
  const files = [
    ...(await walkFiles("server", {
      filter: (file) => /\.(js|sql)$/.test(file),
    })),
    ...(await walkFiles("src", {
      filter: (file) => /\.(js|jsx|css)$/.test(file),
    })),
  ].sort((a, b) => a.localeCompare(b, "en"));
  return Promise.all(
    files.map(async (file) => {
      const source = await readUtf8(file);
      return { file, lines: lineCount(source) };
    }),
  );
}

export async function collectFacts() {
  const packageJson = JSON.parse(await readUtf8("package.json"));
  const [
    apiRoutes,
    permissions,
    migrations,
    environmentVariables,
    frontendRoutes,
    tests,
    sourceFiles,
  ] = await Promise.all([
    collectApiRoutes(),
    collectPermissions(),
    collectMigrations(),
    collectEnvironmentVariables(),
    collectFrontendRoutes(),
    collectTests(),
    collectSourceFiles(),
  ]);
  return {
    schemaVersion: 1,
    project: { name: packageJson.name, version: packageJson.version },
    packageScripts: packageJson.scripts,
    apiRoutes,
    frontendRoutes,
    ...permissions,
    migrations,
    environmentVariables,
    tests,
    sourceFiles,
  };
}

function mdCell(value) {
  return String(value).replaceAll("|", "\\|").replaceAll("\n", "<br>");
}

export function renderFactsMarkdown(facts) {
  const lines = [
    "# 自动生成代码事实",
    "",
    "> 由 `npm run ai:docs:build` 确定性生成，禁止手工修改。",
    "",
    `- 项目：\`${facts.project.name}\``,
    `- 版本：\`${facts.project.version}\``,
    `- API 路由：${facts.apiRoutes.length}`,
    `- 地图权限：${facts.mapPermissions.length}`,
    `- 客户端权限：${facts.apiPermissions.length}`,
    `- 数据库迁移：${facts.migrations.length}`,
    "",
    "## 地图权限",
    "",
    "| 常量 | 权限值 |",
    "| --- | --- |",
    ...facts.mapPermissions.map(
      (item) => `| \`${item.name}\` | \`${item.value}\` |`,
    ),
    "",
    "## 游戏客户端权限",
    "",
    ...facts.apiPermissions.map((value) => `- \`${value}\``),
    "",
    "## API 路由",
    "",
    "| 方法 | 路径 | 守门 | 来源 |",
    "| --- | --- | --- | --- |",
    ...facts.apiRoutes.map(
      (route) =>
        `| ${route.method} | \`${mdCell(route.path)}\` | ${mdCell(route.guards.join(", ") || "public")} | \`${route.source}\` |`,
    ),
    "",
    "## 前端路由",
    "",
    ...facts.frontendRoutes.map((value) => `- \`${value}\``),
    "",
    "## 数据库迁移",
    "",
    "| 文件 | 新建表 | 修改表 | SHA-256 |",
    "| --- | --- | --- | --- |",
    ...facts.migrations.map(
      (migration) =>
        `| \`${migration.file}\` | ${mdCell(migration.tables.join(", ") || "—")} | ${mdCell(migration.alteredTables.join(", ") || "—")} | \`${migration.sha256.slice(0, 12)}\` |`,
    ),
    "",
    "## 环境变量",
    "",
    `- 运行时校验：${facts.environmentVariables.runtime.map((value) => `\`${value}\``).join("、")}`,
    `- 部署模板：${facts.environmentVariables.deployment.map((value) => `\`${value}\``).join("、")}`,
    "",
    "## 测试入口",
    "",
    ...facts.tests.flatMap((file) => [
      `### \`${file.file}\``,
      "",
      ...file.tests.map((name) => `- ${name}`),
      "",
    ]),
    "## 审计动作",
    "",
    ...facts.auditActions.map((value) => `- \`${value}\``),
  ];
  return `${lines.join("\n")}\n`;
}

export async function renderFactFiles() {
  const facts = await collectFacts();
  return new Map([
    [".ai/generated/code-facts.json", `${JSON.stringify(facts, null, 2)}\n`],
    [".ai/generated/code-facts.md", renderFactsMarkdown(facts)],
  ]);
}
