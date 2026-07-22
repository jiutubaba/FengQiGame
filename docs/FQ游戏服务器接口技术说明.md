# FQ 游戏服务器接口技术说明

文档版本：1.0

协议更新时间：2026-07-20

适用对象：War3 地图服务器框架、游戏服务端适配层和其它受信任的游戏运行环境

## 1. 接入范围

FQ 接口是游戏项目读写风起游戏后台数据的唯一正式通道：

```text
游戏框架 -> HTTPS /api/fq -> 风起游戏后台 -> PostgreSQL
```

游戏项目不得直连 PostgreSQL，不需要也不应持有数据库用户名、数据库密码、表名或 SQL。游戏侧只需要：

- 一个可用的 `FQ_BASE_URL`；
- 一把绑定地图、环境和最小权限的 `FQ-Map-Key`；
- 玩家 UID；
- JSON 请求与响应处理；
- 存档 revision 和 requestId 状态。

正式目标地址：

```text
https://fengqigame.com
```

ICP 网站备案、公网 DNS 与 HTTPS 验收均已通过，正式接入统一使用上述域名。不要把 ECS 公网 IP 硬编码为正式地址，因为 HTTPS 证书和 Host 都绑定正式域名。

正式后台已创建地图“沧澜”以及绑定 `release`、`lobby`、`test` 的三套最小权限 Key。2026-07-20 正式域名冒烟已验证三环境鉴权、玩家写入、玩家存档 revision、幂等、冲突保护、权限边界和同 UID 隔离；测试数据与临时凭据已全部清理。实际游戏项目仍须先在 `test` 环境完成字段映射、全局存档、封禁、消息和礼包链路验收，再逐步启用 `lobby` 与 `release`。

## 2. 协议总则

### 2.1 请求头

所有 FQ 接口必须使用 HTTPS，并携带：

```http
FQ-Map-Key: fqmap_完整Token
Content-Type: application/json
Accept: application/json
```

`FQ-Map-Key` 绑定：

- 一张地图；
- 一个环境；
- 一组 `game.*` 权限。

环境只允许：

| 环境值    | 用途       |
| --------- | ---------- |
| `release` | 正式服     |
| `lobby`   | 测试大厅服 |
| `test`    | 测试服     |

请求体不得自行提交 `mapId` 或 `environment`。服务端始终以 Key 的绑定范围为准，因此同一个 UID 在三个环境中互不覆盖。

完整 Token 只在后台创建 Key 时返回一次，服务端只保存 Token 哈希。游戏日志、报错截图和埋点中不得记录完整 Token。

War3 地图包可能被反编译或提取字符串，因此必须把 Key 的破坏半径限制在单张地图、单个环境和实际所需权限内。发现泄漏后应立即在后台停用旧 Key 并创建新 Key。

### 2.2 成功响应

通常返回：

```json
{
  "success": true,
  "data": {}
}
```

少量只表示完成的接口返回：

```json
{
  "success": true
}
```

### 2.3 失败响应

统一格式：

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "可读错误信息",
    "details": {}
  },
  "requestId": "服务端请求追踪 ID"
}
```

`details` 只在部分错误中出现。响应头也包含 `X-Request-Id`。游戏侧应记录状态码、`error.code` 和 `requestId`，但不要记录完整 Key、完整存档或玩家敏感资料。

### 2.4 通用数据规则

- 请求和响应使用 UTF-8 JSON。
- URL 中的 UID、Key 和 ID 必须进行 URL 编码。
- PostgreSQL BIGINT 字段可能以 JSON 字符串返回；消息 ID 应按不透明字符串处理。礼包资格 `value` 固定返回 JSON 数字。
- 可能超过 JavaScript 安全整数范围的游戏数值，应在存档 JSON 中使用字符串。
- 时间字段使用 ISO 8601，例如 `2026-07-16T09:45:02.951Z`。

## 3. 权限与接口清单

| 权限                      | 方法 | 路径                                                | 说明                         |
| ------------------------- | ---- | --------------------------------------------------- | ---------------------------- |
| `game.archives.read`      | POST | `/api/fq/bootstrap`                                 | 批量读取玩家与全局存档       |
| `game.archives.read`      | GET  | `/api/fq/archives/players/:uid`                     | 读取单个玩家存档             |
| `game.archives.read`      | GET  | `/api/fq/archives/global`                           | 读取当前地图环境的全局存档   |
| `game.archives.write`     | POST | `/api/fq/archives/players/:uid/save`                | 保存完整玩家存档             |
| `game.archives.write`     | POST | `/api/fq/archives/global/save`                      | 保存完整全局存档             |
| `game.players.write`      | POST | `/api/fq/players/upsert`                            | 批量新增或更新玩家           |
| `game.logs.write`         | POST | `/api/fq/logs`                                      | 上报并聚合运行日志           |
| `game.metrics.write`      | POST | `/api/fq/metrics`                                   | 按日期更新地图指标           |
| `game.points.write`       | POST | `/api/fq/points/:pointKey/increment`                | 增加已启用埋点的次数         |
| `game.leaderboards.read`  | POST | `/api/fq/leaderboards/:leaderboardKey/query`        | 读取最新发布快照与采集状态   |
| `game.leaderboards.write` | POST | `/api/fq/leaderboards/:leaderboardKey/entries`      | 批量提交每日首次样本         |
| `game.risk.write`         | POST | `/api/fq/risk/events`                               | 幂等上报风险事件             |
| `game.messages.read` + `game.gifts.read` | POST | `/api/fq/deliveries/query`             | 批量拉取待送达消息与当前礼包资格 |
| `game.messages.read`      | POST | `/api/fq/messages/:messageId/ack`                   | 确认消息已写入游戏           |

至少为 `release`、`lobby`、`test` 分别创建不同 Key。每把 Key 只授予实际使用的权限；不应为了方便默认勾选全部权限。

## 4. 存档接口

### 4.1 开局批量读取

```http
POST /api/fq/bootstrap
```

权限：

```text
game.archives.read
```

请求：

```json
{
  "uids": ["player-001", "player-002"],
  "includeGlobal": true
}
```

约束：

- `uids` 至少 1 个、最多 24 个；
- 每个 UID 长度 1–128；
- 重复 UID 会自动去重；
- `includeGlobal` 可省略，默认 `true`。

响应：

```json
{
  "success": true,
  "data": {
    "mapId": 1,
    "environment": "release",
    "players": [
      {
        "uid": "player-001",
        "dataBanned": false,
        "revision": 3,
        "values": {
          "gold": 100,
          "inventory": ["sword"]
        },
        "updatedAt": "2026-07-16T09:45:02.951Z"
      },
      {
        "uid": "player-002",
        "dataBanned": false,
        "revision": 0,
        "values": {},
        "updatedAt": null
      }
    ],
    "global": {
      "revision": 2,
      "values": {
        "season": 1,
        "serverOpen": true
      },
      "updatedAt": "2026-07-16T09:40:00.000Z"
    }
  }
}
```

未保存过的存档返回：

```json
{
  "revision": 0,
  "values": {},
  "updatedAt": null
}
```

如果玩家被后台标记为存档封禁，批量读取不会泄露原存档：

```json
{
  "uid": "player-001",
  "dataBanned": true,
  "revision": 0,
  "values": {},
  "updatedAt": null
}
```

### 4.2 读取单个玩家存档

```http
GET /api/fq/archives/players/:uid
```

权限：

```text
game.archives.read
```

成功响应：

```json
{
  "success": true,
  "data": {
    "uid": "player-001",
    "dataBanned": false,
    "revision": 3,
    "values": {
      "gold": 100
    },
    "updatedAt": "2026-07-16T09:45:02.951Z"
  }
}
```

被存档封禁时返回：

```text
403 FQ_ARCHIVE_BANNED
```

### 4.3 读取全局存档

```http
GET /api/fq/archives/global
```

权限：

```text
game.archives.read
```

响应：

```json
{
  "success": true,
  "data": {
    "revision": 2,
    "values": {
      "season": 1
    },
    "updatedAt": "2026-07-16T09:40:00.000Z"
  }
}
```

### 4.4 保存玩家存档

```http
POST /api/fq/archives/players/:uid/save
```

权限：

```text
game.archives.write
```

请求：

```json
{
  "requestId": "FQ-release-player-001-20260716-000001",
  "expectedRevision": 3,
  "values": {
    "gold": 120,
    "inventory": ["sword", "shield"],
    "progress": {
      "chapter": 2
    }
  }
}
```

成功响应：

```json
{
  "success": true,
  "data": {
    "requestId": "FQ-release-player-001-20260716-000001",
    "replayed": false,
    "archive": {
      "uid": "player-001",
      "dataBanned": false,
      "revision": 4,
      "values": {
        "gold": 120,
        "inventory": ["sword", "shield"],
        "progress": {
          "chapter": 2
        }
      },
      "updatedAt": "2026-07-16T09:50:00.000Z"
    }
  }
}
```

相同请求的安全重放：

```json
{
  "success": true,
  "data": {
    "requestId": "FQ-release-player-001-20260716-000001",
    "replayed": true,
    "archive": {
      "uid": "player-001",
      "dataBanned": false,
      "revision": 4,
      "values": {
        "gold": 120
      },
      "updatedAt": "2026-07-16T09:50:00.000Z"
    }
  }
}
```

### 4.5 保存全局存档

```http
POST /api/fq/archives/global/save
```

权限：

```text
game.archives.write
```

请求和玩家保存相同，但没有 UID：

```json
{
  "requestId": "FQ-release-global-20260716-000001",
  "expectedRevision": 2,
  "values": {
    "season": 2,
    "serverOpen": true
  }
}
```

响应中的 `archive` 不包含 `uid` 和 `dataBanned`：

```json
{
  "success": true,
  "data": {
    "requestId": "FQ-release-global-20260716-000001",
    "replayed": false,
    "archive": {
      "revision": 3,
      "values": {
        "season": 2,
        "serverOpen": true
      },
      "updatedAt": "2026-07-16T09:50:00.000Z"
    }
  }
}
```

### 4.6 存档保存规则

`values` 是完整快照，不是局部补丁。服务端保存时会用新 `values` 整体替换旧对象。

约束：

- `values` 顶层必须是 JSON 对象；
- 顶层字段名长度 1–128；
- 单份玩家或全局存档序列化后不得超过 512 KiB；
- `expectedRevision` 必须是 0 以上安全整数；
- 首次保存使用 `expectedRevision: 0`；
- 保存成功后使用响应中的新 revision 覆盖本地 revision。

`requestId` 约束：

- 必须以 `FQ-` 开头；
- 总长度 4–128；
- 只能包含字母、数字、点、下划线、冒号和连字符；
- 同一次逻辑保存及其网络重试必须使用同一个 `requestId` 和完全相同的内容；
- 不同逻辑保存必须生成新的 `requestId`。

推荐格式：

```text
FQ-<environment>-<server/session>-<uid/global>-<counter>
```

例如：

```text
FQ-release-room-889-player-001-17
```

并发或重试错误：

| 状态 | 错误码                         | 处理方式                               |
| ---- | ------------------------------ | -------------------------------------- |
| 409  | `FQ_ARCHIVE_REVISION_CONFLICT` | 重新读取最新存档，合并业务变化后再保存 |
| 409  | `FQ_REQUEST_REUSED`            | 生成新 requestId；排查错误复用了旧 ID  |
| 403  | `FQ_ARCHIVE_BANNED`            | 停止读写该玩家存档，交由后台处理       |

版本冲突会返回当前服务端版本：

```json
{
  "success": false,
  "error": {
    "code": "FQ_ARCHIVE_REVISION_CONFLICT",
    "message": "存档版本已变化，请重新读取后再保存",
    "details": {
      "currentRevision": 4
    }
  },
  "requestId": "服务端追踪 ID"
}
```

## 5. 玩家上报

```http
POST /api/fq/players/upsert
```

权限：

```text
game.players.write
```

请求：

```json
{
  "players": [
    {
      "uid": "player-001",
      "name": "玩家名称",
      "level": 25,
      "gameLevel": "N2",
      "profile": {
        "platform": "kk",
        "hero": "H001"
      }
    }
  ]
}
```

约束：

- `players`：1–24 项，同一批不得出现重复 UID；
- `uid`：1–128；
- `name`：1–160；
- `level`：0–1,000,000，默认 0；
- `gameLevel`：最多 32，默认空字符串；
- `profile`：JSON 对象，默认空对象。

该接口在一个事务中按地图、环境、UID 批量 upsert，并刷新最后活跃时间。

响应：

```json
{
  "success": true,
  "data": {
    "players": [
      {
        "id": "123",
        "uid": "player-001",
        "name": "玩家名称",
        "last_active_at": "2026-07-16T09:55:00.000Z"
      }
    ]
  }
}
```

## 6. 日志与指标

### 6.1 日志上报

```http
POST /api/fq/logs
```

权限：

```text
game.logs.write
```

请求：

```json
{
  "context": "[room=889] game completed",
  "playerCount": 10
}
```

约束：

- `context` 长度 1–100,000；
- `playerCount` 为 0 以上整数，默认 1。

同一地图、环境和完全相同的 `context` 会聚合为一条记录：

- `player_count` 保留历史最大值；
- `upload_count` 每次请求加一。

响应：

```json
{
  "success": true,
  "data": {
    "id": "8",
    "player_count": "10",
    "upload_count": "3",
    "updated_at": "2026-07-16T10:00:00.000Z"
  }
}
```

### 6.2 指标上报

```http
POST /api/fq/metrics
```

权限：

```text
game.metrics.write
```

请求：

```json
{
  "date": "2026-07-16",
  "cumulativeUsers": 1200,
  "onlineUsers": 35,
  "totalGameCount": 8190,
  "dailyNewUsers": 42,
  "dailyActiveUsers": 310,
  "lostUserCount": 70,
  "returnUserCount": 18,
  "activeUserRetentionRate": 31.5,
  "newUserRetentionRate": 22.4,
  "sevenDayRetentionRate": 14.8,
  "replayRate": 8.1
}
```

规则：

- `date` 格式为 `YYYY-MM-DD`，省略时使用服务端当天日期；
- 人数和局数均为 0 以上整数，省略时为 0；
- 比率范围为 0–100，省略时为 0；
- 同一地图、环境和日期再次提交会整体更新当天指标。

响应：

```json
{
  "success": true
}
```

## 7. 埋点

```http
POST /api/fq/points/:pointKey/increment
```

权限：

```text
game.points.write
```

后台必须先在当前地图环境创建并启用对应 `pointKey`。

请求：

```json
{
  "amount": 3
}
```

`amount` 为 1–1,000,000 的整数，默认 1。

响应：

```json
{
  "success": true,
  "data": {
    "id": "5",
    "point_key": "game_start",
    "trigger_count": "103"
  }
}
```

不存在或停用时：

```text
404 POINT_NOT_FOUND
```

该接口是累加操作，不具备 requestId 幂等保护，不得在结果不确定时盲目自动重试。

## 8. 排行榜

所有榜单只采集每名玩家在 FQ 服务器北京时间自然日内的首次提交。后台创建榜单时仍需选择该每日样本如何更新候选池：

- `latest`：当日首次样本覆盖分数、附属字段和达成时间；
- `best`：当日首次样本严格优于当前记录时才覆盖分数、附属字段和达成时间。升序榜数值更小为更优，降序榜数值更大为更优。

### 8.1 读取榜单

```http
POST /api/fq/leaderboards/:leaderboardKey/query
```

权限：

```text
game.leaderboards.read
```

请求：

```json
{
  "uids": ["player-001", "player-002"],
  "limit": 100
}
```

- `uids` 可省略，最多 24 个；
- `limit` 可省略，范围 1–100，默认 100；
- 只返回最新人工发布快照；`published=false` 时 `entries/playerRanks` 为空，不回退实时候选池；
- `playerRanks` 只包含指定 UID 中位于已发布前 100 名的玩家，榜外玩家不返回实时名次；
- `publishedAt/publishedAtText` 是游戏展示的更新时间，`collectionDate` 是当前北京时间日期；
- `submittedTodayUids` 返回请求 UID 中今日已经成功采集的玩家，供客户端跳过写请求；
- 条目包含 `rank`、`uid`、`name`、`gameLevel`、`score`、`gameCount`、`metadata`、`achievedAt` 与北京时间展示字段 `achievedAtText`；
- 当前封禁只影响候选池和后续新快照，已经发布的历史快照不被回写。

### 8.2 上报条目

```http
POST /api/fq/leaderboards/:leaderboardKey/entries
```

权限：

```text
game.leaderboards.write
```

后台必须先在当前地图环境创建并启用榜单。`leaderboardKey` 长度 1–128，只允许字母、数字、点、下划线和连字符。

请求：

```json
{
  "entries": [
    {
      "uid": "player-001",
      "name": "玩家名称",
      "gameLevel": "N2",
      "score": 9900,
      "gameCount": 18,
      "metadata": {
        "season": 3
      }
    }
  ]
}
```

约束：

- 每次 1–500 条；
- 同一批不得出现重复 UID；
- `uid`：1–128；
- `name`：1–160；
- `gameLevel`：最多 64；
- `score`：有限数值，范围 `-1e15` 到 `1e15`；
- `gameCount`：0–1e12 的整数；
- `metadata`：JSON 对象。

同一个榜单中的同一 UID 每个北京时间自然日只接受首次提交。数据库在冲突更新条件中原子判定日期，并发房间同日提交时也只有一个请求生效；失败或结果不确定时可以重试，已经采集的 UID 会进入 `skippedUids`。被后台标记为排行榜封禁的玩家不会进入候选排名和后续新快照；已经发布的历史快照不会被改写。

响应：

```json
{
  "success": true,
  "data": {
    "leaderboardKey": "game_power",
    "collectionDate": "2026-07-21",
    "acceptedUids": ["player-001"],
    "skippedUids": []
  }
}
```

榜单不存在或停用时：

```text
404 LEADERBOARD_NOT_FOUND
```

## 9. 风险事件

```http
POST /api/fq/risk/events
```

权限：

```text
game.risk.write
```

后台必须先在当前地图环境创建并启用 `ruleKey`。

请求：

```json
{
  "eventId": "room-889-risk-000001",
  "ruleKey": "abnormal_power_growth",
  "uid": "player-001",
  "playerName": "玩家名称",
  "count": 3,
  "details": {
    "delta": 8800
  },
  "occurredAt": "2026-07-16T18:30:00+08:00"
}
```

约束：

- `eventId`：1–128，是地图、环境内的幂等键；
- `ruleKey`：1–128；
- `uid`：1–128；
- `playerName`：1–160；
- `count`：1–1,000,000，默认 1；
- `details`：JSON 对象；
- `occurredAt`：带时区的 ISO 8601，可省略。

首次创建返回 HTTP 201：

```json
{
  "success": true,
  "data": {
    "id": "18",
    "event_key": "room-889-risk-000001",
    "status": "open",
    "occurred_at": "2026-07-16T10:30:00.000Z",
    "created": true
  }
}
```

相同 `eventId` 重试返回 HTTP 200，且不会重复创建：

```json
{
  "success": true,
  "data": {
    "id": "18",
    "event_key": "room-889-risk-000001",
    "status": "open",
    "occurred_at": "2026-07-16T10:30:00.000Z",
    "created": false
  }
}
```

同一个 `eventId` 不得用于两个不同事件。规则不存在或停用时返回：

```text
404 RISK_RULE_NOT_FOUND
```

## 10. 消息与礼包批量读取

开局使用一个请求读取最多 24 名玩家的待处理消息与当前礼包资格：

```http
POST /api/fq/deliveries/query
```

权限：同时需要 `game.messages.read` 和 `game.gifts.read`。

```json
{
  "uids": ["player-001", "player-002"]
}
```

每个 UID 最多返回最早的 100 条消息；礼包资格使用该 UID 最近一次玩家资料上报的完整昵称，在同一地图和环境内精确匹配。响应仍按请求 UID 归位，存档封禁只让消息为空，不影响礼包资格：

```json
{
  "success": true,
  "data": {
    "players": [
      {
        "uid": "player-001",
        "messages": [
          {
            "id": "31",
            "subject": "系统补偿",
            "content": "维护补偿内容",
            "attachments": [],
            "created_at": "2026-07-16T10:40:00.000Z"
          }
        ],
        "gifts": [
          {
            "gift_key": "测试10级",
            "name": "测试10级",
            "value": 100
          }
        ]
      }
    ]
  }
}
```

消息必须先幂等写入玩家完整存档，保存成功后 ACK。礼包不按 UID 判断资格，只按完整昵称（如 `酒徒#8023`）精确匹配；同名多 UID 的同一礼包只返回一项并取最大正数值。礼包是当局实时资格快照，只覆盖本局内存值，不写入玩家存档，也没有 ACK 接口；下一局重新查询，`value > 0` 表示激活。《沧澜》只识别现役福利礼包名称，因此用于激活的 `gift_key` 必须与对应礼包名称完全一致。

### 10.1 确认消息

只有附件或内容已成功写入游戏后，才能调用：

```http
POST /api/fq/messages/:messageId/ack
```

请求：

```json
{
  "uid": "player-001"
}
```

响应：

```json
{
  "success": true,
  "data": {
    "id": "31",
    "delivered_at": "2026-07-16T10:41:00.000Z"
  }
}
```

消息不存在、UID 不匹配、环境不匹配或已经 ACK 时：

```text
404 MESSAGE_NOT_FOUND
```

游戏侧必须按 `messageId` 自身幂等，避免因为重复拉取而重复发放附件。

## 11. 礼包资格

礼包由后台维护当前值。设置正数会创建或覆盖资格，设置 `0` 会删除资格；游戏每局通过 `/api/fq/deliveries/query` 按完整昵称读取正数快照。同名多 UID 的同一礼包取最大值，不跨局累计，重复查询也不会改变数值；玩家改名后不会继承旧昵称资格。

## 12. 重试策略

| 接口类型                 | 是否可直接重试 | 要求                                                         |
| ------------------------ | -------------- | ------------------------------------------------------------ |
| GET 读取                 | 是             | 可使用退避重试                                               |
| `bootstrap`              | 是             | 请求体保持不变                                               |
| 玩家/全局存档保存        | 是             | 必须复用同一 requestId、expectedRevision 和 values           |
| 玩家 upsert              | 是             | 相同 UID 和内容可重复提交                                    |
| 指标 upsert              | 是             | 相同日期会覆盖为最新请求值                                   |
| 排行榜批量 upsert        | 是             | 重试时 entries 保持一致                                      |
| 风险事件                 | 是             | 必须复用同一 eventId，且该 ID 只能代表同一事件               |
| 日志上报                 | 否             | 重试会增加 `upload_count`                                    |
| 埋点累加                 | 否             | 重试会重复增加计数                                           |
| 消息 ACK                 | 条件允许       | 本地先按 ID 幂等；不确定时重新拉取 pending，不循环重试 404   |
| 礼包资格读取             | 是             | 每局按完整昵称读取当前快照，不在客户端累计                   |

建议对网络错误和 HTTP 5xx 使用指数退避；对 4xx 不应盲目重试：

- 400：修正 JSON 或字段；
- 401：检查 Key 是否缺失、错误或已停用；
- 403：检查权限或玩家存档封禁；
- 404：检查后台资源、ID、Key 和环境；
- 409：按存档冲突规则重新读取；
- 500：记录 `requestId`，使用安全的端点级重试策略。

## 13. 常见错误码

| HTTP | 错误码                           | 含义                                 |
| ---- | -------------------------------- | ------------------------------------ |
| 400  | `INVALID_JSON`                   | 请求体不是有效 JSON                  |
| 400  | `VALIDATION_ERROR`               | 字段类型、范围或格式不符合要求       |
| 401  | `FQ_MISSING_API_KEY`             | 没有携带 `FQ-Map-Key`                |
| 401  | `FQ_INVALID_API_KEY`             | Key 错误、已停用或不存在             |
| 403  | `FORBIDDEN`                      | Key 缺少接口所需权限                 |
| 403  | `FQ_ARCHIVE_BANNED`              | 玩家存档被后台封禁                   |
| 404  | `POINT_NOT_FOUND`                | 埋点不存在或已停用                   |
| 404  | `LEADERBOARD_NOT_FOUND`          | 榜单不存在或已停用                   |
| 404  | `RISK_RULE_NOT_FOUND`            | 风控规则不存在或已停用               |
| 404  | `MESSAGE_NOT_FOUND`              | 消息不存在、范围不匹配或已经确认     |
| 404  | `GIFT_NOT_FOUND`                 | 礼包不存在、范围不匹配或已经确认     |
| 404  | `API_NOT_FOUND`                  | 路径或 HTTP 方法错误                 |
| 409  | `FQ_ARCHIVE_REVISION_CONFLICT`   | 存档版本冲突                         |
| 409  | `FQ_REQUEST_REUSED`              | 同一存档 requestId 被用于不同内容    |
| 500  | `INTERNAL_ERROR`                 | 服务端内部错误                       |

## 14. curl 联调示例

不要把真实 Key 写入脚本或提交 Git。以下示例使用环境变量。

读取：

```bash
curl -sS \
  -H "FQ-Map-Key: ${FQ_MAP_KEY}" \
  -H "Accept: application/json" \
  "${FQ_BASE_URL}/api/fq/archives/players/player-001"
```

开局批量读取：

```bash
curl -sS \
  -X POST \
  -H "FQ-Map-Key: ${FQ_MAP_KEY}" \
  -H "Content-Type: application/json" \
  --data '{"uids":["player-001","player-002"],"includeGlobal":true}' \
  "${FQ_BASE_URL}/api/fq/bootstrap"
```

保存：

```bash
curl -sS \
  -X POST \
  -H "FQ-Map-Key: ${FQ_MAP_KEY}" \
  -H "Content-Type: application/json" \
  --data '{"requestId":"FQ-test-player-001-1","expectedRevision":0,"values":{"gold":100}}' \
  "${FQ_BASE_URL}/api/fq/archives/players/player-001/save"
```

## 15. 《沧澜》现有 FQ 适配与维护示例

《沧澜》已在 `scripts/maps/server/FQHttpClient.lua`、`FQServer.lua` 与 `init.lua` 中完成独立 FQ 适配：固定正式基址、统一添加 `FQ-Map-Key`、判断 `result.success == true`，并维护 bootstrap、玩家/全局 revision、重试与启动离线门闩。下面的代码保留为协议调用示例，不是待创建的新适配层。

Key 必须由被 Git 忽略的 `FQPrivateConfig.lua` 私有配置提供；每次构建只携带当前 environment 对应的一把 Key：

```lua
local YasioHttpClient = require 'maps.server.YasioHttpClient'
local json = JSON

local FQ_BASE_URL = 'https://fengqigame.com'
local FQ_MAP_KEY = '<由部署负责人提供，不提交公开仓库>'

local function fq_request(method, path, body, callback)
    local sent = YasioHttpClient:send {
        url = FQ_BASE_URL .. path,
        type = method,
        headers = {
            ['FQ-Map-Key'] = FQ_MAP_KEY,
        },
        jsondata = body or {},
        callback = function(resp)
            if resp == nil then
                callback(false, {
                    code = 'NETWORK_ERROR',
                    message = '没有收到 HTTP 响应',
                })
                return
            end

            local decoded, result = pcall(json.decode, resp.body)
            if not decoded or type(result) ~= 'table' then
                callback(false, {
                    code = 'INVALID_RESPONSE',
                    message = '响应不是有效 JSON',
                    httpStatus = tonumber(resp.code),
                })
                return
            end

            if result.success == true then
                callback(true, result.data, tonumber(resp.code))
                return
            end

            callback(false, {
                code = result.error and result.error.code or 'REQUEST_FAILED',
                message = result.error and result.error.message or '请求失败',
                details = result.error and result.error.details,
                requestId = result.requestId,
                httpStatus = tonumber(resp.code),
            })
        end,
        error = function()
            callback(false, {
                code = 'NETWORK_ERROR',
                message = '连接失败',
            })
        end,
    }

    if not sent then
        callback(false, {
            code = 'CLIENT_BUSY',
            message = '没有可用 HTTP 通道',
        })
    end
end
```

开局读取：

```lua
fq_request('post', '/api/fq/bootstrap', {
    uids = { 'player-001', 'player-002' },
    includeGlobal = true,
}, function(success, data_or_error)
    if not success then
        print('FQ bootstrap failed:', data_or_error.code, data_or_error.requestId)
        return
    end

    local data = data_or_error
    ServerConfig.Globals = data.global and data.global.values or {}

    for _, archive in ipairs(data.players) do
        if archive.dataBanned then
            print('玩家存档已封禁:', archive.uid)
        else
            -- 按 UID 映射到玩家句柄。
            -- 保存 archive.values，并单独保存 archive.revision。
        end
    end
end)
```

保存时必须提交完整快照，并保存新 revision：

```lua
fq_request('post', '/api/fq/archives/players/player-001/save', {
    requestId = 'FQ-release-room-889-player-001-17',
    expectedRevision = 3,
    values = {
        gold = 120,
        inventory = { 'sword', 'shield' },
    },
}, function(success, data_or_error)
    if not success then
        if data_or_error.code == 'FQ_ARCHIVE_REVISION_CONFLICT' then
            -- 重新读取，按游戏规则合并后生成新 requestId 再保存。
        end
        return
    end

    local new_revision = data_or_error.archive.revision
    -- 覆盖本地保存的 revision。
end)
```

当前《沧澜》实现已经选择原始 JSON，不再对 FQ 值执行旧 Base64 解码；同一字段不得重新混入旧编码格式。

截至 2026-07-22，批量开局、每日首次采集、人工发布快照和礼包实时资格协议已部署，`006_leaderboard_publication_and_daily_collection.sql` 与 `007_gift_entitlements.sql` 已应用；正式域名健康检查和迁移状态通过。游戏端已修改，仍需地图内验证礼包资格 0→1→重开→0、1～4 人开局、跨日采集和发布前后显示。详细交接见 [沧澜项目 AI 技术交接](沧澜项目AI技术交接.md)。

## 16. 游戏侧最低验收清单

- [ ] `release`、`lobby`、`test` 使用不同 Key；
- [ ] 请求只使用 `/api/fq` 和 `FQ-Map-Key`；
- [ ] 开局可以一次读取全局和本局玩家存档；
- [ ] 未建档玩家按 revision 0、空对象处理；
- [ ] 封禁玩家不会载入旧存档，也不能保存；
- [ ] 保存提交完整快照，而不是局部字段；
- [ ] 保存成功后更新本地 revision；
- [ ] 网络重试复用同一 requestId 和请求内容；
- [ ] revision 409 时重新读取，不强行覆盖；
- [ ] 四人房无待投递时使用 4 个批量 HTTP 完成开局链；
- [ ] 消息批量读取后只在游戏内写入成功后 ACK；礼包每局覆盖本地资格且不写入存档；
- [ ] 榜单未发布时游戏显示“尚未发布”，人工发布后仅新开对局读取最新前 100 名；
- [ ] 同一 UID 同一北京时间自然日只接受首次样本，并发重复请求只接受一次；
- [ ] `landing_power` 使用 `best` 模式，榜外玩家不泄露实时名次；
- [ ] 消息 ID、风险 eventId 在游戏侧幂等；礼包重复查询不累计；
- [ ] 日志和埋点不盲目重试；
- [ ] 日志中不出现完整 Key、数据库密码或完整玩家存档；
- [ ] 测试环境验证通过后，再为正式环境创建并配置 Key。
