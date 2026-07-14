# 自动生成代码事实

> 由 `npm run ai:docs:build` 确定性生成，禁止手工修改。

- 项目：`fengqi-game-admin`
- 版本：`1.0.0`
- API 路由：85
- 地图权限：15
- 客户端权限：8
- 数据库迁移：3

## 地图权限

| 常量 | 权限值 |
| --- | --- |
| `MAP_VIEW` | `map.view` |
| `MAP_EDIT` | `map.edit` |
| `METRICS_VIEW` | `metrics.view` |
| `PLAYERS_VIEW` | `players.view` |
| `PLAYERS_MANAGE` | `players.manage` |
| `LEADERBOARDS_VIEW` | `leaderboards.view` |
| `LEADERBOARDS_MANAGE` | `leaderboards.manage` |
| `RISK_VIEW` | `risk.view` |
| `RISK_MANAGE` | `risk.manage` |
| `GIFTS_MANAGE` | `gifts.manage` |
| `ANCHORS_MANAGE` | `anchors.manage` |
| `POINTS_MANAGE` | `points.manage` |
| `LOGS_VIEW` | `logs.view` |
| `FILES_MANAGE` | `files.manage` |
| `API_KEYS_MANAGE` | `api_keys.manage` |

## 游戏客户端权限

- `game.gifts.read`
- `game.leaderboards.write`
- `game.logs.write`
- `game.messages.read`
- `game.metrics.write`
- `game.players.write`
- `game.points.write`
- `game.risk.write`

## API 路由

| 方法 | 路径 | 守门 | 来源 |
| --- | --- | --- | --- |
| GET | `/api/admin/permissions` | requireAdmin, requireAuth | `server/routes/admin.js` |
| GET | `/api/admin/settings` | requireAdmin, requireAuth | `server/routes/admin.js` |
| PUT | `/api/admin/settings` | requireAdmin, requireAuth | `server/routes/admin.js` |
| GET | `/api/admin/users` | requireAdmin, requireAuth | `server/routes/admin.js` |
| POST | `/api/admin/users` | requireAdmin, requireAuth | `server/routes/admin.js` |
| PATCH | `/api/admin/users/:userId` | requireAdmin, requireAuth | `server/routes/admin.js` |
| GET | `/api/admin/users/:userId/maps` | requireAdmin, requireAuth | `server/routes/admin.js` |
| PUT | `/api/admin/users/:userId/maps/:mapId` | requireAdmin, requireAuth | `server/routes/admin.js` |
| POST | `/api/admin/users/:userId/password` | requireAdmin, requireAuth | `server/routes/admin.js` |
| POST | `/api/auth/login` | public | `server/routes/auth.js` |
| POST | `/api/auth/logout` | requireAuth | `server/routes/auth.js` |
| GET | `/api/auth/me` | requireAuth | `server/routes/auth.js` |
| POST | `/api/auth/password` | requireAuth | `server/routes/auth.js` |
| PATCH | `/api/auth/profile` | requireAuth | `server/routes/auth.js` |
| POST | `/api/auth/register` | public | `server/routes/auth.js` |
| POST | `/api/game/gifts/:grantId/ack` | api:game.gifts.read, loadApiKey | `server/routes/game.js` |
| POST | `/api/game/leaderboards/:leaderboardKey/entries` | api:game.leaderboards.write, loadApiKey | `server/routes/game.js` |
| POST | `/api/game/logs` | api:game.logs.write, loadApiKey | `server/routes/game.js` |
| POST | `/api/game/messages/:messageId/ack` | api:game.messages.read, loadApiKey | `server/routes/game.js` |
| POST | `/api/game/metrics` | api:game.metrics.write, loadApiKey | `server/routes/game.js` |
| GET | `/api/game/players/:uid/gifts` | api:game.gifts.read, loadApiKey | `server/routes/game.js` |
| GET | `/api/game/players/:uid/messages` | api:game.messages.read, loadApiKey | `server/routes/game.js` |
| POST | `/api/game/players/upsert` | api:game.players.write, loadApiKey | `server/routes/game.js` |
| POST | `/api/game/points/:pointKey/increment` | api:game.points.write, loadApiKey | `server/routes/game.js` |
| POST | `/api/game/risk/events` | api:game.risk.write, loadApiKey | `server/routes/game.js` |
| GET | `/api/maps/` | requireAuth | `server/routes/maps.js` |
| POST | `/api/maps/` | requireAdmin, requireAuth | `server/routes/maps.js` |
| DELETE | `/api/maps/:mapId` | requireAdmin, requireAuth | `server/routes/maps.js` |
| GET | `/api/maps/:mapId` | map:MAP_VIEW | `server/routes/maps.js` |
| PATCH | `/api/maps/:mapId` | map:MAP_EDIT | `server/routes/maps.js` |
| GET | `/api/maps/:mapId/anchors` | map:ANCHORS_MANAGE | `server/routes/maps.js` |
| POST | `/api/maps/:mapId/anchors` | map:ANCHORS_MANAGE | `server/routes/maps.js` |
| DELETE | `/api/maps/:mapId/anchors/:resourceId` | map:ANCHORS_MANAGE | `server/routes/maps.js` |
| PATCH | `/api/maps/:mapId/anchors/:resourceId` | map:ANCHORS_MANAGE | `server/routes/maps.js` |
| GET | `/api/maps/:mapId/api-keys` | map:API_KEYS_MANAGE | `server/routes/maps.js` |
| POST | `/api/maps/:mapId/api-keys` | map:API_KEYS_MANAGE | `server/routes/maps.js` |
| DELETE | `/api/maps/:mapId/api-keys/:keyId` | map:API_KEYS_MANAGE | `server/routes/maps.js` |
| GET | `/api/maps/:mapId/config` | map:MAP_VIEW | `server/routes/maps.js` |
| PUT | `/api/maps/:mapId/config` | map:MAP_EDIT | `server/routes/maps.js` |
| GET | `/api/maps/:mapId/files` | map:FILES_MANAGE | `server/routes/maps.js` |
| DELETE | `/api/maps/:mapId/files/:fileId` | map:FILES_MANAGE | `server/routes/maps.js` |
| GET | `/api/maps/:mapId/files/:fileId/download` | map:FILES_MANAGE | `server/routes/maps.js` |
| POST | `/api/maps/:mapId/files/folder` | map:FILES_MANAGE | `server/routes/maps.js` |
| POST | `/api/maps/:mapId/files/upload` | map:FILES_MANAGE | `server/routes/maps.js` |
| GET | `/api/maps/:mapId/gifts` | map:GIFTS_MANAGE | `server/routes/maps.js` |
| POST | `/api/maps/:mapId/gifts` | map:GIFTS_MANAGE | `server/routes/maps.js` |
| DELETE | `/api/maps/:mapId/gifts/:giftId` | map:GIFTS_MANAGE | `server/routes/maps.js` |
| PATCH | `/api/maps/:mapId/gifts/:giftId` | map:GIFTS_MANAGE | `server/routes/maps.js` |
| POST | `/api/maps/:mapId/gifts/grant` | map:GIFTS_MANAGE | `server/routes/maps.js` |
| GET | `/api/maps/:mapId/leaderboards` | map:LEADERBOARDS_VIEW | `server/routes/maps.js` |
| POST | `/api/maps/:mapId/leaderboards` | map:LEADERBOARDS_MANAGE | `server/routes/maps.js` |
| DELETE | `/api/maps/:mapId/leaderboards/:leaderboardId` | map:LEADERBOARDS_MANAGE | `server/routes/maps.js` |
| PATCH | `/api/maps/:mapId/leaderboards/:leaderboardId` | map:LEADERBOARDS_MANAGE | `server/routes/maps.js` |
| GET | `/api/maps/:mapId/leaderboards/:leaderboardId/entries` | map:LEADERBOARDS_VIEW | `server/routes/maps.js` |
| DELETE | `/api/maps/:mapId/leaderboards/:leaderboardId/entries/:entryId` | map:LEADERBOARDS_MANAGE | `server/routes/maps.js` |
| POST | `/api/maps/:mapId/leaderboards/:leaderboardId/publish` | map:LEADERBOARDS_MANAGE | `server/routes/maps.js` |
| GET | `/api/maps/:mapId/logs` | map:LOGS_VIEW | `server/routes/maps.js` |
| DELETE | `/api/maps/:mapId/logs/:logId` | map:MAP_EDIT | `server/routes/maps.js` |
| GET | `/api/maps/:mapId/lotteries` | map:GIFTS_MANAGE | `server/routes/maps.js` |
| POST | `/api/maps/:mapId/lotteries` | map:GIFTS_MANAGE | `server/routes/maps.js` |
| DELETE | `/api/maps/:mapId/lotteries/:campaignId` | map:GIFTS_MANAGE | `server/routes/maps.js` |
| POST | `/api/maps/:mapId/lotteries/:campaignId/draw` | map:GIFTS_MANAGE | `server/routes/maps.js` |
| GET | `/api/maps/:mapId/messages` | map:PLAYERS_VIEW | `server/routes/maps.js` |
| POST | `/api/maps/:mapId/messages` | map:PLAYERS_MANAGE | `server/routes/maps.js` |
| GET | `/api/maps/:mapId/metrics` | map:METRICS_VIEW | `server/routes/maps.js` |
| GET | `/api/maps/:mapId/players` | map:PLAYERS_VIEW | `server/routes/maps.js` |
| POST | `/api/maps/:mapId/players` | map:PLAYERS_MANAGE | `server/routes/maps.js` |
| DELETE | `/api/maps/:mapId/players/:playerId` | map:PLAYERS_MANAGE | `server/routes/maps.js` |
| PATCH | `/api/maps/:mapId/players/:playerId` | map:PLAYERS_MANAGE | `server/routes/maps.js` |
| GET | `/api/maps/:mapId/points` | map:POINTS_MANAGE | `server/routes/maps.js` |
| POST | `/api/maps/:mapId/points` | map:POINTS_MANAGE | `server/routes/maps.js` |
| DELETE | `/api/maps/:mapId/points/:resourceId` | map:POINTS_MANAGE | `server/routes/maps.js` |
| PATCH | `/api/maps/:mapId/points/:resourceId` | map:POINTS_MANAGE | `server/routes/maps.js` |
| GET | `/api/maps/:mapId/risk/events` | map:RISK_VIEW | `server/routes/maps.js` |
| PATCH | `/api/maps/:mapId/risk/events/:eventId` | map:RISK_MANAGE | `server/routes/maps.js` |
| GET | `/api/maps/:mapId/risk/rules` | map:RISK_VIEW | `server/routes/maps.js` |
| POST | `/api/maps/:mapId/risk/rules` | map:RISK_MANAGE | `server/routes/maps.js` |
| DELETE | `/api/maps/:mapId/risk/rules/:ruleId` | map:RISK_MANAGE | `server/routes/maps.js` |
| PATCH | `/api/maps/:mapId/risk/rules/:ruleId` | map:RISK_MANAGE | `server/routes/maps.js` |
| POST | `/api/maps/:mapId/runtime/clear` | requireAdmin, requireAuth | `server/routes/maps.js` |
| GET | `/api/public/lotteries/:token` | public | `server/routes/public.js` |
| POST | `/api/public/lotteries/:token/entries` | public | `server/routes/public.js` |
| GET | `/api/system/audit` | requireAdmin, requireAuth | `server/routes/system.js` |
| GET | `/api/system/health` | public | `server/routes/system.js` |
| GET | `/api/system/status` | requireAdmin, requireAuth | `server/routes/system.js` |

## 前端路由

- `*`
- `/`
- `/admin/audit`
- `/admin/settings`
- `/admin/users`
- `/docs`
- `/login`
- `/lottery/:token`
- `/maps`
- `/maps/:mapId`
- `/maps/:mapId/:section`
- `/profile`
- `/tools`

## 数据库迁移

| 文件 | 新建表 | 修改表 | SHA-256 |
| --- | --- | --- | --- |
| `server/db/migrations/001_initial.sql` | anchors, api_keys, audit_logs, gift_grants, gifts, map_configs, map_files, map_logs, map_metrics, map_permissions, maps, players, sessions, system_settings, tracking_points, users | — | `5bf35b512a29` |
| `server/db/migrations/002_messages_lotteries.sql` | lottery_campaigns, lottery_entries, player_messages | gift_grants | `4d11a4f69d16` |
| `server/db/migrations/003_leaderboards_risk.sql` | leaderboard_entries, leaderboard_snapshot_entries, leaderboard_snapshots, leaderboards, risk_events, risk_rules | — | `754bde1002a9` |

## 环境变量

- 运行时校验：`ADMIN_DISPLAY_NAME`、`ADMIN_PASSWORD`、`ADMIN_USERNAME`、`COOKIE_SECURE`、`DATABASE_URL`、`LOG_LEVEL`、`NODE_ENV`、`PORT`、`PUBLIC_REGISTRATION`、`SESSION_COOKIE_NAME`、`SESSION_TTL_HOURS`、`TRUST_PROXY`、`UPLOAD_MAX_MB`
- 部署模板：`ADMIN_DISPLAY_NAME`、`ADMIN_PASSWORD`、`ADMIN_USERNAME`、`COOKIE_SECURE`、`DATABASE_URL`、`DEPLOYMENT_MODE`、`LOG_LEVEL`、`NODE_ENV`、`PORT`、`POSTGRES_DB`、`POSTGRES_PASSWORD`、`POSTGRES_USER`、`PUBLIC_REGISTRATION`、`SESSION_COOKIE_NAME`、`SESSION_TTL_HOURS`、`SITE_ADDRESS`、`TRUST_PROXY`、`UPLOAD_MAX_MB`

## 测试入口

### `server/tests/integration/full-chain.test.js`

- HTTP 安全头、跨站请求和非法 JSON 均按生产规则处理
- 管理员登录并创建地图与普通用户
- 普通用户只能访问被授权的地图与功能
- 游戏客户端写入玩家，后台发送消息与礼包，客户端确认领取
- 客户端上报日志和指标并进入后台查询链路
- 地图局部编辑、地图配置和系统设置均能持久化
- 主播和埋点支持增改查，游戏客户端可上报埋点
- 排行榜发布快照、风险事件幂等上报与玩家封禁形成闭环
- 测试服与正式服的数据和凭据严格隔离
- 文件夹、文件上传、列表、下载和级联删除形成闭环
- 公开抽奖支持报名、防重复、开奖与中奖结果公开
- 个人资料、密码更新、退出登录和重新登录均有效
- 管理员运维、审计、清理、凭据停用和地图归档完整生效

### `server/tests/unit/security.test.js`

- 密码哈希可以验证正确密码并拒绝错误密码
- Token 使用随机值并只保存固定长度哈希
- 文件名和相对目录不能保留路径穿越字符

### `server/tests/unit/validation.test.js`

- PATCH 只保留客户端实际提交的字段，不注入 schema 默认值
- POST 会保留 schema 默认值
- 内部异常不向客户端泄露原始错误
- 非法 JSON 返回稳定的 400 错误码

## 审计动作

- `anchors.create`
- `anchors.delete`
- `anchors.update`
- `api_key.create`
- `api_key.disable`
- `auth.login`
- `auth.logout`
- `auth.password_changed`
- `file.delete`
- `file.upload`
- `folder.create`
- `gift.create`
- `gift.delete`
- `gift.grant`
- `gift.update`
- `leaderboard.create`
- `leaderboard.delete`
- `leaderboard.entry.delete`
- `leaderboard.publish`
- `leaderboard.update`
- `log.delete`
- `lottery.cancel`
- `lottery.create`
- `lottery.draw`
- `map.archive`
- `map.config.update`
- `map.create`
- `map.runtime.clear`
- `map.update`
- `player.create`
- `player.delete`
- `player.message.send`
- `player.update`
- `points.create`
- `points.delete`
- `points.update`
- `profile.update`
- `risk_event.resolve`
- `risk_rule.create`
- `risk_rule.delete`
- `risk_rule.update`
- `system.settings.update`
- `user.create`
- `user.map_permissions.update`
- `user.password_reset`
- `user.update`
