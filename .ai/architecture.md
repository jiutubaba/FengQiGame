# 系统架构

更新时间：2026-07-14

## 组件边界

- Web：React 19、React Router 7、Vite 8；所有后台数据通过同源 `/api` 访问。
- API：Express 5；负责认证、授权、输入校验、业务事务、审计和静态前端托管。
- 数据库：PostgreSQL；迁移文件按名称顺序执行，`schema_migrations` 记录已应用版本。
- 文件：元数据在 PostgreSQL，文件内容在 `uploads/` 或生产卷；数据库备份不自动包含上传卷。
- 生产入口：Caddy 终止 HTTPS 并反向代理应用；PostgreSQL 不暴露公网端口。
- 本机原生模式：Node 与本机 PostgreSQL，仅监听 `127.0.0.1:3000`，用于开发和内网验收，不是公网生产方案。

## 身份与流量

```text
浏览器 -> Caddy/同源站点 -> Express -> 会话与地图权限 -> PostgreSQL/上传卷
游戏客户端 -> /api/fq + FQ-Map-Key -> Express API Key 权限 -> 绑定地图与环境 -> PostgreSQL
公开参与者 -> 不可猜测群抽 Token -> 限流公开接口 -> 群抽数据
```

浏览器后台使用 Cookie 会话；游戏客户端不使用后台账号；公开群抽接口不获得后台权限。前端菜单显隐只改善体验，服务端中间件才是授权边界。

## 数据分区

- 地图是核心租户边界，业务查询不得跨越请求已授权的 `map_id`。
- 运行数据按 `release`、`lobby`、`test` 三个环境隔离；API Key 创建时固定环境，客户端请求体不能覆盖。
- 地图定义、礼物定义等少数配置按源码查询语义决定是否跨环境共享；不能仅凭字段直觉新增 `environment`。
- 地图归档保留历史数据但退出活跃列表；管理员永久删除会清除当前数据库中的地图及全部关联数据和当前上传卷目录，但保留审计记录与既有备份。
- 运行数据清理只清理明确列出的运行表，不删除地图、配置或文件定义。

## 关键实现入口

- 前端路由：`src/App.jsx`；后台壳层和功能权限菜单：`src/components/AppShell.jsx`。
- 地图工作台：`src/pages/MapWorkspace.jsx`；地图管理和大部分运营接口：`server/routes/maps.js`。
- 游戏客户端协议：`server/routes/game.js`；认证授权：`server/middleware/auth.js`。
- 迁移：`server/db/migrations/`；启动装配：`server/app.js`、`server/index.js`。

具体路由、权限、迁移和环境变量清单见 `.ai/generated/code-facts.md`，不要在本文件复制易漂移的枚举。
