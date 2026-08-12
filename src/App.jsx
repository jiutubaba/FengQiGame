import { lazy, Suspense, useEffect } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router";
import { useAuth } from "./auth/AuthContext";

const AppShell = lazy(() => import("./components/AppShell"));
const AdminAuditPage = lazy(() => import("./pages/AdminAuditPage"));
const AdminSettingsPage = lazy(() => import("./pages/AdminSettingsPage"));
const AdminUsersPage = lazy(() => import("./pages/AdminUsersPage"));
const AuthPage = lazy(() => import("./pages/AuthPage"));
const LotteryPage = lazy(() => import("./pages/LotteryPage"));
const MapCenter = lazy(() => import("./pages/MapCenter"));
const MapWorkspace = lazy(() => import("./pages/MapWorkspace"));
const ProfilePage = lazy(() => import("./pages/ProfilePage"));
const PublicHome = lazy(() => import("./pages/PublicHome"));

const routeTitles = [
  [/^\/$/, "风起游戏"],
  [/^\/login$/, "后台登录 · 风起游戏"],
  [/^\/maps$/, "地图中心 · 风起游戏"],
  [/^\/maps\/\d+/, "地图工作台 · 风起游戏"],
  [/^\/profile$/, "个人中心 · 风起游戏"],
  [/^\/admin\/users$/, "账号与权限 · 风起游戏"],
  [/^\/admin\/audit$/, "审计日志 · 风起游戏"],
  [/^\/admin\/settings$/, "系统设置 · 风起游戏"],
  [/^\/lottery\//, "群抽活动 · 风起游戏"],
];

function RouteTitle() {
  const { pathname } = useLocation();
  useEffect(() => {
    document.title =
      routeTitles.find(([pattern]) => pattern.test(pathname))?.[1] ||
      "风起游戏";
  }, [pathname]);
  return null;
}

function RouteFallback() {
  return (
    <div className="boot-screen" role="status" aria-live="polite">
      <img src="/assets/fengqi-mark.svg?v=attio" alt="" />
      <span>正在打开工作区…</span>
    </div>
  );
}

function PageBoundary({ children }) {
  return (
    <Suspense fallback={<div className="loading-state">正在加载当前页面…</div>}>
      {children}
    </Suspense>
  );
}

function Protected({ children }) {
  const location = useLocation();
  const { user, loading } = useAuth();
  if (loading)
    return (
      <div className="boot-screen">
        <img src="/assets/fengqi-mark.svg?v=attio" alt="" />
        <span>正在验证安全会话…</span>
      </div>
    );
  return user ? (
    children
  ) : (
    <Navigate to="/login" replace state={{ from: location.pathname }} />
  );
}

function AdminOnly({ children }) {
  const { isAdmin } = useAuth();
  return isAdmin ? children : <Navigate to="/maps" replace />;
}

export default function App() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <RouteTitle />
      <Routes>
        <Route path="/" element={<PublicHome />} />
        <Route path="/login" element={<AuthPage />} />
        <Route path="/lottery/:token" element={<LotteryPage />} />
        <Route
          element={
            <Protected>
              <AppShell />
            </Protected>
          }
        >
          <Route
            path="/maps"
            element={
              <PageBoundary>
                <MapCenter />
              </PageBoundary>
            }
          />
          <Route
            path="/maps/:mapId"
            element={<Navigate to="metrics" replace />}
          />
          <Route
            path="/maps/:mapId/:section"
            element={
              <PageBoundary>
                <MapWorkspace />
              </PageBoundary>
            }
          />
          <Route
            path="/profile"
            element={
              <PageBoundary>
                <ProfilePage />
              </PageBoundary>
            }
          />
          <Route
            path="/admin/users"
            element={
              <AdminOnly>
                <PageBoundary>
                  <AdminUsersPage />
                </PageBoundary>
              </AdminOnly>
            }
          />
          <Route
            path="/admin/audit"
            element={
              <AdminOnly>
                <PageBoundary>
                  <AdminAuditPage />
                </PageBoundary>
              </AdminOnly>
            }
          />
          <Route
            path="/admin/settings"
            element={
              <AdminOnly>
                <PageBoundary>
                  <AdminSettingsPage />
                </PageBoundary>
              </AdminOnly>
            }
          />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
