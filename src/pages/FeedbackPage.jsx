import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  MessageSquareText,
  ShieldCheck,
  Star,
} from "lucide-react";
import { Link, useParams } from "react-router";
import { api } from "../api/client";
import { FEEDBACK_DIMENSIONS, projectPlatform } from "../utils/projects";

const EMPTY_RATINGS = Object.freeze(
  Object.fromEntries(FEEDBACK_DIMENSIONS.map(({ key }) => [key, 0])),
);

export default function FeedbackPage() {
  const { token } = useParams();
  const [project, setProject] = useState(null);
  const [ratings, setRatings] = useState({ ...EMPTY_RATINGS });
  const [form, setForm] = useState({
    qq: "",
    wechat: "",
    optimizationSuggestion: "",
    futureContent: "",
  });
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setProject(await api(`/api/public/feedback/${token}`));
    } catch (requestError) {
      setProject(null);
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const completedRatings = useMemo(
    () => FEEDBACK_DIMENSIONS.filter(({ key }) => ratings[key] > 0).length,
    [ratings],
  );
  const contactReady = Boolean(form.qq.trim() || form.wechat.trim());
  const ready = completedRatings === FEEDBACK_DIMENSIONS.length && contactReady;
  const platform = projectPlatform(project?.platform);

  const submit = async (event) => {
    event.preventDefault();
    if (!ready) {
      setError("请完成五项评分，并至少填写 QQ 或微信中的一项。");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const result = await api(`/api/public/feedback/${token}`, {
        method: "POST",
        body: { ratings, ...form },
      });
      setSubmitted(result);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="feedback-page feedback-loading" role="status">
        <MessageSquareText size={28} />
        <span>正在打开反馈问卷…</span>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="feedback-page feedback-unavailable">
        <div>
          <MessageSquareText size={34} />
          <span className="feedback-kicker">FENGQI FEEDBACK</span>
          <h1>问卷暂时无法打开</h1>
          <p>{error || "链接不存在或已停止访问。"}</p>
          <Link to="/">返回风起游戏</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="feedback-page">
      <main className="feedback-shell">
        <aside className="feedback-intro">
          <Link className="feedback-brand" to="/">
            <img src="/assets/fengqi-mark.svg?v=attio" alt="" />
            <span>
              <strong>风起游戏</strong>
              <small>FENGQI GAMES</small>
            </span>
          </Link>
          <div className="feedback-intro-copy">
            <span className="feedback-kicker">{platform?.label}</span>
            <p className="feedback-index">PLAYER / FEEDBACK</p>
            <h1>{project.projectName}</h1>
            <p>
              每一项真实体验，都会成为下一次更新的依据。完成评分后留下可联系的方式，我们会认真阅读。
            </p>
          </div>
          <div
            className="feedback-progress"
            aria-label={`已完成 ${completedRatings} 项评分`}
          >
            <span>
              评分进度
              <b>
                {completedRatings} / {FEEDBACK_DIMENSIONS.length}
              </b>
            </span>
            <i>
              <b style={{ width: `${completedRatings * 20}%` }} />
            </i>
          </div>
          <footer>
            <ShieldCheck size={16} />
            联系方式仅用于产品反馈回访
          </footer>
        </aside>

        <section className="feedback-form-surface">
          {submitted ? (
            <div className="feedback-success" role="status">
              <CheckCircle2 size={48} />
              <span className="feedback-kicker">FEEDBACK RECEIVED</span>
              <h2>感谢你的认真反馈</h2>
              <p>
                本次综合评分为{" "}
                <strong>{submitted.averageScore.toFixed(2)}</strong> /
                5.00，内容已经提交给项目团队。
              </p>
              <Link to="/">
                返回风起游戏
                <ArrowRight size={16} />
              </Link>
            </div>
          ) : (
            <form className="feedback-form" onSubmit={submit}>
              <header>
                <span className="feedback-kicker">01 · EXPERIENCE</span>
                <h2>请为本次体验评分</h2>
                <p>一星表示非常不满意，五星表示非常满意。</p>
              </header>

              <div className="feedback-rating-list">
                {FEEDBACK_DIMENSIONS.map((dimension, index) => (
                  <StarRating
                    key={dimension.key}
                    index={index + 1}
                    name={dimension.key}
                    label={dimension.label}
                    value={ratings[dimension.key]}
                    onChange={(score) =>
                      setRatings((current) => ({
                        ...current,
                        [dimension.key]: score,
                      }))
                    }
                  />
                ))}
              </div>

              <section className="feedback-form-section">
                <header>
                  <span className="feedback-kicker">02 · CONTACT</span>
                  <h2>留下联系方式</h2>
                  <p>QQ、微信任选一项，也可以同时填写。</p>
                </header>
                <div className="feedback-contact-grid">
                  <label>
                    <span>联系 QQ</span>
                    <input
                      value={form.qq}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          qq: event.target.value,
                        }))
                      }
                      maxLength="64"
                      autoComplete="off"
                      placeholder="请输入 QQ"
                    />
                  </label>
                  <label>
                    <span>联系微信</span>
                    <input
                      value={form.wechat}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          wechat: event.target.value,
                        }))
                      }
                      maxLength="128"
                      autoComplete="off"
                      placeholder="请输入微信号"
                    />
                  </label>
                </div>
              </section>

              <section className="feedback-form-section">
                <header>
                  <span className="feedback-kicker">03 · DETAILS</span>
                  <h2>补充反馈</h2>
                  <p>以下两项均为选填。</p>
                </header>
                <div className="feedback-details-grid">
                  <FeedbackTextarea
                    label="对当前内容是否有优化建议"
                    placeholder="哪些体验可以更顺畅、更有趣？"
                    value={form.optimizationSuggestion}
                    onChange={(value) =>
                      setForm((current) => ({
                        ...current,
                        optimizationSuggestion: value,
                      }))
                    }
                  />
                  <FeedbackTextarea
                    label="希望我们后续开发哪些内容"
                    placeholder="写下你最期待的新玩法或内容方向"
                    value={form.futureContent}
                    onChange={(value) =>
                      setForm((current) => ({
                        ...current,
                        futureContent: value,
                      }))
                    }
                  />
                </div>
              </section>

              {error && (
                <p className="feedback-form-error" role="alert">
                  {error}
                </p>
              )}
              <button
                className="feedback-submit"
                type="submit"
                disabled={!ready || submitting}
              >
                <span>{submitting ? "正在提交反馈…" : "提交反馈问卷"}</span>
                <ArrowRight size={18} />
              </button>
            </form>
          )}
        </section>
      </main>
    </div>
  );
}

function StarRating({ index, name, label, value, onChange }) {
  const [hovered, setHovered] = useState(0);
  const highlighted = hovered || value;
  return (
    <fieldset className="feedback-rating-row">
      <legend className="sr-only">{label}</legend>
      <div className="feedback-rating-label" aria-hidden="true">
        <small>{String(index).padStart(2, "0")}</small>
        <span>{label}</span>
      </div>
      <div
        className="feedback-stars"
        onMouseLeave={() => setHovered(0)}
        aria-label={`${label}评分`}
      >
        {[1, 2, 3, 4, 5].map((score) => (
          <label
            className={score <= highlighted ? "active" : ""}
            key={score}
            onMouseEnter={() => setHovered(score)}
            title={`${score} 星`}
          >
            <input
              type="radio"
              name={`rating-${name}`}
              value={score}
              checked={value === score}
              onChange={() => onChange(score)}
              required
              aria-label={`${label} ${score} 星`}
            />
            <Star size={28} strokeWidth={1.6} />
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function FeedbackTextarea({ label, placeholder, value, onChange }) {
  return (
    <label className="feedback-textarea">
      <span>{label}</span>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows="4"
        maxLength="2000"
        placeholder={placeholder}
      />
      <small>{value.length} / 2000</small>
    </label>
  );
}
