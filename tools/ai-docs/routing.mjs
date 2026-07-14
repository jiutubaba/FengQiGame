export const baseDocuments = [
  ".ai/README.md",
  ".ai/router.md",
  ".ai/architecture.md",
  ".ai/code_style.md",
  ".ai/security.md",
  ".ai/quality.md",
];

export const contextRules = [
  {
    name: "账号、会话与权限",
    matches: [
      /^server\/middleware\//,
      /^server\/routes\/(auth|admin)\.js$/,
      /^server\/services\/users\.js$/,
      /^src\/auth\//,
      /^src\/pages\/Admin/,
    ],
    documents: [".ai/systems/账号与权限.md"],
    checks: ["npm test", "npm run test:integration"],
  },
  {
    name: "地图与环境",
    matches: [
      /^server\/routes\/maps\.js$/,
      /^src\/pages\/Map(Center|Workspace)\.jsx$/,
    ],
    documents: [".ai/systems/地图与环境.md"],
    checks: ["npm run test:integration"],
  },
  {
    name: "游戏客户端协议",
    matches: [
      /^server\/routes\/game\.js$/,
      /^server\/middleware\/auth\.js$/,
      /^docs\/游戏客户端接入\.md$/,
    ],
    documents: [".ai/systems/客户端协议.md", ".ai/systems/账号与权限.md"],
    checks: ["npm run test:integration"],
  },
  {
    name: "玩家与运营内容",
    matches: [
      /^server\/routes\/(maps|game)\.js$/,
      /^src\/pages\/MapWorkspace\.jsx$/,
      /^server\/db\/migrations\/00[12]_.*\.sql$/,
    ],
    documents: [".ai/systems/玩家与运营内容.md"],
    checks: ["npm run test:integration"],
  },
  {
    name: "排行榜与风控",
    matches: [
      /^server\/routes\/(maps|game)\.js$/,
      /^src\/pages\/MapWorkspace\.jsx$/,
      /^server\/db\/migrations\/003_.*\.sql$/,
    ],
    documents: [".ai/systems/排行榜与风控.md"],
    checks: ["npm run test:integration"],
  },
  {
    name: "群抽与文件",
    matches: [
      /^server\/routes\/(maps|public)\.js$/,
      /^server\/lib\/security\.js$/,
      /^src\/pages\/(Lottery|MapWorkspace)\.jsx$/,
    ],
    documents: [".ai/systems/群抽与文件.md"],
    checks: ["npm test", "npm run test:integration"],
  },
  {
    name: "数据库与运行配置",
    matches: [/^server\/db\//, /^server\/config\.js$/, /^\.env\.example$/],
    documents: [".ai/operations.md", ".ai/systems/部署与恢复.md"],
    checks: ["npm run ai:docs:build", "npm run test:integration"],
  },
  {
    name: "部署、备份与恢复",
    matches: [
      /^(Dockerfile|docker-compose\.yml|Caddyfile|首次配置\.ps1|启动网站\.bat)$/,
      /^运维\//,
      /^docs\/(部署与运维|上线验收清单)\.md$/,
    ],
    documents: [".ai/operations.md", ".ai/systems/部署与恢复.md"],
    checks: ["npm run check", "npm run audit:prod"],
  },
  {
    name: "前端界面",
    matches: [/^src\//],
    documents: [".ai/architecture.md", ".ai/code_style.md"],
    checks: ["npm run build"],
  },
  {
    name: "自动化测试",
    matches: [/^server\/tests\//],
    documents: [".ai/quality.md", ".ai/security.md"],
    checks: ["npm test", "npm run test:integration"],
  },
];
