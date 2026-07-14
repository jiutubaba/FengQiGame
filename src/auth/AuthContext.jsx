import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { api } from "../api/client";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setSession(await api("/api/auth/me"));
    } catch (error) {
      if (error.status !== 401) throw error;
      setSession(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh().catch(() => setLoading(false));
    const clear = () => setSession(null);
    window.addEventListener("fq:unauthenticated", clear);
    return () => window.removeEventListener("fq:unauthenticated", clear);
  }, [refresh]);

  const login = useCallback(
    async (credentials) => {
      const result = await api("/api/auth/login", {
        method: "POST",
        body: credentials,
      });
      await refresh();
      return result;
    },
    [refresh],
  );

  const logout = useCallback(async () => {
    try {
      await api("/api/auth/logout", { method: "POST" });
    } finally {
      setSession(null);
    }
  }, []);

  const value = useMemo(
    () => ({
      user: session?.user || null,
      mapAccess: session?.mapAccess || [],
      loading,
      isAdmin: session?.user?.role === "admin",
      login,
      logout,
      refresh,
    }),
    [session, loading, login, logout, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth 必须在 AuthProvider 内使用");
  return context;
}
