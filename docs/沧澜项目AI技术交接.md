# 沧澜项目 AI 技术交接

> 交接日期：2026-07-21
>
> 交接目标：以后以《沧澜》项目的 AI 会话作为主会话，同时维护游戏接入与风起后台；两个仓库仍分别治理、分别验证、分别提交。

## 1. 两个仓库与职责

| 范围 | 本机路径 | 主要职责 |
| --- | --- | --- |
| 《沧澜》地图 | `D:\工作\War3项目\war3project_沧澜\沧澜` | War3/Lua 业务、FQ 客户端适配、地图内存档与投递落地、游戏内验收 |
| 风起后台 | `F:\风起游戏管理后台` | FQ API、PostgreSQL、后台运营功能、权限、部署、备份、监控与正式服务器维护 |

跨仓库工作遵守以下边界：

1. 先读取目标仓库自己的 `AGENTS.md`、`.ai/README.md` 和 `.ai/router.md`，再运行该仓库要求的 context 命令。
2. 源码、数据库迁移和部署配置是最高真值；交接文档只提供入口和最后已验证状态。
3. 两个仓库分别创建分支、运行检查和提交，不把一个仓库的脏改动带入另一个仓库。
4. 《沧澜》工作区在本次交接核对时已有大量未提交改动。后续 AI 必须先看 `git status` 和目标文件 diff，不得 reset、checkout 或覆盖无关改动。
5. 游戏代码不直连 PostgreSQL，只通过 `https://fengqigame.com/api/fq/**` 访问后台。数据库结构、账号、密码和 SQL 不进入地图。
6. 完整 `FQ-Map-Key`、SSH 私钥、管理员密码、数据库密码、OSS/SMTP 凭据、玩家数据与备份不得写入聊天、日志、源码、文档或 Git。

## 2. 开始工作时的读取顺序

### 2.1 在《沧澜》仓库

```powershell
git status --short --branch
Get-Content AGENTS.md
Get-Content .ai/README.md
Get-Content .ai/router.md
python tools/check_ai_docs.py --context scripts/maps/server/init.lua scripts/maps/server/FQHttpClient.lua scripts/maps/server/FQServer.lua --full
```
FQ 接入的必读真值：

- `.ai/systems/FQ服务器交互.md`
- `scripts/maps/server/FQHttpClient.lua`
- `scripts/maps/server/FQServer.lua`
- `scripts/maps/server/init.lua`
- `scripts/maps/init.lua`
- `scripts/maps/server/FQPrivateConfig.example.lua`
- `tools/test_fq_server.lua`

AI 不主动生成或覆盖 `.w3x`，不启动或关闭魔兽；游戏内验证由用户手工执行，AI 根据日志和现象继续诊断。

### 2.2 在风起后台仓库

```powershell
git status --short --branch
Get-Content AGENTS.md
Get-Content .ai/README.md
Get-Content .ai/router.md
npm run ai:context -- docs/沧澜项目AI技术交接.md
```

后台与运维的必读真值：

- `docs/FQ游戏服务器接口技术说明.md`
- `docs/游戏客户端接入.md`
- `docs/部署与运维.md`
- `docs/上线验收清单.md`
- `.ai/systems/客户端协议.md`
- `.ai/systems/部署与恢复.md`
- `.ai/backlog.md`

## 3. 正式环境最后已验证状态

以下状态最后在 2026-07-20 至 2026-07-21 的上线与交接阶段核对；后续维护前应低风险复验，不要把本节当作永久不变的实时监控结果。

- 正式站点：`https://fengqigame.com`
- 健康检查：`https://fengqigame.com/api/system/health`
- ICP 网站备案：`鄂ICP备2024058688号-2`
- ECS：广州 `8.148.249.198`，Ubuntu 24.04，4 vCPU / 8 GiB / 100 GiB / 5 Mbps
- SSH 用户：`ecs-user`；本机身份文件位置为 `C:\Users\Administrator\Desktop\风起游戏后台.pem`
- 正式部署目录：`/opt/fengqigame`
- Compose 服务：`app`、`db`、`caddy`
- 公网入口：只开放 HTTP/HTTPS；HTTP 自动 308 到 HTTPS；SSH 仅管理员固定 `/32`；PostgreSQL 与应用内部端口不对公网开放
- TLS：Caddy 自动申请与续期；最后核对的证书有效期至 2026-10-13
- 正式备份：每天北京时间 03:30，由 systemd timer 生成数据库与上传卷副本，上传武汉私有 OSS，保留 14 天；失败邮件发送到既定 QQ 邮箱
- 备份恢复：已从 OSS 下载最新两类副本并在隔离 Compose 环境完成恢复与健康检查
- 远程仓库：公有 GitHub `https://github.com/jiutubaba/FengQiGame`
- `main` 分支：required checks、严格同步、禁止强推和删除，管理员不能绕过
- 最近归档：PR #9 已合并；合并提交 `ed542807efac5062ae81342fa25021d9c4ed7b87` 的 `main` CI 运行 `29778462265` 成功

常用只读检查：

```bash
cd /opt/fengqigame
docker compose ps
docker compose logs --tail 200 app
systemctl list-timers fengqigame-backup.timer
curl -fsS https://fengqigame.com/api/system/health
```

不要在没有新备份和回滚路径时更新生产；不要执行 `docker compose down -v`。

## 4. FQ 后台与《沧澜》接入现状

### 4.1 后台已完成

- 正式数据库已创建地图“沧澜”，地图 ID 为 `1`，默认环境为 `release`。
- `release`、`lobby`、`test` 三套 Key 均已创建并启用，完整 Token 不在仓库中保存。
- 三套 Key 当前只授予：`game.players.write`、`game.archives.read`、`game.archives.write`。
- 已通过正式域名完成三环境鉴权、玩家 upsert、玩家存档首次保存、相同请求幂等重放、requestId 复用拦截、旧 revision 冲突、最小权限拒绝和同 UID 环境隔离。
- 冒烟数据已精确清理，正式库测试残留为 0；服务器临时 Key 文件和冒烟脚本已删除。
- 玩家与全局存档使用完整 JSON 快照、独立 revision 和 `FQ-` requestId；数据库维护始终留在后台侧。

### 4.2 《沧澜》代码已完成

《沧澜》已不再是旧 `/war3/` 接口状态。2026-07-17 的当前源码已经具备：

- 固定 `https://fengqigame.com` 与 `/api/fq/**`
- 自动添加 `FQ-Map-Key`
- bootstrap、玩家/全局完整 JSON 快照与独立 revision
- 相同 requestId 安全重试、409 权威重读、`dataBanned` 封锁
- 消息/礼包先落玩家存档再 ACK
- 10 秒启动门闩、失败后本局 FQ 离线开局且不热恢复
- 旧 `Server*` Lua 调用面的兼容包装
- `tools/test_fq_server.lua` 14 项纯 Lua 自检

本次只读核对发现：`scripts/maps/server/FQPrivateConfig.lua` 当前不存在，只有被 Git 跟踪的模板。真实 Key 尚未落入本机构建私有配置，因此不能把“代码实现”和“真实游戏已联通”混为一谈。

### 4.3 当前联调阻塞项

1. 《沧澜》启动链会主动读取消息和礼包，但现有三套 Key 缺少 `game.messages.read` 与 `game.gifts.read`。若不补权限，请求会被 403 拒绝并令本局进入 FQ 离线模式。只给需要该功能的环境补这两项最小权限，不授予无调用方的日志、指标、风控或排行榜权限。
2. 先复制 `FQPrivateConfig.example.lua` 为被 Git 忽略的 `FQPrivateConfig.lua`，每次构建只写当前环境和对应的一把 Key。不得把三把 Key 同时打进地图。
3. 在 `test` 环境完成真实游戏验收后，再分别验证 `lobby` 与 `release`。不得拿正式玩家 UID 做测试。
4. 正式环境 Key 曾在受控会话画面中明文输入，用户当时选择暂不轮换。它未写入 Git 或文档，但正式地图对外分发前应停用旧 Key、创建新 Key，并只把新 Key 写入私有构建配置。

## 5. 游戏侧实际验收顺序

1. 运行《沧澜》的 14 项纯 Lua FQ 自检和 Lua 语法检查。
2. 为 `test` Key 补齐消息/礼包读取权限；创建本地私有配置，不提交。
3. 单人新档：确认 bootstrap 返回 revision `0` 和空对象，玩家资料 upsert 成功。
4. 保存与重进：写入玩家和全局完整快照，确认 revision 更新，重新开局后读取一致。
5. 幂等与冲突：同一请求重发不重复写；同 ID 改内容和旧 revision 都被 409 拒绝并触发权威重读。
6. 封禁：`dataBanned` 玩家不导入旧值、不能保存，且不会被错误当作商城封禁。
7. 消息/礼包：投递只在游戏内落档成功后 ACK；重复 pending 不重复发放；布尔与数量礼包都正确。
8. 多人：验证 1～4 人 UID 映射、同步分段和同标签长消息交错，不串玩家、不串环境。
9. 故障：缺配置、域名不可达和服务不回包时，立即或 10 秒后只提示一次并正常离线开局；迟到响应不热恢复，本局写入被拒绝。
10. `test` 全部通过后再构建 `lobby`，最后构建 `release`；每个构建只携带本环境 Key。

未实际运行地图时，结论必须写“已修改，未测试”，不能宣称正式游戏接入完成。

## 6. 后台发布与运维闭环

### 6.1 代码改动

1. 从最新 `origin/main` 创建 `codex/*` 分支。
2. 只修改当前任务文件，保护工作区已有改动。
3. 运行：

```powershell
npm run ai:docs:check
npm run check
npm run audit:prod
```

4. 涉及数据库时，只允许使用显式隔离的本机 PostgreSQL 运行 `npm run test:integration`。
5. 检查 diff 中不存在完整 Key、密码、生产玩家数据或备份内容。
6. 提交并推送分支，等待 required checks 成功后合并 Pull Request。

### 6.2 生产更新

1. 先生成并核对数据库、上传卷两类备份。
2. 记录当前 Git 提交、镜像 ID、容器状态和健康结果。
3. 更新代码或镜像，只重建需要变化的服务。
4. 核对 Compose、迁移、容器健康、HTTPS、登录和目标业务接口。
5. 用专用测试数据做最小冒烟并精确清理；不得打印凭据或正式玩家数据。
6. 失败时按 `docs/部署与运维.md` 和 `docs/上线验收清单.md` 回滚。

## 7. 仍未完成的事项

| 优先级 | 事项 | 完成条件 |
| --- | --- | --- |
| P0 | FQ Key 与《沧澜》权限闭环 | `test` Key 补消息/礼包读取权限；正式发版前轮换曾暴露的 `release` Key；私有配置不进 Git |
| P0 | 《沧澜》真实客户端验收 | 本文第 5 节全部通过，并把结果归档到《沧澜》`.ai` 文档 |
| P0 | 公安联网备案与页脚公示 | 审核通过后在公共页脚展示公安备案号并链接公安查询页 |
| P2 | 后台模块边界评估 | 先形成不改变 API 的拆分方案，再处理过大的地图工作台和地图路由文件 |

## 8. 给后续《沧澜》AI 会话的启动提示词

```text
你现在同时负责《沧澜》游戏接入和风起后台维护，但两个仓库必须分别治理、分别验证、分别提交。

游戏仓库：D:\工作\War3项目\war3project_沧澜\沧澜
后台仓库：F:\风起游戏管理后台

开始前：
1. 在每个准备修改的仓库先读 AGENTS.md、.ai/README.md、.ai/router.md，并运行各自的 context 命令。
2. 先看 git status 和目标文件 diff，保护所有已有未提交改动，不得 reset 或覆盖无关文件。
3. 先完整读取 F:\风起游戏管理后台\docs\沧澜项目AI技术交接.md；FQ 协议真值见 docs\FQ游戏服务器接口技术说明.md。
4. 《沧澜》FQ 适配已经存在于 scripts/maps/server/FQHttpClient.lua、FQServer.lua、init.lua；不要重新发明适配层。当前任务重点是真实 test 环境权限、私有配置和游戏内验收。
5. 游戏只通过 https://fengqigame.com/api/fq/** 和 FQ-Map-Key 访问，不直连数据库。任何完整 Key、密码、私钥、玩家数据和备份都不得进入聊天、日志、源码、文档或 Git。
6. 未实际运行地图时必须明确“已修改，未测试”；AI 不主动构建/覆盖 .w3x 或启动/关闭魔兽。
7. 后台改动完成后运行 npm run ai:docs:check、npm run check、npm run audit:prod；数据库测试只连接隔离本机库。生产变更必须先备份、再变更、再健康检查和最小冒烟，并保留回滚路径。

先只读核对两个仓库与交接文档，列出当前真实状态、与文档的漂移、下一项最小安全工作；取得足够源码证据后再实施。
```
