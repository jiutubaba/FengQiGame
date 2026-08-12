import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { useNavigate, useOutletContext, useParams } from "react-router";
import { ShieldAlert } from "lucide-react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import {
  Button,
  EmptyState,
  ErrorState,
  InlineAlert,
  SectionHead,
} from "../components/ui";

const MetricsPanel = lazy(() => import("./map-workspace/MetricsPanel"));
const ConfigPanel = lazy(() => import("./map-workspace/ConfigPanel"));
const PlayersPanel = lazy(() => import("./map-workspace/PlayersPanel"));
const LeaderboardsPanel = lazy(
  () => import("./map-workspace/LeaderboardsPanel"),
);
const RiskPanel = lazy(() => import("./map-workspace/RiskPanel"));
const GiftsPanel = lazy(() => import("./map-workspace/GiftsPanel"));
const ResourcePanel = lazy(() =>
  import("./map-workspace/ResourcePanels").then((module) => ({
    default: module.ResourcePanel,
  })),
);
const LogsPanel = lazy(() =>
  import("./map-workspace/ResourcePanels").then((module) => ({
    default: module.LogsPanel,
  })),
);
const FilesPanel = lazy(() =>
  import("./map-workspace/ResourcePanels").then((module) => ({
    default: module.FilesPanel,
  })),
);
const ApiKeysPanel = lazy(() =>
  import("./map-workspace/ResourcePanels").then((module) => ({
    default: module.ApiKeysPanel,
  })),
);

const sectionTitles = {
  metrics: ["地图数据", "查看游戏客户端上报的真实指标。", "metrics.view"],
  config: ["地图配置", "维护地图基础信息与共享配置。", "map.view"],
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
    "维护礼包、批量设置玩家资格并创建公开群抽活动。",
    "gifts.manage",
  ],
  anchors: ["主播管理", "维护地图的主播名单和专属礼包配置。", "anchors.manage"],
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
    "创建按地图和接口权限隔离的游戏 API Key。",
    "api_keys.manage",
  ],
};

export default function MapWorkspace() {
  const { mapId, section } = useParams();
  const navigate = useNavigate();
  const { selectedMap, refreshMaps } = useOutletContext();
  const { isAdmin } = useAuth();
  const [map, setMap] = useState(selectedMap || null);
  const [loadError, setLoadError] = useState("");

  const loadMap = useCallback(async () => {
    setLoadError("");
    try {
      setMap(await api(`/api/maps/${mapId}`));
    } catch (error) {
      setLoadError(error.message);
    }
  }, [mapId]);
  useEffect(() => {
    loadMap();
  }, [loadMap]);

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
  if (!map && loadError)
    return <ErrorState description={loadError} onRetry={loadMap} />;
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
      </div>
      {loadError && (
        <InlineAlert
          tone="danger"
          title="地图信息刷新失败"
          description={loadError}
          action={<Button onClick={loadMap}>重新尝试</Button>}
        />
      )}
      <Suspense
        fallback={<div className="loading-state">正在加载功能模块…</div>}
      >
        {panels[section]}
      </Suspense>
    </div>
  );
}
