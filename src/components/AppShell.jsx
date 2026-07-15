import { useCallback, useEffect, useMemo, useState } from "react";
import {
  NavLink,
  Outlet,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import {
  Activity,
  BookOpen,
  Boxes,
  ChevronDown,
  FileArchive,
  FileKey2,
  FileText,
  Gift,
  LayoutGrid,
  ListChecks,
  LogOut,
  Map,
  Menu,
  RadioTower,
  ScrollText,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  Trophy,
  UserCog,
  UserRound,
  Users,
  Wrench,
  X,
} from "lucide-react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { environmentLabel } from "../utils/format";
import { Badge } from "./ui";

const workspaceNavigation = [
  {
    id: "metrics",
    label: "地图数据",
    icon: Activity,
    permission: "metrics.view",
  },
  { id: "config", label: "地图配置", icon: Settings2, permission: "map.view" },
  { id: "players", label: "玩家管理", icon: Users, permission: "players.view" },
  {
    id: "leaderboards",
    label: "排行榜中心",
    icon: Trophy,
    permission: "leaderboards.view",
  },
  {
    id: "risk",
    label: "风控中心",
    icon: ShieldAlert,
    permission: "risk.view",
  },
  { id: "gifts", label: "礼包与群抽", icon: Gift, permission: "gifts.manage" },
  {
    id: "anchors",
    label: "主播管理",
    icon: RadioTower,
    permission: "anchors.manage",
  },
  { id: "points", label: "埋点管理", icon: Boxes, permission: "points.manage" },
  { id: "logs", label: "日志管理", icon: ScrollText, permission: "logs.view" },
  {
    id: "files",
    label: "文件管理",
    icon: FileArchive,
    permission: "files.manage",
  },
  {
    id: "api-keys",
    label: "客户端接入",
    icon: FileKey2,
    permission: "api_keys.manage",
  },
];

function SideLink({ to, icon: Icon, label, end = false, onClick }) {
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onClick}
      className={({ isActive }) => `side-link ${isActive ? "active" : ""}`}
    >
      <Icon size={17} strokeWidth={1.8} />
      <span>{label}</span>
    </NavLink>
  );
}

export default function AppShell() {
  const { mapId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { user, isAdmin, logout } = useAuth();
  const [maps, setMaps] = useState([]);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [healthy, setHealthy] = useState(null);

  const refreshMaps = useCallback(
    () =>
      api("/api/maps")
        .then(setMaps)
        .catch(() => setMaps([])),
    [],
  );
  useEffect(() => {
    refreshMaps();
  }, [refreshMaps, location.pathname]);
  useEffect(() => {
    api("/api/system/health")
      .then(() => setHealthy(true))
      .catch(() => setHealthy(false));
  }, [location.pathname]);

  const selectedMap = useMemo(
    () => maps.find((item) => item.id === Number(mapId)),
    [maps, mapId],
  );
  const permissions = selectedMap?.permissions || [];
  const visibleWorkspaceNavigation = workspaceNavigation.filter(
    (item) => isAdmin || permissions.includes(item.permission),
  );
  const inWorkspace = Boolean(mapId);
  const closeMobile = () => setMobileOpen(false);

  const signOut = async () => {
    await logout();
    navigate("/login", { replace: true });
  };

  const pageTitle =
    selectedMap?.name ||
    (location.pathname.startsWith("/admin/users")
      ? "账号与权限"
      : location.pathname.startsWith("/admin/audit")
        ? "审计日志"
        : location.pathname.startsWith("/admin/settings")
          ? "系统设置"
          : location.pathname.startsWith("/docs")
            ? "XYPlugin 文档"
            : location.pathname.startsWith("/tools")
              ? "工具版本"
              : location.pathname.startsWith("/profile")
                ? "个人中心"
                : "地图中心");

  return (
    <div className="app-frame">
      <aside className={`sidebar ${mobileOpen ? "is-open" : ""}`}>
        <div className="sidebar-brand">
          <div className="brand-mark">
            <img src="/assets/fengqi-mark.svg?v=attio" alt="风起游戏" />
          </div>
          <div>
            <strong>风起游戏</strong>
            <span>FENGQI GAMES</span>
          </div>
          <button
            type="button"
            className="mobile-close"
            onClick={closeMobile}
            aria-label="关闭导航"
          >
            <X size={18} />
          </button>
        </div>
        <nav className="sidebar-nav">
          <span className="nav-label">工作区</span>
          <SideLink
            to="/maps"
            icon={LayoutGrid}
            label="地图中心"
            end
            onClick={closeMobile}
          />
          {inWorkspace && selectedMap && (
            <>
              <div className="map-context">
                <img
                  src={selectedMap.coverPath || "/assets/fengqi-mark.svg?v=attio"}
                  alt=""
                />
                <div>
                  <strong>{selectedMap.name}</strong>
                  <span>
                    ID {selectedMap.id} ·{" "}
                    {environmentLabel(selectedMap.runtimeEnv)}
                  </span>
                </div>
              </div>
              {visibleWorkspaceNavigation.map((item) => (
                <SideLink
                  key={item.id}
                  to={`/maps/${selectedMap.id}/${item.id}`}
                  icon={item.icon}
                  label={item.label}
                  onClick={closeMobile}
                />
              ))}
            </>
          )}
          {isAdmin && (
            <>
              <span className="nav-label nav-label-spaced">系统管理</span>
              <SideLink
                to="/admin/users"
                icon={UserCog}
                label="账号与权限"
                onClick={closeMobile}
              />
              <SideLink
                to="/admin/audit"
                icon={ListChecks}
                label="审计日志"
                onClick={closeMobile}
              />
              <SideLink
                to="/admin/settings"
                icon={ShieldCheck}
                label="系统设置"
                onClick={closeMobile}
              />
            </>
          )}
          <span className="nav-label nav-label-spaced">资源</span>
          <SideLink
            to="/tools"
            icon={Wrench}
            label="工具版本"
            onClick={closeMobile}
          />
          <SideLink
            to="/docs"
            icon={BookOpen}
            label="XYPlugin 文档"
            onClick={closeMobile}
          />
          <SideLink
            to="/profile"
            icon={UserRound}
            label="个人中心"
            onClick={closeMobile}
          />
        </nav>
        <div className="sidebar-foot">
          <div className="system-health">
            <span
              className={`pulse-dot ${healthy === false ? "is-danger" : ""}`}
            />
            <div>
              <strong>
                {healthy === false
                  ? "系统连接异常"
                  : healthy
                    ? "系统运行正常"
                    : "正在检测系统"}
              </strong>
              <small>数据库与 API 健康检查</small>
            </div>
          </div>
          <span className="build-number">湖北风起文化有限公司 · 1.0.0</span>
        </div>
      </aside>

      <div className="app-main">
        <header className="topbar">
          <div className="topbar-left">
            <button
              type="button"
              className="mobile-menu"
              onClick={() => setMobileOpen(true)}
              aria-label="打开导航"
              aria-expanded={mobileOpen}
            >
              <Menu size={19} />
            </button>
            <div className="breadcrumb">
              <Map size={15} />
              <span>{pageTitle}</span>
              {selectedMap && (
                <Badge tone="positive" dot>
                  {environmentLabel(selectedMap.runtimeEnv)}
                </Badge>
              )}
            </div>
          </div>
          <div className="topbar-right">
            <a className="topbar-doc-link" href="/docs">
              <FileText size={15} />
              接口文档
            </a>
            <div className="profile-menu-wrap">
              <button
                type="button"
                className="profile-trigger"
                onClick={() => setProfileOpen((value) => !value)}
                aria-haspopup="menu"
                aria-expanded={profileOpen}
              >
                <span className="avatar">{user?.displayName?.[0] || "用"}</span>
                <span className="profile-copy">
                  <strong>{user?.displayName}</strong>
                  <small>{isAdmin ? "系统管理员" : "授权用户"}</small>
                </span>
                <ChevronDown size={14} />
              </button>
              {profileOpen && (
                <div className="profile-popover">
                  <button
                    onClick={() => {
                      navigate("/profile");
                      setProfileOpen(false);
                    }}
                  >
                    <UserRound size={16} />
                    个人中心
                  </button>
                  <button onClick={signOut}>
                    <LogOut size={16} />
                    退出登录
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>
        <main className="page-content">
          <Outlet context={{ maps, selectedMap, refreshMaps }} />
        </main>
      </div>
      {mobileOpen && (
        <button
          type="button"
          className="mobile-scrim"
          onClick={closeMobile}
          aria-label="关闭导航"
        />
      )}
    </div>
  );
}
