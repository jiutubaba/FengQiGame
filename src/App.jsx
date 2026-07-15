import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "./auth/AuthContext";
import AppShell from "./components/AppShell";
import AdminAuditPage from "./pages/AdminAuditPage";
import AdminSettingsPage from "./pages/AdminSettingsPage";
import AdminUsersPage from "./pages/AdminUsersPage";
import AuthPage from "./pages/AuthPage";
import LotteryPage from "./pages/LotteryPage";
import MapCenter from "./pages/MapCenter";
import MapWorkspace from "./pages/MapWorkspace";
import ProfilePage from "./pages/ProfilePage";
import PublicHome from "./pages/PublicHome";

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
        <Route path="/maps" element={<MapCenter />} />
        <Route
          path="/maps/:mapId"
          element={<Navigate to="metrics" replace />}
        />
        <Route path="/maps/:mapId/:section" element={<MapWorkspace />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route
          path="/admin/users"
          element={
            <AdminOnly>
              <AdminUsersPage />
            </AdminOnly>
          }
        />
        <Route
          path="/admin/audit"
          element={
            <AdminOnly>
              <AdminAuditPage />
            </AdminOnly>
          }
        />
        <Route
          path="/admin/settings"
          element={
            <AdminOnly>
              <AdminSettingsPage />
            </AdminOnly>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
