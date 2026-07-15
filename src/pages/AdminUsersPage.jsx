import { useCallback, useEffect, useMemo, useState } from "react";
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
  Field,
  Modal,
  SectionHead,
  useToast,
} from "../components/ui";
import { formatDate } from "../utils/format";

export default function AdminUsersPage() {
  const [users, setUsers] = useState([]),
    [search, setSearch] = useState(""),
    [loading, setLoading] = useState(true);
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
  const toast = useToast();
  const load = useCallback(async () => {
    setLoading(true);
    try {
      setUsers(
        await api(`/api/admin/users?q=${encodeURIComponent(search)}&limit=100`),
      );
    } catch (error) {
      toast(error.message, "danger");
    } finally {
      setLoading(false);
    }
  }, [search, toast]);
  useEffect(() => {
    const timer = setTimeout(load, 200);
    return () => clearTimeout(timer);
  }, [load]);
  const createUser = async () => {
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
      toast(error.message, "danger");
    }
  };
  const updateUser = async () => {
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
      toast(error.message, "danger");
    }
  };
  const resetPassword = async () => {
    try {
      await api(`/api/admin/users/${passwordUser.id}/password`, {
        method: "POST",
        body: { password: newPassword },
      });
      setPasswordUser(null);
      setNewPassword("");
      toast("密码已重置，该账号的全部会话已退出");
    } catch (error) {
      toast(error.message, "danger");
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
            onClick={() => setCreateOpen(true)}
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
      {loading ? (
        <div className="loading-state">正在读取账号…</div>
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
                      onClick={() => setEditing({ ...user })}
                    >
                      <UserCog size={14} />
                      编辑
                    </button>
                    <button
                      className="table-action"
                      onClick={() => {
                        setPasswordUser(user);
                        setNewPassword("");
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
        onClose={() => setCreateOpen(false)}
        title="创建后台账号"
        eyebrow="NEW ACCOUNT"
        footer={
          <>
            <Button onClick={() => setCreateOpen(false)}>取消</Button>
            <Button
              variant="primary"
              onClick={createUser}
              disabled={
                !createForm.username ||
                !createForm.displayName ||
                createForm.password.length < 6
              }
            >
              创建账号
            </Button>
          </>
        }
      >
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
        onClose={() => setEditing(null)}
        title={`编辑账号 · ${editing?.username || ""}`}
        eyebrow="ACCOUNT CONTROL"
        footer={
          <>
            <Button onClick={() => setEditing(null)}>取消</Button>
            <Button variant="primary" onClick={updateUser}>
              保存
            </Button>
          </>
        }
      >
        {editing && (
          <>
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
        onClose={() => setPasswordUser(null)}
        title={`重置密码 · ${passwordUser?.displayName || ""}`}
        eyebrow="SECURITY RESET"
        danger
        footer={
          <>
            <Button onClick={() => setPasswordUser(null)}>取消</Button>
            <Button
              variant="danger"
              onClick={resetPassword}
              disabled={newPassword.length < 6}
            >
              重置并退出会话
            </Button>
          </>
        }
      >
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
  const toast = useToast();
  useEffect(() => {
    if (!user) return;
    setLoading(true);
    Promise.all([
      api("/api/admin/permissions"),
      api(`/api/admin/users/${user.id}/maps`),
    ])
      .then(([permissions, mapRows]) => {
        setCatalog(permissions);
        setMaps(
          mapRows.map((map) => ({
            ...map,
            permissions: map.permissions || [],
          })),
        );
      })
      .catch((error) => toast(error.message, "danger"))
      .finally(() => setLoading(false));
  }, [user, toast]);
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
    setLoading(true);
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
      toast(error.message, "danger");
    } finally {
      setLoading(false);
    }
  };
  const assignedCount = useMemo(
    () => maps.filter((map) => map.permissions.length).length,
    [maps],
  );
  return (
    <Modal
      open={Boolean(user)}
      onClose={onClose}
      title={`功能权限 · ${user?.displayName || ""}`}
      eyebrow="MAP RBAC"
      wide
      footer={
        <>
          <span className="result-count">已授权 {assignedCount} 张地图</span>
          <Button onClick={onClose}>取消</Button>
          <Button variant="primary" onClick={save} disabled={loading}>
            保存全部权限
          </Button>
        </>
      }
    >
      {loading && !maps.length ? (
        <div className="loading-state">正在读取权限…</div>
      ) : (
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
      )}
    </Modal>
  );
}

function CheckIcon() {
  return <span className="permission-check">✓</span>;
}
