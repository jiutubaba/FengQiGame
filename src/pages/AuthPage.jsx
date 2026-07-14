import { useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Eye,
  EyeOff,
  LockKeyhole,
  UserRound,
} from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { Button, Field, useToast } from "../components/ui";

export default function AuthPage() {
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [remember, setRemember] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();

  useEffect(() => {
    if (user) navigate("/maps", { replace: true });
  }, [user, navigate]);

  const submit = async (event) => {
    event.preventDefault();
    setLoading(true);
    try {
      await login({ username, password, remember });
      toast("登录成功");
      navigate(location.state?.from || "/maps", { replace: true });
    } catch (error) {
      toast(error.message, "danger");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-art">
        <div className="auth-grid" />
        <Link className="auth-back" to="/">
          <ArrowLeft size={16} />
          返回首页
        </Link>
        <div className="auth-art-copy">
          <span className="hero-kicker">SECURE · AUDITABLE · ISOLATED</span>
          <h1>
            地图数据，
            <br />
            始终保持清晰。
          </h1>
          <p>
            正式服、测试大厅和测试服独立运行。账号操作、权限变更与危险操作均写入审计日志。
          </p>
        </div>
        <div className="auth-system-state">
          <span className="pulse-dot" />
          <div>
            <strong>安全会话登录</strong>
            <small>HTTPONLY COOKIE · RBAC</small>
          </div>
        </div>
      </div>
      <div className="auth-panel">
        <form className="auth-form" onSubmit={submit}>
          <div className="auth-brand">
            <span className="brand-mark">
              <img src="/assets/fengqi-mark.svg" alt="风起游戏" />
            </span>
            <div>
              <strong>风起游戏</strong>
              <small>FENGQI GAME OPERATIONS</small>
            </div>
          </div>
          <div className="auth-heading">
            <span>WELCOME BACK</span>
            <h2>后台登录</h2>
            <p>管理员拥有全局权限；普通用户只会看到被授权的地图与功能。</p>
          </div>
          <Field label="用户名">
            <div className="input-with-icon">
              <UserRound size={16} />
              <input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="username"
                placeholder="请输入用户名"
                required
              />
            </div>
          </Field>
          <Field label="密码">
            <div className="input-with-icon">
              <LockKeyhole size={16} />
              <input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                type={visible ? "text" : "password"}
                autoComplete="current-password"
                placeholder="请输入密码"
                required
              />
              <button
                type="button"
                onClick={() => setVisible((value) => !value)}
              >
                {visible ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </Field>
          <label className="remember-check">
            <button
              type="button"
              className={remember ? "checked" : ""}
              onClick={() => setRemember((value) => !value)}
            >
              {remember && <Check size={13} />}
            </button>
            在此设备保持登录
          </label>
          <Button
            type="submit"
            variant="primary"
            size="lg"
            className="auth-submit"
            disabled={loading}
          >
            {loading ? "正在验证…" : "进入后台"}{" "}
            {!loading && <ArrowRight size={16} />}
          </Button>
          <p className="auth-notice">
            湖北风起文化有限公司运营 · 账号由系统管理员创建
          </p>
        </form>
      </div>
    </div>
  );
}
