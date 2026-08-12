import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Link,
  NavLink,
  Outlet,
  useLocation,
  useNavigate,
  useParams,
} from "react-router";
import {
  Activity,
  Boxes,
  ChevronDown,
  ChevronRight,
  FileArchive,
  FileKey2,
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
  X,
} from "lucide-react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";

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

const workspaceGroups = [
  {
    id: "insights",
    label: "数据监控",
    items: ["metrics", "leaderboards", "risk", "logs"],
  },
  {
    id: "operations",
    label: "玩家运营",
    items: ["players", "gifts", "anchors", "points"],
  },
  {
    id: "delivery",
    label: "地图管理",
    items: ["config", "files", "api-keys"],
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
  const sidebarRef = useRef(null);
  const profileMenuRef = useRef(null);
  const profileTriggerRef = useRef(null);

  const refreshMaps = useCallback(
    () =>
      api("/api/maps")
        .then(setMaps)
        .catch(() => null),
    [],
  );
  useEffect(() => {
    refreshMaps();
  }, [refreshMaps]);
  useEffect(() => {
    api("/api/system/health")
      .then(() => setHealthy(true))
      .catch(() => setHealthy(false));
  }, []);

  const selectedMap = useMemo(
    () => maps.find((item) => item.id === Number(mapId)),
    [maps, mapId],
  );
  const permissions = selectedMap?.permissions || [];
  const visibleWorkspaceNavigation = workspaceNavigation.filter(
    (item) => isAdmin || permissions.includes(item.permission),
  );
  const visibleWorkspaceGroups = workspaceGroups
    .map((group) => ({
      ...group,
      items: group.items
        .map((id) => visibleWorkspaceNavigation.find((item) => item.id === id))
        .filter(Boolean),
    }))
    .filter((group) => group.items.length);
  const inWorkspace = Boolean(mapId);
  const currentWorkspaceItem = visibleWorkspaceNavigation.find((item) =>
    location.pathname.endsWith(`/${item.id}`),
  );
  const closeMobile = () => setMobileOpen(false);

  useEffect(() => {
    setMobileOpen(false);
    setProfileOpen(false);
  }, [location.pathname]);
  useEffect(() => {
    if (!mobileOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setMobileOpen(false);
        return;
      }
      if (event.key !== "Tab" || !sidebarRef.current) return;
      const controls = [
        ...sidebarRef.current.querySelectorAll(
          "button:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])",
        ),
      ].filter((element) => element.offsetParent !== null);
      if (!controls.length) return;
      const first = controls[0];
      const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", closeOnEscape);
    window.requestAnimationFrame(() =>
      sidebarRef.current?.querySelector(".mobile-close")?.focus(),
    );
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [mobileOpen]);

  useEffect(() => {
    if (!profileOpen) return undefined;
    const closeOnOutside = (event) => {
      if (!profileMenuRef.current?.contains(event.target)) {
        setProfileOpen(false);
      }
    };
    const closeOnEscape = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setProfileOpen(false);
      profileTriggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [profileOpen]);

  const signOut = async () => {
    await logout();
    navigate("/login", { replace: true });
  };

  const navigateProfileMenu = (event) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const items = [
      ...(profileMenuRef.current?.querySelectorAll("[role='menuitem']") || []),
    ];
    if (!items.length) return;
    event.preventDefault();
    const currentIndex = items.indexOf(document.activeElement);
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? items.length - 1
          : event.key === "ArrowUp"
            ? (currentIndex - 1 + items.length) % items.length
            : (currentIndex + 1) % items.length;
    items[nextIndex].focus();
  };

  const pageTitle =
    selectedMap?.name ||
    (location.pathname.startsWith("/admin/users")
      ? "账号与权限"
      : location.pathname.startsWith("/admin/audit")
        ? "审计日志"
        : location.pathname.startsWith("/admin/settings")
          ? "系统设置"
          : location.pathname.startsWith("/profile")
            ? "个人中心"
            : "地图中心");

  useEffect(() => {
    const currentTitle = currentWorkspaceItem?.label || pageTitle;
    document.title = selectedMap
      ? `${currentTitle} · ${selectedMap.name} · 风起游戏`
      : `${currentTitle} · 风起游戏`;
  }, [currentWorkspaceItem?.label, pageTitle, selectedMap]);

  return (
    <div className="app-frame">
      <aside
        ref={sidebarRef}
        className={`sidebar ${mobileOpen ? "is-open" : ""}`}
        aria-label="主导航"
      >
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
                  src={
                    selectedMap.coverPath || "/assets/fengqi-mark.svg?v=attio"
                  }
                  alt=""
                />
                <div>
                  <strong>{selectedMap.name}</strong>
                  <span>ID {selectedMap.id}</span>
                </div>
              </div>
              {visibleWorkspaceGroups.map((group) => (
                <div className="workspace-nav-group" key={group.id}>
                  <span className="workspace-group-label">{group.label}</span>
                  {group.items.map((item) => (
                    <SideLink
                      key={item.id}
                      to={`/maps/${selectedMap.id}/${item.id}`}
                      icon={item.icon}
                      label={item.label}
                      onClick={closeMobile}
                    />
                  ))}
                </div>
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
          <span className="nav-label nav-label-spaced">账户</span>
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

      <div className="app-main" inert={mobileOpen ? true : undefined}>
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
            <nav className="breadcrumb" aria-label="当前位置">
              <Map size={15} />
              {inWorkspace && selectedMap ? (
                <>
                  <Link className="breadcrumb-home" to="/maps">
                    地图中心
                  </Link>
                  <ChevronRight className="breadcrumb-separator" size={14} />
                  <Link
                    className="breadcrumb-map"
                    to={`/maps/${selectedMap.id}`}
                  >
                    {selectedMap.name}
                  </Link>
                  {currentWorkspaceItem && (
                    <>
                      <ChevronRight
                        className="breadcrumb-separator"
                        size={14}
                      />
                      <strong aria-current="page">
                        {currentWorkspaceItem.label}
                      </strong>
                    </>
                  )}
                </>
              ) : (
                <strong aria-current="page">{pageTitle}</strong>
              )}
            </nav>
          </div>
          <div className="topbar-right">
            <div className="profile-menu-wrap" ref={profileMenuRef}>
              <button
                ref={profileTriggerRef}
                type="button"
                className="profile-trigger"
                onClick={() => setProfileOpen((value) => !value)}
                onKeyDown={(event) => {
                  if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
                  event.preventDefault();
                  setProfileOpen(true);
                  window.requestAnimationFrame(() => {
                    const items =
                      profileMenuRef.current?.querySelectorAll(
                        "[role='menuitem']",
                      );
                    items?.[
                      event.key === "ArrowUp" ? items.length - 1 : 0
                    ]?.focus();
                  });
                }}
                aria-haspopup="menu"
                aria-expanded={profileOpen}
                aria-controls="profile-menu"
              >
                <span className="avatar">{user?.displayName?.[0] || "用"}</span>
                <span className="profile-copy">
                  <strong>{user?.displayName}</strong>
                  <small>{isAdmin ? "系统管理员" : "授权用户"}</small>
                </span>
                <ChevronDown size={14} />
              </button>
              {profileOpen && (
                <div
                  className="profile-popover"
                  id="profile-menu"
                  role="menu"
                  onKeyDown={navigateProfileMenu}
                >
                  <button
                    role="menuitem"
                    onClick={() => {
                      navigate("/profile");
                      setProfileOpen(false);
                    }}
                  >
                    <UserRound size={16} />
                    个人中心
                  </button>
                  <button role="menuitem" onClick={signOut}>
                    <LogOut size={16} />
                    退出登录
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>
        {inWorkspace && selectedMap && (
          <nav className="mobile-workspace-nav" aria-label="当前地图功能">
            <span className="mobile-workspace-label">{selectedMap.name}</span>
            {visibleWorkspaceGroups.map((group) => (
              <div className="mobile-workspace-group" key={group.id}>
                <span>{group.label}</span>
                {group.items.map(({ id, label, icon: Icon }) => (
                  <NavLink
                    key={id}
                    to={`/maps/${selectedMap.id}/${id}`}
                    className={({ isActive }) => (isActive ? "active" : "")}
                  >
                    <Icon size={15} />
                    {label}
                  </NavLink>
                ))}
              </div>
            ))}
          </nav>
        )}
        <main className="page-content">
          <Outlet
            context={{ maps, selectedMap, refreshMaps, syncMaps: setMaps }}
          />
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
