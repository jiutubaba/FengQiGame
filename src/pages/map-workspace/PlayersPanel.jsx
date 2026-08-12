import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import {
  ArrowDown,
  ArrowUp,
  Edit3,
  Mail,
  Plus,
  Search,
  Trash2,
  Users,
} from "lucide-react";
import { api, apiPage } from "../../api/client";
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
import PaginationControls from "./PaginationControls";

export default function PlayersPanel({ mapId, can }) {
  const [viewParams, setViewParams] = useSearchParams();
  const [players, setPlayers] = useState([]),
    [messages, setMessages] = useState([]),
    [query, setQuery] = useState(() => viewParams.get("q") || ""),
    [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [messageLoadError, setMessageLoadError] = useState("");
  const [page, setPage] = useState(() => {
    const value = Number.parseInt(viewParams.get("page") || "1", 10);
    return Number.isFinite(value) && value > 0 ? value : 1;
  });
  const [playerPagination, setPlayerPagination] = useState({
    page: 1,
    limit: 20,
    total: 0,
  });
  const [sortBy, setSortBy] = useState(() =>
    ["level", "lastActiveAt"].includes(viewParams.get("sort"))
      ? viewParams.get("sort")
      : "lastActiveAt",
  );
  const [sortDirection, setSortDirection] = useState(() =>
    viewParams.get("direction") === "asc" ? "asc" : "desc",
  );
  const [selected, setSelected] = useState([]),
    [editing, setEditing] = useState(null),
    [mailOpen, setMailOpen] = useState(false);
  const [mail, setMail] = useState({ subject: "", content: "" });
  const playerRequestId = useRef(0);
  const messageRequestId = useRef(0);
  const previousPlayersMapId = useRef(mapId);
  const confirmAction = useConfirm(),
    toast = useToast(),
    manageable = can("players.manage");
  const loadPlayers = useCallback(async () => {
    const requestId = ++playerRequestId.current;
    setLoading(true);
    setLoadError("");
    try {
      const params = new URLSearchParams({
        q: query,
        page: String(page),
        limit: "20",
        sortBy,
        sortDirection,
      });
      const result = await apiPage(`/api/maps/${mapId}/players?${params}`);
      if (requestId !== playerRequestId.current) return;
      const totalPages = Math.max(
        1,
        Math.ceil(result.pagination.total / result.pagination.limit),
      );
      if (page > totalPages) {
        setPage(totalPages);
        return;
      }
      setPlayers(result.data);
      setPlayerPagination(result.pagination);
    } catch (error) {
      if (requestId === playerRequestId.current) setLoadError(error.message);
    } finally {
      if (requestId === playerRequestId.current) setLoading(false);
    }
  }, [mapId, page, query, sortBy, sortDirection, toast]);
  const loadMessages = useCallback(async () => {
    const requestId = ++messageRequestId.current;
    setMessageLoadError("");
    try {
      const messageRows = await api(`/api/maps/${mapId}/messages?limit=20`);
      if (requestId === messageRequestId.current) setMessages(messageRows);
    } catch (error) {
      if (requestId === messageRequestId.current)
        setMessageLoadError(error.message);
    }
  }, [mapId, toast]);
  useEffect(() => {
    const mapChanged = previousPlayersMapId.current !== mapId;
    previousPlayersMapId.current = mapId;
    playerRequestId.current += 1;
    messageRequestId.current += 1;
    setPlayers([]);
    setMessages([]);
    setLoadError("");
    setMessageLoadError("");
    setSelected([]);
    if (mapChanged) {
      setQuery("");
      setPage(1);
      setSortBy("lastActiveAt");
      setSortDirection("desc");
    }
    setPlayerPagination({ page: 1, limit: 20, total: 0 });
    setLoading(true);
  }, [mapId]);
  useEffect(() => {
    const next = new URLSearchParams();
    if (query.trim()) next.set("q", query.trim());
    if (page > 1) next.set("page", String(page));
    if (sortBy !== "lastActiveAt") next.set("sort", sortBy);
    if (sortDirection !== "desc") next.set("direction", sortDirection);
    setViewParams(next, { replace: true });
  }, [page, query, setViewParams, sortBy, sortDirection]);
  useEffect(() => {
    const timer = setTimeout(loadPlayers, 200);
    return () => {
      clearTimeout(timer);
      playerRequestId.current += 1;
    };
  }, [loadPlayers]);
  useEffect(() => {
    loadMessages();
  }, [loadMessages]);
  const refreshPlayersAndMessages = async () => {
    await Promise.all([loadPlayers(), loadMessages()]);
  };
  const toggleSort = (nextSortBy) => {
    setPage(1);
    setSelected([]);
    if (sortBy === nextSortBy) {
      setSortDirection((current) => (current === "desc" ? "asc" : "desc"));
      return;
    }
    setSortBy(nextSortBy);
    setSortDirection("desc");
  };
  const save = async () => {
    try {
      const path = editing.id
        ? `/api/maps/${mapId}/players/${editing.id}`
        : `/api/maps/${mapId}/players`;
      await api(path, {
        method: editing.id ? "PATCH" : "POST",
        body: editing,
      });
      setEditing(null);
      toast("玩家资料已保存");
      refreshPlayersAndMessages();
    } catch (error) {
      toast(error.message, "danger");
    }
  };
  const remove = async (player) => {
    if (
      !(await confirmAction({
        title: "删除玩家",
        description: `确认删除玩家“${player.name}”？`,
        detail:
          "该操作会按服务端规则处理玩家及关联业务记录，请确认目标玩家无误。",
        confirmLabel: "确认删除",
      }))
    )
      return;
    try {
      await api(`/api/maps/${mapId}/players/${player.id}`, {
        method: "DELETE",
      });
      setSelected((current) => current.filter((id) => id !== player.id));
      toast("玩家已删除");
      if (players.length === 1 && page > 1) {
        setPage((current) => current - 1);
        loadMessages();
      } else {
        refreshPlayersAndMessages();
      }
    } catch (error) {
      toast(error.message, "danger");
    }
  };
  const sendMail = async () => {
    try {
      await api(`/api/maps/${mapId}/messages`, {
        method: "POST",
        body: { playerIds: selected, ...mail },
      });
      setMailOpen(false);
      setMail({ subject: "", content: "" });
      toast("消息已进入游戏客户端待领取队列");
      loadMessages();
    } catch (error) {
      toast(error.message, "danger");
    }
  };
  const toggleAll = () =>
    setSelected(
      players.length > 0 &&
        players.every((player) => selected.includes(player.id))
        ? []
        : players.map((player) => player.id),
    );
  return (
    <>
      <div className="module-toolbar">
        <div className="search-box">
          <Search size={16} />
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(1);
              setSelected([]);
            }}
            placeholder="玩家 UID 或玩家名"
            aria-label="搜索玩家 UID 或玩家名"
          />
        </div>
        <div className="section-actions">
          {manageable && (
            <Button
              icon={Mail}
              disabled={!selected.length}
              onClick={() => setMailOpen(true)}
            >
              发送消息 ({selected.length})
            </Button>
          )}
          {manageable && (
            <Button
              variant="primary"
              icon={Plus}
              onClick={() =>
                setEditing({
                  uid: "",
                  name: "",
                  level: 0,
                  gameLevel: "",
                  itemBan: false,
                  dataBan: false,
                  rankBan: false,
                  profile: {},
                })
              }
            >
              添加玩家
            </Button>
          )}
        </div>
      </div>
      <FilterSummary
        items={[
          ...(query.trim() ? [`搜索：${query.trim()}`] : []),
          `排序：${sortBy === "level" ? "等级" : "最后活跃"} · ${sortDirection === "asc" ? "升序" : "降序"}`,
          ...(selected.length ? [`已选 ${selected.length} 位`] : []),
        ]}
        resultText={
          loading
            ? "正在更新…"
            : `共 ${formatNumber(playerPagination.total)} 位玩家`
        }
        onClear={
          query.trim() ||
          selected.length ||
          sortBy !== "lastActiveAt" ||
          sortDirection !== "desc"
            ? () => {
                setQuery("");
                setPage(1);
                setSortBy("lastActiveAt");
                setSortDirection("desc");
                setSelected([]);
              }
            : undefined
        }
      />
      {loadError && players.length > 0 && (
        <InlineAlert
          tone="danger"
          title="玩家列表刷新失败"
          description={`${loadError}；当前仍显示上一次成功读取的数据。`}
          action={<Button onClick={loadPlayers}>重新尝试</Button>}
        />
      )}
      {loading && !players.length ? (
        <div className="loading-state">正在读取玩家…</div>
      ) : loadError && !players.length ? (
        <ErrorState
          title="玩家列表读取失败"
          description={loadError}
          onRetry={loadPlayers}
        />
      ) : players.length ? (
        <div className="table-shell">
          <table className="data-table">
            <thead>
              <tr>
                <th className="check-cell">
                  <input
                    type="checkbox"
                    checked={
                      players.length > 0 &&
                      players.every((player) => selected.includes(player.id))
                    }
                    onChange={toggleAll}
                  />
                </th>
                <th>玩家</th>
                <th>UID</th>
                <th
                  aria-sort={
                    sortBy === "level"
                      ? sortDirection === "asc"
                        ? "ascending"
                        : "descending"
                      : "none"
                  }
                >
                  <button
                    type="button"
                    className={`table-sort-button ${sortBy === "level" ? "active" : ""}`}
                    onClick={() => toggleSort("level")}
                  >
                    等级
                    {sortBy === "level" ? (
                      sortDirection === "asc" ? (
                        <ArrowUp size={14} />
                      ) : (
                        <ArrowDown size={14} />
                      )
                    ) : (
                      <span className="sort-placeholder">↕</span>
                    )}
                  </button>
                </th>
                <th>状态</th>
                <th
                  aria-sort={
                    sortBy === "lastActiveAt"
                      ? sortDirection === "asc"
                        ? "ascending"
                        : "descending"
                      : "none"
                  }
                >
                  <button
                    type="button"
                    className={`table-sort-button ${sortBy === "lastActiveAt" ? "active" : ""}`}
                    onClick={() => toggleSort("lastActiveAt")}
                    title="最近一次游戏客户端上报玩家资料的时间"
                  >
                    最后活跃
                    {sortBy === "lastActiveAt" ? (
                      sortDirection === "asc" ? (
                        <ArrowUp size={14} />
                      ) : (
                        <ArrowDown size={14} />
                      )
                    ) : (
                      <span className="sort-placeholder">↕</span>
                    )}
                  </button>
                </th>
                <th className="align-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {players.map((player) => (
                <tr key={player.id}>
                  <td className="check-cell">
                    <input
                      type="checkbox"
                      checked={selected.includes(player.id)}
                      onChange={() =>
                        setSelected((current) =>
                          current.includes(player.id)
                            ? current.filter((id) => id !== player.id)
                            : [...current, player.id],
                        )
                      }
                    />
                  </td>
                  <td>
                    <div className="player-name">
                      <span>{player.name[0]}</span>
                      <strong>{player.name}</strong>
                    </div>
                  </td>
                  <td>
                    <code>{player.uid}</code>
                  </td>
                  <td>{formatNumber(player.level)}</td>
                  <td>
                    <div className="badge-row">
                      {player.itemBan && <Badge tone="warning">物品封禁</Badge>}
                      {player.dataBan && <Badge tone="warning">存档封禁</Badge>}
                      {player.rankBan && <Badge tone="warning">榜单封禁</Badge>}
                      {!player.itemBan &&
                        !player.dataBan &&
                        !player.rankBan && <Badge tone="positive">正常</Badge>}
                    </div>
                  </td>
                  <td className="muted-cell">
                    {formatDate(player.lastActiveAt)}
                  </td>
                  <td className="align-right">
                    {manageable && (
                      <>
                        <button
                          className="table-action"
                          onClick={() => setEditing({ ...player })}
                        >
                          <Edit3 size={14} />
                          编辑
                        </button>
                        <button
                          className="table-action danger"
                          onClick={() => remove(player)}
                        >
                          <Trash2 size={14} />
                          删除
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <PaginationControls
            pagination={playerPagination}
            noun="位玩家"
            onPageChange={(nextPage) => {
              setSelected([]);
              setPage(nextPage);
            }}
          />
        </div>
      ) : (
        <EmptyState
          icon={Users}
          title={query ? "没有匹配的玩家" : "当前地图没有玩家"}
          description={
            query
              ? "请调整玩家名称或 UID 搜索词。"
              : "可由游戏客户端 API 自动写入，也可以手动添加。"
          }
        />
      )}
      {messageLoadError && (
        <InlineAlert
          tone="danger"
          title="最近消息读取失败"
          description={messageLoadError}
          action={<Button onClick={loadMessages}>重新尝试</Button>}
        />
      )}
      {messages.length > 0 && (
        <section className="subsection-panel">
          <div className="subsection-head">
            <div>
              <span className="eyebrow">MESSAGE DELIVERY</span>
              <h3>最近消息记录</h3>
              <p>客户端确认后状态会从“待送达”更新为“已送达”。</p>
            </div>
          </div>
          <div className="table-shell">
            <table className="data-table">
              <thead>
                <tr>
                  <th>玩家</th>
                  <th>标题</th>
                  <th>状态</th>
                  <th>发送时间</th>
                  <th>送达时间</th>
                </tr>
              </thead>
              <tbody>
                {messages.map((message) => (
                  <tr key={message.id}>
                    <td>
                      <strong>{message.playerName}</strong>
                      <small className="cell-subtitle">{message.uid}</small>
                    </td>
                    <td>{message.subject}</td>
                    <td>
                      <Badge
                        tone={
                          message.status === "delivered"
                            ? "positive"
                            : "warning"
                        }
                      >
                        {message.status === "delivered" ? "已送达" : "待送达"}
                      </Badge>
                    </td>
                    <td>{formatDate(message.createdAt)}</td>
                    <td>{formatDate(message.deliveredAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={editing?.id ? `编辑玩家 · ${editing.name}` : "添加玩家"}
        eyebrow="PLAYER PROFILE"
        wide
        footer={
          <>
            <Button onClick={() => setEditing(null)}>取消</Button>
            <Button
              variant="primary"
              onClick={save}
              disabled={!editing?.uid || !editing?.name}
            >
              保存资料
            </Button>
          </>
        }
      >
        {editing && (
          <>
            <div className="form-grid">
              <Field
                label="玩家 UID"
                hint={
                  editing.uidLocked
                    ? "该玩家已有游戏或运营数据，UID 已锁定；姓名、等级与封禁状态仍可修改。"
                    : "玩家产生游戏、存档、消息、礼包、榜单、指标、风控或群抽数据后将自动锁定。"
                }
              >
                <input
                  className="input"
                  value={editing.uid}
                  disabled={Boolean(editing.id && editing.uidLocked)}
                  onChange={(event) =>
                    setEditing({ ...editing, uid: event.target.value })
                  }
                />
              </Field>
              <Field label="玩家名">
                <input
                  className="input"
                  value={editing.name}
                  onChange={(event) =>
                    setEditing({ ...editing, name: event.target.value })
                  }
                />
              </Field>
              <Field label="后台等级">
                <input
                  className="input"
                  type="number"
                  min="0"
                  value={editing.level}
                  onChange={(event) =>
                    setEditing({
                      ...editing,
                      level: Number(event.target.value),
                    })
                  }
                />
              </Field>
              <Field label="游戏难度">
                <input
                  className="input"
                  value={editing.gameLevel || ""}
                  onChange={(event) =>
                    setEditing({ ...editing, gameLevel: event.target.value })
                  }
                />
              </Field>
            </div>
            <div className="status-control-list">
              {[
                ["itemBan", "物品封禁"],
                ["dataBan", "存档封禁"],
                ["rankBan", "榜单封禁"],
              ].map(([key, label]) => (
                <div key={key}>
                  <span>
                    <strong>{label}</strong>
                    <small>修改后立即影响后台状态。</small>
                  </span>
                  <Switch
                    checked={Boolean(editing[key])}
                    onChange={(value) =>
                      setEditing({ ...editing, [key]: value })
                    }
                  />
                </div>
              ))}
            </div>
          </>
        )}
      </Modal>
      <Modal
        open={mailOpen}
        onClose={() => setMailOpen(false)}
        title={`发送游戏内消息 · ${selected.length} 位玩家`}
        eyebrow="PLAYER MESSAGE"
        footer={
          <>
            <Button onClick={() => setMailOpen(false)}>取消</Button>
            <Button
              variant="primary"
              onClick={sendMail}
              disabled={!mail.subject.trim() || !mail.content.trim()}
            >
              发送消息
            </Button>
          </>
        }
      >
        <Field label="标题">
          <input
            className="input"
            value={mail.subject}
            onChange={(event) =>
              setMail({ ...mail, subject: event.target.value })
            }
          />
        </Field>
        <Field label="内容">
          <textarea
            className="input"
            rows="6"
            value={mail.content}
            onChange={(event) =>
              setMail({ ...mail, content: event.target.value })
            }
          />
        </Field>
        <p className="warning-note">
          消息通过 game.messages.read API
          由游戏客户端拉取，客户端确认后状态变为已送达。
        </p>
      </Modal>
    </>
  );
}
