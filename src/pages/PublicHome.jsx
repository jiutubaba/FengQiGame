import {
  ArrowRight,
  BookOpen,
  Boxes,
  Download,
  Map,
  ShieldCheck,
} from "lucide-react";
import { Link } from "react-router-dom";

export default function PublicHome() {
  return (
    <div className="landing-page">
      <header className="landing-header">
        <Link className="landing-brand" to="/">
          <span className="brand-mark">
            <img src="/assets/fengqi-mark.svg?v=attio" alt="风起游戏" />
          </span>
          <span>
            <strong>风起游戏</strong>
            <small>FENGQI GAME OPERATIONS</small>
          </span>
        </Link>
        <nav>
          <Link to="/login">工具版本</Link>
          <Link to="/login">接口文档</Link>
          <Link className="landing-login" to="/login">
            后台登录 <ArrowRight size={15} />
          </Link>
        </nav>
      </header>

      <main>
        <section className="landing-hero">
          <div className="hero-noise" />
          <div className="hero-copy">
            <span className="hero-kicker">FENGQI GAME OPERATIONS · 2026</span>
            <h1>
              每一张地图，
              <br />
              <em>都在掌控之中。</em>
            </h1>
            <p>
              统一管理地图存档、玩家、礼包、主播与运行数据。登录后从地图维度进入完整业务工作台。
            </p>
            <div className="hero-actions">
              <Link className="hero-primary" to="/login">
                进入后台 <ArrowRight size={17} />
              </Link>
              <Link className="hero-secondary" to="/login">
                <BookOpen size={16} />
                登录查看文档
              </Link>
            </div>
          </div>
          <div className="hero-visual" aria-hidden="true">
            <div className="orbital-ring ring-one" />
            <div className="orbital-ring ring-two" />
            <img src="/assets/fengqi-mark.svg?v=attio" alt="" />
            <span className="visual-coordinate coordinate-one">MAP / 018</span>
            <span className="visual-coordinate coordinate-two">
              ONLINE · 00
            </span>
          </div>
        </section>

        <section className="workflow-strip">
          <div>
            <span>01</span>
            <Map size={19} />
            <strong>选择地图</strong>
            <small>地图中心统一入口</small>
          </div>
          <div>
            <span>02</span>
            <Boxes size={19} />
            <strong>进入板块</strong>
            <small>按功能权限开放</small>
          </div>
          <div>
            <span>03</span>
            <ShieldCheck size={19} />
            <strong>处理业务</strong>
            <small>环境隔离与权限控制</small>
          </div>
        </section>

        <section className="landing-tools">
          <div className="landing-section-title">
            <span>TOOL NAVIGATION</span>
            <h2>工具导航</h2>
            <p>编辑、预览、调试，一处获取当前版本。</p>
          </div>
          <div className="tool-release-list">
            <Link to="/login" className="tool-release-row">
              <div className="tool-index">01</div>
              <div className="tool-name">
                <strong>XYWE 编辑器</strong>
                <span>历史版本与更新说明</span>
              </div>
              <div className="tool-version">授权资源</div>
              <div className="tool-date">登录查看</div>
              <Download size={17} />
            </Link>
            <Link to="/login" className="tool-release-row">
              <div className="tool-index">02</div>
              <div className="tool-name">
                <strong>模型预览工具</strong>
                <span>模型复制与地图预览</span>
              </div>
              <div className="tool-version">授权资源</div>
              <div className="tool-date">登录查看</div>
              <Download size={17} />
            </Link>
          </div>
        </section>
      </main>
      <footer className="landing-footer">
        <span>© 2026 风起游戏 · 湖北风起文化有限公司</span>
        <span>安全会话 · 权限隔离 · 操作审计</span>
      </footer>
    </div>
  );
}
