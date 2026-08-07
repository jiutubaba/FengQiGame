---
name: publish-fq-admin
description: 安全发布风起游戏 FQ 管理后台到正式环境。Use when the user says“发布 FQ 后台”“部署 FQ”“正式发布”“生产部署”“更新线上后台”，或要求完成 FQ 后台的生产备份、发布、回滚准备与上线验收。仅适用于本仓库及其既有广州正式 ECS；不用于地图包发布、其他项目、其他服务器、数据库恢复、数据删除或基础设施变更。
---

# 发布 FQ 后台

把发布作为“代码门禁、双备份、app-only 更新、生产验收、归档”闭环执行。复用仓库既有工具，不保存或输出凭据。

## 固定边界

- 完整读取仓库 `AGENTS.md`、`.ai/README.md`、`.ai/router.md`，运行 `npm run ai:context -- 运维/调用阿里云云助手.ps1`。
- 只操作本仓库、阿里云 CLI OAuth 配置 `fq-production` 和实例 `i-7xvdufe80gxzqw3oowvo`。使用 `运维/调用阿里云云助手.ps1` 执行远程命令。
- 不得读取、输出、复制、提交或记录 OAuth Token、API Key、密码、`.env`、生产玩家数据或备份内容。
- 普通发布只替换 `app`；不得改变 PostgreSQL、上传卷、Caddy、`.env`、安全组、RAM、ECS 生命周期或 DNS。
- 数据库恢复、数据/卷删除、资源销毁、凭据轮换、地图包和跨项目发布不属于本技能，必须按对应危险操作规则另行处理。

## 1. 确定发布版本

1. 检查分支、工作区、`origin/main` 和最近提交，保护既有改动。
2. 只发布已进入 `main` 且 required checks 成功的提交。未合并时先完成 `codex/*` 分支、检查、提交、PR、CI、合并和本地同步。
3. 记录目标完整提交、生产 `.release-commit`、app 镜像、Compose 状态、云助手 Agent、备份 timer 和磁盘余量。
4. 目标提交与生产一致时停止重复部署，只报告“线上已是目标版本”。

## 2. 执行发布前门禁

1. 路由、权限、迁移、环境变量或测试入口变化时运行 `npm run ai:docs:build`。
2. 运行 `npm run check`、`npm run audit:prod`、`npm run ai:docs:check`，并核对目标提交的 GitHub required checks。
3. 涉及数据库时确认隔离 PostgreSQL 集成测试成功，禁止连接正式库运行测试。
4. 从干净目标提交重新生成 `dist`；不得复用来源不明的旧构建。
5. 用 `git archive` 生成源码包，用新鲜 `dist` 生成前端包并记录 SHA-256。不得包含 `.env`、`backups/`、`uploads/`、`.runtime/` 或其他未跟踪文件。
6. 上传到 `deploy-<短提交>` GitHub 非正式发布，保留 URL 与哈希作为审计证据。

## 3. 备份并部署

1. 通过云助手重新核对实例、部署目录和当前状态，不基于猜测继续。
2. 启动正式备份任务，等待数据库与上传卷备份都成功；核对非空文件、私有 OSS 和 CRC64。任一失败都停止。
3. 服务器下载两个载荷并校验 SHA-256；不匹配时停止。
4. 在 `/opt/fengqigame/.runtime/` 保留旧源码，为旧 app 镜像创建唯一回滚标签，并在远程脚本设置失败自动回滚。
5. 使用旧生产镜像的既有依赖层构建目标 app：移除镜像内旧 `server`、`dist` 后复制目标 `server` 和新鲜 `dist`。
6. 同步源码时排除 `.env`、`backups/`、`uploads/`、`.runtime/`；只重新创建 `app` 并等待健康。
7. 失败时恢复旧源码和镜像，重新拉起旧 app 并核对健康；不得带病继续。

## 4. 生产验收

至少取得：

- `.release-commit` 等于目标短提交，镜像 revision 等于完整提交。
- 新迁移已登记，目标表或字段存在；只读查询不得返回生产业务数据。
- `app`、`db` healthy，`caddy` running，备份 timer active。
- 容器内健康成功；公网 HTTP→HTTPS、HTTPS 200、`www` 保留 URI 跳转和安全响应头正确。
- `/api/fq` 缺少 `FQ-Map-Key` 时返回 401 与预期错误码，不用真实 Key 做无必要写入。
- 首页 JS/CSS 属于本次新鲜构建。

影响可用性或核心合约的验收失败立即回滚。不得把本地检查、静态检查或单个健康接口包装成完整生产验收。

## 5. 归档与交付

1. 同步 `docs/部署与运维.md`、`docs/上线验收清单.md`、`.ai/systems/部署与恢复.md` 的真实发布、备份、镜像、回滚和验收事实。
2. 更新 `.ai/sessions.md`，新增或合并本次重要任务并只保留最近 5 条；状态变化时同步 `.ai/backlog.md`。
3. 刷新并检查 AI 文档，运行 `npm run check`、`npm run audit:prod`、`git diff --check`。
4. 归档与技能改动走独立 PR 和 required checks；纯文档/技能提交不重复部署 app。
5. 报告目标提交、生产版本、备份、镜像、回滚证据、健康结果、PR/CI 和剩余人工边界。

## 失败与权限

- 项目长期授权允许直接完成既定范围内的备份、发布、验收和必要回滚；平台审批仍需正常通过。
- OAuth 失效时只请求浏览器重新授权，不请求密码或长期 AccessKey。
- 云助手不可用时停止；除非用户当次明确要求应急 SSH，否则不扩大 SSH 来源。
- 同一失败连续两次时暂停，复核目标、权限、载荷和服务器状态后报告。
