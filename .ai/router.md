# 源码上下文路由

先运行 `npm run ai:context -- <源码路径>`。下表是人工可读路由；工具输出是执行入口，系统文档说明稳定约束。

| 源码范围                                                                                                     | 必读系统文档                                      | 重点验证                                                  |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- | --------------------------------------------------------- |
| `server/middleware/**`、`server/routes/auth.js`、`server/routes/admin.js`、`src/auth/**`、`src/pages/Admin*` | `systems/账号与权限.md`、`security.md`            | 会话失效、管理员边界、地图最小权限、审计                  |
| `server/routes/maps.js`、`src/pages/MapCenter.jsx`、地图配置与环境切换                                       | `systems/地图与环境.md`                           | `map_id + environment` 隔离、归档、永久删除、运行数据清理 |
| `server/routes/game.js`、API Key 页面、客户端接入                                                            | `systems/客户端协议.md`、`systems/账号与权限.md`  | Key 绑定、权限、幂等、ACK、错误格式                       |
| 玩家、消息、礼包、主播、埋点、日志相关代码                                                                   | `systems/玩家与运营内容.md`                       | 环境隔离、发放/送达语义、审计                             |
| 排行榜、风险规则和风险事件相关代码                                                                           | `systems/排行榜与风控.md`                         | 快照不可变、事件幂等、封禁联动                            |
| 群抽、公开接口、上传下载相关代码                                                                             | `systems/群抽与文件.md`                           | 公开 Token、重复报名、路径与扩展名安全                    |
| `server/db/**`、`server/config.js`、`.env.example`                                                           | `architecture.md`、`security.md`、`operations.md` | 迁移顺序、配置校验、敏感值、恢复兼容性                    |
| `Dockerfile`、`docker-compose.yml`、`Caddyfile`、`首次配置.ps1`、`启动网站.bat`、`运维/**`                   | `systems/部署与恢复.md`、`operations.md`          | HTTPS、端口、卷、备份恢复、原生模式边界                   |
| `src/**` 通用界面、路由和样式                                                                                | `architecture.md`、`code_style.md`、`quality.md`  | 前端授权仅作展示、响应式、真实 API 状态                   |
| `server/tests/**`、测试配置                                                                                  | `quality.md`、`security.md`                       | 正式库门禁、测试隔离、行为覆盖                            |

所有任务默认还要阅读 `architecture.md`、`code_style.md`、`security.md` 和 `quality.md`。`server/routes/maps.js` 与 `src/pages/MapWorkspace.jsx` 当前承载多个业务域，修改局部功能时仍需读取该功能对应的系统文档。
