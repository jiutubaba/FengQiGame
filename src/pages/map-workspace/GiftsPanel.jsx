import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import {
  ArrowLeft,
  Clipboard,
  Edit3,
  Filter,
  Gift,
  Plus,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react";
import { api, apiPage } from "../../api/client";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Field,
  InlineAlert,
  Modal,
  useConfirm,
  useToast,
} from "../../components/ui";
import { formatDate, formatNumber } from "../../utils/format";
import PaginationControls from "./PaginationControls";

export default function GiftsPanel({ mapId }) {
  const [viewParams, setViewParams] = useSearchParams();
  const [activeGiftView, setActiveGiftView] = useState(() =>
    viewParams.get("tab") === "lotteries" ? "lotteries" : "entitlements",
  );
  const [gifts, setGifts] = useState([]),
    [players, setPlayers] = useState([]),
    [entitlementsByPlayer, setEntitlementsByPlayer] = useState({}),
    [playerSearch, setPlayerSearch] = useState(() => viewParams.get("q") || ""),
    [selectedPlayers, setSelectedPlayers] = useState([]),
    [selectedGifts, setSelectedGifts] = useState([]),
    [playerGiftFilterIds, setPlayerGiftFilterIds] = useState(() =>
      (viewParams.get("giftIds") || "")
        .split(",")
        .map((value) => Number.parseInt(value, 10))
        .filter((value) => Number.isFinite(value) && value > 0),
    ),
    [giftValues, setGiftValues] = useState({});
  const [playerPage, setPlayerPage] = useState(() => {
      const value = Number.parseInt(viewParams.get("page") || "1", 10);
      return Number.isFinite(value) && value > 0 ? value : 1;
    }),
    [playerLoading, setPlayerLoading] = useState(true),
    [playerPagination, setPlayerPagination] = useState({
      page: 1,
      limit: 10,
      total: 0,
    });
  const [giftOpen, setGiftOpen] = useState(false),
    [giftForm, setGiftForm] = useState({
      giftKey: "",
      name: "",
      description: "",
      defaultValue: 0,
      enabled: true,
    });
  const [lotteries, setLotteries] = useState([]),
    [lotteryOpen, setLotteryOpen] = useState(false),
    [lotteryToDelete, setLotteryToDelete] = useState(null),
    [permanentDeletingLottery, setPermanentDeletingLottery] = useState(false),
    [lottery, setLottery] = useState({
      title: "",
      description: "",
      drawAt: "",
      winnerCount: 1,
    });
  const giftPlayerRequestId = useRef(0);
  const previousGiftMapId = useRef(mapId);
  const [moduleLoading, setModuleLoading] = useState(true);
  const [moduleLoadError, setModuleLoadError] = useState("");
  const [playerLoadError, setPlayerLoadError] = useState("");
  const confirmAction = useConfirm();
  const toast = useToast();
  const load = useCallback(async () => {
    setModuleLoading(true);
    setModuleLoadError("");
    try {
      const [giftRows, lotteryRows] = await Promise.all([
        api(`/api/maps/${mapId}/gifts`),
        api(`/api/maps/${mapId}/lotteries`),
      ]);
      setGifts(giftRows);
      setLotteries(lotteryRows);
    } catch (error) {
      setModuleLoadError(error.message);
    } finally {
      setModuleLoading(false);
    }
  }, [mapId]);
  const loadGiftPlayers = useCallback(async () => {
    const requestId = ++giftPlayerRequestId.current;
    setPlayerLoading(true);
    setPlayerLoadError("");
    try {
      const params = new URLSearchParams({
        q: playerSearch,
        page: String(playerPage),
        limit: "10",
      });
      if (playerGiftFilterIds.length) {
        params.set("giftIds", playerGiftFilterIds.join(","));
      }
      const result = await apiPage(
        `/api/maps/${mapId}/gifts/entitlements/players?${params}`,
      );
      if (requestId !== giftPlayerRequestId.current) return;
      const totalPages = Math.max(
        1,
        Math.ceil(result.pagination.total / result.pagination.limit),
      );
      if (playerPage > totalPages) {
        setPlayerPage(totalPages);
        return;
      }
      setPlayers(result.data);
      setPlayerPagination(result.pagination);
      setEntitlementsByPlayer((current) => {
        const next = { ...current };
        for (const player of result.data) {
          next[player.id] = Object.fromEntries(
            player.entitlements.map((item) => [item.giftId, item.value]),
          );
        }
        return next;
      });
    } catch (error) {
      if (requestId === giftPlayerRequestId.current)
        setPlayerLoadError(error.message);
    } finally {
      if (requestId === giftPlayerRequestId.current) setPlayerLoading(false);
    }
  }, [mapId, playerGiftFilterIds, playerPage, playerSearch]);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    const timer = setTimeout(loadGiftPlayers, 200);
    return () => {
      clearTimeout(timer);
      giftPlayerRequestId.current += 1;
    };
  }, [loadGiftPlayers]);
  useEffect(() => {
    if (previousGiftMapId.current === mapId) return;
    previousGiftMapId.current = mapId;
    giftPlayerRequestId.current += 1;
    setPlayers([]);
    setSelectedPlayers([]);
    setSelectedGifts([]);
    setPlayerGiftFilterIds([]);
    setGiftValues({});
    setEntitlementsByPlayer({});
    setPlayerSearch("");
    setPlayerPage(1);
    setPlayerPagination({ page: 1, limit: 10, total: 0 });
    setPlayerLoading(true);
    setActiveGiftView("entitlements");
    setLotteryToDelete(null);
  }, [mapId]);
  useEffect(() => {
    const next = new URLSearchParams();
    if (activeGiftView !== "entitlements") next.set("tab", activeGiftView);
    if (playerSearch.trim()) next.set("q", playerSearch.trim());
    if (playerPage > 1) next.set("page", String(playerPage));
    if (playerGiftFilterIds.length) {
      next.set("giftIds", playerGiftFilterIds.join(","));
    }
    setViewParams(next, { replace: true });
  }, [
    activeGiftView,
    playerGiftFilterIds,
    playerPage,
    playerSearch,
    setViewParams,
  ]);
  const emptyGift = {
    giftKey: "",
    name: "",
    description: "",
    defaultValue: 0,
    enabled: true,
  };
  const entitlementValue = (playerId, giftId) =>
    entitlementsByPlayer[playerId]?.[giftId] ?? 0;
  const currentGiftValue = (giftId) => {
    if (!selectedPlayers.length) return "未选择玩家";
    const values = selectedPlayers.map((playerId) =>
      entitlementValue(playerId, giftId),
    );
    return values.every((value) => value === values[0]) ? values[0] : "混合";
  };
  const selectCurrentPlayerPage = () => {
    const next = [
      ...new Set([...selectedPlayers, ...players.map((player) => player.id)]),
    ];
    if (next.length > 500) {
      toast("单次最多选择 500 位玩家，请先应用当前选择", "warning");
      return;
    }
    setSelectedPlayers(next);
  };
  const saveGift = async () => {
    try {
      await api(
        `/api/maps/${mapId}/gifts${giftForm.id ? `/${giftForm.id}` : ""}`,
        { method: giftForm.id ? "PATCH" : "POST", body: giftForm },
      );
      setGiftOpen(false);
      setGiftForm(emptyGift);
      await load();
      toast(giftForm.id ? "礼包已更新" : "礼包已创建");
    } catch (error) {
      toast(error.message, "danger");
    }
  };
  const removeGift = async (gift) => {
    if (
      !(await confirmAction({
        title: "删除礼包",
        description: `确认删除礼包“${gift.name}”？`,
        detail: "礼包定义及玩家对应资格将按服务端规则处理，请确认不再使用。",
        confirmLabel: "确认删除",
      }))
    )
      return;
    try {
      await api(`/api/maps/${mapId}/gifts/${gift.id}`, { method: "DELETE" });
      setSelectedGifts((current) => current.filter((id) => id !== gift.id));
      setPlayerGiftFilterIds((current) =>
        current.filter((id) => id !== gift.id),
      );
      toast("礼包已删除");
      load();
    } catch (error) {
      toast(error.message, "danger");
    }
  };
  const copyGift = (gift) => {
    let copyKey = `${gift.giftKey}_copy`;
    let suffix = 2;
    while (gifts.some((item) => item.giftKey === copyKey)) {
      copyKey = `${gift.giftKey}_copy${suffix}`;
      suffix += 1;
    }
    setGiftForm({
      giftKey: copyKey,
      name: `${gift.name} 副本`,
      description: gift.description,
      defaultValue: gift.defaultValue,
      enabled: gift.enabled,
    });
    setGiftOpen(true);
  };
  const applyEntitlements = async () => {
    try {
      await api(`/api/maps/${mapId}/gifts/entitlements`, {
        method: "PUT",
        body: {
          playerIds: selectedPlayers,
          gifts: selectedGifts.map((giftId) => ({
            giftId,
            value: giftValues[giftId] ?? 0,
          })),
        },
      });
      setEntitlementsByPlayer((current) => {
        const next = { ...current };
        for (const playerId of selectedPlayers) {
          const values = { ...(next[playerId] || {}) };
          for (const giftId of selectedGifts) {
            const value = giftValues[giftId] ?? 0;
            if (value > 0) values[giftId] = value;
            else delete values[giftId];
          }
          next[playerId] = values;
        }
        return next;
      });
      await load();
      if (playerGiftFilterIds.length) await loadGiftPlayers();
      toast("礼包资格已应用，下局将读取最新数值");
    } catch (error) {
      toast(error.message, "danger");
    }
  };
  const createLottery = async () => {
    try {
      const created = await api(`/api/maps/${mapId}/lotteries`, {
        method: "POST",
        body: {
          ...lottery,
          drawAt: lottery.drawAt
            ? new Date(lottery.drawAt).toISOString()
            : null,
          rewardConfig: [],
        },
      });
      setLotteryOpen(false);
      setLottery({ title: "", description: "", drawAt: "", winnerCount: 1 });
      await navigator.clipboard?.writeText(
        `${location.origin}${created.publicPath}`,
      );
      toast("群抽已创建，公开链接已复制");
      load();
    } catch (error) {
      toast(error.message, "danger");
    }
  };
  const draw = async (item) => {
    if (
      !(await confirmAction({
        title: "立即开奖",
        description: `确认立即为“${item.title}”开奖？`,
        detail: "系统会按当前报名名单和中奖人数生成开奖结果。",
        confirmLabel: "确认开奖",
        tone: "primary",
      }))
    )
      return;
    try {
      await api(`/api/maps/${mapId}/lotteries/${item.id}/draw`, {
        method: "POST",
      });
      toast("开奖完成");
      load();
    } catch (error) {
      toast(error.message, "danger");
    }
  };
  const cancelLottery = async (item) => {
    if (
      !(await confirmAction({
        title: "取消群抽",
        description: `确认取消群抽“${item.title}”？`,
        detail: "取消后活动不再接受报名，也不能继续开奖。",
        confirmLabel: "确认取消",
      }))
    )
      return;
    try {
      await api(`/api/maps/${mapId}/lotteries/${item.id}`, {
        method: "DELETE",
      });
      toast("群抽已取消");
      load();
    } catch (error) {
      toast(error.message, "danger");
    }
  };
  const permanentlyDeleteLottery = async () => {
    if (!lotteryToDelete) return;
    setPermanentDeletingLottery(true);
    try {
      await api(
        `/api/maps/${mapId}/lotteries/${lotteryToDelete.id}/permanent`,
        { method: "DELETE" },
      );
      setLotteryToDelete(null);
      await load();
      toast("群抽记录已永久删除");
    } catch (error) {
      toast(error.message, "danger");
    } finally {
      setPermanentDeletingLottery(false);
    }
  };
  const handleGiftTabKeyDown = (event) => {
    const views = ["entitlements", "lotteries"];
    const currentIndex = views.indexOf(activeGiftView);
    let nextIndex = currentIndex;
    if (event.key === "ArrowRight")
      nextIndex = (currentIndex + 1) % views.length;
    else if (event.key === "ArrowLeft")
      nextIndex = (currentIndex - 1 + views.length) % views.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = views.length - 1;
    else return;
    event.preventDefault();
    const nextView = views[nextIndex];
    setActiveGiftView(nextView);
    requestAnimationFrame(() =>
      document.getElementById(`gift-tab-${nextView}-${mapId}`)?.focus(),
    );
  };
  if (moduleLoading && !gifts.length && !lotteries.length) {
    return <div className="loading-state">正在读取礼包与群抽配置…</div>;
  }
  if (moduleLoadError && !gifts.length && !lotteries.length) {
    return (
      <ErrorState
        title="礼包与群抽读取失败"
        description={moduleLoadError}
        onRetry={load}
      />
    );
  }
  return (
    <>
      {moduleLoadError && (
        <InlineAlert
          tone="danger"
          title="礼包与群抽刷新失败"
          description={`${moduleLoadError}；当前仍显示上一次成功读取的数据。`}
          action={<Button onClick={load}>重新尝试</Button>}
        />
      )}
      <div className="gift-module-shell">
        <div
          className="gift-module-tabs"
          role="tablist"
          aria-label="礼包与群抽管理"
          onKeyDown={handleGiftTabKeyDown}
        >
          <button
            type="button"
            id={`gift-tab-entitlements-${mapId}`}
            role="tab"
            aria-selected={activeGiftView === "entitlements"}
            aria-controls={`gift-panel-entitlements-${mapId}`}
            tabIndex={activeGiftView === "entitlements" ? 0 : -1}
            className={activeGiftView === "entitlements" ? "active" : ""}
            onClick={() => setActiveGiftView("entitlements")}
          >
            礼包资格
            <span>{formatNumber(gifts.length)} 项礼包</span>
          </button>
          <button
            type="button"
            id={`gift-tab-lotteries-${mapId}`}
            role="tab"
            aria-selected={activeGiftView === "lotteries"}
            aria-controls={`gift-panel-lotteries-${mapId}`}
            tabIndex={activeGiftView === "lotteries" ? 0 : -1}
            className={activeGiftView === "lotteries" ? "active" : ""}
            onClick={() => setActiveGiftView("lotteries")}
          >
            群抽活动
            <span>{formatNumber(lotteries.length)} 条记录</span>
          </button>
        </div>
        {activeGiftView === "entitlements" && (
          <div
            id={`gift-panel-entitlements-${mapId}`}
            className="gift-tab-panel"
            role="tabpanel"
            aria-labelledby={`gift-tab-entitlements-${mapId}`}
          >
            <div className="gift-workspace">
              <section className="gift-player-pane">
                <div className="pane-head">
                  <div>
                    <span className="eyebrow">TARGET PLAYERS</span>
                    <h3>选择玩家</h3>
                  </div>
                  <Badge>{selectedPlayers.length} 已选</Badge>
                </div>
                <label className="gift-search">
                  <Search size={15} />
                  <input
                    value={playerSearch}
                    onChange={(event) => {
                      setPlayerLoading(true);
                      setPlayerSearch(event.target.value);
                      setPlayerPage(1);
                    }}
                    placeholder="搜索名称或 UID"
                    aria-label="搜索礼包玩家名称或 UID"
                  />
                </label>
                {playerGiftFilterIds.length > 0 && (
                  <div className="gift-filter-summary" role="status">
                    <span>
                      <Filter size={13} />
                      拥有任一所选礼包
                      <strong>{playerGiftFilterIds.length} 项</strong>
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setPlayerLoading(true);
                        setPlayerGiftFilterIds([]);
                        setPlayerPage(1);
                      }}
                    >
                      清除筛选
                    </button>
                  </div>
                )}
                <div className="gift-player-tools">
                  <button
                    type="button"
                    onClick={selectCurrentPlayerPage}
                    disabled={!players.length || playerLoading}
                  >
                    全选本页
                  </button>
                  <button type="button" onClick={() => setSelectedPlayers([])}>
                    清空全部
                  </button>
                </div>
                {playerLoadError && players.length > 0 && (
                  <div className="gift-inline-error" role="alert">
                    <strong>玩家列表刷新失败</strong>
                    <span>{playerLoadError}</span>
                    <button type="button" onClick={loadGiftPlayers}>
                      重试
                    </button>
                  </div>
                )}
                <div
                  className="gift-player-list"
                  aria-busy={playerLoading}
                  aria-live="polite"
                >
                  {playerLoading ? (
                    <>
                      <span className="sr-only" role="status">
                        正在读取玩家
                      </span>
                      <div className="gift-player-skeleton" aria-hidden="true">
                        {Array.from({ length: 6 }, (_, index) => (
                          <div key={index}>
                            <i />
                            <span>
                              <b />
                              <small />
                            </span>
                          </div>
                        ))}
                      </div>
                    </>
                  ) : playerLoadError && !players.length ? (
                    <div className="gift-inline-error" role="alert">
                      <strong>玩家列表读取失败</strong>
                      <span>{playerLoadError}</span>
                      <button type="button" onClick={loadGiftPlayers}>
                        重新尝试
                      </button>
                    </div>
                  ) : (
                    players.map((player) => (
                      <label
                        key={player.id}
                        className={
                          selectedPlayers.includes(player.id) ? "selected" : ""
                        }
                      >
                        <input
                          type="checkbox"
                          checked={selectedPlayers.includes(player.id)}
                          onChange={() => {
                            if (
                              !selectedPlayers.includes(player.id) &&
                              selectedPlayers.length >= 500
                            ) {
                              toast("单次最多选择 500 位玩家", "warning");
                              return;
                            }
                            setSelectedPlayers((current) =>
                              current.includes(player.id)
                                ? current.filter((id) => id !== player.id)
                                : [...current, player.id],
                            );
                          }}
                        />
                        <span>
                          <strong>{player.name}</strong>
                          <small>{player.uid}</small>
                        </span>
                      </label>
                    ))
                  )}
                  {!playerLoading && !players.length && (
                    <p className="gift-empty-copy">
                      {playerGiftFilterIds.length
                        ? "没有拥有所选礼包的玩家"
                        : "没有匹配的玩家"}
                    </p>
                  )}
                </div>
                <PaginationControls
                  pagination={playerPagination}
                  noun="位玩家"
                  onPageChange={(nextPage) => {
                    setPlayerLoading(true);
                    setPlayerPage(nextPage);
                  }}
                />
              </section>
              <section className="gift-catalog-pane">
                <div className="pane-head">
                  <div>
                    <span className="eyebrow">GIFT CATALOG</span>
                    <h3>礼包目录</h3>
                  </div>
                  <Button
                    icon={Plus}
                    onClick={() => {
                      setGiftForm(emptyGift);
                      setGiftOpen(true);
                    }}
                  >
                    新建礼包
                  </Button>
                </div>
                <div className="gift-catalog-head" aria-hidden="true">
                  <span>礼包 / Key</span>
                  <span>状态 / 资格 / 说明</span>
                  <span>默认</span>
                  <span>操作</span>
                </div>
                <div className="gift-catalog-list">
                  {gifts.map((gift) => (
                    <div
                      key={gift.id}
                      className={[
                        selectedGifts.includes(gift.id) ? "selected" : "",
                        playerGiftFilterIds.includes(gift.id)
                          ? "filtering"
                          : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    >
                      <div className="gift-catalog-primary">
                        <label className="gift-catalog-identity">
                          <input
                            type="checkbox"
                            checked={selectedGifts.includes(gift.id)}
                            onChange={() => {
                              setSelectedGifts((current) =>
                                current.includes(gift.id)
                                  ? current.filter((id) => id !== gift.id)
                                  : [...current, gift.id],
                              );
                              setGiftValues((current) =>
                                current[gift.id] === undefined
                                  ? {
                                      ...current,
                                      [gift.id]: gift.defaultValue ?? 0,
                                    }
                                  : current,
                              );
                            }}
                          />
                          <span>
                            <strong>{gift.name}</strong>
                            <small>{gift.giftKey}</small>
                          </span>
                        </label>
                        <button
                          type="button"
                          className={
                            playerGiftFilterIds.includes(gift.id)
                              ? "gift-filter-toggle active"
                              : "gift-filter-toggle"
                          }
                          aria-pressed={playerGiftFilterIds.includes(gift.id)}
                          aria-label={`${playerGiftFilterIds.includes(gift.id) ? "取消筛选" : "筛选"}拥有“${gift.name}”的玩家`}
                          title={
                            playerGiftFilterIds.includes(gift.id)
                              ? "取消此礼包筛选"
                              : "筛选拥有此礼包的玩家"
                          }
                          onClick={() => {
                            setPlayerLoading(true);
                            setPlayerGiftFilterIds((current) =>
                              current.includes(gift.id)
                                ? current.filter((id) => id !== gift.id)
                                : [...current, gift.id],
                            );
                            setPlayerPage(1);
                          }}
                        >
                          <Filter size={13} />
                        </button>
                      </div>
                      <div className="gift-catalog-meta">
                        <div className="gift-catalog-status">
                          <Badge tone={gift.enabled ? "positive" : "neutral"}>
                            {gift.enabled ? "已启用" : "已停用"}
                          </Badge>
                          <small>
                            {formatNumber(gift.entitlementCount ?? 0)} 人有资格
                          </small>
                        </div>
                        <p>{gift.description || "无说明"}</p>
                      </div>
                      <Badge>{gift.defaultValue}</Badge>
                      <div className="gift-row-actions">
                        <button type="button" onClick={() => copyGift(gift)}>
                          <Clipboard size={13} />
                          复制
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setGiftForm({ ...gift });
                            setGiftOpen(true);
                          }}
                        >
                          <Edit3 size={13} />
                          编辑
                        </button>
                        <button
                          type="button"
                          className="danger"
                          onClick={() => removeGift(gift)}
                        >
                          <Trash2 size={13} />
                          删除
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
              <section className="gift-setting-pane">
                <div className="pane-head">
                  <div>
                    <span className="eyebrow">ENTITLEMENT SET</span>
                    <h3>本次资格设置</h3>
                  </div>
                  <Badge>{selectedGifts.length} 项</Badge>
                </div>
                <div className="gift-setting-list">
                  {selectedGifts.map((giftId) => {
                    const gift = gifts.find((item) => item.id === giftId);
                    if (!gift) return null;
                    return (
                      <div key={gift.id}>
                        <span>
                          <strong>{gift.name}</strong>
                          <small>当前：{currentGiftValue(gift.id)}</small>
                        </span>
                        <label>
                          设为
                          <input
                            className="input"
                            type="number"
                            min="0"
                            max="1000000"
                            value={giftValues[gift.id] ?? 0}
                            onChange={(event) =>
                              setGiftValues((current) => ({
                                ...current,
                                [gift.id]: Number(event.target.value),
                              }))
                            }
                          />
                        </label>
                      </div>
                    );
                  })}
                  {!selectedGifts.length && (
                    <p className="gift-empty-copy">
                      从礼包目录选择要设置的项目
                    </p>
                  )}
                </div>
                <div className="gift-apply-summary">
                  <p>
                    将更新{" "}
                    <strong>
                      {selectedPlayers.length * selectedGifts.length}
                    </strong>{" "}
                    条玩家礼包资格
                  </p>
                  <small>数值大于 0 时激活，设为 0 将取消资格。</small>
                  <Button
                    variant="primary"
                    icon={Gift}
                    disabled={!selectedPlayers.length || !selectedGifts.length}
                    onClick={applyEntitlements}
                  >
                    应用礼包资格
                  </Button>
                </div>
              </section>
            </div>
          </div>
        )}
        {activeGiftView === "lotteries" && (
          <section
            id={`gift-panel-lotteries-${mapId}`}
            className="subsection-panel gift-lottery-panel gift-tab-panel"
            role="tabpanel"
            aria-labelledby={`gift-tab-lotteries-${mapId}`}
          >
            <div className="subsection-head">
              <div>
                <span className="eyebrow">GROUP LOTTERY</span>
                <h3>群抽活动</h3>
                <p>
                  公开链接无需后台账号，参与者信息与开奖结果保存在当前地图。
                </p>
              </div>
              <Button icon={Sparkles} onClick={() => setLotteryOpen(true)}>
                创建群抽
              </Button>
            </div>
            {lotteries.length ? (
              <div className="table-shell">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>活动</th>
                      <th>状态</th>
                      <th>参与 / 名额</th>
                      <th>开奖时间</th>
                      <th className="align-right">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lotteries.map((item) => {
                      const expiredOpen =
                        item.status === "open" &&
                        item.drawAt &&
                        new Date(item.drawAt).getTime() <= Date.now();
                      const permanentlyDeletable =
                        item.status === "drawn" ||
                        item.status === "cancelled" ||
                        expiredOpen;
                      return (
                        <tr key={item.id}>
                          <td>
                            <strong>{item.title}</strong>
                          </td>
                          <td>
                            <Badge
                              tone={
                                item.status === "open" && !expiredOpen
                                  ? "positive"
                                  : "neutral"
                              }
                            >
                              {expiredOpen
                                ? "已过期"
                                : item.status === "open"
                                  ? "进行中"
                                  : item.status === "drawn"
                                    ? "已开奖"
                                    : "已取消"}
                            </Badge>
                          </td>
                          <td>
                            {item.participantCount} / {item.winnerCount}
                          </td>
                          <td>{formatDate(item.drawAt)}</td>
                          <td className="align-right">
                            <button
                              className="table-action"
                              onClick={() => {
                                navigator.clipboard?.writeText(
                                  `${location.origin}${item.publicPath}`,
                                );
                                toast("公开链接已复制");
                              }}
                            >
                              <Clipboard size={14} />
                              复制链接
                            </button>
                            {item.status === "open" && (
                              <>
                                <button
                                  className="table-action"
                                  onClick={() => draw(item)}
                                >
                                  <Sparkles size={14} />
                                  开奖
                                </button>
                                {!expiredOpen && (
                                  <button
                                    className="table-action danger"
                                    onClick={() => cancelLottery(item)}
                                  >
                                    <Trash2 size={14} />
                                    取消
                                  </button>
                                )}
                              </>
                            )}
                            {permanentlyDeletable && (
                              <button
                                className="table-action danger"
                                onClick={() => setLotteryToDelete(item)}
                              >
                                <Trash2 size={14} />
                                删除记录
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState
                icon={Sparkles}
                title="暂无群抽活动"
                description="创建后可将公开链接发送到玩家群。"
              />
            )}
          </section>
        )}
      </div>
      <Modal
        open={giftOpen}
        onClose={() => setGiftOpen(false)}
        title={giftForm.id ? `编辑礼包 · ${giftForm.name}` : "新建礼包"}
        eyebrow="GIFT DEFINITION"
        footer={
          <>
            <Button onClick={() => setGiftOpen(false)}>取消</Button>
            <Button
              variant="primary"
              onClick={saveGift}
              disabled={!giftForm.giftKey || !giftForm.name}
            >
              {giftForm.id ? "保存" : "创建"}
            </Button>
          </>
        }
      >
        <Field
          label="礼包 Key"
          hint="接入沧澜福利礼包时，必须与现役礼包名称完全一致"
        >
          <input
            className="input"
            value={giftForm.giftKey}
            onChange={(event) =>
              setGiftForm({ ...giftForm, giftKey: event.target.value })
            }
          />
        </Field>
        <Field label="礼包名称">
          <input
            className="input"
            value={giftForm.name}
            onChange={(event) =>
              setGiftForm({ ...giftForm, name: event.target.value })
            }
          />
        </Field>
        <Field label="说明">
          <textarea
            className="input"
            rows="3"
            value={giftForm.description}
            onChange={(event) =>
              setGiftForm({ ...giftForm, description: event.target.value })
            }
          />
        </Field>
        <Field label="默认数值">
          <input
            className="input"
            type="number"
            value={giftForm.defaultValue}
            onChange={(event) =>
              setGiftForm({
                ...giftForm,
                defaultValue: Number(event.target.value),
              })
            }
          />
        </Field>
      </Modal>
      <Modal
        open={lotteryOpen}
        onClose={() => setLotteryOpen(false)}
        title="创建群抽活动"
        eyebrow="LOTTERY"
        footer={
          <>
            <Button onClick={() => setLotteryOpen(false)}>取消</Button>
            <Button
              variant="primary"
              onClick={createLottery}
              disabled={!lottery.title}
            >
              生成公开链接
            </Button>
          </>
        }
      >
        <Field label="活动标题">
          <input
            className="input"
            value={lottery.title}
            onChange={(event) =>
              setLottery({ ...lottery, title: event.target.value })
            }
          />
        </Field>
        <Field label="活动说明">
          <textarea
            className="input"
            rows="3"
            value={lottery.description}
            onChange={(event) =>
              setLottery({ ...lottery, description: event.target.value })
            }
          />
        </Field>
        <Field label="报名截止 / 计划开奖时间">
          <input
            className="input"
            type="datetime-local"
            value={lottery.drawAt}
            onChange={(event) =>
              setLottery({ ...lottery, drawAt: event.target.value })
            }
          />
        </Field>
        <Field label="中奖名额">
          <input
            className="input"
            type="number"
            min="1"
            max="100"
            value={lottery.winnerCount}
            onChange={(event) =>
              setLottery({
                ...lottery,
                winnerCount: Number(event.target.value),
              })
            }
          />
        </Field>
      </Modal>
      <Modal
        open={Boolean(lotteryToDelete)}
        onClose={() => {
          if (!permanentDeletingLottery) setLotteryToDelete(null);
        }}
        title="永久删除群抽记录"
        eyebrow="IRREVERSIBLE ACTION"
        danger
        footer={
          <>
            <Button
              onClick={() => setLotteryToDelete(null)}
              disabled={permanentDeletingLottery}
            >
              返回
            </Button>
            <Button
              variant="danger"
              onClick={permanentlyDeleteLottery}
              disabled={permanentDeletingLottery}
            >
              {permanentDeletingLottery ? "正在删除…" : "确认永久删除"}
            </Button>
          </>
        }
      >
        <div className="permanent-delete-target">
          <span>即将永久删除群抽记录</span>
          <strong>{lotteryToDelete?.title}</strong>
          <code>活动 ID：{lotteryToDelete?.id}</code>
        </div>
        <p className="warning-note danger-warning">
          活动记录、参与名单与开奖结果将一并删除，操作完成后无法恢复。
        </p>
      </Modal>
    </>
  );
}
