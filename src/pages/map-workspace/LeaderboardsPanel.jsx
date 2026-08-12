import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { Ban, Edit3, Plus, Save, Search, Trash2, Trophy } from "lucide-react";
import { api } from "../../api/client";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Field,
  FilterSummary,
  InlineAlert,
  Modal,
  Switch,
  useConfirm,
  useToast,
} from "../../components/ui";
import { formatDate, formatNumber } from "../../utils/format";

export default function LeaderboardsPanel({ mapId, can }) {
  const [viewParams, setViewParams] = useSearchParams();
  const manageable = can("leaderboards.manage");
  const [leaderboards, setLeaderboards] = useState([]);
  const [selectedId, setSelectedId] = useState(() => {
    const value = Number.parseInt(viewParams.get("leaderboard") || "", 10);
    return Number.isFinite(value) && value > 0 ? value : null;
  });
  const [detail, setDetail] = useState(null);
  const [query, setQuery] = useState(() => viewParams.get("q") || "");
  const [snapshotId, setSnapshotId] = useState(
    () => viewParams.get("snapshot") || "",
  );
  const [editing, setEditing] = useState(null);
  const [loading, setLoading] = useState(true);
  const [listLoading, setListLoading] = useState(true);
  const [listLoadError, setListLoadError] = useState("");
  const [detailLoadError, setDetailLoadError] = useState("");
  const [blockingEntryId, setBlockingEntryId] = useState(null);
  const leaderboardRequestId = useRef(0);
  const entriesRequestId = useRef(0);
  const confirmAction = useConfirm();
  const toast = useToast();

  const loadLeaderboards = useCallback(async () => {
    const requestId = ++leaderboardRequestId.current;
    setListLoading(true);
    setListLoadError("");
    try {
      const rows = await api(`/api/maps/${mapId}/leaderboards`);
      if (requestId !== leaderboardRequestId.current) return;
      setLeaderboards(rows);
    } catch (error) {
      if (requestId === leaderboardRequestId.current)
        setListLoadError(error.message);
    } finally {
      if (requestId === leaderboardRequestId.current) setListLoading(false);
    }
  }, [mapId]);

  useEffect(() => {
    leaderboardRequestId.current += 1;
    entriesRequestId.current += 1;
    setLeaderboards([]);
    setDetail(null);
    setListLoadError("");
    setDetailLoadError("");
    loadLeaderboards();
  }, [loadLeaderboards]);

  useEffect(() => {
    if (listLoading) return;
    if (!leaderboards.length) {
      setSelectedId(null);
      return;
    }
    if (!leaderboards.some((item) => item.id === selectedId))
      setSelectedId(leaderboards[0].id);
  }, [leaderboards, listLoading, selectedId]);

  useEffect(() => {
    const next = new URLSearchParams();
    if (selectedId) next.set("leaderboard", String(selectedId));
    if (query.trim()) next.set("q", query.trim());
    if (snapshotId) next.set("snapshot", snapshotId);
    setViewParams(next, { replace: true });
  }, [query, selectedId, setViewParams, snapshotId]);

  const loadEntries = useCallback(async () => {
    if (!selectedId) {
      setLoading(false);
      return;
    }
    const requestId = ++entriesRequestId.current;
    setLoading(true);
    setDetailLoadError("");
    try {
      const params = new URLSearchParams({ limit: "100" });
      if (query.trim()) params.set("q", query.trim());
      if (snapshotId) params.set("snapshotId", snapshotId);
      const nextDetail = await api(
        `/api/maps/${mapId}/leaderboards/${selectedId}/entries?${params}`,
      );
      if (requestId !== entriesRequestId.current) return;
      setDetail(nextDetail);
    } catch (error) {
      if (requestId === entriesRequestId.current)
        setDetailLoadError(error.message);
    } finally {
      if (requestId === entriesRequestId.current) setLoading(false);
    }
  }, [mapId, selectedId, snapshotId, query]);

  useEffect(() => {
    const timer = setTimeout(loadEntries, 180);
    return () => {
      clearTimeout(timer);
      entriesRequestId.current += 1;
    };
  }, [loadEntries]);

  const selectLeaderboard = (id) => {
    setSelectedId(id);
    setSnapshotId("");
    setDetail(null);
  };

  const openCreateLeaderboard = () => {
    setEditing({
      leaderboardKey: "",
      name: "",
      valueLabel: "积分",
      sortDirection: "desc",
      scoreUpdateMode: "latest",
      enabled: true,
    });
  };

  const save = async () => {
    try {
      const id = editing.id;
      const saved = await api(
        `/api/maps/${mapId}/leaderboards${id ? `/${id}` : ""}`,
        {
          method: id ? "PATCH" : "POST",
          body: {
            leaderboardKey: editing.leaderboardKey,
            name: editing.name,
            valueLabel: editing.valueLabel,
            sortDirection: editing.sortDirection,
            scoreUpdateMode: editing.scoreUpdateMode,
            enabled: editing.enabled,
          },
        },
      );
      setEditing(null);
      setSelectedId(saved.id);
      setSnapshotId("");
      toast("排行榜已保存");
      await loadLeaderboards();
    } catch (error) {
      toast(error.message, "danger");
    }
  };

  const publish = async () => {
    const current = leaderboards.find((item) => item.id === selectedId);
    if (
      !current ||
      !(await confirmAction({
        title: "发布排行榜快照",
        description: `确认发布“${current.name}”当前前 100 名？`,
        detail: "发布后会生成可追溯快照，游戏客户端将读取新的已发布榜单。",
        confirmLabel: "确认发布",
        tone: "primary",
      }))
    )
      return;
    try {
      const snapshot = await api(
        `/api/maps/${mapId}/leaderboards/${selectedId}/publish`,
        { method: "POST", body: { limit: 100 } },
      );
      setSnapshotId(String(snapshot.id));
      toast(`已发布 ${snapshot.entryCount} 条榜单记录`);
      await loadLeaderboards();
    } catch (error) {
      toast(error.message, "danger");
    }
  };

  const removeLeaderboard = async () => {
    const current = leaderboards.find((item) => item.id === selectedId);
    if (
      !current ||
      !(await confirmAction({
        title: "删除排行榜",
        description: `确认删除排行榜“${current.name}”及全部快照？`,
        detail: "排行榜定义、实时条目和历史发布快照将一并删除，无法撤销。",
        confirmLabel: "确认删除",
      }))
    )
      return;
    try {
      await api(`/api/maps/${mapId}/leaderboards/${current.id}`, {
        method: "DELETE",
      });
      setSelectedId(null);
      setDetail(null);
      toast("排行榜已删除");
      loadLeaderboards();
    } catch (error) {
      toast(error.message, "danger");
    }
  };

  const removeEntry = async (entry) => {
    if (
      !(await confirmAction({
        title: "移除实时榜条目",
        description: `确认从实时榜移除“${entry.name}”？`,
        detail: "只影响当前实时候选，已经发布的历史快照不会被回写。",
        confirmLabel: "确认移除",
      }))
    )
      return;
    try {
      await api(
        `/api/maps/${mapId}/leaderboards/${selectedId}/entries/${entry.id}`,
        { method: "DELETE" },
      );
      toast("实时榜记录已移除");
      loadEntries();
      loadLeaderboards();
    } catch (error) {
      toast(error.message, "danger");
    }
  };

  const blockEntryPlayer = async (entry) => {
    if (
      !(await confirmAction({
        title: "拉黑排行榜玩家",
        description: `确认将“${entry.name}”（${entry.uid}）设为排行榜封禁？`,
        detail:
          "该玩家将从当前地图的所有实时榜及后续发布中排除；已发布历史快照不会被回写，可在玩家管理中取消封禁。",
        confirmLabel: "确认拉黑",
      }))
    )
      return;
    setBlockingEntryId(entry.id);
    try {
      await api(
        `/api/maps/${mapId}/leaderboards/${selectedId}/entries/${entry.id}/rank-ban`,
        { method: "POST" },
      );
      toast(`“${entry.name}”已设为排行榜封禁`);
      await Promise.all([loadEntries(), loadLeaderboards()]);
    } catch (error) {
      toast(error.message, "danger");
    } finally {
      setBlockingEntryId(null);
    }
  };

  const current = leaderboards.find((item) => item.id === selectedId);
  const snapshots = detail?.snapshots || [];
  const entries = detail?.entries || [];

  return (
    <>
      {listLoadError && leaderboards.length > 0 && (
        <InlineAlert
          tone="danger"
          title="排行榜配置刷新失败"
          description={`${listLoadError}；当前仍显示上一次成功读取的数据。`}
          action={<Button onClick={loadLeaderboards}>重新尝试</Button>}
        />
      )}
      <div className="operations-workspace leaderboard-workspace">
        <aside className="operations-rail">
          <div className="operations-rail-head">
            <div>
              <span className="eyebrow">LEADERBOARDS</span>
              <strong>{leaderboards.length} 个榜单</strong>
            </div>
            {manageable && (
              <button
                className="icon-button"
                aria-label="新建排行榜"
                onClick={openCreateLeaderboard}
              >
                <Plus size={17} />
              </button>
            )}
          </div>
          <div className="operations-rail-list">
            {leaderboards.map((item) => (
              <button
                key={item.id}
                className={item.id === selectedId ? "active" : ""}
                onClick={() => selectLeaderboard(item.id)}
              >
                <span className="rail-rank-mark">
                  <Trophy size={16} />
                </span>
                <span>
                  <strong>{item.name}</strong>
                  <small>
                    {item.entryCount} 条 · {item.valueLabel}
                  </small>
                </span>
                <i className={item.enabled ? "is-online" : ""} />
              </button>
            ))}
          </div>
          {!leaderboards.length && (
            <p className="rail-empty">创建榜单后，游戏客户端才能写入排名。</p>
          )}
        </aside>

        <section className="operations-main">
          {current ? (
            <>
              <div className="module-toolbar operations-toolbar">
                <div className="search-box">
                  <Search size={16} />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="玩家 UID 或名称"
                    aria-label="搜索排行榜玩家 UID 或名称"
                  />
                </div>
                <div className="section-actions">
                  {manageable && (
                    <Button
                      icon={Edit3}
                      onClick={() => setEditing({ ...current })}
                    >
                      编辑配置
                    </Button>
                  )}
                  {manageable && (
                    <span className="publish-action">
                      <Button
                        variant="primary"
                        icon={Save}
                        onClick={publish}
                        disabled={!current.entryCount}
                        title="将当前实时候选池的前 100 名发布为不可变快照"
                      >
                        发布前 100 名
                      </Button>
                      {!current.entryCount && <small>暂无候选，不能发布</small>}
                    </span>
                  )}
                </div>
              </div>

              <div className="operations-context-line">
                <div>
                  <span>榜单 Key</span>
                  <code>{current.leaderboardKey}</code>
                </div>
                <div>
                  <span>排序</span>
                  <strong>
                    {current.sortDirection === "desc"
                      ? "数值由高到低"
                      : "数值由低到高"}
                  </strong>
                </div>
                <div>
                  <span>更新策略</span>
                  <strong>
                    {current.scoreUpdateMode === "best"
                      ? "每日首份 · 仅更优时更新"
                      : "每日首份 · 覆盖当前成绩"}
                  </strong>
                </div>
                <div>
                  <span>实时候选</span>
                  <strong>{formatNumber(current.entryCount)} 条</strong>
                </div>
                <div>
                  <span>最近发布</span>
                  <strong>
                    {current.latestPublishedAt
                      ? `${formatDate(current.latestPublishedAt)} · ${formatNumber(current.latestSnapshotCount)} 条`
                      : "尚未发布"}
                  </strong>
                </div>
                <Badge tone={current.enabled ? "positive" : "neutral"}>
                  {current.enabled ? "接收上报" : "已停用"}
                </Badge>
              </div>

              <div className="view-switch-row">
                <div className="segmented-switch compact-switch">
                  <button
                    type="button"
                    className={!snapshotId ? "active" : ""}
                    onClick={() => setSnapshotId("")}
                    aria-pressed={!snapshotId}
                  >
                    实时榜
                  </button>
                  <button
                    type="button"
                    className={snapshotId ? "active" : ""}
                    disabled={!snapshots.length}
                    onClick={() =>
                      setSnapshotId(String(snapshots[0]?.id || ""))
                    }
                    aria-pressed={Boolean(snapshotId)}
                  >
                    发布快照
                  </button>
                </div>
                {snapshotId && (
                  <select
                    className="input snapshot-select"
                    value={snapshotId}
                    onChange={(event) => setSnapshotId(event.target.value)}
                  >
                    {snapshots.map((snapshot) => (
                      <option key={snapshot.id} value={snapshot.id}>
                        {formatDate(snapshot.publishedAt)} ·{" "}
                        {snapshot.entryCount} 条
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <FilterSummary
                items={[
                  ...(query.trim() ? [`搜索：${query.trim()}`] : []),
                  snapshotId ? "数据源：已发布快照" : "数据源：实时候选榜",
                ]}
                resultText={
                  loading ? "正在更新…" : `当前显示 ${entries.length} 条排名`
                }
                onClear={
                  query.trim() || snapshotId
                    ? () => {
                        setQuery("");
                        setSnapshotId("");
                      }
                    : undefined
                }
              />

              {detailLoadError && detail && (
                <InlineAlert
                  tone="danger"
                  title="排行榜刷新失败"
                  description={`${detailLoadError}；当前仍显示上一次成功读取的数据。`}
                  action={<Button onClick={loadEntries}>重新尝试</Button>}
                />
              )}

              {loading && !detail ? (
                <div className="loading-state">正在计算排名…</div>
              ) : detailLoadError && !detail ? (
                <ErrorState
                  title="排行榜数据读取失败"
                  description={detailLoadError}
                  onRetry={loadEntries}
                />
              ) : entries.length ? (
                <div className="table-shell leaderboard-table-shell">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>名次</th>
                        <th>玩家</th>
                        <th>UID</th>
                        <th>游戏等级</th>
                        <th>{current.valueLabel}</th>
                        <th>游戏次数</th>
                        <th>更新时间</th>
                        {manageable && !snapshotId && (
                          <th className="align-right">操作</th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {entries.map((entry) => (
                        <tr
                          key={`${snapshotId || "live"}-${entry.rank}-${entry.uid}`}
                        >
                          <td>
                            <span
                              className={`rank-number ${entry.rank <= 3 ? `rank-${entry.rank}` : ""}`}
                            >
                              {entry.rank}
                            </span>
                          </td>
                          <td>
                            <strong>{entry.name}</strong>
                          </td>
                          <td>
                            <code>{entry.uid}</code>
                          </td>
                          <td>{entry.gameLevel || "—"}</td>
                          <td>
                            <strong>{formatNumber(entry.score)}</strong>
                          </td>
                          <td>{formatNumber(entry.gameCount)}</td>
                          <td className="muted-cell">
                            {formatDate(entry.updatedAt)}
                          </td>
                          {manageable && !snapshotId && (
                            <td className="align-right">
                              <span className="table-action-group">
                                <button
                                  className="table-action danger"
                                  disabled={blockingEntryId === entry.id}
                                  onClick={() => removeEntry(entry)}
                                >
                                  <Trash2 size={14} />
                                  移除
                                </button>
                                <button
                                  className="table-action danger"
                                  disabled={blockingEntryId === entry.id}
                                  onClick={() => blockEntryPlayer(entry)}
                                >
                                  <Ban size={14} />
                                  {blockingEntryId === entry.id
                                    ? "处理中…"
                                    : "拉黑"}
                                </button>
                              </span>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyState
                  icon={Trophy}
                  title={snapshotId ? "该快照没有记录" : "实时榜暂无玩家"}
                  description={
                    snapshotId
                      ? "该次发布没有包含候选条目。"
                      : "榜单定义已经就绪；还需地图客户端使用 game.leaderboards.write 权限上报候选条目，随后由后台发布前 100 名快照。"
                  }
                />
              )}
            </>
          ) : listLoading ? (
            <div className="loading-state">正在读取排行榜配置…</div>
          ) : listLoadError ? (
            <ErrorState
              title="排行榜配置读取失败"
              description={listLoadError}
              onRetry={loadLeaderboards}
            />
          ) : (
            <EmptyState
              icon={Trophy}
              title="尚未配置排行榜"
              description="排行榜按地图隔离，先创建榜单再接入游戏客户端。"
              action={
                manageable ? (
                  <Button
                    variant="primary"
                    icon={Plus}
                    onClick={openCreateLeaderboard}
                  >
                    创建第一个榜单
                  </Button>
                ) : null
              }
            />
          )}
        </section>
      </div>

      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={`${editing?.id ? "编辑" : "新建"}排行榜`}
        eyebrow="LEADERBOARD DEFINITION"
        footer={
          <>
            {editing?.id && (
              <Button variant="danger" onClick={removeLeaderboard}>
                删除排行榜
              </Button>
            )}
            <Button onClick={() => setEditing(null)}>取消</Button>
            <Button
              variant="primary"
              onClick={save}
              disabled={
                !editing?.leaderboardKey ||
                !editing?.name ||
                !editing?.valueLabel
              }
            >
              保存
            </Button>
          </>
        }
      >
        {editing && (
          <>
            <Field label="榜单名称">
              <input
                className="input"
                value={editing.name}
                onChange={(event) =>
                  setEditing({ ...editing, name: event.target.value })
                }
                placeholder="例如 落地战力榜"
              />
            </Field>
            <Field
              label="榜单 Key"
              hint={
                editing.id
                  ? "客户端接口的稳定标识，创建后不可修改"
                  : "客户端上报和查询时使用，创建后不可修改"
              }
            >
              <input
                className="input"
                value={editing.leaderboardKey}
                disabled={Boolean(editing.id)}
                onChange={(event) =>
                  setEditing({ ...editing, leaderboardKey: event.target.value })
                }
                placeholder="game_power"
              />
            </Field>
            <div className="field-grid-two">
              <Field label="数值名称">
                <input
                  className="input"
                  value={editing.valueLabel}
                  onChange={(event) =>
                    setEditing({ ...editing, valueLabel: event.target.value })
                  }
                  placeholder="战力"
                />
              </Field>
              <Field label="排序方式">
                <select
                  className="input"
                  value={editing.sortDirection}
                  onChange={(event) =>
                    setEditing({
                      ...editing,
                      sortDirection: event.target.value,
                    })
                  }
                >
                  <option value="desc">数值越高越靠前</option>
                  <option value="asc">数值越低越靠前</option>
                </select>
              </Field>
            </div>
            <Field label="分数更新策略">
              <select
                className="input"
                value={editing.scoreUpdateMode}
                onChange={(event) =>
                  setEditing({
                    ...editing,
                    scoreUpdateMode: event.target.value,
                  })
                }
              >
                <option value="latest">每日首份样本覆盖当前成绩</option>
                <option value="best">每日首份样本仅在更优时更新</option>
              </select>
            </Field>
            <Field label="接收上报">
              <Switch
                checked={editing.enabled}
                onChange={(value) => setEditing({ ...editing, enabled: value })}
                label={editing.enabled ? "已启用" : "已停用"}
              />
            </Field>
          </>
        )}
      </Modal>
    </>
  );
}
