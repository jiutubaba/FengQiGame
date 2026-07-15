import { useEffect, useState } from "react";
import {
  KeyRound,
  MapPinned,
  Save,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import {
  Badge,
  Button,
  Field,
  Modal,
  SectionHead,
  useToast,
} from "../components/ui";
import { formatDate } from "../utils/format";

export default function ProfilePage() {
  const { user, mapAccess, isAdmin, refresh } = useAuth();
  const [form, setForm] = useState({
    displayName: "",
    phone: "",
    description: "",
  });
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [password, setPassword] = useState({
    currentPassword: "",
    newPassword: "",
    confirmation: "",
  });
  const toast = useToast();
  useEffect(() => {
    setForm({
      displayName: user?.displayName || "",
      phone: user?.phone || "",
      description: user?.profile?.description || "",
    });
  }, [user]);
  const save = async () => {
    try {
      await api("/api/auth/profile", {
        method: "PATCH",
        body: {
          displayName: form.displayName,
          phone: form.phone || null,
          profile: { ...user.profile, description: form.description },
        },
      });
      await refresh();
      toast("账号资料已保存");
    } catch (error) {
      toast(error.message, "danger");
    }
  };
  const changePassword = async () => {
    if (password.newPassword !== password.confirmation)
      return toast("两次输入的新密码不一致", "danger");
    try {
      await api("/api/auth/password", {
        method: "POST",
        body: {
          currentPassword: password.currentPassword,
          newPassword: password.newPassword,
        },
      });
      setPasswordOpen(false);
      setPassword({ currentPassword: "", newPassword: "", confirmation: "" });
      toast("密码已更新，其它设备的会话已退出");
    } catch (error) {
      toast(error.message, "danger");
    }
  };
  return (
    <div className="page-stack page-enter">
      <SectionHead
        eyebrow="PROFILE CENTER"
        title="个人中心"
        description="维护当前账号资料和登录密码。"
      />
      <section className="profile-hero-panel">
        <div className="profile-avatar-large">
          <span>{user.displayName[0]}</span>
        </div>
        <div className="profile-identity">
          <span className="eyebrow">
            {isAdmin ? "SYSTEM ADMINISTRATOR" : "AUTHORIZED USER"}
          </span>
          <h2>{user.displayName}</h2>
          <p>账号：{user.username}</p>
          <div>
            <Badge tone={isAdmin ? "warning" : "positive"}>
              {isAdmin ? "系统管理员" : "普通用户"}
            </Badge>
            <Badge>{user.status === "active" ? "账号正常" : "账号停用"}</Badge>
          </div>
        </div>
        <div className="profile-stats">
          <div>
            <MapPinned size={17} />
            <span>
              <small>可访问地图</small>
              <strong>{isAdmin ? "全部" : `${mapAccess.length} 张`}</strong>
            </span>
          </div>
          <div>
            <ShieldCheck size={17} />
            <span>
              <small>权限模式</small>
              <strong>{isAdmin ? "全局管理" : "逐项授权"}</strong>
            </span>
          </div>
          <div>
            <UserRound size={17} />
            <span>
              <small>最近登录</small>
              <strong>{formatDate(user.lastLoginAt)}</strong>
            </span>
          </div>
        </div>
      </section>
      <section className="profile-form-panel">
        <div className="subsection-head">
          <div>
            <span className="eyebrow">ACCOUNT DETAILS</span>
            <h3>账号资料</h3>
            <p>用户名和角色由系统管理员维护。</p>
          </div>
        </div>
        <div className="form-grid">
          <Field label="用户名">
            <input className="input" value={user.username} readOnly />
          </Field>
          <Field label="角色">
            <input
              className="input"
              value={isAdmin ? "系统管理员" : "普通用户"}
              readOnly
            />
          </Field>
          <Field label="显示名称">
            <input
              className="input"
              value={form.displayName}
              onChange={(event) =>
                setForm({ ...form, displayName: event.target.value })
              }
            />
          </Field>
          <Field label="手机号">
            <input
              className="input"
              value={form.phone}
              onChange={(event) =>
                setForm({ ...form, phone: event.target.value })
              }
            />
          </Field>
          <Field label="个人说明">
            <textarea
              className="input"
              rows="4"
              value={form.description}
              onChange={(event) =>
                setForm({ ...form, description: event.target.value })
              }
            />
          </Field>
        </div>
        <div className="form-actions">
          <Button icon={KeyRound} onClick={() => setPasswordOpen(true)}>
            修改密码
          </Button>
          <Button variant="primary" icon={Save} onClick={save}>
            保存资料
          </Button>
        </div>
      </section>
      <Modal
        open={passwordOpen}
        onClose={() => setPasswordOpen(false)}
        title="修改密码"
        eyebrow="SECURITY"
        footer={
          <>
            <Button onClick={() => setPasswordOpen(false)}>取消</Button>
            <Button
              variant="primary"
              onClick={changePassword}
              disabled={
                !password.currentPassword ||
                password.newPassword.length < 6 ||
                !password.confirmation
              }
            >
              确认修改
            </Button>
          </>
        }
      >
        <Field label="当前密码">
          <input
            type="password"
            className="input"
            autoComplete="current-password"
            value={password.currentPassword}
            onChange={(event) =>
              setPassword({ ...password, currentPassword: event.target.value })
            }
          />
        </Field>
        <Field label="新密码" hint="至少 6 位">
          <input
            type="password"
            className="input"
            autoComplete="new-password"
            value={password.newPassword}
            onChange={(event) =>
              setPassword({ ...password, newPassword: event.target.value })
            }
          />
        </Field>
        <Field label="确认新密码">
          <input
            type="password"
            className="input"
            autoComplete="new-password"
            value={password.confirmation}
            onChange={(event) =>
              setPassword({ ...password, confirmation: event.target.value })
            }
          />
        </Field>
      </Modal>
    </div>
  );
}
