import { ArrowRight, Boxes, Map, ShieldCheck } from "lucide-react";
import { Link } from "react-router";

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
          <Link className="landing-login" to="/login">
            后台登录 <ArrowRight size={15} />
          </Link>
        </nav>
      </header>

      <main>
        <section className="landing-hero">
          <div className="hero-copy">
            <span className="hero-kicker">FENGQI GAME OPERATIONS</span>
            <h1>
              风起游戏
              <br />
              <em>运营工作台</em>
            </h1>
            <p>项目数据、玩家运营与配置管理，在一个工作台完成。</p>
            <div className="hero-actions">
              <Link className="hero-primary" to="/login">
                进入后台 <ArrowRight size={17} />
              </Link>
            </div>
          </div>
          <div className="hero-visual" aria-hidden="true">
            <div className="orbital-ring ring-one" />
            <div className="orbital-ring ring-two" />
            <img src="/assets/fengqi-mark.svg?v=attio" alt="" />
            <span className="visual-coordinate coordinate-one">
              FENGQI GAMES
            </span>
            <span className="visual-coordinate coordinate-two">
              PROJECT WORKSPACE
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
            <small>地图隔离与权限控制</small>
          </div>
        </section>
      </main>
      <footer className="landing-footer">
        <span className="landing-footer-records">
          <span>© 2026 风起游戏 · 湖北风起文化有限公司</span>
          <a href="https://beian.miit.gov.cn/" target="_blank" rel="noreferrer">
            鄂ICP备2024058688号-2
          </a>
        </span>
        <span>安全会话 · 权限隔离 · 操作审计</span>
      </footer>
    </div>
  );
}
