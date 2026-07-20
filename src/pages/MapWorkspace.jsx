import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useOutletContext, useParams } from "react-router-dom";
import {
  Activity,
  ArrowLeft,
  ArrowUpRight,
  BarChart3,
  Check,
  CircleHelp,
  Clipboard,
  CloudUpload,
  Download,
  Edit3,
  Eye,
  File,
  FileArchive,
  FileImage,
  FileJson,
  FileKey2,
  Folder,
  FolderPlus,
  Gift,
  KeyRound,
  Mail,
  MoreHorizontal,
  Plus,
  RadioTower,
  RefreshCw,
  Save,
  Search,
  Settings2,
  ShieldAlert,
  Sparkles,
  Trash2,
  Trophy,
  Upload,
  Users,
} from "lucide-react";
import { api, download, withEnvironment } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import {
  Badge,
  Button,
  EmptyState,
  Field,
  Modal,
  SectionHead,
  Switch,
  useToast,
} from "../components/ui";
import {
  environmentLabel,
  formatBytes,
  formatDate,
  formatNumber,
} from "../utils/format";

const sectionTitles = {
  metrics: [
    "地图数据",
    "查看当前环境由游戏客户端上报的真实指标。",
    "metrics.view",
  ],
  config: ["地图配置", "维护地图基础信息、共享配置与运行环境。", "map.view"],
  players: [
    "玩家管理",
    "查询玩家、调整封禁状态并发送游戏内消息。",
    "players.view",
  ],
  leaderboards: [
    "排行榜中心",
    "维护通用榜单、查看实时排名并发布可追溯快照。",
    "leaderboards.view",
  ],
  risk: [
    "风控中心",
    "查看客户端风险事件，并联动玩家封禁状态完成处置。",
    "risk.view",
  ],
  gifts: [
    "礼包与群抽",
    "维护礼包、批量发放并创建公开群抽活动。",
    "gifts.manage",
  ],
  anchors: [
    "主播管理",
    "维护当前环境的主播名单和专属礼包配置。",
    "anchors.manage",
  ],
  points: [
    "埋点管理",
    "维护行为埋点并查看客户端累计触发次数。",
    "points.manage",
  ],
  logs: ["日志管理", "查看游戏客户端上报并自动聚合的运行日志。", "logs.view"],
  files: [
    "文件管理",
    "使用地图独立文件空间进行上传、下载和目录管理。",
    "files.manage",
  ],
  "api-keys": [
    "客户端接入",
    "创建按地图、环境和接口权限隔离的游戏 API Key。",
    "api_keys.manage",
  ],
};

const environments = ["release", "lobby", "test"];

export default function MapWorkspace() {
  const { mapId, section } = useParams();
  const navigate = useNavigate();
  const { selectedMap, refreshMaps } = useOutletContext();
  const { isAdmin } = useAuth();
  const [environment, setEnvironment] = useState(
    selectedMap?.runtimeEnv || "release",
  );
  const [map, setMap] = useState(selectedMap || null);
  const toast = useToast();

  useEffect(() => {
    if (selectedMap?.runtimeEnv) setEnvironment(selectedMap.runtimeEnv);
  }, [selectedMap?.runtimeEnv]);
  useEffect(() => {
    api(`/api/maps/${mapId}`)
      .then(setMap)
      .catch((error) => toast(error.message, "danger"));
  }, [mapId, toast]);

  const title = sectionTitles[section];
  const allowed = Boolean(
    map && (isAdmin || map.permissions?.includes(title?.[2])),
  );
  if (!title)
    return (
      <EmptyState
        title="功能不存在"
        description="该工作区没有这个功能。"
        action={
          <Button onClick={() => navigate(`/maps/${mapId}/metrics`)}>
            返回地图数据
          </Button>
        }
      />
    );
  if (!map) return <div className="loading-state">正在读取地图与权限…</div>;
  if (!allowed)
    return (
      <EmptyState
        icon={ShieldAlert}
        title="没有访问权限"
        description="管理员尚未为你的账号开放此功能。"
        action={<Button onClick={() => navigate("/maps")}>返回地图中心</Button>}
      />
    );

  const panelProps = {
    map,
    mapId: Number(mapId),
    environment,
    isAdmin,
    can: (permission) => isAdmin || map.permissions?.includes(permission),
    refreshMap: async () => {
      const next = await api(`/api/maps/${mapId}`);
      setMap(next);
      await refreshMaps();
    },
    refreshMaps,
  };
  const panels = {
    metrics: <MetricsPanel {...panelProps} />,
    config: <ConfigPanel {...panelProps} />,
    players: <PlayersPanel {...panelProps} />,
    leaderboards: <LeaderboardsPanel {...panelProps} />,
    risk: <RiskPanel {...panelProps} />,
    gifts: <GiftsPanel {...panelProps} />,
    anchors: <ResourcePanel {...panelProps} resource="anchors" />,
    points: <ResourcePanel {...panelProps} resource="points" />,
    logs: <LogsPanel {...panelProps} />,
    files: <FilesPanel {...panelProps} />,
    "api-keys": <ApiKeysPanel {...panelProps} />,
  };

  return (
    <div className="page-stack page-enter">
      <div className="workspace-head">
        <SectionHead
          eyebrow={`MAP / ${String(map.id).padStart(3, "0")}`}
          title={title[0]}
          description={title[1]}
        />
        <div className="environment-switch">
          {environments.map((value) => (
            <button
              key={value}
              className={environment === value ? "active" : ""}
              onClick={() => setEnvironment(value)}
            >
              {environmentLabel(value)}
            </button>
          ))}
        </div>
      </div>
      {panels[section]}
    </div>
  );
}

function MetricsPanel({ mapId, environment }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const toast = useToast();
  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(
        await api(withEnvironment(`/api/maps/${mapId}/metrics`, environment)),
      );
    } catch (error) {
      toast(error.message, "danger");
    } finally {
      setLoading(false);
    }
  }, [mapId, environment, toast]);
  useEffect(() => {
    load();
  }, [load]);
  if (loading && !data)
    return <div className="loading-state">正在统计当前环境数据…</div>;
  const summary = data?.summary || {};
  const cards = [
    ["累计用户", summary.cumulativeUsers],
    ["在线用户", summary.onlineUsers],
    ["总局数", summary.totalGameCount],
    ["日新增用户", summary.dailyNewUsers],
    ["日活跃用户", summary.dailyActiveUsers],
    ["流失用户数", summary.lostUserCount],
    ["回流用户数", summary.returnUserCount],
    ["活跃用户留存率", `${summary.activeUserRetentionRate || 0}%`],
    ["新增用户留存率", `${summary.newUserRetentionRate || 0}%`],
    ["七日留存率", `${summary.sevenDayRetentionRate || 0}%`],
    ["复玩率", `${summary.replayRate || 0}%`],
  ];
  return (
    <>
      <div className="metrics-toolbar">
        <div>
          <span className="pulse-dot" />
          当前为{environmentLabel(environment)}数据
        </div>
        <Button icon={RefreshCw} onClick={load} disabled={loading}>
          {loading ? "统计中…" : "刷新统计"}
        </Button>
      </div>
      <div className="metric-grid">
        {cards.map(([label, value], index) => (
          <article className="metric-cell" key={label}>
            <div className="metric-cell-top">
              <span>{label}</span>
              <small>{String(index + 1).padStart(2, "0")}</small>
            </div>
            <strong>
              {typeof value === "number" ? formatNumber(value) : value}
            </strong>
            <small>
              {data?.calculatedAt
                ? formatDate(data.calculatedAt)
                : "等待客户端上报"}
            </small>
          </article>
        ))}
      </div>
      <TrendChart rows={data?.trends || []} />
      <div className="data-footnote">
        <CircleHelp size={16} />
        <span>
          指标由持有 game.metrics.write 权限的游戏客户端 API Key
          上报；不同环境完全隔离。
        </span>
      </div>
    </>
  );
}

function TrendChart({ rows }) {
  if (!rows.length)
    return (
      <EmptyState
        icon={BarChart3}
        title="暂无趋势数据"
        description="接入游戏客户端并上报指标后，这里会显示近 30 天趋势。"
      />
    );
  const width = 920,
    height = 248;
  const values = rows.map((item) => Number(item.cumulativeUsers || 0)),
    min = Math.min(...values),
    max = Math.max(...values);
  const points = rows.map((item, index) => ({
    ...item,
    x: 34 + index * ((width - 68) / Math.max(1, rows.length - 1)),
    y:
      height -
      40 -
      ((Number(item.cumulativeUsers) - min) / Math.max(1, max - min)) * 142,
  }));
  const line = points.map((item) => `${item.x},${item.y}`).join(" "),
    area = `${points[0].x},${height - 40} ${line} ${points.at(-1).x},${height - 40}`;
  return (
    <div className="chart-wrap">
      <div className="chart-head">
        <div>
          <span className="eyebrow">USER GROWTH</span>
          <h3>累计用户趋势</h3>
        </div>
        <div className="chart-legend">
          <span>
            <i className="legend-gold" />
            累计用户
          </span>
        </div>
      </div>
      <svg
        className="trend-chart"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="累计用户趋势"
      >
        {[0, 1, 2, 3].map((index) => (
          <line
            key={index}
            x1="34"
            y1={44 + index * 48}
            x2={width - 34}
            y2={44 + index * 48}
            className="chart-gridline"
          />
        ))}
        <polygon points={area} className="chart-area" />
        <polyline points={line} className="chart-line" />
        {points.map((item, index) => (
          <g key={`${item.date}-${index}`}>
            <circle
              cx={item.x}
              cy={item.y}
              r={index === points.length - 1 ? 5 : 3}
              className="chart-point"
            />
            <text
              x={item.x}
              y={height - 15}
              textAnchor="middle"
              className="chart-label"
            >
              {String(item.date).slice(5, 10)}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

const configSections = [
  ["ranks", "榜单配置"],
  ["gifts", "礼包配置"],
  ["anchorGifts", "主播福利礼包"],
  ["globals", "全局存档"],
  ["dayLimits", "存档每日上限"],
  ["randomGroups", "随机数存档"],
  ["preloadCode", "预加载代码"],
];

function ConfigPanel({
  map,
  mapId,
  environment,
  isAdmin,
  can,
  refreshMap,
  refreshMaps,
}) {
  const [active, setActive] = useState("basic");
  const [config, setConfig] = useState(null);
  const [mapForm, setMapForm] = useState({
    name: map.name,
    description: map.description || "",
    runtimeEnv: map.runtimeEnv,
    coverPath: map.coverPath || "",
  });
  const [editor, setEditor] = useState("");
  const [clearOpen, setClearOpen] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const [deleteStep, setDeleteStep] = useState(0);
  const [deleting, setDeleting] = useState(false);
  const navigate = useNavigate();
  const toast = useToast();
  const editable = can("map.edit");

  const load = useCallback(async () => {
    try {
      setConfig(await api(`/api/maps/${mapId}/config`));
    } catch (error) {
      toast(error.message, "danger");
    }
  }, [mapId, toast]);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    if (!config || active === "basic") return;
    setEditor(
      active === "preloadCode"
        ? String(config[active] || "")
        : JSON.stringify(config[active] || [], null, 2),
    );
  }, [active, config]);

  const saveMap = async () => {
    try {
      await api(`/api/maps/${mapId}`, {
        method: "PATCH",
        body: { ...mapForm, coverPath: mapForm.coverPath || null },
      });
      await refreshMap();
      toast("地图基础信息已保存");
    } catch (error) {
      toast(error.message, "danger");
    }
  };
  const saveSection = async () => {
    try {
      const value = active === "preloadCode" ? editor : JSON.parse(editor);
      const next = await api(`/api/maps/${mapId}/config`, {
        method: "PUT",
        body: { [active]: value },
      });
      setConfig(next);
      toast("配置已保存");
    } catch (error) {
      toast(
        error instanceof SyntaxError ? "JSON 格式不正确" : error.message,
        "danger",
      );
    }
  };
  const exportConfig = () => {
    const blob = new Blob([JSON.stringify(config, null, 2)], {
        type: "application/json",
      }),
      url = URL.createObjectURL(blob),
      anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `map-${mapId}-config.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };
  const clearRuntime = async () => {
    try {
      const counts = await api(`/api/maps/${mapId}/runtime/clear`, {
        method: "POST",
        body: { environment, confirmName },
      });
      setClearOpen(false);
      setConfirmName("");
      toast(
        `运行数据已清理：${Object.values(counts).reduce((sum, value) => sum + value, 0)} 条`,
      );
    } catch (error) {
      toast(error.message, "danger");
    }
  };
  const archiveMap = async () => {
    if (
      !window.confirm(`确认归档地图“${map.name}”？归档后普通列表将不再显示。`)
    )
      return;
    try {
      await api(`/api/maps/${mapId}`, { method: "DELETE" });
      toast("地图已归档");
      navigate("/maps");
    } catch (error) {
      toast(error.message, "danger");
    }
  };
  const deleteMapPermanently = async () => {
    setDeleting(true);
    try {
      await api(`/api/maps/${mapId}/permanent`, {
        method: "DELETE",
        body: { confirmMapId: map.id, confirmName: map.name },
      });
      setDeleteStep(0);
      await refreshMaps();
      toast("地图及服务器数据已永久删除");
      navigate("/maps");
    } catch (error) {
      toast(error.message, "danger");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="config-layout">
      <aside className="config-sidebar">
        <span className="nav-label">配置板块</span>
        <button
          className={active === "basic" ? "active" : ""}
          onClick={() => setActive("basic")}
        >
          <Edit3 size={16} />
          基础信息
        </button>
        {configSections.map(([key, label]) => (
          <button
            key={key}
            className={active === key ? "active" : ""}
            onClick={() => setActive(key)}
          >
            <Settings2 size={16} />
            {label}
          </button>
        ))}
      </aside>
      <section className="config-surface">
        {active === "basic" ? (
          <>
            <div className="config-surface-head">
              <div>
                <span className="eyebrow">MAP SETTINGS</span>
                <h3>地图基础信息</h3>
                <p>地图名称全局唯一，默认环境决定地图中心的统计口径。</p>
              </div>
              {editable && (
                <Button variant="primary" icon={Save} onClick={saveMap}>
                  保存地图
                </Button>
              )}
            </div>
            <div className="form-grid">
              <Field label="地图名称">
                <input
                  className="input"
                  value={mapForm.name}
                  onChange={(event) =>
                    setMapForm({ ...mapForm, name: event.target.value })
                  }
                  readOnly={!editable}
                />
              </Field>
              <Field label="默认运行环境">
                <select
                  className="input"
                  value={mapForm.runtimeEnv}
                  onChange={(event) =>
                    setMapForm({ ...mapForm, runtimeEnv: event.target.value })
                  }
                  disabled={!editable}
                >
                  {environments.map((value) => (
                    <option value={value} key={value}>
                      {environmentLabel(value)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="封面路径">
                <input
                  className="input"
                  value={mapForm.coverPath}
                  onChange={(event) =>
                    setMapForm({ ...mapForm, coverPath: event.target.value })
                  }
                  readOnly={!editable}
                  placeholder="例如 /api/maps/.../files/.../download?inline=1"
                />
              </Field>
              <Field label="说明">
                <textarea
                  className="input"
                  rows="4"
                  value={mapForm.description}
                  onChange={(event) =>
                    setMapForm({ ...mapForm, description: event.target.value })
                  }
                  readOnly={!editable}
                />
              </Field>
            </div>
            <div className="form-actions">
              <Button icon={Download} onClick={exportConfig} disabled={!config}>
                导出完整配置
              </Button>
              {isAdmin && (
                <>
                  <Button
                    variant="danger"
                    icon={ShieldAlert}
                    onClick={() => setClearOpen(true)}
                  >
                    清理{environmentLabel(environment)}运行数据
                  </Button>
                  <Button variant="danger" icon={Trash2} onClick={archiveMap}>
                    归档地图
                  </Button>
                </>
              )}
            </div>
            {isAdmin && (
              <div className="danger-zone map-delete-zone">
                <div>
                  <ShieldAlert size={19} />
                  <span>
                    <strong>永久删除地图</strong>
                    <small>
                      清除全部环境的玩家、存档、配置、榜单、礼包、日志、API Key
                      和上传文件，不可撤销。
                    </small>
                  </span>
                </div>
                <Button
                  variant="danger"
                  icon={Trash2}
                  onClick={() => setDeleteStep(1)}
                >
                  永久删除
                </Button>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="config-surface-head">
              <div>
                <span className="eyebrow">CONFIGURATION DATA</span>
                <h3>{configSections.find(([key]) => key === active)?.[1]}</h3>
                <p>
                  {active === "preloadCode"
                    ? "保存游戏加载时使用的预加载代码。"
                    : "使用 JSON 数组维护结构化配置，保存前会进行语法校验。"}
                </p>
              </div>
              {editable && (
                <Button variant="primary" icon={Save} onClick={saveSection}>
                  保存配置
                </Button>
              )}
            </div>
            <textarea
              className="code-editor config-editor"
              spellCheck="false"
              value={editor}
              onChange={(event) => setEditor(event.target.value)}
              readOnly={!editable}
            />
          </>
        )}
      </section>
      <Modal
        open={clearOpen}
        onClose={() => setClearOpen(false)}
        danger
        title={`清理${environmentLabel(environment)}运行数据`}
        eyebrow="DANGEROUS OPERATION"
        footer={
          <>
            <Button onClick={() => setClearOpen(false)}>取消</Button>
            <Button
              variant="danger"
              onClick={clearRuntime}
              disabled={confirmName !== map.name}
            >
              确认清理
            </Button>
          </>
        }
      >
        <p className="warning-note">
          将删除当前环境的玩家、礼包发放、消息、日志、指标、排行榜实时数据与快照、风控事件，并把埋点次数归零。排行榜定义、风控规则、地图配置和文件不会删除，操作会写入审计日志。
        </p>
        <Field label={`输入地图名称“${map.name}”确认`}>
          <input
            className="input"
            value={confirmName}
            onChange={(event) => setConfirmName(event.target.value)}
          />
        </Field>
      </Modal>
      <Modal
        open={deleteStep === 1}
        onClose={() => setDeleteStep(0)}
        danger
        title="永久删除地图"
        eyebrow="PERMANENT DELETION · 第一次确认"
        footer={
          <>
            <Button onClick={() => setDeleteStep(0)}>取消</Button>
            <Button
              variant="danger"
              icon={ShieldAlert}
              onClick={() => setDeleteStep(2)}
            >
              确认风险，继续删除
            </Button>
          </>
        }
      >
        <p className="warning-note danger-warning">
          此操作不是归档，也不是清理单个环境。继续后将进入最终确认。
        </p>
        <ul className="danger-consequence-list">
          <li>删除正式服、大厅服和测试服的全部玩家与存档数据。</li>
          <li>删除地图配置、礼包、榜单及快照、风控、日志和 API Key。</li>
          <li>删除服务器上传卷中该地图的全部文件。</li>
          <li>后台不提供撤销或恢复按钮。</li>
        </ul>
      </Modal>
      <Modal
        open={deleteStep === 2}
        onClose={() => !deleting && setDeleteStep(0)}
        danger
        title={`最终确认：永久删除“${map.name}”`}
        eyebrow="PERMANENT DELETION · 第二次确认"
        footer={
          <>
            <Button onClick={() => setDeleteStep(0)} disabled={deleting}>
              取消
            </Button>
            <Button
              variant="danger"
              icon={Trash2}
              onClick={deleteMapPermanently}
              disabled={deleting}
            >
              {deleting ? "正在永久删除…" : "确认永久删除"}
            </Button>
          </>
        }
      >
        <div className="permanent-delete-target">
          <span>即将永久删除</span>
          <strong>{map.name}</strong>
          <code>地图 ID：{map.id}</code>
        </div>
        <p className="warning-note danger-warning">
          确认后，当前在线数据库和上传卷中的地图数据将不可恢复。历史审计记录会保留，已有数据库与上传卷备份仍按原保留期管理。
        </p>
      </Modal>
    </div>
  );
}

function PlayersPanel({ mapId, environment, can }) {
  const [players, setPlayers] = useState([]),
    [messages, setMessages] = useState([]),
    [query, setQuery] = useState(""),
    [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState([]),
    [editing, setEditing] = useState(null),
    [mailOpen, setMailOpen] = useState(false);
  const [mail, setMail] = useState({ subject: "", content: "" });
  const toast = useToast(),
    manageable = can("players.manage");
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [playerRows, messageRows] = await Promise.all([
        api(
          withEnvironment(
            `/api/maps/${mapId}/players?q=${encodeURIComponent(query)}&limit=100`,
            environment,
          ),
        ),
        api(
          withEnvironment(`/api/maps/${mapId}/messages?limit=20`, environment),
        ),
      ]);
      setPlayers(playerRows);
      setMessages(messageRows);
    } catch (error) {
      toast(error.message, "danger");
    } finally {
      setLoading(false);
    }
  }, [mapId, environment, query, toast]);
  useEffect(() => {
    const timer = setTimeout(load, 200);
    return () => clearTimeout(timer);
  }, [load]);
  const save = async () => {
    try {
      const path = editing.id
        ? `/api/maps/${mapId}/players/${editing.id}`
        : `/api/maps/${mapId}/players`;
      await api(withEnvironment(path, environment), {
        method: editing.id ? "PATCH" : "POST",
        body: editing,
      });
      setEditing(null);
      toast("玩家资料已保存");
      load();
    } catch (error) {
      toast(error.message, "danger");
    }
  };
  const remove = async (player) => {
    if (!window.confirm(`确认删除玩家“${player.name}”？`)) return;
    try {
      await api(
        withEnvironment(`/api/maps/${mapId}/players/${player.id}`, environment),
        { method: "DELETE" },
      );
      setSelected((current) => current.filter((id) => id !== player.id));
      toast("玩家已删除");
      load();
    } catch (error) {
      toast(error.message, "danger");
    }
  };
  const sendMail = async () => {
    try {
      await api(withEnvironment(`/api/maps/${mapId}/messages`, environment), {
        method: "POST",
        body: { playerIds: selected, ...mail },
      });
      setMailOpen(false);
      setMail({ subject: "", content: "" });
      toast("消息已进入游戏客户端待领取队列");
      load();
    } catch (error) {
      toast(error.message, "danger");
    }
  };
  const toggleAll = () =>
    setSelected(
      selected.length === players.length
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
            onChange={(event) => setQuery(event.target.value)}
            placeholder="玩家 UID 或玩家名"
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
      {loading ? (
        <div className="loading-state">正在读取玩家…</div>
      ) : players.length ? (
        <div className="table-shell">
          <table className="data-table">
            <thead>
              <tr>
                <th className="check-cell">
                  <input
                    type="checkbox"
                    checked={selected.length === players.length}
                    onChange={toggleAll}
                  />
                </th>
                <th>玩家</th>
                <th>UID</th>
                <th>等级</th>
                <th>状态</th>
                <th>最后活跃</th>
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
                  <td>
                    {player.level} / {player.gameLevel || "—"}
                  </td>
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
        </div>
      ) : (
        <EmptyState
          icon={Users}
          title="当前环境没有玩家"
          description="可由游戏客户端 API 自动写入，也可以手动添加。"
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
              <Field label="玩家 UID">
                <input
                  className="input"
                  value={editing.uid}
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

function LeaderboardsPanel({ mapId, environment, can }) {
  const manageable = can("leaderboards.manage");
  const [leaderboards, setLeaderboards] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [query, setQuery] = useState("");
  const [snapshotId, setSnapshotId] = useState("");
  const [editing, setEditing] = useState(null);
  const [loading, setLoading] = useState(true);
  const toast = useToast();

  const loadLeaderboards = useCallback(async () => {
    try {
      const rows = await api(
        withEnvironment(`/api/maps/${mapId}/leaderboards`, environment),
      );
      setLeaderboards(rows);
    } catch (error) {
      toast(error.message, "danger");
    }
  }, [mapId, environment, toast]);

  useEffect(() => {
    setSelectedId(null);
    setSnapshotId("");
    setDetail(null);
    loadLeaderboards();
  }, [loadLeaderboards]);

  useEffect(() => {
    if (!leaderboards.length) {
      setSelectedId(null);
      return;
    }
    if (!leaderboards.some((item) => item.id === selectedId))
      setSelectedId(leaderboards[0].id);
  }, [leaderboards, selectedId]);

  const loadEntries = useCallback(async () => {
    if (!selectedId) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ environment, limit: "100" });
      if (query.trim()) params.set("q", query.trim());
      if (snapshotId) params.set("snapshotId", snapshotId);
      setDetail(
        await api(
          `/api/maps/${mapId}/leaderboards/${selectedId}/entries?${params}`,
        ),
      );
    } catch (error) {
      toast(error.message, "danger");
    } finally {
      setLoading(false);
    }
  }, [mapId, environment, selectedId, snapshotId, query, toast]);

  useEffect(() => {
    const timer = setTimeout(loadEntries, 180);
    return () => clearTimeout(timer);
  }, [loadEntries]);

  const selectLeaderboard = (id) => {
    setSelectedId(id);
    setSnapshotId("");
    setDetail(null);
  };

  const save = async () => {
    try {
      const id = editing.id;
      const saved = await api(
        withEnvironment(
          `/api/maps/${mapId}/leaderboards${id ? `/${id}` : ""}`,
          environment,
        ),
        {
          method: id ? "PATCH" : "POST",
          body: {
            leaderboardKey: editing.leaderboardKey,
            name: editing.name,
            valueLabel: editing.valueLabel,
            sortDirection: editing.sortDirection,
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
    if (!current || !window.confirm(`确认发布“${current.name}”当前前 100 名？`))
      return;
    try {
      const snapshot = await api(
        withEnvironment(
          `/api/maps/${mapId}/leaderboards/${selectedId}/publish`,
          environment,
        ),
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
      !window.confirm(`确认删除排行榜“${current.name}”及全部快照？`)
    )
      return;
    try {
      await api(
        withEnvironment(
          `/api/maps/${mapId}/leaderboards/${current.id}`,
          environment,
        ),
        { method: "DELETE" },
      );
      setSelectedId(null);
      setDetail(null);
      toast("排行榜已删除");
      loadLeaderboards();
    } catch (error) {
      toast(error.message, "danger");
    }
  };

  const removeEntry = async (entry) => {
    if (!window.confirm(`确认从实时榜移除“${entry.name}”？`)) return;
    try {
      await api(
        withEnvironment(
          `/api/maps/${mapId}/leaderboards/${selectedId}/entries/${entry.id}`,
          environment,
        ),
        { method: "DELETE" },
      );
      toast("实时榜记录已移除");
      loadEntries();
      loadLeaderboards();
    } catch (error) {
      toast(error.message, "danger");
    }
  };

  const current = leaderboards.find((item) => item.id === selectedId);
  const snapshots = detail?.snapshots || [];
  const entries = detail?.entries || [];

  return (
    <>
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
                onClick={() =>
                  setEditing({
                    leaderboardKey: "",
                    name: "",
                    valueLabel: "积分",
                    sortDirection: "desc",
                    enabled: true,
                  })
                }
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
                    <Button variant="primary" icon={Save} onClick={publish}>
                      发布前 100 名
                    </Button>
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
                  <span>最近发布</span>
                  <strong>{formatDate(current.latestPublishedAt)}</strong>
                </div>
                <Badge tone={current.enabled ? "positive" : "neutral"}>
                  {current.enabled ? "接收上报" : "已停用"}
                </Badge>
              </div>

              <div className="view-switch-row">
                <div className="environment-switch compact-switch">
                  <button
                    className={!snapshotId ? "active" : ""}
                    onClick={() => setSnapshotId("")}
                  >
                    实时榜
                  </button>
                  <button
                    className={snapshotId ? "active" : ""}
                    disabled={!snapshots.length}
                    onClick={() =>
                      setSnapshotId(String(snapshots[0]?.id || ""))
                    }
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

              {loading ? (
                <div className="loading-state">正在计算排名…</div>
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
                            {snapshotId
                              ? "快照记录"
                              : formatDate(entry.updatedAt)}
                          </td>
                          {manageable && !snapshotId && (
                            <td className="align-right">
                              <button
                                className="table-action danger"
                                onClick={() => removeEntry(entry)}
                              >
                                <Trash2 size={14} />
                                移除
                              </button>
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
                  description="使用带 game.leaderboards.write 权限的 API Key 上报榜单条目。"
                />
              )}
            </>
          ) : (
            <EmptyState
              icon={Trophy}
              title="尚未配置排行榜"
              description="排行榜按地图和环境隔离，先创建榜单再接入游戏客户端。"
              action={
                manageable ? (
                  <Button
                    variant="primary"
                    icon={Plus}
                    onClick={() =>
                      setEditing({
                        leaderboardKey: "",
                        name: "",
                        valueLabel: "积分",
                        sortDirection: "desc",
                        enabled: true,
                      })
                    }
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
            <Field label="榜单 Key" hint="客户端上报时使用，建议创建后保持不变">
              <input
                className="input"
                value={editing.leaderboardKey}
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

const severityLabels = {
  low: "低",
  medium: "中",
  high: "高",
  critical: "紧急",
};
const riskStatusLabels = {
  open: "待处置",
  reviewed: "已复核",
  blocked: "已封禁",
  ignored: "已忽略",
};
const severityTone = (severity) =>
  severity === "critical" || severity === "high"
    ? "danger"
    : severity === "medium"
      ? "warning"
      : "neutral";
const riskStatusTone = (status) =>
  status === "blocked"
    ? "danger"
    : status === "reviewed"
      ? "positive"
      : status === "open"
        ? "warning"
        : "neutral";

function RiskPanel({ mapId, environment, can }) {
  const manageable = can("risk.manage");
  const [rules, setRules] = useState([]);
  const [events, setEvents] = useState([]);
  const [summary, setSummary] = useState({
    open: 0,
    critical: 0,
    blocked: 0,
    total: 0,
  });
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("open");
  const [editingRule, setEditingRule] = useState(null);
  const [resolving, setResolving] = useState(null);
  const [loading, setLoading] = useState(true);
  const toast = useToast();

  const loadRules = useCallback(async () => {
    try {
      setRules(
        await api(
          withEnvironment(`/api/maps/${mapId}/risk/rules`, environment),
        ),
      );
    } catch (error) {
      toast(error.message, "danger");
    }
  }, [mapId, environment, toast]);

  const loadEvents = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ environment, limit: "100" });
      if (query.trim()) params.set("q", query.trim());
      if (status) params.set("status", status);
      const result = await api(`/api/maps/${mapId}/risk/events?${params}`);
      setEvents(result.items);
      setSummary(result.summary);
    } catch (error) {
      toast(error.message, "danger");
    } finally {
      setLoading(false);
    }
  }, [mapId, environment, query, status, toast]);

  useEffect(() => {
    loadRules();
  }, [loadRules]);
  useEffect(() => {
    const timer = setTimeout(loadEvents, 180);
    return () => clearTimeout(timer);
  }, [loadEvents]);

  const saveRule = async () => {
    try {
      const id = editingRule.id;
      await api(
        withEnvironment(
          `/api/maps/${mapId}/risk/rules${id ? `/${id}` : ""}`,
          environment,
        ),
        {
          method: id ? "PATCH" : "POST",
          body: {
            ruleKey: editingRule.ruleKey,
            name: editingRule.name,
            severity: editingRule.severity,
            enabled: editingRule.enabled,
          },
        },
      );
      setEditingRule(null);
      toast("风控规则已保存");
      loadRules();
    } catch (error) {
      toast(error.message, "danger");
    }
  };

  const removeRule = async (rule) => {
    if (!window.confirm(`确认删除规则“${rule.name}”？历史事件会保留规则快照。`))
      return;
    try {
      await api(
        withEnvironment(
          `/api/maps/${mapId}/risk/rules/${rule.id}`,
          environment,
        ),
        { method: "DELETE" },
      );
      toast("风控规则已删除");
      loadRules();
    } catch (error) {
      toast(error.message, "danger");
    }
  };

  const startResolve = (event) =>
    setResolving({
      ...event,
      nextStatus: event.status,
      nextItemBan: event.itemBan,
      nextDataBan: event.dataBan,
      nextRankBan: event.rankBan,
      note: event.details?.resolutionNote || "",
    });

  const resolve = async () => {
    try {
      await api(
        withEnvironment(
          `/api/maps/${mapId}/risk/events/${resolving.id}`,
          environment,
        ),
        {
          method: "PATCH",
          body: {
            status: resolving.nextStatus,
            itemBan: resolving.nextItemBan,
            dataBan: resolving.nextDataBan,
            rankBan: resolving.nextRankBan,
            note: resolving.note,
          },
        },
      );
      setResolving(null);
      toast("风险事件已完成处置");
      loadEvents();
    } catch (error) {
      toast(error.message, "danger");
    }
  };

  return (
    <>
      <div className="operations-context-line risk-summary-line">
        <div>
          <span>待处置</span>
          <strong>{formatNumber(summary.open)}</strong>
        </div>
        <div>
          <span>紧急事件</span>
          <strong className="danger-text">
            {formatNumber(summary.critical)}
          </strong>
        </div>
        <div>
          <span>已封禁</span>
          <strong>{formatNumber(summary.blocked)}</strong>
        </div>
        <div>
          <span>累计事件</span>
          <strong>{formatNumber(summary.total)}</strong>
        </div>
      </div>

      <div className="module-toolbar operations-toolbar">
        <div className="section-actions filter-actions">
          <div className="search-box">
            <Search size={16} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="玩家、UID 或规则"
            />
          </div>
          <select
            className="input status-filter"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="">全部状态</option>
            {Object.entries(riskStatusLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <Button icon={RefreshCw} onClick={loadEvents} disabled={loading}>
          {loading ? "刷新中…" : "刷新事件"}
        </Button>
      </div>

      <div className="operations-workspace risk-workspace">
        <section className="operations-main risk-events-main">
          {loading ? (
            <div className="loading-state">正在读取风险事件…</div>
          ) : events.length ? (
            <div className="table-shell">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>等级</th>
                    <th>玩家</th>
                    <th>触发规则</th>
                    <th>次数</th>
                    <th>状态</th>
                    <th>发生时间</th>
                    {manageable && <th className="align-right">操作</th>}
                  </tr>
                </thead>
                <tbody>
                  {events.map((event) => (
                    <tr key={event.id}>
                      <td>
                        <Badge tone={severityTone(event.severity)}>
                          {severityLabels[event.severity]}
                        </Badge>
                      </td>
                      <td>
                        <div className="event-player">
                          <strong>{event.playerName}</strong>
                          <code>{event.uid}</code>
                        </div>
                      </td>
                      <td>
                        <strong>{event.ruleName}</strong>
                        <small className="cell-subline">{event.ruleKey}</small>
                      </td>
                      <td>{formatNumber(event.count)}</td>
                      <td>
                        <Badge tone={riskStatusTone(event.status)}>
                          {riskStatusLabels[event.status]}
                        </Badge>
                      </td>
                      <td className="muted-cell">
                        {formatDate(event.occurredAt)}
                      </td>
                      {manageable && (
                        <td className="align-right">
                          <button
                            className="table-action"
                            onClick={() => startResolve(event)}
                          >
                            <ShieldAlert size={14} />
                            处置
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              icon={ShieldAlert}
              title="当前筛选下没有风险事件"
              description="客户端按已启用规则上报后，事件会进入这里等待处置。"
            />
          )}
        </section>

        <aside className="operations-rail risk-rule-rail">
          <div className="operations-rail-head">
            <div>
              <span className="eyebrow">RISK RULES</span>
              <strong>{rules.length} 条规则</strong>
            </div>
            {manageable && (
              <button
                className="icon-button"
                aria-label="新建风控规则"
                onClick={() =>
                  setEditingRule({
                    ruleKey: "",
                    name: "",
                    severity: "medium",
                    enabled: true,
                  })
                }
              >
                <Plus size={17} />
              </button>
            )}
          </div>
          <div className="risk-rule-list">
            {rules.map((rule) => (
              <div key={rule.id}>
                <span>
                  <Badge tone={severityTone(rule.severity)}>
                    {severityLabels[rule.severity]}
                  </Badge>
                </span>
                <div>
                  <strong>{rule.name}</strong>
                  <code>{rule.ruleKey}</code>
                </div>
                <i className={rule.enabled ? "is-online" : ""} />
                {manageable && (
                  <div className="rail-row-actions">
                    <button onClick={() => setEditingRule({ ...rule })}>
                      编辑
                    </button>
                    <button className="danger" onClick={() => removeRule(rule)}>
                      删除
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
          {!rules.length && (
            <p className="rail-empty">创建规则后，客户端才可上报对应事件。</p>
          )}
        </aside>
      </div>

      <Modal
        open={Boolean(editingRule)}
        onClose={() => setEditingRule(null)}
        title={`${editingRule?.id ? "编辑" : "新建"}风控规则`}
        eyebrow="RISK RULE"
        footer={
          <>
            <Button onClick={() => setEditingRule(null)}>取消</Button>
            <Button
              variant="primary"
              onClick={saveRule}
              disabled={!editingRule?.ruleKey || !editingRule?.name}
            >
              保存
            </Button>
          </>
        }
      >
        {editingRule && (
          <>
            <Field label="规则名称">
              <input
                className="input"
                value={editingRule.name}
                onChange={(event) =>
                  setEditingRule({ ...editingRule, name: event.target.value })
                }
                placeholder="例如 异常资源增长"
              />
            </Field>
            <Field label="规则 Key" hint="需要与游戏客户端上报的 ruleKey 一致">
              <input
                className="input"
                value={editingRule.ruleKey}
                onChange={(event) =>
                  setEditingRule({
                    ...editingRule,
                    ruleKey: event.target.value,
                  })
                }
                placeholder="abnormal_resource_growth"
              />
            </Field>
            <Field label="风险等级">
              <select
                className="input"
                value={editingRule.severity}
                onChange={(event) =>
                  setEditingRule({
                    ...editingRule,
                    severity: event.target.value,
                  })
                }
              >
                {Object.entries(severityLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="接收上报">
              <Switch
                checked={editingRule.enabled}
                onChange={(value) =>
                  setEditingRule({ ...editingRule, enabled: value })
                }
                label={editingRule.enabled ? "已启用" : "已停用"}
              />
            </Field>
          </>
        )}
      </Modal>

      <Modal
        open={Boolean(resolving)}
        onClose={() => setResolving(null)}
        title={`处置风险事件 · ${resolving?.playerName || ""}`}
        eyebrow="RISK RESOLUTION"
        wide
        danger={resolving?.severity === "critical"}
        footer={
          <>
            <Button onClick={() => setResolving(null)}>取消</Button>
            <Button variant="primary" onClick={resolve}>
              保存处置结果
            </Button>
          </>
        }
      >
        {resolving && (
          <div className="resolution-layout">
            <div>
              <Field label="事件状态">
                <select
                  className="input"
                  value={resolving.nextStatus}
                  onChange={(event) =>
                    setResolving({
                      ...resolving,
                      nextStatus: event.target.value,
                    })
                  }
                >
                  {Object.entries(riskStatusLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="ban-switches">
                <Switch
                  checked={resolving.nextItemBan}
                  onChange={(value) =>
                    setResolving({ ...resolving, nextItemBan: value })
                  }
                  label="物品封禁"
                />
                <Switch
                  checked={resolving.nextDataBan}
                  onChange={(value) =>
                    setResolving({ ...resolving, nextDataBan: value })
                  }
                  label="存档封禁"
                />
                <Switch
                  checked={resolving.nextRankBan}
                  onChange={(value) =>
                    setResolving({ ...resolving, nextRankBan: value })
                  }
                  label="榜单封禁"
                />
              </div>
              <Field label="处置说明">
                <textarea
                  className="input"
                  rows="5"
                  value={resolving.note}
                  onChange={(event) =>
                    setResolving({ ...resolving, note: event.target.value })
                  }
                  placeholder="记录复核依据或处理原因"
                />
              </Field>
            </div>
            <div className="event-evidence">
              <span className="eyebrow">EVENT EVIDENCE</span>
              <strong>{resolving.ruleName}</strong>
              <small>{formatDate(resolving.occurredAt)}</small>
              <pre>{JSON.stringify(resolving.details || {}, null, 2)}</pre>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}

function GiftsPanel({ mapId, environment }) {
  const [gifts, setGifts] = useState([]),
    [players, setPlayers] = useState([]),
    [selectedPlayers, setSelectedPlayers] = useState([]),
    [selectedGifts, setSelectedGifts] = useState([]);
  const [giftOpen, setGiftOpen] = useState(false),
    [giftForm, setGiftForm] = useState({
      giftKey: "",
      name: "",
      description: "",
      defaultValue: 1,
      enabled: true,
    });
  const [lotteries, setLotteries] = useState([]),
    [lotteryOpen, setLotteryOpen] = useState(false),
    [lottery, setLottery] = useState({
      title: "",
      description: "",
      drawAt: "",
      winnerCount: 1,
    });
  const toast = useToast();
  const load = useCallback(async () => {
    try {
      const [giftRows, playerRows, lotteryRows] = await Promise.all([
        api(`/api/maps/${mapId}/gifts`),
        api(
          withEnvironment(`/api/maps/${mapId}/players?limit=100`, environment),
        ),
        api(withEnvironment(`/api/maps/${mapId}/lotteries`, environment)),
      ]);
      setGifts(giftRows);
      setPlayers(playerRows);
      setLotteries(lotteryRows);
    } catch (error) {
      toast(error.message, "danger");
    }
  }, [mapId, environment, toast]);
  useEffect(() => {
    load();
  }, [load]);
  const emptyGift = {
    giftKey: "",
    name: "",
    description: "",
    defaultValue: 1,
    enabled: true,
  };
  const saveGift = async () => {
    try {
      await api(
        `/api/maps/${mapId}/gifts${giftForm.id ? `/${giftForm.id}` : ""}`,
        { method: giftForm.id ? "PATCH" : "POST", body: giftForm },
      );
      setGiftOpen(false);
      setGiftForm(emptyGift);
      toast(giftForm.id ? "礼包已更新" : "礼包已创建");
      load();
    } catch (error) {
      toast(error.message, "danger");
    }
  };
  const removeGift = async (gift) => {
    if (!window.confirm(`确认删除礼包“${gift.name}”？`)) return;
    try {
      await api(`/api/maps/${mapId}/gifts/${gift.id}`, { method: "DELETE" });
      setSelectedGifts((current) => current.filter((id) => id !== gift.id));
      toast("礼包已删除");
      load();
    } catch (error) {
      toast(error.message, "danger");
    }
  };
  const grant = async () => {
    try {
      await api(
        withEnvironment(`/api/maps/${mapId}/gifts/grant`, environment),
        {
          method: "POST",
          body: {
            playerIds: selectedPlayers,
            grants: selectedGifts.map((giftId) => ({
              giftId,
              quantity:
                gifts.find((gift) => gift.id === giftId)?.defaultValue || 1,
              booleanValue: false,
            })),
          },
        },
      );
      setSelectedPlayers([]);
      setSelectedGifts([]);
      toast("礼包已写入游戏客户端待领取队列");
    } catch (error) {
      toast(error.message, "danger");
    }
  };
  const createLottery = async () => {
    try {
      const created = await api(
        withEnvironment(`/api/maps/${mapId}/lotteries`, environment),
        {
          method: "POST",
          body: {
            ...lottery,
            drawAt: lottery.drawAt
              ? new Date(lottery.drawAt).toISOString()
              : null,
            rewardConfig: [],
          },
        },
      );
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
    if (!window.confirm(`确认立即为“${item.title}”开奖？`)) return;
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
    if (!window.confirm(`确认取消群抽“${item.title}”？`)) return;
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
  return (
    <>
      <div className="gift-workspace">
        <section className="gift-player-pane">
          <div className="pane-head">
            <div>
              <span className="eyebrow">TARGET PLAYERS</span>
              <h3>选择玩家</h3>
            </div>
            <Badge>{selectedPlayers.length} 已选</Badge>
          </div>
          <div className="grant-list">
            {players.map((player) => (
              <label
                key={player.id}
                className={
                  selectedPlayers.includes(player.id) ? "selected" : ""
                }
              >
                <input
                  type="checkbox"
                  checked={selectedPlayers.includes(player.id)}
                  onChange={() =>
                    setSelectedPlayers((current) =>
                      current.includes(player.id)
                        ? current.filter((id) => id !== player.id)
                        : [...current, player.id],
                    )
                  }
                />
                <span>
                  <strong>{player.name}</strong>
                  <small>{player.uid}</small>
                </span>
              </label>
            ))}
          </div>
        </section>
        <section className="gift-config-pane">
          <div className="pane-head">
            <div>
              <span className="eyebrow">GIFT GRANT</span>
              <h3>发放礼包</h3>
            </div>
            <div className="section-actions">
              <Button
                icon={Plus}
                onClick={() => {
                  setGiftForm(emptyGift);
                  setGiftOpen(true);
                }}
              >
                新建礼包
              </Button>
              <Button icon={Sparkles} onClick={() => setLotteryOpen(true)}>
                创建群抽
              </Button>
            </div>
          </div>
          <div className="grant-list">
            {gifts.map((gift) => (
              <label
                key={gift.id}
                className={selectedGifts.includes(gift.id) ? "selected" : ""}
              >
                <input
                  type="checkbox"
                  checked={selectedGifts.includes(gift.id)}
                  onChange={() =>
                    setSelectedGifts((current) =>
                      current.includes(gift.id)
                        ? current.filter((id) => id !== gift.id)
                        : [...current, gift.id],
                    )
                  }
                />
                <span>
                  <strong>{gift.name}</strong>
                  <small>
                    {gift.giftKey} · {gift.description || "无说明"}
                  </small>
                </span>
                <Badge>{gift.defaultValue}</Badge>
                <button
                  type="button"
                  className="table-action"
                  onClick={(event) => {
                    event.preventDefault();
                    setGiftForm({ ...gift });
                    setGiftOpen(true);
                  }}
                >
                  <Edit3 size={13} />
                  编辑
                </button>
                <button
                  type="button"
                  className="table-action danger"
                  onClick={(event) => {
                    event.preventDefault();
                    removeGift(gift);
                  }}
                >
                  <Trash2 size={13} />
                  删除
                </button>
              </label>
            ))}
          </div>
          <div className="grant-summary">
            <div>
              <span>目标玩家</span>
              <strong>{selectedPlayers.length}</strong>
            </div>
            <div>
              <span>已选礼包</span>
              <strong>{selectedGifts.length}</strong>
            </div>
            <Button
              variant="primary"
              icon={Gift}
              disabled={!selectedPlayers.length || !selectedGifts.length}
              onClick={grant}
            >
              确认发放
            </Button>
          </div>
        </section>
      </div>
      <section className="subsection-panel">
        <div className="subsection-head">
          <div>
            <span className="eyebrow">GROUP LOTTERY</span>
            <h3>群抽活动</h3>
            <p>公开链接无需后台账号，参与者信息与开奖结果保存在当前环境。</p>
          </div>
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
                {lotteries.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <strong>{item.title}</strong>
                    </td>
                    <td>
                      <Badge
                        tone={item.status === "open" ? "positive" : "neutral"}
                      >
                        {item.status === "open"
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
                          <button
                            className="table-action danger"
                            onClick={() => cancelLottery(item)}
                          >
                            <Trash2 size={14} />
                            取消
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
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
        <Field label="礼包 Key">
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
    </>
  );
}

function ResourcePanel({ mapId, environment, resource }) {
  const isAnchor = resource === "anchors",
    label = isAnchor ? "主播" : "埋点";
  const [items, setItems] = useState([]),
    [editing, setEditing] = useState(null);
  const toast = useToast();
  const load = useCallback(async () => {
    try {
      setItems(
        await api(
          withEnvironment(`/api/maps/${mapId}/${resource}`, environment),
        ),
      );
    } catch (error) {
      toast(error.message, "danger");
    }
  }, [mapId, environment, resource, toast]);
  useEffect(() => {
    load();
  }, [load]);
  const startCreate = () =>
    setEditing(
      isAnchor
        ? { name: "", enabled: true, giftConfigText: "{}" }
        : { pointKey: "", name: "", enabled: true },
    );
  const save = async () => {
    try {
      const id = editing.id,
        path = `/api/maps/${mapId}/${resource}${id ? `/${id}` : ""}`,
        body = isAnchor
          ? {
              name: editing.name,
              enabled: editing.enabled,
              giftConfig: JSON.parse(editing.giftConfigText),
            }
          : {
              pointKey: editing.pointKey,
              name: editing.name,
              enabled: editing.enabled,
            };
      await api(withEnvironment(path, environment), {
        method: id ? "PATCH" : "POST",
        body,
      });
      setEditing(null);
      toast(`${label}已保存`);
      load();
    } catch (error) {
      toast(
        error instanceof SyntaxError
          ? "礼包配置 JSON 格式不正确"
          : error.message,
        "danger",
      );
    }
  };
  const remove = async (item) => {
    if (!window.confirm(`确认删除“${item.name}”？`)) return;
    try {
      await api(
        withEnvironment(
          `/api/maps/${mapId}/${resource}/${item.id}`,
          environment,
        ),
        { method: "DELETE" },
      );
      toast(`${label}已删除`);
      load();
    } catch (error) {
      toast(error.message, "danger");
    }
  };
  const exportRows = () => {
    const blob = new Blob([JSON.stringify(items, null, 2)], {
        type: "application/json",
      }),
      url = URL.createObjectURL(blob),
      anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `map-${mapId}-${resource}-${environment}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };
  return (
    <>
      <div className="module-toolbar">
        <span className="result-count">
          {items.length} 条{label}配置
        </span>
        <div className="section-actions">
          <Button icon={Download} onClick={exportRows}>
            导出 JSON
          </Button>
          <Button variant="primary" icon={Plus} onClick={startCreate}>
            添加{label}
          </Button>
        </div>
      </div>
      {items.length ? (
        <div className="table-shell">
          <table className="data-table">
            <thead>
              <tr>
                {!isAnchor && <th>埋点 Key</th>}
                <th>{label}名称</th>
                <th>状态</th>
                {isAnchor ? <th>礼包配置</th> : <th>触发次数</th>}
                <th>更新时间</th>
                <th className="align-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  {!isAnchor && (
                    <td>
                      <code>{item.pointKey}</code>
                    </td>
                  )}
                  <td>
                    <strong>{item.name}</strong>
                  </td>
                  <td>
                    <Badge tone={item.enabled ? "positive" : "neutral"}>
                      {item.enabled ? "启用" : "禁用"}
                    </Badge>
                  </td>
                  <td>
                    {isAnchor
                      ? `${Object.keys(item.giftConfig || {}).length} 项`
                      : formatNumber(item.triggerCount)}
                  </td>
                  <td className="muted-cell">{formatDate(item.updatedAt)}</td>
                  <td className="align-right">
                    <button
                      className="table-action"
                      onClick={() =>
                        setEditing(
                          isAnchor
                            ? {
                                ...item,
                                giftConfigText: JSON.stringify(
                                  item.giftConfig || {},
                                  null,
                                  2,
                                ),
                              }
                            : { ...item },
                        )
                      }
                    >
                      <Edit3 size={14} />
                      编辑
                    </button>
                    <button
                      className="table-action danger"
                      onClick={() => remove(item)}
                    >
                      <Trash2 size={14} />
                      删除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState
          icon={isAnchor ? RadioTower : Activity}
          title={`当前环境暂无${label}`}
          description={`点击“添加${label}”创建第一条配置。`}
        />
      )}
      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={`${editing?.id ? "编辑" : "添加"}${label}`}
        eyebrow={isAnchor ? "ANCHOR" : "TRACKING POINT"}
        footer={
          <>
            <Button onClick={() => setEditing(null)}>取消</Button>
            <Button
              variant="primary"
              onClick={save}
              disabled={!editing?.name || (!isAnchor && !editing?.pointKey)}
            >
              保存
            </Button>
          </>
        }
      >
        {editing && (
          <>
            {!isAnchor && (
              <Field label="埋点 Key">
                <input
                  className="input"
                  value={editing.pointKey}
                  onChange={(event) =>
                    setEditing({ ...editing, pointKey: event.target.value })
                  }
                />
              </Field>
            )}
            <Field label={`${label}名称`}>
              <input
                className="input"
                value={editing.name}
                onChange={(event) =>
                  setEditing({ ...editing, name: event.target.value })
                }
              />
            </Field>
            <Field label="启用状态">
              <Switch
                checked={editing.enabled}
                onChange={(value) => setEditing({ ...editing, enabled: value })}
                label={editing.enabled ? "启用" : "禁用"}
              />
            </Field>
            {isAnchor && (
              <Field label="礼包配置 JSON">
                <textarea
                  className="input"
                  rows="5"
                  value={editing.giftConfigText}
                  onChange={(event) =>
                    setEditing({
                      ...editing,
                      giftConfigText: event.target.value,
                    })
                  }
                />
              </Field>
            )}
          </>
        )}
      </Modal>
    </>
  );
}

function LogsPanel({ mapId, environment, can }) {
  const [logs, setLogs] = useState([]),
    [detail, setDetail] = useState(null);
  const toast = useToast(),
    canDelete = can("map.edit");
  const load = useCallback(async () => {
    try {
      setLogs(
        await api(
          withEnvironment(`/api/maps/${mapId}/logs?limit=100`, environment),
        ),
      );
    } catch (error) {
      toast(error.message, "danger");
    }
  }, [mapId, environment, toast]);
  useEffect(() => {
    load();
  }, [load]);
  const remove = async (id) => {
    try {
      await api(withEnvironment(`/api/maps/${mapId}/logs/${id}`, environment), {
        method: "DELETE",
      });
      toast("日志已删除");
      load();
    } catch (error) {
      toast(error.message, "danger");
    }
  };
  return (
    <>
      <div className="module-toolbar">
        <div className="api-inline">
          <span>GAME CLIENT API</span>
          <code>POST /api/fq/logs</code>
          <small>需要 game.logs.write 权限</small>
        </div>
        <Button icon={RefreshCw} onClick={load}>
          刷新
        </Button>
      </div>
      {logs.length ? (
        <div className="table-shell">
          <table className="data-table">
            <thead>
              <tr>
                <th>日志内容</th>
                <th>上传人数</th>
                <th>上传次数</th>
                <th>更新时间</th>
                <th className="align-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((item) => (
                <tr key={item.id}>
                  <td>
                    <code className="log-code">{item.context}</code>
                  </td>
                  <td>{formatNumber(item.playerCount)}</td>
                  <td>{formatNumber(item.uploadCount)}</td>
                  <td>{formatDate(item.updatedAt)}</td>
                  <td className="align-right">
                    <button
                      className="table-action"
                      onClick={() => setDetail(item)}
                    >
                      <Eye size={14} />
                      查看
                    </button>
                    {canDelete && (
                      <button
                        className="table-action danger"
                        onClick={() => remove(item.id)}
                      >
                        <Trash2 size={14} />
                        删除
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState
          icon={FileArchive}
          title="暂无运行日志"
          description="游戏客户端上报后会自动按相同内容聚合。"
        />
      )}
      <Modal
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        title="日志详情"
        eyebrow="LOG DETAIL"
        wide
      >
        <pre className="log-detail">{detail?.context}</pre>
      </Modal>
    </>
  );
}

function FilesPanel({ mapId }) {
  const [items, setItems] = useState([]),
    [folder, setFolder] = useState(""),
    [folderOpen, setFolderOpen] = useState(false),
    [folderName, setFolderName] = useState(""),
    [uploading, setUploading] = useState(false);
  const inputRef = useRef(null),
    toast = useToast();
  const load = useCallback(async () => {
    try {
      setItems(
        await api(
          `/api/maps/${mapId}/files?folder=${encodeURIComponent(folder)}`,
        ),
      );
    } catch (error) {
      toast(error.message, "danger");
    }
  }, [mapId, folder, toast]);
  useEffect(() => {
    load();
  }, [load]);
  const uploadFiles = async (files) => {
    if (!files?.length) return;
    const form = new FormData();
    [...files].forEach((file) => form.append("files", file));
    setUploading(true);
    try {
      await api(
        `/api/maps/${mapId}/files/upload?folder=${encodeURIComponent(folder)}`,
        { method: "POST", body: form },
      );
      toast("文件上传完成");
      load();
    } catch (error) {
      toast(error.message, "danger");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };
  const createFolder = async () => {
    try {
      await api(`/api/maps/${mapId}/files/folder`, {
        method: "POST",
        body: { name: folderName, parent: folder },
      });
      setFolderOpen(false);
      setFolderName("");
      toast("文件夹已创建");
      load();
    } catch (error) {
      toast(error.message, "danger");
    }
  };
  const remove = async (item) => {
    if (
      !window.confirm(
        `确认删除“${item.name}”${item.kind === "folder" ? "及其全部内容" : ""}？`,
      )
    )
      return;
    try {
      await api(`/api/maps/${mapId}/files/${item.id}`, { method: "DELETE" });
      toast("已删除");
      load();
    } catch (error) {
      toast(error.message, "danger");
    }
  };
  const openItem = (item) =>
    item.kind === "folder"
      ? setFolder(item.relativePath)
      : download(
          `/api/maps/${mapId}/files/${item.id}/download`,
          item.name,
        ).catch((error) => toast(error.message, "danger"));
  const parent = folder.includes("/")
    ? folder.slice(0, folder.lastIndexOf("/"))
    : "";
  return (
    <>
      <div
        className="file-drop-banner"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          uploadFiles(event.dataTransfer.files);
        }}
      >
        <CloudUpload size={22} />
        <div>
          <strong>拖入文件即可上传</strong>
          <small>单文件上限由服务器 UPLOAD_MAX_MB 配置，禁止可执行脚本。</small>
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          onChange={(event) => uploadFiles(event.target.files)}
        />
        <Button
          variant="primary"
          icon={Upload}
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? "正在上传…" : "上传文件"}
        </Button>
      </div>
      <div className="file-toolbar">
        <div className="folder-crumb">
          <Folder size={15} />
          <strong>根目录</strong>
          {folder && (
            <>
              <ArrowUpRight size={14} />
              <span>{folder}</span>
            </>
          )}
        </div>
        <div className="section-actions">
          <Button icon={FolderPlus} onClick={() => setFolderOpen(true)}>
            新建文件夹
          </Button>
          <Button
            icon={ArrowLeft}
            onClick={() => setFolder(parent)}
            disabled={!folder}
          >
            返回上级
          </Button>
          <Button icon={RefreshCw} onClick={load}>
            刷新列表
          </Button>
        </div>
      </div>
      {items.length ? (
        <div className="file-grid">
          {items.map((item) => {
            const Icon =
              item.kind === "folder"
                ? Folder
                : item.mimeType?.includes("image")
                  ? FileImage
                  : item.mimeType?.includes("json")
                    ? FileJson
                    : File;
            return (
              <article key={item.id} className="file-item">
                <button className="file-open" onClick={() => openItem(item)}>
                  <div className={`file-icon file-${item.kind}`}>
                    <Icon size={26} />
                  </div>
                  <div className="file-copy">
                    <strong>{item.name}</strong>
                    <span>
                      {item.kind === "folder"
                        ? "文件夹"
                        : formatBytes(item.sizeBytes)}{" "}
                      · {formatDate(item.updatedAt)}
                    </span>
                  </div>
                </button>
                <button aria-label="删除" onClick={() => remove(item)}>
                  <Trash2 size={16} />
                </button>
              </article>
            );
          })}
        </div>
      ) : (
        <EmptyState
          icon={Folder}
          title="当前目录为空"
          description="上传文件或创建文件夹后会显示在这里。"
        />
      )}
      <Modal
        open={folderOpen}
        onClose={() => setFolderOpen(false)}
        title="新建文件夹"
        eyebrow="NEW FOLDER"
        footer={
          <>
            <Button onClick={() => setFolderOpen(false)}>取消</Button>
            <Button
              variant="primary"
              onClick={createFolder}
              disabled={!folderName.trim()}
            >
              创建
            </Button>
          </>
        }
      >
        <Field label="文件夹名称" hint="名称不能包含路径分隔符">
          <input
            className="input"
            value={folderName}
            onChange={(event) => setFolderName(event.target.value)}
          />
        </Field>
      </Modal>
    </>
  );
}

const apiPermissionLabels = {
  "game.players.write": "写入玩家",
  "game.archives.read": "读取存档",
  "game.archives.write": "写入存档",
  "game.logs.write": "上报日志",
  "game.metrics.write": "上报指标",
  "game.points.write": "写入埋点",
  "game.leaderboards.write": "写入排行榜",
  "game.risk.write": "上报风险事件",
  "game.messages.read": "读取消息",
  "game.gifts.read": "领取礼包",
};

function ApiKeysPanel({ mapId, environment }) {
  const [keys, setKeys] = useState([]),
    [open, setOpen] = useState(false),
    [createdToken, setCreatedToken] = useState("");
  const [form, setForm] = useState({ name: "", environment, permissions: [] }),
    toast = useToast();
  const load = useCallback(async () => {
    try {
      setKeys(await api(`/api/maps/${mapId}/api-keys`));
    } catch (error) {
      toast(error.message, "danger");
    }
  }, [mapId, toast]);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    setForm((current) => ({ ...current, environment }));
  }, [environment]);
  const create = async () => {
    try {
      const key = await api(`/api/maps/${mapId}/api-keys`, {
        method: "POST",
        body: form,
      });
      setCreatedToken(key.token);
      setOpen(false);
      setForm({ name: "", environment, permissions: [] });
      load();
    } catch (error) {
      toast(error.message, "danger");
    }
  };
  const disable = async (key) => {
    if (!window.confirm(`确认停用 API Key“${key.name}”？`)) return;
    try {
      await api(`/api/maps/${mapId}/api-keys/${key.id}`, { method: "DELETE" });
      toast("API Key 已停用");
      load();
    } catch (error) {
      toast(error.message, "danger");
    }
  };
  return (
    <>
      <div className="module-toolbar">
        <div className="api-inline">
          <span>HEADER</span>
          <code>FQ-Map-Key: fqmap_...</code>
          <small>Token 只在创建成功时显示一次</small>
        </div>
        <Button variant="primary" icon={KeyRound} onClick={() => setOpen(true)}>
          创建 API Key
        </Button>
      </div>
      {keys.length ? (
        <div className="table-shell">
          <table className="data-table">
            <thead>
              <tr>
                <th>名称</th>
                <th>环境</th>
                <th>Token 前缀</th>
                <th>接口权限</th>
                <th>最后使用</th>
                <th>状态</th>
                <th className="align-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {keys.map((key) => (
                <tr key={key.id}>
                  <td>
                    <strong>{key.name}</strong>
                  </td>
                  <td>{environmentLabel(key.environment)}</td>
                  <td>
                    <code>{key.token_prefix}…</code>
                  </td>
                  <td>
                    {key.permissions
                      .map((permission) => apiPermissionLabels[permission])
                      .join("、")}
                  </td>
                  <td>{formatDate(key.last_used_at)}</td>
                  <td>
                    <Badge
                      tone={key.status === "active" ? "positive" : "neutral"}
                    >
                      {key.status === "active" ? "有效" : "已停用"}
                    </Badge>
                  </td>
                  <td className="align-right">
                    {key.status === "active" && (
                      <button
                        className="table-action danger"
                        onClick={() => disable(key)}
                      >
                        <Trash2 size={14} />
                        停用
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState
          icon={FileKey2}
          title="还没有游戏客户端 API Key"
          description="按最小权限原则为每个环境创建独立 Key。"
        />
      )}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="创建游戏客户端 API Key"
        eyebrow="CLIENT CREDENTIAL"
        footer={
          <>
            <Button onClick={() => setOpen(false)}>取消</Button>
            <Button
              variant="primary"
              onClick={create}
              disabled={!form.name || !form.permissions.length}
            >
              创建
            </Button>
          </>
        }
      >
        <Field label="名称">
          <input
            className="input"
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            placeholder="例如 正式服游戏服务器"
          />
        </Field>
        <Field label="环境">
          <select
            className="input"
            value={form.environment}
            onChange={(event) =>
              setForm({ ...form, environment: event.target.value })
            }
          >
            {environments.map((value) => (
              <option value={value} key={value}>
                {environmentLabel(value)}
              </option>
            ))}
          </select>
        </Field>
        <div className="permission-grid">
          {Object.entries(apiPermissionLabels).map(([value, label]) => (
            <label key={value}>
              <input
                type="checkbox"
                checked={form.permissions.includes(value)}
                onChange={() =>
                  setForm({
                    ...form,
                    permissions: form.permissions.includes(value)
                      ? form.permissions.filter((item) => item !== value)
                      : [...form.permissions, value],
                  })
                }
              />
              <span>
                <Check size={14} />
                {label}
                <code>{value}</code>
              </span>
            </label>
          ))}
        </div>
      </Modal>
      <Modal
        open={Boolean(createdToken)}
        onClose={() => setCreatedToken("")}
        title="保存 API Key"
        eyebrow="ONE-TIME SECRET"
        danger
        footer={
          <Button
            variant="primary"
            onClick={() => {
              navigator.clipboard?.writeText(createdToken);
              toast("API Key 已复制");
            }}
          >
            复制并保存
          </Button>
        }
      >
        <p className="warning-note">
          此 Token
          只显示一次。关闭后系统仅保存哈希，无法找回；遗失时请停用并重新创建。
        </p>
        <code className="secret-token">{createdToken}</code>
      </Modal>
    </>
  );
}
