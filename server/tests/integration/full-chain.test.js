import { access, readdir, rm } from "node:fs/promises";
import path from "node:path";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../../app.js";
import { config } from "../../config.js";
import { closeDatabase, query } from "../../db/index.js";
import { migrate } from "../../db/migrate.js";
import { createUser } from "../../services/users.js";

const adminPassword = "Admin-password-2026!";
const userPassword = "User-password-2026!";
const updatedUserPassword = "User6!";

describe.sequential("管理员、普通用户与游戏客户端全链路", () => {
  const admin = request.agent(app);
  const normalUser = request.agent(app);
  let mapId,
    userId,
    playerId,
    giftId,
    gameToken,
    gameKeyId,
    releaseToken,
    releaseKeyId,
    lobbyToken,
    lobbyKeyId,
    anchorId,
    pointId;

  beforeAll(async () => {
    const databaseUrl = new URL(
      process.env.DATABASE_URL || "postgres://invalid",
    );
    if (
      process.env.NODE_ENV !== "test" ||
      databaseUrl.hostname !== "127.0.0.1" ||
      databaseUrl.pathname !== "/fengqi_test" ||
      !config.uploadDir.endsWith(path.join(".test-artifacts", "uploads"))
    ) {
      throw new Error(
        "集成测试只允许 NODE_ENV=test 且 DATABASE_URL 指向本机 fengqi_test 隔离库",
      );
    }
    await migrate();
    await query("TRUNCATE users RESTART IDENTITY CASCADE");
    await createUser({
      username: "test-admin",
      password: adminPassword,
      displayName: "测试管理员",
      role: "admin",
    });
  });

  afterAll(async () => {
    try {
      await query("TRUNCATE users RESTART IDENTITY CASCADE");
    } finally {
      await closeDatabase();
      await rm(path.join(config.rootDir, ".test-artifacts"), {
        recursive: true,
        force: true,
      });
    }
  });

  it("HTTP 安全头、跨站请求和非法 JSON 均按生产规则处理", async () => {
    const health = await request(app).get("/api/system/health").expect(200);
    expect(health.headers["x-powered-by"]).toBeUndefined();
    expect(health.headers["content-security-policy"]).toContain(
      "default-src 'self'",
    );
    expect(health.headers["content-security-policy"]).not.toContain(
      "upgrade-insecure-requests",
    );
    expect(health.headers["strict-transport-security"]).toBeUndefined();
    await request(app).get("/api/not-exists").expect(404);
    const invalidJson = await request(app)
      .post("/api/auth/login")
      .set("content-type", "application/json")
      .send("{invalid")
      .expect(400);
    expect(invalidJson.body.error.code).toBe("INVALID_JSON");
    await request(app)
      .post("/api/auth/login")
      .set("origin", "https://attacker.invalid")
      .send({ username: "test-admin", password: adminPassword })
      .expect(403);
  });

  it("管理员登录并创建地图与普通用户", async () => {
    await admin
      .post("/api/auth/login")
      .send({ username: "test-admin", password: adminPassword })
      .expect(200);
    const mapResponse = await admin
      .post("/api/maps")
      .send({
        name: "全链路测试地图",
        description: "integration",
        runtimeEnv: "test",
      })
      .expect(201);
    mapId = mapResponse.body.data.id;
    const userResponse = await admin
      .post("/api/admin/users")
      .send({
        username: "test-user",
        password: userPassword,
        displayName: "测试用户",
        role: "user",
      })
      .expect(201);
    userId = userResponse.body.data.id;
    await admin
      .put(`/api/admin/users/${userId}/maps/${mapId}`)
      .send({ permissions: ["map.view", "metrics.view"] })
      .expect(200);
  });

  it("普通用户只能访问被授权的地图与功能", async () => {
    await normalUser
      .post("/api/auth/login")
      .send({ username: "test-user", password: userPassword })
      .expect(200);
    const maps = await normalUser.get("/api/maps").expect(200);
    expect(maps.body.data).toHaveLength(1);
    await normalUser
      .get(`/api/maps/${mapId}/metrics?environment=test`)
      .expect(200);
    await normalUser
      .get(`/api/maps/${mapId}/players?environment=test`)
      .expect(403);
    await normalUser.get("/api/admin/users").expect(403);
  });

  it("游戏客户端写入玩家，后台发送消息与礼包，客户端确认领取", async () => {
    const keyResponse = await admin
      .post(`/api/maps/${mapId}/api-keys`)
      .send({
        name: "集成测试客户端",
        environment: "test",
        permissions: [
          "game.players.write",
          "game.archives.read",
          "game.archives.write",
          "game.logs.write",
          "game.metrics.write",
          "game.points.write",
          "game.leaderboards.read",
          "game.leaderboards.write",
          "game.risk.write",
          "game.messages.read",
          "game.gifts.read",
        ],
      })
      .expect(201);
    gameToken = keyResponse.body.data.token;
    gameKeyId = keyResponse.body.data.id;

    await request(app)
      .post("/api/fq/players/upsert")
      .set("fq-map-key", gameToken)
      .send({
        players: [
          {
            uid: "player-001",
            name: "链路玩家",
            level: 10,
            gameLevel: "N2",
          },
        ],
      })
      .expect(200);
    const players = await admin
      .get(`/api/maps/${mapId}/players?environment=test`)
      .expect(200);
    playerId = players.body.data[0].id;

    const giftResponse = await admin
      .post(`/api/maps/${mapId}/gifts`)
      .send({ giftKey: "chain_gift", name: "链路礼包", defaultValue: 2 })
      .expect(201);
    giftId = giftResponse.body.data.id;
    await admin
      .post(`/api/maps/${mapId}/gifts/grant?environment=test`)
      .send({ playerIds: [playerId], grants: [{ giftId, quantity: 2 }] })
      .expect(200);
    await admin
      .post(`/api/maps/${mapId}/messages?environment=test`)
      .send({
        playerIds: [playerId],
        subject: "链路消息",
        content: "这是一条集成测试消息",
      })
      .expect(201);

    const deliveries = await request(app)
      .post("/api/fq/deliveries/query")
      .set("fq-map-key", gameToken)
      .send({ uids: ["player-001"] })
      .expect(200);
    expect(deliveries.body.data.players[0].gifts).toHaveLength(1);
    expect(deliveries.body.data.players[0].messages).toHaveLength(1);
    await request(app)
      .post(`/api/fq/gifts/${deliveries.body.data.players[0].gifts[0].id}/ack`)
      .set("fq-map-key", gameToken)
      .send({ uid: "player-001" })
      .expect(200);
    await request(app)
      .post(
        `/api/fq/messages/${deliveries.body.data.players[0].messages[0].id}/ack`,
      )
      .set("fq-map-key", gameToken)
      .send({ uid: "player-001" })
      .expect(200);
    const clearedDeliveries = await request(app)
      .post("/api/fq/deliveries/query")
      .set("fq-map-key", gameToken)
      .send({ uids: ["player-001"] })
      .expect(200);
    expect(clearedDeliveries.body.data.players[0].gifts).toHaveLength(0);
    expect(clearedDeliveries.body.data.players[0].messages).toHaveLength(0);
  });

  it("FQ 存档支持首次读取、版本写入、幂等重放、冲突保护和存档封禁", async () => {
    const empty = await request(app)
      .post("/api/fq/bootstrap")
      .set("fq-map-key", gameToken)
      .send({ uids: ["player-001"] })
      .expect(200);
    expect(empty.body.data.environment).toBe("test");
    expect(empty.body.data.players[0]).toMatchObject({
      uid: "player-001",
      dataBanned: false,
      revision: 0,
      values: {},
    });
    expect(empty.body.data.global).toMatchObject({ revision: 0, values: {} });

    const firstSaveBody = {
      requestId: "FQ-player-001-save-1",
      expectedRevision: 0,
      values: { gold: 100, inventory: ["sword"] },
    };
    const firstSave = await request(app)
      .post("/api/fq/archives/players/player-001/save")
      .set("fq-map-key", gameToken)
      .send(firstSaveBody)
      .expect(200);
    expect(firstSave.body.data.replayed).toBe(false);
    expect(firstSave.body.data.archive).toMatchObject({
      uid: "player-001",
      revision: 1,
      values: firstSaveBody.values,
    });

    const replayed = await request(app)
      .post("/api/fq/archives/players/player-001/save")
      .set("fq-map-key", gameToken)
      .send(firstSaveBody)
      .expect(200);
    expect(replayed.body.data.replayed).toBe(true);
    expect(replayed.body.data.archive.revision).toBe(1);

    const concurrentBody = {
      requestId: "FQ-player-002-concurrent",
      expectedRevision: 0,
      values: { gold: 20 },
    };
    const concurrent = await Promise.all([
      request(app)
        .post("/api/fq/archives/players/player-002/save")
        .set("fq-map-key", gameToken)
        .send(concurrentBody)
        .expect(200),
      request(app)
        .post("/api/fq/archives/players/player-002/save")
        .set("fq-map-key", gameToken)
        .send(concurrentBody)
        .expect(200),
    ]);
    expect(
      concurrent.map((response) => response.body.data.replayed).sort(),
    ).toEqual([false, true]);
    expect(
      concurrent.every((response) => response.body.data.archive.revision === 1),
    ).toBe(true);

    const reused = await request(app)
      .post("/api/fq/archives/players/player-001/save")
      .set("fq-map-key", gameToken)
      .send({ ...firstSaveBody, values: { gold: 999 } })
      .expect(409);
    expect(reused.body.error.code).toBe("FQ_REQUEST_REUSED");

    const stale = await request(app)
      .post("/api/fq/archives/players/player-001/save")
      .set("fq-map-key", gameToken)
      .send({
        requestId: "FQ-player-001-stale",
        expectedRevision: 0,
        values: { gold: 120 },
      })
      .expect(409);
    expect(stale.body.error).toMatchObject({
      code: "FQ_ARCHIVE_REVISION_CONFLICT",
      details: { currentRevision: 1 },
    });

    await request(app)
      .post("/api/fq/archives/global/save")
      .set("fq-map-key", gameToken)
      .send({
        requestId: "FQ-global-save-1",
        expectedRevision: 0,
        values: { season: 1, serverOpen: true },
      })
      .expect(200);
    const loaded = await request(app)
      .post("/api/fq/bootstrap")
      .set("fq-map-key", gameToken)
      .send({ uids: ["player-001"] })
      .expect(200);
    expect(loaded.body.data.players[0].values.gold).toBe(100);
    expect(loaded.body.data.global.values).toEqual({
      season: 1,
      serverOpen: true,
    });

    await admin
      .patch(`/api/maps/${mapId}/players/${playerId}?environment=test`)
      .send({ dataBan: true })
      .expect(200);
    await request(app)
      .get("/api/fq/archives/players/player-001")
      .set("fq-map-key", gameToken)
      .expect(403);
    await request(app)
      .post("/api/fq/archives/players/player-001/save")
      .set("fq-map-key", gameToken)
      .send({
        requestId: "FQ-player-001-banned",
        expectedRevision: 1,
        values: { gold: 120 },
      })
      .expect(403);
    const bannedBootstrap = await request(app)
      .post("/api/fq/bootstrap")
      .set("fq-map-key", gameToken)
      .send({ uids: ["player-001"] })
      .expect(200);
    expect(bannedBootstrap.body.data.players[0]).toMatchObject({
      dataBanned: true,
      revision: 0,
      values: {},
    });
    await admin
      .patch(`/api/maps/${mapId}/players/${playerId}?environment=test`)
      .send({ dataBan: false })
      .expect(200);
    await admin
      .patch(`/api/maps/${mapId}/players/${playerId}?environment=test`)
      .send({ uid: "player-renamed" })
      .expect(200);
    const renamedArchive = await request(app)
      .get("/api/fq/archives/players/player-renamed")
      .set("fq-map-key", gameToken)
      .expect(200);
    expect(renamedArchive.body.data.values.gold).toBe(100);
    await admin
      .patch(`/api/maps/${mapId}/players/${playerId}?environment=test`)
      .send({ uid: "player-001" })
      .expect(200);

    await request(app)
      .post("/api/fq/bootstrap")
      .set("x-map-key", gameToken)
      .send({ uids: ["player-001"] })
      .expect(401);
  });

  it("客户端上报日志和指标并进入后台查询链路", async () => {
    await request(app)
      .post("/api/fq/logs")
      .set("fq-map-key", gameToken)
      .send({ context: "[integration] chain ok", playerCount: 1 })
      .expect(200);
    await request(app)
      .post("/api/fq/metrics")
      .set("fq-map-key", gameToken)
      .send({
        date: "2026-07-14",
        cumulativeUsers: 1,
        onlineUsers: 1,
        totalGameCount: 1,
        dailyNewUsers: 1,
        dailyActiveUsers: 1,
      })
      .expect(200);
    const metrics = await admin
      .get(`/api/maps/${mapId}/metrics?environment=test`)
      .expect(200);
    const logs = await admin
      .get(`/api/maps/${mapId}/logs?environment=test`)
      .expect(200);
    expect(metrics.body.data.summary.cumulativeUsers).toBe(1);
    expect(logs.body.data[0].context).toBe("[integration] chain ok");
  });

  it("地图局部编辑、地图配置和系统设置均能持久化", async () => {
    const patched = await admin
      .patch(`/api/maps/${mapId}`)
      .send({ name: "全链路验收地图" })
      .expect(200);
    expect(patched.body.data.description).toBe("integration");
    expect(patched.body.data.runtimeEnv).toBe("test");

    const configResponse = await admin
      .put(`/api/maps/${mapId}/config`)
      .send({
        ranks: [{ id: "rank-1", name: "青铜" }],
        globals: [{ key: "season", value: 1 }],
        preloadCode: "return true",
      })
      .expect(200);
    expect(configResponse.body.data.ranks).toHaveLength(1);
    const loadedConfig = await admin
      .get(`/api/maps/${mapId}/config`)
      .expect(200);
    expect(loadedConfig.body.data.preloadCode).toBe("return true");

    await admin
      .put("/api/admin/settings")
      .send({ siteNotice: "全链路验收", maintenance: false })
      .expect(200);
    const settings = await admin.get("/api/admin/settings").expect(200);
    expect(settings.body.data.siteNotice).toBe("全链路验收");
    expect(settings.body.data.maintenance).toBe(false);
  });

  it("主播和埋点支持增改查，游戏客户端可上报埋点", async () => {
    const anchor = await admin
      .post(`/api/maps/${mapId}/anchors?environment=test`)
      .send({
        name: "验收主播",
        enabled: true,
        giftConfig: { ticket: 2 },
      })
      .expect(201);
    anchorId = anchor.body.data.id;
    const anchorUpdated = await admin
      .patch(`/api/maps/${mapId}/anchors/${anchorId}?environment=test`)
      .send({ enabled: false })
      .expect(200);
    expect(anchorUpdated.body.data.enabled).toBe(false);
    expect(anchorUpdated.body.data.giftConfig).toEqual({ ticket: 2 });

    const point = await admin
      .post(`/api/maps/${mapId}/points?environment=test`)
      .send({ pointKey: "acceptance_start", name: "验收开始" })
      .expect(201);
    pointId = point.body.data.id;
    await request(app)
      .post("/api/fq/points/acceptance_start/increment")
      .set("fq-map-key", gameToken)
      .send({ amount: 3 })
      .expect(200);
    const points = await admin
      .get(`/api/maps/${mapId}/points?environment=test`)
      .expect(200);
    expect(points.body.data[0].id).toBe(pointId);
    expect(points.body.data[0].triggerCount).toBe(3);
  });

  it("排行榜发布快照、风险事件幂等上报与玩家封禁形成闭环", async () => {
    await normalUser
      .get(`/api/maps/${mapId}/leaderboards?environment=test`)
      .expect(403);
    await normalUser
      .get(`/api/maps/${mapId}/risk/events?environment=test`)
      .expect(403);

    const leaderboard = await admin
      .post(`/api/maps/${mapId}/leaderboards?environment=test`)
      .send({
        leaderboardKey: "landing_power_v1",
        name: "落地战力榜",
        valueLabel: "战力",
        sortDirection: "desc",
        scoreUpdateMode: "best",
      })
      .expect(201);
    const leaderboardId = leaderboard.body.data.id;
    expect(leaderboard.body.data.scoreUpdateMode).toBe("best");
    const unpublished = await request(app)
      .post("/api/fq/leaderboards/landing_power_v1/query")
      .set("fq-map-key", gameToken)
      .send({ uids: ["player-001"] })
      .expect(200);
    expect(unpublished.body.data).toMatchObject({
      published: false,
      snapshotId: null,
      totalEntries: 0,
      entries: [],
      playerRanks: [],
      submittedTodayUids: [],
    });

    const firstUpload = await request(app)
      .post("/api/fq/leaderboards/landing_power_v1/entries")
      .set("fq-map-key", gameToken)
      .send({
        entries: [
          {
            uid: "player-001",
            name: "链路玩家",
            gameLevel: "N2",
            score: 9900,
            gameCount: 18,
            metadata: { season: 3 },
          },
          {
            uid: "player-002",
            name: "候补玩家",
            gameLevel: "N1",
            score: 7700,
            gameCount: 9,
          },
        ],
      })
      .expect(200);
    expect(firstUpload.body.data.acceptedUids).toEqual([
      "player-001",
      "player-002",
    ]);
    const stillUnpublished = await request(app)
      .post("/api/fq/leaderboards/landing_power_v1/query")
      .set("fq-map-key", gameToken)
      .send({ uids: ["player-001", "missing-player"], limit: 100 })
      .expect(200);
    expect(stillUnpublished.body.data.published).toBe(false);
    expect(stillUnpublished.body.data.entries).toEqual([]);
    expect(stillUnpublished.body.data.submittedTodayUids).toEqual([
      "player-001",
    ]);

    const live = await admin
      .get(
        `/api/maps/${mapId}/leaderboards/${leaderboardId}/entries?environment=test`,
      )
      .expect(200);
    expect(live.body.data.entries.map((item) => item.uid)).toEqual([
      "player-001",
      "player-002",
    ]);
    const snapshot = await admin
      .post(
        `/api/maps/${mapId}/leaderboards/${leaderboardId}/publish?environment=test`,
      )
      .send({ limit: 100 })
      .expect(201);
    expect(snapshot.body.data.entryCount).toBe(2);

    const firstPublished = await request(app)
      .post("/api/fq/leaderboards/landing_power_v1/query")
      .set("fq-map-key", gameToken)
      .send({ uids: ["player-001", "missing-player"], limit: 100 })
      .expect(200);
    expect(firstPublished.body.data.published).toBe(true);
    expect(firstPublished.body.data.snapshotId).toBe(snapshot.body.data.id);
    expect(firstPublished.body.data.entries.map((item) => item.uid)).toEqual([
      "player-001",
      "player-002",
    ]);
    expect(firstPublished.body.data.playerRanks).toMatchObject([
      { rank: 1, uid: "player-001", name: "链路玩家", score: 9900 },
    ]);
    expect(firstPublished.body.data.entries[0].achievedAtText).toMatch(
      /^\d{2}-\d{2} \d{2}:\d{2}$/,
    );

    const skippedSameDay = await request(app)
      .post("/api/fq/leaderboards/landing_power_v1/entries")
      .set("fq-map-key", gameToken)
      .send({
        entries: [
          {
            uid: "player-001",
            name: "链路玩家新名",
            gameLevel: "N9",
            score: 8800,
            gameCount: 99,
            metadata: { formulaVersion: "worse" },
          },
        ],
      })
      .expect(200);
    expect(skippedSameDay.body.data).toMatchObject({
      acceptedUids: [],
      skippedUids: ["player-001"],
    });

    await query(
      `UPDATE leaderboard_entries SET last_submitted_on=(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai')::date-1
        WHERE leaderboard_id=$1 AND player_uid='player-001'`,
      [leaderboardId],
    );
    const betterEntry = {
      entries: [
        {
          uid: "player-001",
          name: "链路玩家新名",
          gameLevel: "N3",
          score: 12000,
          gameCount: 10,
          metadata: { formulaVersion: "landing_power_v1" },
        },
      ],
    };
    const concurrentDailyUploads = await Promise.all([
      request(app)
        .post("/api/fq/leaderboards/landing_power_v1/entries")
        .set("fq-map-key", gameToken)
        .send(betterEntry)
        .expect(200),
      request(app)
        .post("/api/fq/leaderboards/landing_power_v1/entries")
        .set("fq-map-key", gameToken)
        .send(betterEntry)
        .expect(200),
    ]);
    expect(
      concurrentDailyUploads
        .map((response) => response.body.data.acceptedUids.length)
        .sort(),
    ).toEqual([0, 1]);

    const beforeRepublish = await request(app)
      .post("/api/fq/leaderboards/landing_power_v1/query")
      .set("fq-map-key", gameToken)
      .send({ uids: ["player-001"] })
      .expect(200);
    expect(beforeRepublish.body.data.playerRanks[0]).toMatchObject({
      gameLevel: "N2",
      score: 9900,
      metadata: { season: 3 },
    });
    const latestSnapshot = await admin
      .post(
        `/api/maps/${mapId}/leaderboards/${leaderboardId}/publish?environment=test`,
      )
      .send({ limit: 100 })
      .expect(201);
    const afterRepublish = await request(app)
      .post("/api/fq/leaderboards/landing_power_v1/query")
      .set("fq-map-key", gameToken)
      .send({ uids: ["player-001"] })
      .expect(200);
    expect(afterRepublish.body.data.snapshotId).toBe(
      latestSnapshot.body.data.id,
    );
    expect(afterRepublish.body.data.playerRanks[0]).toMatchObject({
      rank: 1,
      uid: "player-001",
      gameLevel: "N3",
      score: 12000,
      gameCount: 10,
      metadata: { formulaVersion: "landing_power_v1" },
    });

    const writeOnlyKey = await admin
      .post(`/api/maps/${mapId}/api-keys`)
      .send({
        name: "仅读榜权限拒绝测试",
        environment: "test",
        permissions: ["game.leaderboards.write"],
      })
      .expect(201);
    await request(app)
      .post("/api/fq/leaderboards/landing_power_v1/query")
      .set("fq-map-key", writeOnlyKey.body.data.token)
      .send({ uids: [] })
      .expect(403);
    await admin
      .delete(`/api/maps/${mapId}/api-keys/${writeOnlyKey.body.data.id}`)
      .expect(200);
    const rule = await admin
      .post(`/api/maps/${mapId}/risk/rules?environment=test`)
      .send({
        ruleKey: "abnormal_power_growth",
        name: "战力异常增长",
        severity: "critical",
      })
      .expect(201);
    expect(rule.body.data.ruleKey).toBe("abnormal_power_growth");
    const reported = await request(app)
      .post("/api/fq/risk/events")
      .set("fq-map-key", gameToken)
      .send({
        eventId: "risk-event-001",
        ruleKey: "abnormal_power_growth",
        uid: "player-001",
        playerName: "链路玩家",
        count: 3,
        details: { delta: 8800 },
      })
      .expect(201);
    expect(reported.body.data.created).toBe(true);
    const repeated = await request(app)
      .post("/api/fq/risk/events")
      .set("fq-map-key", gameToken)
      .send({
        eventId: "risk-event-001",
        ruleKey: "abnormal_power_growth",
        uid: "player-001",
        playerName: "链路玩家",
        count: 3,
      })
      .expect(200);
    expect(repeated.body.data.created).toBe(false);

    const riskEvents = await admin
      .get(`/api/maps/${mapId}/risk/events?environment=test&status=open`)
      .expect(200);
    expect(riskEvents.body.data.items).toHaveLength(1);
    expect(riskEvents.body.data.summary.critical).toBe(1);

    await admin
      .put(`/api/admin/users/${userId}/maps/${mapId}`)
      .send({
        permissions: [
          "map.view",
          "metrics.view",
          "leaderboards.view",
          "risk.view",
        ],
      })
      .expect(200);
    await normalUser
      .get(`/api/maps/${mapId}/leaderboards?environment=test`)
      .expect(200);
    await normalUser
      .get(`/api/maps/${mapId}/risk/events?environment=test`)
      .expect(200);
    await normalUser
      .post(`/api/maps/${mapId}/leaderboards?environment=test`)
      .send({ leaderboardKey: "forbidden", name: "无权限榜单" })
      .expect(403);

    await admin
      .patch(
        `/api/maps/${mapId}/risk/events/${reported.body.data.id}?environment=test`,
      )
      .send({
        status: "blocked",
        rankBan: true,
        note: "集成测试确认封禁",
      })
      .expect(200);
    const liveAfterBlock = await admin
      .get(
        `/api/maps/${mapId}/leaderboards/${leaderboardId}/entries?environment=test`,
      )
      .expect(200);
    expect(liveAfterBlock.body.data.entries.map((item) => item.uid)).toEqual([
      "player-002",
    ]);
    const published = await admin
      .get(
        `/api/maps/${mapId}/leaderboards/${leaderboardId}/entries?environment=test&snapshotId=${snapshot.body.data.id}`,
      )
      .expect(200);
    expect(published.body.data.entries).toHaveLength(2);
    const players = await admin
      .get(`/api/maps/${mapId}/players?environment=test`)
      .expect(200);
    expect(
      players.body.data.find((item) => item.uid === "player-001").rankBan,
    ).toBe(true);
  });

  it("测试服、正式服与大厅服的数据和凭据严格隔离", async () => {
    const keyResponse = await admin
      .post(`/api/maps/${mapId}/api-keys`)
      .send({
        name: "正式服验收客户端",
        environment: "release",
        permissions: [
          "game.players.write",
          "game.metrics.write",
          "game.archives.read",
          "game.archives.write",
        ],
      })
      .expect(201);
    releaseToken = keyResponse.body.data.token;
    releaseKeyId = keyResponse.body.data.id;
    const lobbyKeyResponse = await admin
      .post(`/api/maps/${mapId}/api-keys`)
      .send({
        name: "大厅服验收客户端",
        environment: "lobby",
        permissions: [
          "game.players.write",
          "game.archives.read",
          "game.archives.write",
        ],
      })
      .expect(201);
    lobbyToken = lobbyKeyResponse.body.data.token;
    lobbyKeyId = lobbyKeyResponse.body.data.id;
    await request(app)
      .post("/api/fq/players/upsert")
      .set("fq-map-key", releaseToken)
      .send({
        players: [{ uid: "player-001", name: "正式服同 UID 玩家", level: 2 }],
      })
      .expect(200);
    await request(app)
      .post("/api/fq/players/upsert")
      .set("fq-map-key", lobbyToken)
      .send({
        players: [{ uid: "player-001", name: "大厅服同 UID 玩家", level: 3 }],
      })
      .expect(200);
    await request(app)
      .post("/api/fq/archives/players/player-001/save")
      .set("fq-map-key", releaseToken)
      .send({
        requestId: "FQ-release-player-001",
        expectedRevision: 0,
        values: { environment: "release" },
      })
      .expect(200);
    await request(app)
      .post("/api/fq/archives/players/player-001/save")
      .set("fq-map-key", lobbyToken)
      .send({
        requestId: "FQ-lobby-player-001",
        expectedRevision: 0,
        values: { environment: "lobby" },
      })
      .expect(200);

    const testPlayers = await admin
      .get(`/api/maps/${mapId}/players?environment=test`)
      .expect(200);
    const releasePlayers = await admin
      .get(`/api/maps/${mapId}/players?environment=release`)
      .expect(200);
    const lobbyPlayers = await admin
      .get(`/api/maps/${mapId}/players?environment=lobby`)
      .expect(200);
    expect(testPlayers.body.data).toHaveLength(1);
    expect(testPlayers.body.data[0].name).toBe("链路玩家");
    expect(releasePlayers.body.data).toHaveLength(1);
    expect(releasePlayers.body.data[0].name).toBe("正式服同 UID 玩家");
    expect(lobbyPlayers.body.data).toHaveLength(1);
    expect(lobbyPlayers.body.data[0].name).toBe("大厅服同 UID 玩家");
    const [testArchive, releaseArchive, lobbyArchive] = await Promise.all([
      request(app)
        .get("/api/fq/archives/players/player-001")
        .set("fq-map-key", gameToken),
      request(app)
        .get("/api/fq/archives/players/player-001")
        .set("fq-map-key", releaseToken),
      request(app)
        .get("/api/fq/archives/players/player-001")
        .set("fq-map-key", lobbyToken),
    ]);
    expect(testArchive.body.data.values.gold).toBe(100);
    expect(releaseArchive.body.data.values.environment).toBe("release");
    expect(lobbyArchive.body.data.values.environment).toBe("lobby");
  });

  it("文件夹、文件上传、列表、下载和级联删除形成闭环", async () => {
    const rejected = await admin
      .post(`/api/maps/${mapId}/files/upload`)
      .attach("files", Buffer.from("echo unsafe"), {
        filename: "伪装脚本.sh",
        contentType: "application/octet-stream",
      })
      .expect(400);
    expect(rejected.body.error.code).toBe("FILE_TYPE_REJECTED");
    const folder = await admin
      .post(`/api/maps/${mapId}/files/folder`)
      .send({ name: "验收目录" })
      .expect(201);
    const upload = await admin
      .post(
        `/api/maps/${mapId}/files/upload?folder=${encodeURIComponent("验收目录")}`,
      )
      .attach("files", Buffer.from("fengqi acceptance file"), "acceptance.txt")
      .expect(201);
    expect(upload.body.data).toHaveLength(1);
    const file = upload.body.data[0];
    const list = await admin
      .get(`/api/maps/${mapId}/files?folder=${encodeURIComponent("验收目录")}`)
      .expect(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].sha256).toMatch(/^[a-f0-9]{64}$/);
    const downloaded = await admin
      .get(`/api/maps/${mapId}/files/${file.id}/download`)
      .expect(200);
    expect(downloaded.headers["content-disposition"]).toContain("attachment");
    expect(downloaded.text).toBe("fengqi acceptance file");
    await admin
      .delete(`/api/maps/${mapId}/files/${folder.body.data.id}`)
      .expect(200);
    const emptyList = await admin
      .get(`/api/maps/${mapId}/files?folder=${encodeURIComponent("验收目录")}`)
      .expect(200);
    expect(emptyList.body.data).toHaveLength(0);
  });

  it("公开抽奖支持报名、防重复、开奖与中奖结果公开", async () => {
    const campaign = await admin
      .post(`/api/maps/${mapId}/lotteries?environment=test`)
      .send({
        title: "全链路验收抽奖",
        description: "公开页验收",
        winnerCount: 1,
        rewardConfig: [{ giftId, quantity: 1 }],
      })
      .expect(201);
    const campaignId = campaign.body.data.id;
    const token = campaign.body.data.publicPath.split("/").at(-1);
    const publicBefore = await request(app)
      .get(`/api/public/lotteries/${token}`)
      .expect(200);
    expect(publicBefore.body.data.participantCount).toBe(0);
    await request(app)
      .post(`/api/public/lotteries/${token}/entries`)
      .send({ playerName: "参与者甲", playerUid: "lottery-player-a" })
      .expect(201);
    await request(app)
      .post(`/api/public/lotteries/${token}/entries`)
      .send({ playerName: "参与者甲", playerUid: "lottery-player-a" })
      .expect(409);
    await request(app)
      .post(`/api/public/lotteries/${token}/entries`)
      .send({ playerName: "参与者乙", playerUid: "lottery-player-b" })
      .expect(201);
    const draw = await admin
      .post(`/api/maps/${mapId}/lotteries/${campaignId}/draw`)
      .expect(200);
    expect(draw.body.data).toHaveLength(1);
    const publicAfter = await request(app)
      .get(`/api/public/lotteries/${token}`)
      .expect(200);
    expect(publicAfter.body.data.status).toBe("drawn");
    expect(publicAfter.body.data.participantCount).toBe(2);
    expect(publicAfter.body.data.winners).toHaveLength(1);
  });

  it("个人资料、密码更新、退出登录和重新登录均有效", async () => {
    await normalUser
      .patch("/api/auth/profile")
      .send({
        displayName: "验收普通用户",
        phone: "13800000000",
        profile: { description: "全链路" },
      })
      .expect(200);
    const profile = await normalUser.get("/api/auth/me").expect(200);
    expect(profile.body.data.user.displayName).toBe("验收普通用户");
    expect(profile.body.data.user.profile.description).toBe("全链路");
    await normalUser
      .post("/api/auth/password")
      .send({
        currentPassword: userPassword,
        newPassword: "Ab1!x",
      })
      .expect(400);
    await normalUser
      .post("/api/auth/password")
      .send({ currentPassword: userPassword, newPassword: updatedUserPassword })
      .expect(200);
    await normalUser.post("/api/auth/logout").expect(200);
    await normalUser.get("/api/auth/me").expect(401);
    await normalUser
      .post("/api/auth/login")
      .send({ username: "test-user", password: userPassword })
      .expect(401);
    await normalUser
      .post("/api/auth/login")
      .send({ username: "test-user", password: updatedUserPassword })
      .expect(200);
  });

  it("管理员运维、审计、清理、凭据停用和地图归档完整生效", async () => {
    await normalUser
      .post(`/api/maps/${mapId}/runtime/clear`)
      .send({ environment: "test", confirmName: "全链路验收地图" })
      .expect(403);
    await admin.get("/api/system/status").expect(200);
    const audit = await admin.get("/api/system/audit?limit=100").expect(200);
    expect(audit.body.data.some((item) => item.action === "lottery.draw")).toBe(
      true,
    );
    await admin
      .post(`/api/maps/${mapId}/runtime/clear`)
      .send({ environment: "test", confirmName: "名称不匹配" })
      .expect(409);
    const cleared = await admin
      .post(`/api/maps/${mapId}/runtime/clear`)
      .send({ environment: "test", confirmName: "全链路验收地图" })
      .expect(200);
    expect(cleared.body.data.players).toBe(1);
    expect(cleared.body.data.logs).toBe(1);
    expect(cleared.body.data.metrics).toBe(1);
    expect(cleared.body.data.leaderboardEntries).toBe(2);
    expect(cleared.body.data.leaderboardSnapshots).toBe(2);
    expect(cleared.body.data.riskEvents).toBe(1);
    expect(cleared.body.data.playerArchives).toBe(2);
    expect(cleared.body.data.globalArchives).toBe(1);
    const pointsAfterClear = await admin
      .get(`/api/maps/${mapId}/points?environment=test`)
      .expect(200);
    expect(pointsAfterClear.body.data[0].triggerCount).toBe(0);

    await admin
      .delete(`/api/maps/${mapId}/anchors/${anchorId}?environment=test`)
      .expect(200);
    await admin
      .delete(`/api/maps/${mapId}/points/${pointId}?environment=test`)
      .expect(200);
    await admin.delete(`/api/maps/${mapId}/gifts/${giftId}`).expect(200);
    await admin.delete(`/api/maps/${mapId}/api-keys/${gameKeyId}`).expect(200);
    await request(app)
      .post("/api/fq/logs")
      .set("fq-map-key", gameToken)
      .send({ context: "disabled key" })
      .expect(401);
    await admin
      .delete(`/api/maps/${mapId}/api-keys/${releaseKeyId}`)
      .expect(200);
    await admin.delete(`/api/maps/${mapId}/api-keys/${lobbyKeyId}`).expect(200);
    await admin.delete(`/api/maps/${mapId}`).expect(200);
    expect((await admin.get("/api/maps").expect(200)).body.data).toHaveLength(
      0,
    );
    expect(
      (await normalUser.get("/api/maps").expect(200)).body.data,
    ).toHaveLength(0);
  });

  it("永久删除地图经过双重服务端校验并清除数据库与上传目录", async () => {
    const mapName = "全链路验收地图";
    const confirmation = { confirmMapId: mapId, confirmName: mapName };

    await normalUser
      .delete(`/api/maps/${mapId}/permanent`)
      .send(confirmation)
      .expect(403);
    const mismatch = await admin
      .delete(`/api/maps/${mapId}/permanent`)
      .send({ confirmMapId: mapId, confirmName: "错误地图名称" })
      .expect(409);
    expect(mismatch.body.error.code).toBe("MAP_DELETE_CONFIRMATION_MISMATCH");

    const deleteKeyResponse = await admin
      .post(`/api/maps/${mapId}/api-keys`)
      .send({
        name: "永久删除验收 Key",
        environment: "test",
        permissions: ["game.players.write"],
      })
      .expect(201);
    const deleteToken = deleteKeyResponse.body.data.token;
    const players = {};
    for (const environment of ["release", "lobby", "test"]) {
      const result = await query(
        `INSERT INTO players(map_id,environment,uid,name)
         VALUES($1,$2,$3,$4)
         ON CONFLICT(map_id,environment,uid)
         DO UPDATE SET name=EXCLUDED.name
         RETURNING id`,
        [
          mapId,
          environment,
          `delete-player-${environment}`,
          `待删${environment}玩家`,
        ],
      );
      players[environment] = result.rows[0].id;
      await query(
        `INSERT INTO fq_player_archives(map_id,environment,player_uid,archive_data)
         VALUES($1,$2,$3,$4::jsonb)
         ON CONFLICT(map_id,environment,player_uid)
         DO UPDATE SET archive_data=EXCLUDED.archive_data`,
        [
          mapId,
          environment,
          `delete-player-${environment}`,
          JSON.stringify({ deleteCheck: true }),
        ],
      );
      await query(
        `INSERT INTO fq_global_archives(map_id,environment,archive_data)
         VALUES($1,$2,$3::jsonb)
         ON CONFLICT(map_id,environment)
         DO UPDATE SET archive_data=EXCLUDED.archive_data`,
        [mapId, environment, JSON.stringify({ deleteCheck: true })],
      );
    }
    const gift = await query(
      `INSERT INTO gifts(map_id,gift_key,name)
       VALUES($1,'delete-check-gift','永久删除验收礼包')
       RETURNING id`,
      [mapId],
    );
    await query(
      `INSERT INTO gift_grants(map_id,environment,gift_id,player_id)
       VALUES($1,'test',$2,$3)`,
      [mapId, gift.rows[0].id, players.test],
    );
    await query(
      `INSERT INTO player_messages(map_id,environment,player_id,subject,content,created_by)
       VALUES($1,'test',$2,'永久删除验收','待删除',$3)`,
      [mapId, players.test, userId],
    );
    await query(
      `INSERT INTO anchors(map_id,environment,name)
       VALUES($1,'test','永久删除验收主播')`,
      [mapId],
    );
    await query(
      `INSERT INTO tracking_points(map_id,environment,point_key,name)
       VALUES($1,'test','delete-check-point','永久删除验收埋点')`,
      [mapId],
    );
    await query(
      `INSERT INTO map_logs(map_id,environment,context)
       VALUES($1,'test','永久删除验收日志')`,
      [mapId],
    );
    await query(
      `INSERT INTO map_metrics(map_id,environment,metric_date,cumulative_users)
       VALUES($1,'test','2026-07-16',1)
       ON CONFLICT(map_id,environment,metric_date)
       DO UPDATE SET cumulative_users=EXCLUDED.cumulative_users`,
      [mapId],
    );
    const leaderboard = await query(
      `INSERT INTO leaderboards(map_id,environment,leaderboard_key,name)
       VALUES($1,'test','delete-check-board','永久删除验收榜单')
       RETURNING id`,
      [mapId],
    );
    await query(
      `INSERT INTO leaderboard_entries(leaderboard_id,player_uid,player_name,score)
       VALUES($1,'delete-player-test','待删测试玩家',10)`,
      [leaderboard.rows[0].id],
    );
    const snapshot = await query(
      `INSERT INTO leaderboard_snapshots(leaderboard_id,entry_count,published_by)
       VALUES($1,1,$2)
       RETURNING id`,
      [leaderboard.rows[0].id, userId],
    );
    await query(
      `INSERT INTO leaderboard_snapshot_entries(snapshot_id,rank,player_uid,player_name,score)
       VALUES($1,1,'delete-player-test','待删测试玩家',10)`,
      [snapshot.rows[0].id],
    );
    const riskRule = await query(
      `INSERT INTO risk_rules(map_id,environment,rule_key,name)
       VALUES($1,'test','delete-check-rule','永久删除验收规则')
       RETURNING id`,
      [mapId],
    );
    await query(
      `INSERT INTO risk_events(map_id,environment,event_key,rule_id,rule_key,rule_name,severity,player_uid,player_name)
       VALUES($1,'test','delete-check-event',$2,'delete-check-rule','永久删除验收规则','high','delete-player-test','待删测试玩家')`,
      [mapId, riskRule.rows[0].id],
    );
    const campaign = await query(
      `INSERT INTO lottery_campaigns(map_id,environment,public_token,title,created_by)
       VALUES($1,'test','delete-check-public-token','永久删除验收群抽',$2)
       RETURNING id`,
      [mapId, userId],
    );
    await query(
      `INSERT INTO lottery_entries(campaign_id,participant_key,player_name)
       VALUES($1,'delete-check-player','永久删除验收参与者')`,
      [campaign.rows[0].id],
    );
    await admin
      .post(`/api/maps/${mapId}/files/upload`)
      .attach(
        "files",
        Buffer.from("permanent deletion acceptance"),
        "permanent-delete.txt",
      )
      .expect(201);

    const mapUploadDir = path.join(config.uploadDir, `map-${mapId}`);
    expect((await readdir(mapUploadDir)).length).toBeGreaterThan(0);

    await query(`
      CREATE OR REPLACE FUNCTION test_reject_map_delete()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        RAISE EXCEPTION 'forced map delete rollback';
      END;
      $$
    `);
    await query(`
      CREATE TRIGGER test_reject_map_delete
      BEFORE DELETE ON maps
      FOR EACH ROW EXECUTE FUNCTION test_reject_map_delete()
    `);
    try {
      await admin
        .delete(`/api/maps/${mapId}/permanent`)
        .send(confirmation)
        .expect(500);
    } finally {
      await query("DROP TRIGGER IF EXISTS test_reject_map_delete ON maps");
      await query("DROP FUNCTION IF EXISTS test_reject_map_delete()");
    }
    await admin.get(`/api/maps/${mapId}`).expect(200);
    await access(mapUploadDir);
    expect(
      (await readdir(config.uploadDir)).some((name) =>
        name.startsWith(`.deleting-map-${mapId}-`),
      ),
    ).toBe(false);

    const deleted = await admin
      .delete(`/api/maps/${mapId}/permanent`)
      .send(confirmation)
      .expect(200);
    expect(deleted.body.data).toMatchObject({
      id: mapId,
      name: mapName,
      fileCleanup: { directoryExisted: true },
    });
    await admin.get(`/api/maps/${mapId}`).expect(404);
    await admin
      .delete(`/api/maps/${mapId}/permanent`)
      .send(confirmation)
      .expect(404);
    await request(app)
      .post("/api/fq/players/upsert")
      .set("fq-map-key", deleteToken)
      .send({ players: [{ uid: "after-delete", name: "删除后请求" }] })
      .expect(401);

    for (const table of [
      "map_permissions",
      "map_configs",
      "players",
      "gifts",
      "gift_grants",
      "anchors",
      "tracking_points",
      "map_logs",
      "map_files",
      "map_metrics",
      "api_keys",
      "player_messages",
      "lottery_campaigns",
      "leaderboards",
      "risk_rules",
      "risk_events",
      "fq_player_archives",
      "fq_global_archives",
    ]) {
      const count = await query(
        `SELECT COUNT(*)::int AS count FROM ${table} WHERE map_id=$1`,
        [mapId],
      );
      expect(count.rows[0].count, table).toBe(0);
    }
    expect(
      (
        await query(
          "SELECT COUNT(*)::int AS count FROM leaderboard_entries WHERE leaderboard_id=$1",
          [leaderboard.rows[0].id],
        )
      ).rows[0].count,
    ).toBe(0);
    expect(
      (
        await query(
          "SELECT COUNT(*)::int AS count FROM leaderboard_snapshots WHERE leaderboard_id=$1",
          [leaderboard.rows[0].id],
        )
      ).rows[0].count,
    ).toBe(0);
    expect(
      (
        await query(
          "SELECT COUNT(*)::int AS count FROM leaderboard_snapshot_entries WHERE snapshot_id=$1",
          [snapshot.rows[0].id],
        )
      ).rows[0].count,
    ).toBe(0);
    expect(
      (
        await query(
          "SELECT COUNT(*)::int AS count FROM lottery_entries WHERE campaign_id=$1",
          [campaign.rows[0].id],
        )
      ).rows[0].count,
    ).toBe(0);

    const deleteAudit = await query(
      `SELECT map_id,details
         FROM audit_logs
        WHERE action='map.delete' AND resource_id=$1
        ORDER BY id DESC
        LIMIT 1`,
      [mapId],
    );
    expect(deleteAudit.rows[0].map_id).toBeNull();
    expect(deleteAudit.rows[0].details).toMatchObject({
      mapId,
      name: mapName,
      fileCleanup: "completed",
      directoryExisted: true,
    });
    const historicalAudit = await query(
      `SELECT COUNT(*)::int AS count
         FROM audit_logs
        WHERE action='map.create' AND resource_id=$1 AND map_id IS NULL`,
      [mapId],
    );
    expect(historicalAudit.rows[0].count).toBe(1);
    await expect(access(mapUploadDir)).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(
      (await readdir(config.uploadDir)).some((name) =>
        name.startsWith(`.deleting-map-${mapId}-`),
      ),
    ).toBe(false);
  });
});
