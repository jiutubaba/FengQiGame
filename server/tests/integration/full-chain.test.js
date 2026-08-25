import { access, readdir, rm } from "node:fs/promises";
import path from "node:path";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  bundlePreloadWorkspace,
  createPreloadWorkspace,
} from "../../../shared/preload-workspace.js";
import { app } from "../../app.js";
import { config } from "../../config.js";
import { closeDatabase, query } from "../../db/index.js";
import { migrate } from "../../db/migrate.js";
import {
  getAutomaticMetrics,
  recordMetricSessionEvent,
} from "../../services/metrics.js";
import { createUser } from "../../services/users.js";

const adminPassword = "Admin-password-2026!";
const userPassword = "User-password-2026!";
const updatedUserPassword = "User6!";

function expectNoEnvironmentFields(value) {
  expect(JSON.stringify(value)).not.toMatch(
    /\"(?:environment|runtimeEnv|runtime_env)\"/,
  );
}

describe.sequential("管理员、普通用户与游戏客户端全链路", () => {
  const admin = request.agent(app);
  const normalUser = request.agent(app);
  let mapId,
    userId,
    playerId,
    giftId,
    gameToken,
    gameKeyId,
    deniedMetricKeyId,
    metricKeyId,
    sharedMapToken,
    sharedMapKeyId,
    secondMapId,
    secondMapToken,
    secondMapKeyId,
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

  it("单运行空间基线不存在环境列", async () => {
    const fqBusinessTables = [
      "maps",
      "players",
      "gift_entitlements",
      "anchors",
      "tracking_points",
      "map_logs",
      "map_metrics",
      "api_keys",
      "player_messages",
      "lottery_campaigns",
      "leaderboards",
      "leaderboard_daily_collections",
      "risk_rules",
      "risk_events",
      "fq_player_archives",
      "fq_global_archives",
      "fq_metric_sessions",
      "fq_metric_session_activity",
    ];
    const tables = await query(
      `SELECT table_name
         FROM information_schema.tables
        WHERE table_schema=current_schema()
          AND table_name=ANY($1::text[])
        ORDER BY table_name`,
      [fqBusinessTables],
    );
    expect(tables.rows.map((row) => row.table_name)).toEqual(
      [...fqBusinessTables].sort(),
    );
    const forbiddenColumns = await query(
      `SELECT table_name,column_name
         FROM information_schema.columns
        WHERE table_schema=current_schema()
          AND table_name=ANY($1::text[])
          AND column_name IN ('environment','runtime_env')
        ORDER BY table_name,column_name`,
      [fqBusinessTables],
    );
    expect(forbiddenColumns.rows).toEqual([]);
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
      })
      .expect(201);
    mapId = mapResponse.body.data.id;
    expectNoEnvironmentFields(mapResponse.body);
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
    expectNoEnvironmentFields(maps.body);
    await normalUser.get(`/api/maps/${mapId}/metrics`).expect(200);
    await normalUser.get(`/api/maps/${mapId}/players`).expect(403);
    await normalUser.get("/api/admin/users").expect(403);
  });

  it("游戏客户端写入玩家，后台批量设置当前礼包资格，消息仍需确认领取", async () => {
    const keyResponse = await admin
      .post(`/api/maps/${mapId}/api-keys`)
      .send({
        name: "集成测试客户端",
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
    expectNoEnvironmentFields(keyResponse.body);

    const keyList = await admin.get(`/api/maps/${mapId}/api-keys`).expect(200);
    expect(keyList.body.data[0]).toMatchObject({
      id: gameKeyId,
      token_prefix: gameToken.slice(0, 12),
      token_available: true,
    });
    expect(keyList.body.data[0]).not.toHaveProperty("token");
    expectNoEnvironmentFields(keyList.body);
    await normalUser
      .get(`/api/maps/${mapId}/api-keys/${gameKeyId}`)
      .expect(403);
    const keyDetail = await admin
      .get(`/api/maps/${mapId}/api-keys/${gameKeyId}`)
      .expect(200);
    expect(keyDetail.body.data).toMatchObject({
      id: gameKeyId,
      token: gameToken,
      token_available: true,
    });
    expectNoEnvironmentFields(keyDetail.body);
    const storedKey = await query(
      "SELECT token_hash,token_ciphertext FROM api_keys WHERE id=$1",
      [gameKeyId],
    );
    expect(storedKey.rows[0].token_hash).not.toBe(gameToken);
    expect(storedKey.rows[0].token_ciphertext).not.toContain(gameToken);
    const viewAudit = await query(
      "SELECT details::text AS details FROM audit_logs WHERE action='api_key.view' AND resource_id=$1 ORDER BY id DESC LIMIT 1",
      [String(gameKeyId)],
    );
    expect(viewAudit.rows[0].details).toContain('"tokenAvailable": true');
    expect(viewAudit.rows[0].details).not.toContain(gameToken);

    const upsertedPlayers = await request(app)
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
          {
            uid: "player-002",
            name: "批量资格玩家",
            level: 5,
            gameLevel: "N1",
          },
          {
            uid: "player-003",
            name: "链路玩家",
            level: 1,
            gameLevel: "N1",
          },
          {
            uid: "player-004",
            name: "无资格玩家",
            level: 1,
            gameLevel: "N1",
          },
        ],
      })
      .expect(200);
    expect(upsertedPlayers.body).toEqual({ success: true });
    const players = await admin.get(`/api/maps/${mapId}/players`).expect(200);
    const playersByLevel = await admin
      .get(
        `/api/maps/${mapId}/players?sortBy=level&sortDirection=asc&limit=100`,
      )
      .expect(200);
    expect(playersByLevel.body.data.map((player) => player.level)).toEqual([
      1, 1, 5, 10,
    ]);
    expect(players.body.pagination).toMatchObject({
      page: 1,
      limit: 20,
      total: 4,
    });
    expect(players.body.data.every((player) => player.uidLocked)).toBe(true);
    const secondPlayerPage = await admin
      .get(`/api/maps/${mapId}/players?page=2&limit=2`)
      .expect(200);
    expect(secondPlayerPage.body.pagination).toMatchObject({
      page: 2,
      limit: 2,
      total: 4,
    });
    expect(secondPlayerPage.body.data).toHaveLength(2);
    expect(
      new Set([
        ...(
          await admin.get(`/api/maps/${mapId}/players?page=1&limit=2`)
        ).body.data.map((player) => player.id),
        ...secondPlayerPage.body.data.map((player) => player.id),
      ]).size,
    ).toBe(4);
    playerId = players.body.data.find(
      (player) => player.uid === "player-001",
    ).id;
    const secondPlayerId = players.body.data.find(
      (player) => player.uid === "player-002",
    ).id;
    const sameNamePlayerId = players.body.data.find(
      (player) => player.uid === "player-003",
    ).id;
    const unmatchedPlayerId = players.body.data.find(
      (player) => player.uid === "player-004",
    ).id;
    const lockedUidUpdate = await admin
      .patch(`/api/maps/${mapId}/players/${playerId}`)
      .send({ uid: "player-001-changed" })
      .expect(409);
    expect(lockedUidUpdate.body.error.code).toBe("PLAYER_UID_LOCKED");
    const lockedProfileUpdate = await admin
      .patch(`/api/maps/${mapId}/players/${playerId}`)
      .send({ level: 11 })
      .expect(200);
    expect(lockedProfileUpdate.body.data).toMatchObject({
      uid: "player-001",
      level: 11,
      uidLocked: true,
    });
    const placeholder = await admin
      .post(`/api/maps/${mapId}/players`)
      .send({ uid: "placeholder-old", name: "后台占位玩家" })
      .expect(201);
    expect(placeholder.body.data.uidLocked).toBe(false);
    const renamedPlaceholder = await admin
      .patch(`/api/maps/${mapId}/players/${placeholder.body.data.id}`)
      .send({ uid: "placeholder-new" })
      .expect(200);
    expect(renamedPlaceholder.body.data.uid).toBe("placeholder-new");
    const duplicateUid = await admin
      .patch(`/api/maps/${mapId}/players/${placeholder.body.data.id}`)
      .send({ uid: "player-004" })
      .expect(409);
    expect(duplicateUid.body.error.code).toBe("PLAYER_UID_CONFLICT");
    await admin
      .delete(`/api/maps/${mapId}/players/${placeholder.body.data.id}`)
      .expect(200);

    const giftResponse = await admin
      .post(`/api/maps/${mapId}/gifts`)
      .send({ giftKey: "chain_gift", name: "链路礼包" })
      .expect(201);
    giftId = giftResponse.body.data.id;
    expect(giftResponse.body.data.defaultValue).toBe(0);
    const businessPlaceholder = await admin
      .post(`/api/maps/${mapId}/players`)
      .send({ uid: "business-placeholder", name: "已有资格占位玩家" })
      .expect(201);
    await admin
      .put(`/api/maps/${mapId}/gifts/entitlements`)
      .send({
        playerIds: [businessPlaceholder.body.data.id],
        gifts: [{ giftId, value: 1 }],
      })
      .expect(200);
    const lockedBusinessUid = await admin
      .patch(`/api/maps/${mapId}/players/${businessPlaceholder.body.data.id}`)
      .send({ uid: "business-placeholder-changed" })
      .expect(409);
    expect(lockedBusinessUid.body.error.code).toBe("PLAYER_UID_LOCKED");
    const editableBusinessName = await admin
      .patch(`/api/maps/${mapId}/players/${businessPlaceholder.body.data.id}`)
      .send({ name: "资格玩家可改名" })
      .expect(200);
    expect(editableBusinessName.body.data).toMatchObject({
      uid: "business-placeholder",
      name: "资格玩家可改名",
      uidLocked: true,
    });
    await admin
      .delete(`/api/maps/${mapId}/players/${businessPlaceholder.body.data.id}`)
      .expect(200);
    await normalUser
      .put(`/api/maps/${mapId}/gifts/entitlements`)
      .send({
        playerIds: [playerId],
        gifts: [{ giftId, value: 2 }],
      })
      .expect(403);
    await admin
      .put(`/api/maps/${mapId}/gifts/entitlements`)
      .send({
        playerIds: [playerId, secondPlayerId],
        gifts: [{ giftId, value: 2 }],
      })
      .expect(200);
    await admin
      .put(`/api/maps/${mapId}/gifts/entitlements`)
      .send({
        playerIds: [sameNamePlayerId],
        gifts: [{ giftId, value: 5 }],
      })
      .expect(200);
    const entitlements = await admin
      .get(`/api/maps/${mapId}/gifts/entitlements`)
      .expect(200);
    expect(entitlements.body.data).toEqual([
      expect.objectContaining({ playerId, giftId, value: 2 }),
      expect.objectContaining({ playerId: secondPlayerId, giftId, value: 2 }),
      expect.objectContaining({ playerId: sameNamePlayerId, giftId, value: 5 }),
    ]);
    const giftsWithEntitlementCount = await admin
      .get(`/api/maps/${mapId}/gifts`)
      .expect(200);
    expect(
      giftsWithEntitlementCount.body.data.find((gift) => gift.id === giftId),
    ).toMatchObject({
      enabled: true,
      entitlementCount: 3,
    });
    const entitlementPlayers = await admin
      .get(`/api/maps/${mapId}/gifts/entitlements/players?page=2&limit=2`)
      .expect(200);
    expect(entitlementPlayers.body.pagination).toMatchObject({
      page: 2,
      limit: 2,
      total: 4,
    });
    expect(entitlementPlayers.body.data).toHaveLength(2);
    const entitlementSearch = await admin
      .get(`/api/maps/${mapId}/gifts/entitlements/players?q=批量资格`)
      .expect(200);
    expect(entitlementSearch.body.pagination.total).toBe(1);
    expect(entitlementSearch.body.data[0]).toMatchObject({
      id: secondPlayerId,
      entitlements: [expect.objectContaining({ giftId, value: 2 })],
    });
    await normalUser
      .get(`/api/maps/${mapId}/gifts/entitlements/players?giftIds=${giftId}`)
      .expect(403);
    const entitlementGiftFilter = await admin
      .get(`/api/maps/${mapId}/gifts/entitlements/players?giftIds=${giftId}`)
      .expect(200);
    expect(entitlementGiftFilter.body.pagination.total).toBe(3);
    expect(
      new Set(entitlementGiftFilter.body.data.map((player) => player.id)),
    ).toEqual(new Set([playerId, secondPlayerId, sameNamePlayerId]));
    const secondaryGift = await admin
      .post(`/api/maps/${mapId}/gifts`)
      .send({ giftKey: "filter_gift", name: "筛选专用礼包" })
      .expect(201);
    await admin
      .put(`/api/maps/${mapId}/gifts/entitlements`)
      .send({
        playerIds: [unmatchedPlayerId],
        gifts: [{ giftId: secondaryGift.body.data.id, value: 1 }],
      })
      .expect(200);
    const multiGiftFilter = await admin
      .get(
        `/api/maps/${mapId}/gifts/entitlements/players?giftIds=${giftId},${secondaryGift.body.data.id}`,
      )
      .expect(200);
    expect(multiGiftFilter.body.pagination.total).toBe(4);
    const combinedSearchAndGiftFilter = await admin
      .get(
        `/api/maps/${mapId}/gifts/entitlements/players?q=无资格&giftIds=${giftId}`,
      )
      .expect(200);
    expect(combinedSearchAndGiftFilter.body.pagination.total).toBe(0);
    await admin
      .get(`/api/maps/${mapId}/gifts/entitlements/players?giftIds=invalid`)
      .expect(400);
    await admin
      .delete(`/api/maps/${mapId}/gifts/${secondaryGift.body.data.id}`)
      .expect(200);
    await admin
      .post(`/api/maps/${mapId}/messages`)
      .send({
        playerIds: [playerId],
        subject: "链路消息",
        content: "这是一条集成测试消息",
      })
      .expect(201);

    const deliveries = await request(app)
      .post("/api/fq/deliveries/query")
      .set("fq-map-key", gameToken)
      .send({
        uids: ["player-001", "player-002", "player-003", "player-004"],
      })
      .expect(200);
    expect(deliveries.body.data.players[0].gifts).toHaveLength(1);
    expect(deliveries.body.data.players[0].gifts[0]).toEqual({
      gift_key: "chain_gift",
      value: 5,
    });
    expect(deliveries.body.data.players[0].messages).toHaveLength(1);
    expect(deliveries.body.data.players[0].messages[0]).toEqual({
      id: expect.anything(),
      subject: "链路消息",
      content: "这是一条集成测试消息",
      attachments: [],
    });
    expect(deliveries.body.data.players[1].gifts).toHaveLength(1);
    expect(deliveries.body.data.players[1].gifts[0].value).toBe(2);
    expect(deliveries.body.data.players[2].gifts).toEqual([
      expect.objectContaining({ gift_key: "chain_gift", value: 5 }),
    ]);
    expect(deliveries.body.data.players[2].messages).toHaveLength(0);
    expect(deliveries.body.data.players[3].gifts).toHaveLength(0);
    const giftsOnly = await request(app)
      .post("/api/fq/deliveries/query")
      .set("fq-map-key", gameToken)
      .send({ uids: ["player-001"], includeMessages: false })
      .expect(200);
    expect(giftsOnly.body.data.players[0]).toEqual({
      uid: "player-001",
      gifts: [{ gift_key: "chain_gift", value: 5 }],
    });
    const giftsOnlyKey = await admin
      .post(`/api/maps/${mapId}/api-keys`)
      .send({
        name: "仅礼包读取客户端",
        permissions: ["game.gifts.read"],
      })
      .expect(201);
    await request(app)
      .post("/api/fq/deliveries/query")
      .set("fq-map-key", giftsOnlyKey.body.data.token)
      .send({ uids: ["player-001"], includeMessages: false })
      .expect(200);
    await request(app)
      .post("/api/fq/deliveries/query")
      .set("fq-map-key", giftsOnlyKey.body.data.token)
      .send({ uids: ["player-001"] })
      .expect(403);
    const acknowledged = await request(app)
      .post(
        `/api/fq/messages/${deliveries.body.data.players[0].messages[0].id}/ack`,
      )
      .set("fq-map-key", gameToken)
      .send({ uid: "player-001" })
      .expect(200);
    expect(acknowledged.body).toEqual({ success: true });
    const clearedDeliveries = await request(app)
      .post("/api/fq/deliveries/query")
      .set("fq-map-key", gameToken)
      .send({ uids: ["player-001"] })
      .expect(200);
    expect(clearedDeliveries.body.data.players[0].gifts).toHaveLength(1);
    expect(clearedDeliveries.body.data.players[0].messages).toHaveLength(0);
    await admin
      .put(`/api/maps/${mapId}/gifts/entitlements`)
      .send({
        playerIds: [playerId, secondPlayerId, sameNamePlayerId],
        gifts: [{ giftId, value: 0 }],
      })
      .expect(200);
    const cancelled = await request(app)
      .post("/api/fq/deliveries/query")
      .set("fq-map-key", gameToken)
      .send({
        uids: ["player-001", "player-002", "player-003", "player-004"],
      })
      .expect(200);
    expect(cancelled.body.data.players[0].gifts).toHaveLength(0);
    expect(cancelled.body.data.players[1].gifts).toHaveLength(0);
    expect(cancelled.body.data.players[2].gifts).toHaveLength(0);
    expect(cancelled.body.data.players[3].gifts).toHaveLength(0);
    await admin
      .delete(`/api/maps/${mapId}/players/${secondPlayerId}`)
      .expect(200);
    await admin
      .delete(`/api/maps/${mapId}/players/${sameNamePlayerId}`)
      .expect(200);
    await admin
      .delete(`/api/maps/${mapId}/players/${unmatchedPlayerId}`)
      .expect(200);
  });

  it("FQ 存档支持首次读取、版本写入、幂等重放、冲突保护和存档封禁", async () => {
    const empty = await request(app)
      .post("/api/fq/bootstrap")
      .set("fq-map-key", gameToken)
      .send({ uids: ["player-001"] })
      .expect(200);
    expect(empty.body.data.mapId).toBe(mapId);
    expect(empty.body.data.preloadCode).toBe("");
    expectNoEnvironmentFields(empty.body);
    expect(empty.body.data.players[0]).toEqual({
      uid: "player-001",
      dataBanned: false,
      revision: 0,
      values: {},
    });
    expect(empty.body.data.global).toEqual({ revision: 0, values: {} });

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
    expect(firstSave.body).toEqual({
      success: true,
      data: { archive: { revision: 1 } },
    });

    const replayed = await request(app)
      .post("/api/fq/archives/players/player-001/save")
      .set("fq-map-key", gameToken)
      .send(firstSaveBody)
      .expect(200);
    expect(replayed.body).toEqual(firstSave.body);

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

    const globalSave = await request(app)
      .post("/api/fq/archives/global/save")
      .set("fq-map-key", gameToken)
      .send({
        requestId: "FQ-global-save-1",
        expectedRevision: 0,
        values: { season: 1, serverOpen: true },
      })
      .expect(200);
    expect(globalSave.body).toEqual({
      success: true,
      data: { archive: { revision: 1 } },
    });
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
      .put(`/api/maps/${mapId}/gifts/entitlements`)
      .send({ playerIds: [playerId], gifts: [{ giftId, value: 3 }] })
      .expect(200);
    await admin
      .patch(`/api/maps/${mapId}/players/${playerId}`)
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
    const bannedDeliveries = await request(app)
      .post("/api/fq/deliveries/query")
      .set("fq-map-key", gameToken)
      .send({ uids: ["player-001"] })
      .expect(200);
    expect(bannedDeliveries.body.data.players[0].messages).toEqual([]);
    expect(bannedDeliveries.body.data.players[0].gifts).toEqual([
      expect.objectContaining({ gift_key: "chain_gift", value: 3 }),
    ]);
    await admin
      .patch(`/api/maps/${mapId}/players/${playerId}`)
      .send({ dataBan: false })
      .expect(200);
    const archivedUidUpdate = await admin
      .patch(`/api/maps/${mapId}/players/${playerId}`)
      .send({ uid: "player-renamed" })
      .expect(409);
    expect(archivedUidUpdate.body.error.code).toBe("PLAYER_UID_LOCKED");
    const preservedArchive = await request(app)
      .get("/api/fq/archives/players/player-001")
      .set("fq-map-key", gameToken)
      .expect(200);
    expect(preservedArchive.body.data).toEqual({
      revision: 1,
      values: firstSaveBody.values,
    });

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
    const metrics = await admin.get(`/api/maps/${mapId}/metrics`).expect(200);
    const logs = await admin.get(`/api/maps/${mapId}/logs`).expect(200);
    expect(metrics.body.data.source).toBe("snapshot");
    expect(metrics.body.data.summary.cumulativeUsers).toBe(1);
    expect(metrics.body.data.summary.validGameCount).toBeNull();
    expect(logs.body.data[0].context).toBe("[integration] chain ok");
  });

  it("自动指标会话幂等、隔离、在线状态及 11 项公式均按北京时间聚合", async () => {
    const deniedKey = await admin
      .post(`/api/maps/${mapId}/api-keys`)
      .send({
        name: "无指标权限客户端",
        permissions: ["game.players.write"],
      })
      .expect(201);
    deniedMetricKeyId = deniedKey.body.data.id;
    await request(app)
      .post("/api/fq/metrics/sessions/start")
      .set("fq-map-key", deniedKey.body.data.token)
      .send({ sessionId: "denied-session", uids: ["metric-user"] })
      .expect(403);

    const metricKey = await admin
      .post(`/api/maps/${mapId}/api-keys`)
      .send({
        name: "自动指标客户端",
        permissions: ["game.metrics.write"],
      })
      .expect(201);
    metricKeyId = metricKey.body.data.id;
    const metricToken = metricKey.body.data.token;
    const sessionStart = {
      sessionId: "metric-room-1",
      uids: ["same-uid", "same-uid"],
    };
    const firstMetricStart = await request(app)
      .post("/api/fq/metrics/sessions/start")
      .set("fq-map-key", metricToken)
      .send(sessionStart)
      .expect(200);
    expect(firstMetricStart.body).toEqual({ success: true });
    await request(app)
      .post("/api/fq/metrics/sessions/start")
      .set("fq-map-key", metricToken)
      .send(sessionStart)
      .expect(200);
    await request(app)
      .post("/api/fq/metrics/sessions/heartbeat")
      .set("fq-map-key", metricToken)
      .send({ sessionId: "missing-session", uids: [] })
      .expect(404);
    await request(app)
      .post("/api/fq/metrics/sessions/start")
      .set("fq-map-key", metricToken)
      .send({
        sessionId: "too-many-uids",
        uids: Array.from({ length: 25 }, (_, index) => `uid-${index}`),
      })
      .expect(400);

    let automaticMetrics = await getAutomaticMetrics(mapId);
    expect(automaticMetrics.rows.at(-1)).toMatchObject({
      cumulative_users: "1",
      online_users: "1",
      total_game_count: "0",
      valid_game_count: "0",
    });
    await request(app)
      .post("/api/fq/metrics/sessions/start")
      .set("fq-map-key", metricToken)
      .send({ sessionId: "metric-room-2", uids: ["same-uid"] })
      .expect(200);
    automaticMetrics = await getAutomaticMetrics(mapId);
    expect(automaticMetrics.rows.at(-1).online_users).toBe("1");
    await request(app)
      .post("/api/fq/metrics/sessions/end")
      .set("fq-map-key", metricToken)
      .send({ sessionId: "metric-room-1", uids: ["same-uid"] })
      .expect(200);
    automaticMetrics = await getAutomaticMetrics(mapId);
    expect(automaticMetrics.rows.at(-1).online_users).toBe("1");
    await request(app)
      .post("/api/fq/metrics/sessions/end")
      .set("fq-map-key", metricToken)
      .send({ sessionId: "metric-room-2", uids: ["same-uid"] })
      .expect(200);
    automaticMetrics = await getAutomaticMetrics(mapId);
    expect(automaticMetrics.rows.at(-1).online_users).toBe("0");

    const timeoutNow = new Date();
    await recordMetricSessionEvent({
      mapId,
      sessionId: "metric-timeout-room",
      uids: ["same-uid"],
      event: "start",
      now: new Date(timeoutNow.getTime() - 121_000),
    });
    automaticMetrics = await getAutomaticMetrics(mapId, timeoutNow);
    expect(automaticMetrics.rows.at(-1).online_users).toBe("0");
    await request(app)
      .post("/api/fq/metrics/sessions/heartbeat")
      .set("fq-map-key", metricToken)
      .send({ sessionId: "metric-timeout-room", uids: ["same-uid"] })
      .expect(200);
    automaticMetrics = await getAutomaticMetrics(mapId);
    expect(automaticMetrics.rows.at(-1).online_users).toBe("1");
    await request(app)
      .post("/api/fq/metrics/sessions/end")
      .set("fq-map-key", metricToken)
      .send({ sessionId: "metric-timeout-room", uids: ["same-uid"] })
      .expect(200);

    const metricEvent = (sessionId, uids, now) =>
      recordMetricSessionEvent({
        mapId,
        sessionId,
        uids,
        event: "start",
        now,
      });
    await metricEvent(
      "formula-d0",
      ["u1", "u2", "u3", "u4"],
      "2026-01-01T04:00:00Z",
    );
    await metricEvent("formula-d1", ["u1", "u5"], "2026-01-02T04:00:00Z");
    await metricEvent("formula-d7-1", ["u2", "u4"], "2026-01-08T04:00:00Z");
    await metricEvent("formula-d7-2", ["u4"], "2026-01-08T05:00:00Z");
    await metricEvent("formula-d7-3", ["u4"], "2026-01-08T06:00:00Z");
    await metricEvent("formula-d7-4", ["u4"], "2026-01-08T07:00:00Z");
    await metricEvent("formula-return", ["u3"], "2026-02-01T04:00:00Z");

    const d1 = await getAutomaticMetrics(mapId, "2026-01-02T12:00:00Z");
    expect(d1.rows.at(-1)).toMatchObject({
      cumulative_users: "5",
      total_game_count: "0",
      valid_game_count: "0",
      daily_new_users: "1",
      daily_active_users: "2",
      active_user_retention_rate: "25.00",
      active_user_retained_count: "1",
      active_user_cohort_count: "4",
      new_user_retention_rate: "25.00",
      new_user_retained_count: "1",
      new_user_cohort_count: "4",
    });
    expect(Number(d1.rows.at(-1).seven_day_retention_rate)).toBe(0);
    expect(Number(d1.rows.at(-1).replay_rate)).toBe(0);
    const d7 = await getAutomaticMetrics(mapId, "2026-01-08T12:00:00Z");
    expect(d7.rows.at(-1)).toMatchObject({
      daily_active_users: "2",
      seven_day_retention_rate: "50.00",
      seven_day_retained_count: "2",
      seven_day_cohort_count: "4",
      replay_rate: "50.00",
      replay_user_count: "1",
      replay_cohort_count: "2",
    });
    const d30 = await getAutomaticMetrics(mapId, "2026-01-31T12:00:00Z");
    expect(d30.rows.at(-1).lost_user_count).toBe("1");
    const returned = await getAutomaticMetrics(mapId, "2026-02-01T12:00:00Z");
    expect(returned.rows.at(-1)).toMatchObject({
      cumulative_users: "5",
      online_users: "0",
      total_game_count: "0",
      valid_game_count: "0",
      daily_new_users: "0",
      daily_active_users: "1",
      lost_user_count: "2",
      return_user_count: "1",
    });
    expect(Number(returned.rows.at(-1).active_user_retention_rate)).toBe(0);
    expect(Number(returned.rows.at(-1).new_user_retention_rate)).toBe(0);
    expect(Number(returned.rows.at(-1).seven_day_retention_rate)).toBe(0);
    expect(Number(returned.rows.at(-1).replay_rate)).toBe(0);

    await recordMetricSessionEvent({
      mapId,
      sessionId: "duration-exact-ten",
      uids: ["same-uid"],
      event: "start",
      now: "2026-04-01T04:00:00Z",
    });
    await recordMetricSessionEvent({
      mapId,
      sessionId: "duration-exact-ten",
      uids: ["same-uid"],
      event: "end",
      now: "2026-04-01T04:10:00Z",
    });
    await recordMetricSessionEvent({
      mapId,
      sessionId: "duration-exact-ten",
      uids: ["same-uid"],
      event: "end",
      now: "2026-04-02T04:10:01Z",
    });
    await recordMetricSessionEvent({
      mapId,
      sessionId: "duration-over-ten",
      uids: ["same-uid"],
      event: "start",
      now: "2026-04-01T05:00:00Z",
    });
    await recordMetricSessionEvent({
      mapId,
      sessionId: "duration-over-ten",
      uids: ["same-uid"],
      event: "end",
      now: "2026-04-01T05:10:01Z",
    });
    await recordMetricSessionEvent({
      mapId,
      sessionId: "duration-heartbeat",
      uids: ["same-uid"],
      event: "start",
      now: "2026-04-02T05:00:00Z",
    });
    await recordMetricSessionEvent({
      mapId,
      sessionId: "duration-heartbeat",
      uids: ["same-uid"],
      event: "heartbeat",
      now: "2026-04-02T05:11:00Z",
    });
    await recordMetricSessionEvent({
      mapId,
      sessionId: "duration-cross-midnight",
      uids: ["same-uid"],
      event: "start",
      now: "2026-04-03T15:55:00Z",
    });
    await recordMetricSessionEvent({
      mapId,
      sessionId: "duration-cross-midnight",
      uids: ["same-uid"],
      event: "end",
      now: "2026-04-03T16:06:00Z",
    });
    const aprilMetrics = await getAutomaticMetrics(
      mapId,
      "2026-04-04T04:00:00Z",
    );
    expect(aprilMetrics.rows.at(-4)).toMatchObject({
      total_game_count: "1",
      valid_game_count: "1",
    });
    expect(aprilMetrics.rows.at(-3)).toMatchObject({
      total_game_count: "2",
      valid_game_count: "1",
    });
    expect(aprilMetrics.rows.at(-2)).toMatchObject({
      total_game_count: "3",
      valid_game_count: "1",
    });
    expect(aprilMetrics.rows.at(-1)).toMatchObject({
      total_game_count: "3",
      valid_game_count: "0",
    });
    const automatic = await admin.get(`/api/maps/${mapId}/metrics`).expect(200);
    expect(automatic.body.data.source).toBe("automatic");
    expect(automatic.body.data.epochDate).toBe("2026-01-01");
    expect(automatic.body.data.summary.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(
      automatic.body.data.trends.every((item) =>
        /^\d{4}-\d{2}-\d{2}$/.test(item.date),
      ),
    ).toBe(true);
    expect(automatic.body.data.summary.cumulativeUsers).toBe(6);
    expect(automatic.body.data.summary.validGameCount).toBe(0);
    const mapCenter = await admin.get("/api/maps").expect(200);
    expect(mapCenter.body.data[0]).toMatchObject({
      cumulativeUsers: 6,
      totalGameCount: 3,
    });

    await recordMetricSessionEvent({
      mapId,
      sessionId: "cross-midnight-replay",
      uids: ["cross-midnight-user"],
      event: "start",
      now: "2026-03-01T15:59:00Z",
    });
    await recordMetricSessionEvent({
      mapId,
      sessionId: "cross-midnight-replay",
      uids: ["cross-midnight-user"],
      event: "start",
      now: "2026-03-01T16:01:00Z",
    });
    await recordMetricSessionEvent({
      mapId,
      sessionId: "cross-midnight-replay",
      uids: ["cross-midnight-user"],
      event: "end",
      now: "2026-03-01T16:02:00Z",
    });
    await recordMetricSessionEvent({
      mapId,
      sessionId: "cross-midnight-replay",
      uids: ["cross-midnight-user"],
      event: "end",
      now: "2026-03-02T16:02:00Z",
    });
    await recordMetricSessionEvent({
      mapId,
      sessionId: "cross-midnight-replay",
      uids: ["late-heartbeat-user"],
      event: "heartbeat",
      now: "2026-03-03T04:00:00Z",
    });
    const replayedActivity = await query(
      `SELECT player_uid,TO_CHAR(active_date,'YYYY-MM-DD') AS active_date
         FROM fq_metric_session_activity
        WHERE map_id=$1 AND session_id='cross-midnight-replay'
        ORDER BY active_date,player_uid`,
      [mapId],
    );
    expect(replayedActivity.rows).toEqual([
      { player_uid: "cross-midnight-user", active_date: "2026-03-01" },
      { player_uid: "cross-midnight-user", active_date: "2026-03-02" },
    ]);
  });

  it("地图局部编辑、地图配置和系统设置均能持久化", async () => {
    const patched = await admin
      .patch(`/api/maps/${mapId}`)
      .send({ name: "全链路验收地图" })
      .expect(200);
    expect(patched.body.data.description).toBe("integration");
    expectNoEnvironmentFields(patched.body);

    await admin
      .put(`/api/admin/users/${userId}/maps/${mapId}`)
      .send({ permissions: ["map.view", "metrics.view", "map.edit"] })
      .expect(200);
    const deniedPreload = await normalUser
      .put(`/api/maps/${mapId}/config`)
      .send({
        preloadWorkspace: {
          version: 1,
          entry: "main.lua",
          folders: [],
          files: [{ path: "main.lua", content: "return false" }],
        },
      })
      .expect(403);
    expect(deniedPreload.body.error.code).toBe("FORBIDDEN");
    await admin
      .put(`/api/admin/users/${userId}/maps/${mapId}`)
      .send({ permissions: ["map.view", "metrics.view"] })
      .expect(200);

    const legacyPreloadSource = "-- 旧版接口注释\nreturn   true";
    const legacyPreloadBundle = bundlePreloadWorkspace(
      createPreloadWorkspace(legacyPreloadSource),
    );
    const configResponse = await admin
      .put(`/api/maps/${mapId}/config`)
      .send({
        ranks: [{ id: "rank-1", name: "青铜" }],
        globals: [{ key: "season", value: 1 }],
        preloadCode: legacyPreloadSource,
      })
      .expect(200);
    expect(configResponse.body.data.ranks).toHaveLength(1);
    const loadedConfig = await admin
      .get(`/api/maps/${mapId}/config`)
      .expect(200);
    expect(loadedConfig.body.data.preloadCode).toBe(legacyPreloadBundle);
    expect(loadedConfig.body.data.preloadWorkspace).toEqual({
      version: 1,
      entry: "main.lua",
      folders: [],
      files: [{ path: "main.lua", content: legacyPreloadSource }],
    });

    const preloadWorkspace = {
      version: 1,
      entry: "main.lua",
      folders: ["scripts"],
      files: [
        {
          path: "main.lua",
          content:
            'local config = require("scripts/config.lua")\nreturn config.enabled',
        },
        {
          path: "scripts/config.lua",
          content: "return { enabled = true }",
        },
      ],
    };
    const workspaceResponse = await admin
      .put(`/api/maps/${mapId}/config`)
      .send({
        preloadWorkspace,
        expectedUpdatedAt: loadedConfig.body.data.updatedAt,
      })
      .expect(200);
    const bundledPreload = bundlePreloadWorkspace(preloadWorkspace);
    expect(workspaceResponse.body.data.preloadCode).toBe(bundledPreload);
    expect(workspaceResponse.body.data.preloadWorkspace).toEqual(
      preloadWorkspace,
    );
    const preloadBootstrap = await request(app)
      .post("/api/fq/bootstrap")
      .set("fq-map-key", gameToken)
      .send({ uids: ["player-001"] })
      .expect(200);
    expect(preloadBootstrap.body.data.preloadCode).toBe(bundledPreload);
    const stalePreload = await admin
      .put(`/api/maps/${mapId}/config`)
      .send({
        preloadWorkspace,
        expectedUpdatedAt: loadedConfig.body.data.updatedAt,
      })
      .expect(409);
    expect(stalePreload.body.error.code).toBe("CONFLICT");
    await admin
      .put(`/api/maps/${mapId}/config`)
      .send({ preloadCode: "x".repeat(256 * 1024) })
      .expect(200);
    await admin
      .put(`/api/maps/${mapId}/config`)
      .send({ preloadCode: "-- 可移除注释\n".repeat(25_000) })
      .expect(200);
    await admin
      .put(`/api/maps/${mapId}/config`)
      .send({ preloadCode: "x".repeat(256 * 1024 + 1) })
      .expect(400);

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
      .post(`/api/maps/${mapId}/anchors`)
      .send({
        name: "验收主播",
        enabled: true,
        giftConfig: { ticket: 2 },
      })
      .expect(201);
    anchorId = anchor.body.data.id;
    const anchorUpdated = await admin
      .patch(`/api/maps/${mapId}/anchors/${anchorId}`)
      .send({ enabled: false })
      .expect(200);
    expect(anchorUpdated.body.data.enabled).toBe(false);
    expect(anchorUpdated.body.data.giftConfig).toEqual({ ticket: 2 });

    const point = await admin
      .post(`/api/maps/${mapId}/points`)
      .send({ pointKey: "acceptance_start", name: "验收开始" })
      .expect(201);
    pointId = point.body.data.id;
    await request(app)
      .post("/api/fq/points/acceptance_start/increment")
      .set("fq-map-key", gameToken)
      .send({ amount: 3 })
      .expect(200);
    const points = await admin.get(`/api/maps/${mapId}/points`).expect(200);
    expect(points.body.data[0].id).toBe(pointId);
    expect(points.body.data[0].triggerCount).toBe(3);
  });

  it("排行榜发布快照、风险事件幂等上报与玩家封禁形成闭环", async () => {
    await normalUser.get(`/api/maps/${mapId}/leaderboards`).expect(403);
    await normalUser.get(`/api/maps/${mapId}/risk/events`).expect(403);

    const leaderboard = await admin
      .post(`/api/maps/${mapId}/leaderboards`)
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
    await admin
      .patch(`/api/maps/${mapId}/leaderboards/${leaderboardId}`)
      .send({ leaderboardKey: "renamed-key" })
      .expect(400);
    await admin
      .post(`/api/maps/${mapId}/leaderboards/${leaderboardId}/publish`)
      .send({ limit: 101 })
      .expect(400);
    const unpublished = await request(app)
      .post("/api/fq/leaderboards/landing_power_v1/query")
      .set("fq-map-key", gameToken)
      .send({ uids: ["player-001"] })
      .expect(200);
    expect(unpublished.body.data).toEqual({
      published: false,
      publishedAtText: "",
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
    expect(firstUpload.body).toEqual({ success: true });
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
      .get(`/api/maps/${mapId}/leaderboards/${leaderboardId}/entries`)
      .expect(200);
    expect(live.body.data.entries.map((item) => item.uid)).toEqual([
      "player-001",
      "player-002",
    ]);
    const deletionProbe = await request(app)
      .post("/api/fq/leaderboards/landing_power_v1/entries")
      .set("fq-map-key", gameToken)
      .send({
        entries: [
          {
            uid: "daily-delete-probe",
            name: "当日删除门闩测试",
            score: 1,
          },
        ],
      })
      .expect(200);
    expect(deletionProbe.body).toEqual({ success: true });
    const liveWithProbe = await admin
      .get(`/api/maps/${mapId}/leaderboards/${leaderboardId}/entries`)
      .expect(200);
    const probeEntry = liveWithProbe.body.data.entries.find(
      (entry) => entry.uid === "daily-delete-probe",
    );
    await admin
      .delete(
        `/api/maps/${mapId}/leaderboards/${leaderboardId}/entries/${probeEntry.id}`,
      )
      .expect(200);
    const retryAfterDeletion = await request(app)
      .post("/api/fq/leaderboards/landing_power_v1/entries")
      .set("fq-map-key", gameToken)
      .send({
        entries: [
          {
            uid: "daily-delete-probe",
            name: "当日删除门闩测试",
            score: 2,
          },
        ],
      })
      .expect(200);
    expect(retryAfterDeletion.body).toEqual({ success: true });
    const liveAfterRetry = await admin
      .get(`/api/maps/${mapId}/leaderboards/${leaderboardId}/entries`)
      .expect(200);
    expect(
      liveAfterRetry.body.data.entries.some(
        (entry) => entry.uid === "daily-delete-probe",
      ),
    ).toBe(false);
    const snapshot = await admin
      .post(`/api/maps/${mapId}/leaderboards/${leaderboardId}/publish`)
      .send({ limit: 100 })
      .expect(201);
    expect(snapshot.body.data.entryCount).toBe(2);

    const firstPublished = await request(app)
      .post("/api/fq/leaderboards/landing_power_v1/query")
      .set("fq-map-key", gameToken)
      .send({ uids: ["player-001", "missing-player"], limit: 100 })
      .expect(200);
    expect(firstPublished.body.data.published).toBe(true);
    expect(firstPublished.body.data.entries.map((item) => item.name)).toEqual([
      "链路玩家",
      "候补玩家",
    ]);
    expect(firstPublished.body.data.playerRanks).toEqual([
      { rank: 1, uid: "player-001" },
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
    expect(skippedSameDay.body).toEqual({ success: true });
    const liveAfterSameDayRetry = await admin
      .get(`/api/maps/${mapId}/leaderboards/${leaderboardId}/entries`)
      .expect(200);
    expect(
      liveAfterSameDayRetry.body.data.entries.find(
        (entry) => entry.uid === "player-001",
      ),
    ).toMatchObject({ name: "链路玩家", score: 9900 });

    await query(
      `UPDATE leaderboard_entries SET last_submitted_on=(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai')::date-1
        WHERE leaderboard_id=$1 AND player_uid='player-001'`,
      [leaderboardId],
    );
    await query(
      `UPDATE leaderboard_daily_collections
          SET collection_date=(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai')::date-1
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
      concurrentDailyUploads.every(
        (response) =>
          response.body.success === true && response.body.data === undefined,
      ),
    ).toBe(true);
    const currentDailyCollections = await query(
      `SELECT COUNT(*)::int AS count
         FROM leaderboard_daily_collections
        WHERE leaderboard_id=$1 AND player_uid='player-001'
          AND collection_date=(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai')::date`,
      [leaderboardId],
    );
    expect(currentDailyCollections.rows[0].count).toBe(1);

    const beforeRepublish = await request(app)
      .post("/api/fq/leaderboards/landing_power_v1/query")
      .set("fq-map-key", gameToken)
      .send({ uids: ["player-001"] })
      .expect(200);
    expect(beforeRepublish.body.data.entries[0]).toMatchObject({
      name: "链路玩家",
      score: 9900,
    });
    expect(beforeRepublish.body.data.playerRanks[0]).toEqual({
      rank: 1,
      uid: "player-001",
    });
    await admin
      .post(`/api/maps/${mapId}/leaderboards/${leaderboardId}/publish`)
      .send({ limit: 100 })
      .expect(201);
    const afterRepublish = await request(app)
      .post("/api/fq/leaderboards/landing_power_v1/query")
      .set("fq-map-key", gameToken)
      .send({ uids: ["player-001"] })
      .expect(200);
    expect(afterRepublish.body.data.entries[0]).toMatchObject({
      name: "链路玩家新名",
      score: 12000,
    });
    expect(afterRepublish.body.data.playerRanks[0]).toEqual({
      rank: 1,
      uid: "player-001",
    });

    const writeOnlyKey = await admin
      .post(`/api/maps/${mapId}/api-keys`)
      .send({
        name: "仅读榜权限拒绝测试",
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
      .post(`/api/maps/${mapId}/risk/rules`)
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
      .get(`/api/maps/${mapId}/risk/events?status=open`)
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
    await normalUser.get(`/api/maps/${mapId}/leaderboards`).expect(200);
    await normalUser.get(`/api/maps/${mapId}/risk/events`).expect(200);
    await normalUser
      .post(`/api/maps/${mapId}/leaderboards`)
      .send({ leaderboardKey: "forbidden", name: "无权限榜单" })
      .expect(403);

    await admin
      .patch(`/api/maps/${mapId}/risk/events/${reported.body.data.id}`)
      .send({
        status: "blocked",
        rankBan: true,
        note: "集成测试确认封禁",
      })
      .expect(200);
    const liveAfterBlock = await admin
      .get(`/api/maps/${mapId}/leaderboards/${leaderboardId}/entries`)
      .expect(200);
    expect(liveAfterBlock.body.data.entries.map((item) => item.uid)).toEqual([
      "player-002",
    ]);
    const published = await admin
      .get(
        `/api/maps/${mapId}/leaderboards/${leaderboardId}/entries?snapshotId=${snapshot.body.data.id}`,
      )
      .expect(200);
    expect(published.body.data.entries).toHaveLength(2);
    const remainingLiveEntry = liveAfterBlock.body.data.entries[0];
    await normalUser
      .post(
        `/api/maps/${mapId}/leaderboards/${leaderboardId}/entries/${remainingLiveEntry.id}/rank-ban`,
      )
      .expect(403);
    const rankBan = await admin
      .post(
        `/api/maps/${mapId}/leaderboards/${leaderboardId}/entries/${remainingLiveEntry.id}/rank-ban`,
      )
      .expect(200);
    expect(rankBan.body.data).toMatchObject({
      entryId: remainingLiveEntry.id,
      uid: "player-002",
      rankBan: true,
    });
    const liveAfterRankBan = await admin
      .get(`/api/maps/${mapId}/leaderboards/${leaderboardId}/entries`)
      .expect(200);
    expect(liveAfterRankBan.body.data.entries).toHaveLength(0);
    const publishedAfterRankBan = await admin
      .get(
        `/api/maps/${mapId}/leaderboards/${leaderboardId}/entries?snapshotId=${snapshot.body.data.id}`,
      )
      .expect(200);
    expect(publishedAfterRankBan.body.data.entries).toHaveLength(2);
    const players = await admin.get(`/api/maps/${mapId}/players`).expect(200);
    expect(
      players.body.data.find((item) => item.uid === "player-001").rankBan,
    ).toBe(true);
    expect(
      players.body.data.find((item) => item.uid === "player-002").rankBan,
    ).toBe(true);
    const rankBanAudit = await query(
      `SELECT action,resource_type,details FROM audit_logs
        WHERE map_id=$1 AND action='leaderboard.player.ban'
        ORDER BY id DESC LIMIT 1`,
      [mapId],
    );
    expect(rankBanAudit.rows[0]).toMatchObject({
      action: "leaderboard.player.ban",
      resource_type: "player",
      details: {
        leaderboardId,
        entryId: remainingLiveEntry.id,
        uid: "player-002",
      },
    });
    await query("DELETE FROM players WHERE id=$1 AND map_id=$2", [
      rankBan.body.data.playerId,
      mapId,
    ]);
  });

  it("同地图多 Key 共享数据，同 UID 在不同地图仍隔离", async () => {
    const sharedKeyResponse = await admin
      .post(`/api/maps/${mapId}/api-keys`)
      .send({
        name: "同地图轮换客户端",
        permissions: [
          "game.players.write",
          "game.archives.read",
          "game.archives.write",
        ],
      })
      .expect(201);
    sharedMapToken = sharedKeyResponse.body.data.token;
    sharedMapKeyId = sharedKeyResponse.body.data.id;
    expectNoEnvironmentFields(sharedKeyResponse.body);

    const sharedBootstrap = await request(app)
      .post("/api/fq/bootstrap")
      .set("fq-map-key", sharedMapToken)
      .send({ uids: ["player-001"] })
      .expect(200);
    expect(sharedBootstrap.body.data.mapId).toBe(mapId);
    expectNoEnvironmentFields(sharedBootstrap.body);
    expect(sharedBootstrap.body.data.players[0].values.gold).toBe(100);

    const secondMap = await admin
      .post("/api/maps")
      .send({ name: "第二张隔离地图", description: "integration isolation" })
      .expect(201);
    secondMapId = secondMap.body.data.id;
    expectNoEnvironmentFields(secondMap.body);
    const secondKey = await admin
      .post(`/api/maps/${secondMapId}/api-keys`)
      .send({
        name: "第二地图客户端",
        permissions: [
          "game.players.write",
          "game.archives.read",
          "game.archives.write",
        ],
      })
      .expect(201);
    secondMapToken = secondKey.body.data.token;
    secondMapKeyId = secondKey.body.data.id;
    expectNoEnvironmentFields(secondKey.body);

    await request(app)
      .post("/api/fq/players/upsert")
      .set("fq-map-key", secondMapToken)
      .send({
        players: [{ uid: "player-001", name: "第二地图同 UID 玩家", level: 3 }],
      })
      .expect(200);
    await request(app)
      .post("/api/fq/archives/players/player-001/save")
      .set("fq-map-key", secondMapToken)
      .send({
        requestId: "FQ-second-map-player-001",
        expectedRevision: 0,
        values: { map: "second" },
      })
      .expect(200);

    const firstMapPlayers = await admin
      .get(`/api/maps/${mapId}/players`)
      .expect(200);
    const secondMapPlayers = await admin
      .get(`/api/maps/${secondMapId}/players`)
      .expect(200);
    expect(firstMapPlayers.body.data).toHaveLength(1);
    expect(firstMapPlayers.body.data[0].name).toBe("链路玩家");
    expect(secondMapPlayers.body.data).toHaveLength(1);
    expect(secondMapPlayers.body.data[0].name).toBe("第二地图同 UID 玩家");

    const [primaryArchive, sharedArchive, secondArchive] = await Promise.all([
      request(app)
        .get("/api/fq/archives/players/player-001")
        .set("fq-map-key", gameToken),
      request(app)
        .get("/api/fq/archives/players/player-001")
        .set("fq-map-key", sharedMapToken),
      request(app)
        .get("/api/fq/archives/players/player-001")
        .set("fq-map-key", secondMapToken),
    ]);
    expect(primaryArchive.body.data.values.gold).toBe(100);
    expect(sharedArchive.body.data.values.gold).toBe(100);
    expect(secondArchive.body.data.values.map).toBe("second");

    await admin
      .delete(`/api/maps/${secondMapId}/api-keys/${secondMapKeyId}`)
      .expect(200);
    await admin.delete(`/api/maps/${secondMapId}`).expect(200);
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

  it("公开抽奖支持报名、防重复、开奖、状态受控永久删除与级联清理", async () => {
    const campaign = await admin
      .post(`/api/maps/${mapId}/lotteries`)
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

    await normalUser
      .delete(`/api/maps/${mapId}/lotteries/${campaignId}/permanent`)
      .expect(403);
    await admin
      .delete(`/api/maps/${secondMapId}/lotteries/${campaignId}/permanent`)
      .expect(404);
    const entriesBeforeDelete = await query(
      "SELECT COUNT(*)::int AS count FROM lottery_entries WHERE campaign_id=$1",
      [campaignId],
    );
    expect(entriesBeforeDelete.rows[0].count).toBe(2);
    await admin
      .delete(`/api/maps/${mapId}/lotteries/${campaignId}/permanent`)
      .expect(200);
    await request(app).get(`/api/public/lotteries/${token}`).expect(404);
    const entriesAfterDelete = await query(
      "SELECT COUNT(*)::int AS count FROM lottery_entries WHERE campaign_id=$1",
      [campaignId],
    );
    expect(entriesAfterDelete.rows[0].count).toBe(0);

    const futureCampaign = await admin
      .post(`/api/maps/${mapId}/lotteries`)
      .send({
        title: "未到期群抽",
        drawAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      })
      .expect(201);
    const futureCampaignId = futureCampaign.body.data.id;
    const blockedDelete = await admin
      .delete(`/api/maps/${mapId}/lotteries/${futureCampaignId}/permanent`)
      .expect(409);
    expect(blockedDelete.body.error.code).toBe("LOTTERY_DELETE_NOT_ALLOWED");
    await admin
      .delete(`/api/maps/${mapId}/lotteries/${futureCampaignId}`)
      .expect(200);
    await admin
      .delete(`/api/maps/${mapId}/lotteries/${futureCampaignId}/permanent`)
      .expect(200);

    const expiredCampaign = await admin
      .post(`/api/maps/${mapId}/lotteries`)
      .send({
        title: "已到期未开奖群抽",
        drawAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      })
      .expect(201);
    const expiredCampaignId = expiredCampaign.body.data.id;
    await admin
      .delete(`/api/maps/${mapId}/lotteries/${expiredCampaignId}/permanent`)
      .expect(200);
    const campaigns = await admin
      .get(`/api/maps/${mapId}/lotteries`)
      .expect(200);
    expect(
      campaigns.body.data.some((item) =>
        [campaignId, futureCampaignId, expiredCampaignId].includes(item.id),
      ),
    ).toBe(false);
    const deleteAudits = await query(
      `SELECT resource_id FROM audit_logs
        WHERE action='lottery.delete' AND map_id=$1
        ORDER BY id`,
      [mapId],
    );
    expect(deleteAudits.rows.map((row) => Number(row.resource_id))).toEqual([
      campaignId,
      futureCampaignId,
      expiredCampaignId,
    ]);
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
      .send({ confirmName: "全链路验收地图" })
      .expect(403);
    await admin.get("/api/system/status").expect(200);
    const audit = await admin.get("/api/system/audit?limit=100").expect(200);
    expect(audit.body.data.some((item) => item.action === "lottery.draw")).toBe(
      true,
    );
    expect(
      audit.body.data.some((item) => item.action === "gift.entitlements.set"),
    ).toBe(true);
    await admin
      .post(`/api/maps/${mapId}/runtime/clear`)
      .send({ confirmName: "名称不匹配" })
      .expect(409);
    const cleared = await admin
      .post(`/api/maps/${mapId}/runtime/clear`)
      .send({ confirmName: "全链路验收地图" })
      .expect(200);
    expect(cleared.body.data.players).toBe(1);
    expect(cleared.body.data.logs).toBe(1);
    expect(cleared.body.data.metrics).toBe(1);
    expect(cleared.body.data.automaticMetricSessions).toBe(15);
    expect(cleared.body.data.leaderboardEntries).toBe(2);
    expect(cleared.body.data.leaderboardSnapshots).toBe(2);
    expect(cleared.body.data.leaderboardDailyCollections).toBe(4);
    expect(cleared.body.data.riskEvents).toBe(1);
    expect(cleared.body.data.playerArchives).toBe(2);
    expect(cleared.body.data.globalArchives).toBe(1);
    expect(cleared.body.data.entitlements).toBe(1);
    const pointsAfterClear = await admin
      .get(`/api/maps/${mapId}/points`)
      .expect(200);
    expect(pointsAfterClear.body.data[0].triggerCount).toBe(0);

    await admin.delete(`/api/maps/${mapId}/anchors/${anchorId}`).expect(200);
    await admin.delete(`/api/maps/${mapId}/points/${pointId}`).expect(200);
    await admin.delete(`/api/maps/${mapId}/gifts/${giftId}`).expect(200);
    await admin.delete(`/api/maps/${mapId}/api-keys/${gameKeyId}`).expect(200);
    await request(app)
      .post("/api/fq/logs")
      .set("fq-map-key", gameToken)
      .send({ context: "disabled key" })
      .expect(401);
    await admin
      .delete(`/api/maps/${mapId}/api-keys/${deniedMetricKeyId}`)
      .expect(200);
    await admin
      .delete(`/api/maps/${mapId}/api-keys/${metricKeyId}`)
      .expect(200);
    await admin
      .delete(`/api/maps/${mapId}/api-keys/${sharedMapKeyId}`)
      .expect(200);
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
        permissions: ["game.players.write"],
      })
      .expect(201);
    const deleteToken = deleteKeyResponse.body.data.token;
    const player = await query(
      `INSERT INTO players(map_id,uid,name)
       VALUES($1,'delete-player','待删玩家')
       ON CONFLICT(map_id,uid)
       DO UPDATE SET name=EXCLUDED.name
       RETURNING id`,
      [mapId],
    );
    await query(
      `INSERT INTO fq_player_archives(map_id,player_uid,archive_data)
       VALUES($1,'delete-player',$2::jsonb)
       ON CONFLICT(map_id,player_uid)
       DO UPDATE SET archive_data=EXCLUDED.archive_data`,
      [mapId, JSON.stringify({ deleteCheck: true })],
    );
    await query(
      `INSERT INTO fq_global_archives(map_id,archive_data)
       VALUES($1,$2::jsonb)
       ON CONFLICT(map_id)
       DO UPDATE SET archive_data=EXCLUDED.archive_data`,
      [mapId, JSON.stringify({ deleteCheck: true })],
    );
    const gift = await query(
      `INSERT INTO gifts(map_id,gift_key,name)
       VALUES($1,'delete-check-gift','永久删除验收礼包')
       RETURNING id`,
      [mapId],
    );
    await query(
      `INSERT INTO gift_entitlements(map_id,gift_id,player_id,value)
       VALUES($1,$2,$3,1)`,
      [mapId, gift.rows[0].id, player.rows[0].id],
    );
    await query(
      `INSERT INTO player_messages(map_id,player_id,subject,content,created_by)
       VALUES($1,$2,'永久删除验收','待删除',$3)`,
      [mapId, player.rows[0].id, userId],
    );
    await query(
      `INSERT INTO anchors(map_id,name)
       VALUES($1,'永久删除验收主播')`,
      [mapId],
    );
    await query(
      `INSERT INTO tracking_points(map_id,point_key,name)
       VALUES($1,'delete-check-point','永久删除验收埋点')`,
      [mapId],
    );
    await query(
      `INSERT INTO map_logs(map_id,context)
       VALUES($1,'永久删除验收日志')`,
      [mapId],
    );
    await query(
      `INSERT INTO map_metrics(map_id,metric_date,cumulative_users)
       VALUES($1,'2026-07-16',1)
       ON CONFLICT(map_id,metric_date)
       DO UPDATE SET cumulative_users=EXCLUDED.cumulative_users`,
      [mapId],
    );
    await recordMetricSessionEvent({
      mapId,
      sessionId: "delete-check-session",
      uids: ["delete-player"],
      event: "start",
      now: "2026-07-16T04:00:00Z",
    });
    const leaderboard = await query(
      `INSERT INTO leaderboards(map_id,leaderboard_key,name)
       VALUES($1,'delete-check-board','永久删除验收榜单')
       RETURNING id`,
      [mapId],
    );
    await query(
      `INSERT INTO leaderboard_entries(leaderboard_id,player_uid,player_name,score)
       VALUES($1,'delete-player','待删玩家',10)`,
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
       VALUES($1,1,'delete-player','待删玩家',10)`,
      [snapshot.rows[0].id],
    );
    const riskRule = await query(
      `INSERT INTO risk_rules(map_id,rule_key,name)
       VALUES($1,'delete-check-rule','永久删除验收规则')
       RETURNING id`,
      [mapId],
    );
    await query(
      `INSERT INTO risk_events(map_id,event_key,rule_id,rule_key,rule_name,severity,player_uid,player_name)
       VALUES($1,'delete-check-event',$2,'delete-check-rule','永久删除验收规则','high','delete-player','待删玩家')`,
      [mapId, riskRule.rows[0].id],
    );
    const campaign = await query(
      `INSERT INTO lottery_campaigns(map_id,public_token,title,created_by)
       VALUES($1,'delete-check-public-token','永久删除验收群抽',$2)
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
      "gift_entitlements",
      "anchors",
      "tracking_points",
      "map_logs",
      "map_files",
      "map_metrics",
      "fq_metric_session_activity",
      "fq_metric_sessions",
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
