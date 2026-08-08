import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import {
  KeyRound,
  Plus,
  Search,
  ShieldCheck,
  UserCog,
  Users,
} from "lucide-react";
import { api } from "../api/client";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Field,
  FilterSummary,
  InlineAlert,
  Modal,
  SectionHead,
  useToast,
} from "../components/ui";
import { formatDate } from "../utils/format";

export default function AdminUsersPage() {
  const [viewParams, setViewParams] = useSearchParams();
  const [users, setUsers] = useState([]),
    [search, setSearch] = useState(() => viewParams.get("q") || ""),
    [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [createOpen, setCreateOpen] = useState(false),
    [editing, setEditing] = useState(null),
    [permissionUser, setPermissionUser] = useState(null),
    [passwordUser, setPasswordUser] = useState(null);
  const [createForm, setCreateForm] = useState({
      username: "",
      password: "",
      displayName: "",
      phone: "",
      role: "user",
    }),
    [newPassword, setNewPassword] = useState("");
  const [submitting, setSubmitting] = useState("");
  const [modalError, setModalError] = useState("");
  const toast = useToast();
  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      setUsers(
        await api(`/api/admin/users?q=${encodeURIComponent(search)}&limit=100`),
      );
    } catch (error) {
      setLoadError(error.message);
    } finally {
      setLoading(false);
    }
  }, [search]);
  useEffect(() => {
    const timer = setTimeout(load, 200);
    return () => clearTimeout(timer);
  }, [load]);
  useEffect(() => {
    const next = new URLSearchParams();
    if (search.trim()) next.set("q", search.trim());
    setViewParams(next, { replace: true });
  }, [search, setViewParams]);
  const createUser = async () => {
    setSubmitting("create");
    setModalError("");
    try {
      await api("/api/admin/users", {
        method: "POST",
        body: { ...createForm, phone: createForm.phone || null },
      });
      setCreateOpen(false);
      setCreateForm({
        username: "",
        password: "",
        displayName: "",
        phone: "",
        role: "user",
      });
      toast("账号已创建");
      load();
    } catch (error) {
      setModalError(error.message);
    } finally {
      setSubmitting("");
    }
  };
  const updateUser = async () => {
    setSubmitting("edit");
    setModalError("");
    try {
      await api(`/api/admin/users/${editing.id}`, {
        method: "PATCH",
        body: {
          displayName: editing.displayName,
          phone: editing.phone || null,
          role: editing.role,
          status: editing.status,
        },
      });
      setEditing(null);
      toast("账号已更新");
      load();
    } catch (error) {
      setModalError(error.message);
    } finally {
      setSubmitting("");
    }
  };
  const resetPassword = async () => {
    setSubmitting("password");
    setModalError("");
    try {
      await api(`/api/admin/users/${passwordUser.id}/password`, {
        method: "POST",
        body: { password: newPassword },
      });
      setPasswordUser(null);
      setNewPassword("");
      toast("密码已重置，该账号的全部会话已退出");
    } catch (error) {
      setModalError(error.message);
    } finally {
      setSubmitting("");
    }
  };
  return (
    <div className="page-stack page-enter">
      <SectionHead
        eyebrow="ACCESS CONTROL"
        title="账号与权限"
        description="管理员管理全局账号；普通用户按地图和功能逐项授权。"
        actions={
          <Button
            variant="primary"
            icon={Plus}
            onClick={() => {
              setModalError("");
              setCreateOpen(true);
            }}
          >
            创建账号
          </Button>
        }
      />
      <div className="module-toolbar">
        <div className="search-box">
          <Search size={16} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="用户名、姓名或手机号"
          />
        </div>
        <span className="result-count">{users.length} 个账号</span>
      </div>
      <FilterSummary
        items={search.trim() ? [`搜索：${search.trim()}`] : []}
        resultText={loading ? "正在更新…" : `当前返回 ${users.length} 个账号`}
        onClear={() => setSearch("")}
      />
      {loadError && users.length > 0 && (
        <InlineAlert
          tone="danger"
          title="账号列表刷新失败"
          description={loadError}
          action={<Button onClick={load}>重新尝试</Button>}
        />
      )}
      {loading && !users.length ? (
        <div className="loading-state">正在读取账号…</div>
      ) : loadError && !users.length ? (
        <ErrorState description={loadError} onRetry={load} />
      ) : users.length ? (
        <div className="table-shell">
          <table className="data-table">
            <thead>
              <tr>
                <th>账号</th>
                <th>角色</th>
                <th>地图数</th>
                <th>状态</th>
                <th>最近登录</th>
                <th>创建时间</th>
                <th className="align-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td>
                    <div className="player-name">
                      <span>{user.displayName[0]}</span>
                      <span>
                        <strong>{user.displayName}</strong>
                        <small>{user.username}</small>
                      </span>
                    </div>
                  </td>
                  <td>
                    <Badge tone={user.role === "admin" ? "warning" : "neutral"}>
                      {user.role === "admin" ? "管理员" : "普通用户"}
                    </Badge>
                  </td>
                  <td>{user.role === "admin" ? "全部" : user.mapCount}</td>
                  <td>
                    <Badge
                      tone={user.status === "active" ? "positive" : "neutral"}
                    >
                      {user.status === "active" ? "正常" : "已停用"}
                    </Badge>
                  </td>
                  <td>{formatDate(user.lastLoginAt)}</td>
                  <td>{formatDate(user.createdAt)}</td>
                  <td className="align-right">
                    {user.role === "user" && (
                      <button
                        className="table-action"
                        onClick={() => setPermissionUser(user)}
                      >
                        <ShieldCheck size={14} />
                        权限
                      </button>
                    )}
                    <button
                      className="table-action"
                      onClick={() => {
                        setModalError("");
                        setEditing({ ...user });
                      }}
                    >
                      <UserCog size={14} />
                      编辑
                    </button>
                    <button
                      className="table-action"
                      onClick={() => {
                        setPasswordUser(user);
                        setNewPassword("");
                        setModalError("");
                      }}
                    >
                      <KeyRound size={14} />
                      重置密码
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState icon={Users} title="没有匹配账号" />
      )}
      <Modal
        open={createOpen}
        onClose={() => {
          if (!submitting) setCreateOpen(false);
        }}
        title="创建后台账号"
        eyebrow="NEW ACCOUNT"
        footer={
          <>
            <Button
              onClick={() => setCreateOpen(false)}
              disabled={submitting === "create"}
            >
              取消
            </Button>
            <Button
              variant="primary"
              onClick={createUser}
              disabled={
                !createForm.username ||
                !createForm.displayName ||
                createForm.password.length < 6 ||
                submitting === "create"
              }
            >
              {submitting === "create" ? "正在创建…" : "创建账号"}
            </Button>
          </>
        }
      >
        {modalError && (
          <InlineAlert
            tone="danger"
            title="账号创建失败"
            description={modalError}
          />
        )}
        <div className="form-grid">
          <Field label="用户名">
            <input
              className="input"
              value={createForm.username}
              onChange={(event) =>
                setCreateForm({ ...createForm, username: event.target.value })
              }
            />
          </Field>
          <Field label="显示名称">
            <input
              className="input"
              value={createForm.displayName}
              onChange={(event) =>
                setCreateForm({
                  ...createForm,
                  displayName: event.target.value,
                })
              }
            />
          </Field>
          <Field label="初始密码" hint="至少 6 位，创建后请通知用户立即修改">
            <input
              className="input"
              type="password"
              value={createForm.password}
              onChange={(event) =>
                setCreateForm({ ...createForm, password: event.target.value })
              }
            />
          </Field>
          <Field label="手机号">
            <input
              className="input"
              value={createForm.phone}
              onChange={(event) =>
                setCreateForm({ ...createForm, phone: event.target.value })
              }
            />
          </Field>
          <Field label="角色">
            <select
              className="input"
              value={createForm.role}
              onChange={(event) =>
                setCreateForm({ ...createForm, role: event.target.value })
              }
            >
              <option value="user">普通用户</option>
              <option value="admin">系统管理员</option>
            </select>
          </Field>
        </div>
      </Modal>
      <Modal
        open={Boolean(editing)}
        onClose={() => {
          if (!submitting) setEditing(null);
        }}
        title={`编辑账号 · ${editing?.username || ""}`}
        eyebrow="ACCOUNT CONTROL"
        footer={
          <>
            <Button
              onClick={() => setEditing(null)}
              disabled={submitting === "edit"}
            >
              取消
            </Button>
            <Button
              variant="primary"
              onClick={updateUser}
              disabled={submitting === "edit" || !editing?.displayName}
            >
              {submitting === "edit" ? "正在保存…" : "保存"}
            </Button>
          </>
        }
      >
        {editing && (
          <>
            {modalError && (
              <InlineAlert
                tone="danger"
                title="账号保存失败"
                description={modalError}
              />
            )}
            <Field label="显示名称">
              <input
                className="input"
                value={editing.displayName}
                onChange={(event) =>
                  setEditing({ ...editing, displayName: event.target.value })
                }
              />
            </Field>
            <Field label="手机号">
              <input
                className="input"
                value={editing.phone || ""}
                onChange={(event) =>
                  setEditing({ ...editing, phone: event.target.value })
                }
              />
            </Field>
            <div className="form-grid">
              <Field label="角色">
                <select
                  className="input"
                  value={editing.role}
                  onChange={(event) =>
                    setEditing({ ...editing, role: event.target.value })
                  }
                >
                  <option value="user">普通用户</option>
                  <option value="admin">系统管理员</option>
                </select>
              </Field>
              <Field label="状态">
                <select
                  className="input"
                  value={editing.status}
                  onChange={(event) =>
                    setEditing({ ...editing, status: event.target.value })
                  }
                >
                  <option value="active">正常</option>
                  <option value="disabled">停用</option>
                </select>
              </Field>
            </div>
          </>
        )}
      </Modal>
      <Modal
        open={Boolean(passwordUser)}
        onClose={() => {
          if (!submitting) setPasswordUser(null);
        }}
        title={`重置密码 · ${passwordUser?.displayName || ""}`}
        eyebrow="SECURITY RESET"
        danger
        footer={
          <>
            <Button
              onClick={() => setPasswordUser(null)}
              disabled={submitting === "password"}
            >
              取消
            </Button>
            <Button
              variant="danger"
              onClick={resetPassword}
              disabled={newPassword.length < 6 || submitting === "password"}
            >
              {submitting === "password" ? "正在重置…" : "重置并退出会话"}
            </Button>
          </>
        }
      >
        {modalError && (
          <InlineAlert
            tone="danger"
            title="密码重置失败"
            description={modalError}
          />
        )}
        <p className="warning-note">
          密码重置后，该账号的全部登录会话立即失效。
        </p>
        <Field label="新密码" hint="至少 6 位">
          <input
            className="input"
            type="password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
          />
        </Field>
      </Modal>
      <PermissionModal
        user={permissionUser}
        onClose={() => setPermissionUser(null)}
        onSaved={load}
      />
    </div>
  );
}

function PermissionModal({ user, onClose, onSaved }) {
  const [catalog, setCatalog] = useState([]),
    [maps, setMaps] = useState([]),
    [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const toast = useToast();
  const loadPermissions = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError("");
    setCatalog([]);
    setMaps([]);
    try {
      const [permissions, mapRows] = await Promise.all([
        api("/api/admin/permissions"),
        api(`/api/admin/users/${user.id}/maps`),
      ]);
      setCatalog(permissions);
      setMaps(
        mapRows.map((map) => ({
          ...map,
          permissions: map.permissions || [],
        })),
      );
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }, [user]);
  useEffect(() => {
    loadPermissions();
  }, [loadPermissions]);
  const setPermission = (mapId, permission, checked) =>
    setMaps((current) =>
      current.map((map) =>
        map.id === mapId
          ? {
              ...map,
              permissions: checked
                ? [...new Set([...map.permissions, permission])]
                : map.permissions.filter((value) => value !== permission),
            }
          : map,
      ),
    );
  const save = async () => {
    setSaving(true);
    setError("");
    try {
      await Promise.all(
        maps.map((map) =>
          api(`/api/admin/users/${user.id}/maps/${map.id}`, {
            method: "PUT",
            body: { permissions: map.permissions },
          }),
        ),
      );
      toast("地图与功能权限已保存");
      onClose();
      onSaved();
    } catch (error) {
      setError(error.message);
    } finally {
      setSaving(false);
    }
  };
  const assignedCount = useMemo(
    () => maps.filter((map) => map.permissions.length).length,
    [maps],
  );
  return (
    <Modal
      open={Boolean(user)}
      onClose={() => {
        if (!saving) onClose();
      }}
      title={`功能权限 · ${user?.displayName || ""}`}
      eyebrow="MAP RBAC"
      wide
      footer={
        <>
          <span className="result-count">已授权 {assignedCount} 张地图</span>
          <Button onClick={onClose} disabled={saving}>
            取消
          </Button>
          <Button
            variant="primary"
            onClick={save}
            disabled={loading || saving || Boolean(error && !maps.length)}
          >
            {saving ? "正在保存…" : "保存全部权限"}
          </Button>
        </>
      }
    >
      {loading && !maps.length ? (
        <div className="loading-state">正在读取权限…</div>
      ) : error && !maps.length ? (
        <ErrorState
          title="权限读取失败"
          description={error}
          onRetry={loadPermissions}
        />
      ) : (
        <>
          {error && (
            <InlineAlert
              tone="danger"
              title="权限保存失败"
              description={error}
              action={<Button onClick={save}>重新保存</Button>}
            />
          )}
          <div className="permission-matrix">
            {maps.map((map) => (
              <section key={map.id}>
                <header>
                  <div>
                    <strong>{map.name}</strong>
                    <small>MAP / {map.id}</small>
                  </div>
                  <Button
                    size="sm"
                    onClick={() =>
                      setMaps((current) =>
                        current.map((item) =>
                          item.id === map.id
                            ? {
                                ...item,
                                permissions: item.permissions.length
                                  ? []
                                  : catalog.map((entry) => entry.value),
                              }
                            : item,
                        ),
                      )
                    }
                  >
                    {map.permissions.length ? "取消整张地图" : "授权整张地图"}
                  </Button>
                </header>
                <div>
                  {catalog.map((permission) => (
                    <label key={permission.value}>
                      <input
                        type="checkbox"
                        checked={map.permissions.includes(permission.value)}
                        onChange={(event) =>
                          setPermission(
                            map.id,
                            permission.value,
                            event.target.checked,
                          )
                        }
                      />
                      <span>
                        <CheckIcon />
                        {permission.label}
                        <code>{permission.value}</code>
                      </span>
                    </label>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </>
      )}
    </Modal>
  );
}

function CheckIcon() {
  return <span className="permission-check">✓</span>;
}
