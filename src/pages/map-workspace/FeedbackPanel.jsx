import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Copy,
  ExternalLink,
  MessageSquareText,
  RotateCcw,
  Search,
  Star,
  Trash2,
} from "lucide-react";
import { useSearchParams } from "react-router";
import { api } from "../../api/client";
import {
  Button,
  EmptyState,
  ErrorState,
  InlineAlert,
  useConfirm,
  useToast,
} from "../../components/ui";
import { formatDate, formatNumber } from "../../utils/format";
import { FEEDBACK_DIMENSIONS } from "../../utils/projects";
import PaginationControls from "./PaginationControls";

const STARRED_OPTIONS = [
  ["all", "全部"],
  ["starred", "已关注 ★"],
  ["unstarred", "未关注 ☆"],
];
const CONTACT_OPTIONS = [
  ["all", "全部"],
  ["qq", "已填写 QQ"],
  ["wechat", "已填写微信"],
  ["both", "QQ 与微信齐全"],
];
const SCORE_OPTIONS = [
  ["all", "全部"],
  ["5", "5.0 分"],
  ["4", "4.0–4.9 分"],
  ["3", "3.0–3.9 分"],
  ["low", "3.0 分以下"],
];
const SORT_OPTIONS = [
  ["created_desc", "最新提交"],
  ["created_asc", "最早提交"],
  ["score_desc", "高分优先"],
  ["score_asc", "低分优先"],
  ["starred", "关注优先"],
];

export default function FeedbackPanel({ mapId, can }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const query = (searchParams.get("q") || "").trim();
  const starred = optionValue(
    searchParams.get("starred"),
    STARRED_OPTIONS,
    "all",
  );
  const contact = optionValue(
    searchParams.get("contact"),
    CONTACT_OPTIONS,
    "all",
  );
  const score = optionValue(searchParams.get("score"), SCORE_OPTIONS, "all");
  const sort = optionValue(
    searchParams.get("sort"),
    SORT_OPTIONS,
    "created_desc",
  );
  const [searchDraft, setSearchDraft] = useState(query);
  const [data, setData] = useState(null);
  const [selected, setSelected] = useState([]);
  const [loading, setLoading] = useState(true);
  const [mutating, setMutating] = useState("");
  const [error, setError] = useState("");
  const requestId = useRef(0);
  const confirmAction = useConfirm();
  const toast = useToast();
  const manageable = can("feedback.manage");

  const load = useCallback(async () => {
    const currentRequest = ++requestId.current;
    setLoading(true);
    setError("");
    const params = new URLSearchParams({
      page: String(page),
      limit: "20",
      starred,
      contact,
      score,
      sort,
    });
    if (query) params.set("q", query);
    try {
      const result = await api(`/api/maps/${mapId}/feedback?${params}`);
      if (currentRequest === requestId.current) setData(result);
    } catch (requestError) {
      if (currentRequest === requestId.current) setError(requestError.message);
    } finally {
      if (currentRequest === requestId.current) setLoading(false);
    }
  }, [contact, mapId, page, query, score, sort, starred]);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    setSearchDraft(query);
  }, [query]);
  useEffect(() => {
    setSelected([]);
  }, [contact, mapId, page, query, score, sort, starred]);

  const publicUrl = useMemo(
    () =>
      data?.publicPath
        ? new URL(data.publicPath, window.location.origin).toString()
        : "",
    [data?.publicPath],
  );

  const updateView = (updates) => {
    const next = new URLSearchParams(searchParams);
    Object.entries(updates).forEach(([name, value]) => {
      if (!value || value === defaultValue(name)) next.delete(name);
      else next.set(name, value);
    });
    next.delete("page");
    setSearchParams(next);
  };

  const resetFilters = () => {
    setSearchDraft("");
    setSearchParams(new URLSearchParams());
  };

  const copyPublicUrl = async () => {
    try {
      await navigator.clipboard.writeText(publicUrl);
      toast("问卷链接已复制");
    } catch {
      setError("浏览器未允许复制，请选中链接后手动复制。");
    }
  };

  const copyContact = async (type, value) => {
    try {
      await navigator.clipboard.writeText(value);
      toast(`${type} 已复制，请打开 ${type} 搜索并添加`);
    } catch {
      toast(`浏览器未允许复制，请手动复制 ${type} 号。`, "danger");
    }
  };

  const changePage = (nextPage) => {
    const next = new URLSearchParams(searchParams);
    if (nextPage > 1) next.set("page", String(nextPage));
    else next.delete("page");
    setSearchParams(next);
  };

  const applyBatch = async (action, responseIds = selected) => {
    if (!responseIds.length || mutating) return;
    if (
      action === "delete" &&
      !(await confirmAction({
        title: "永久删除反馈",
        description: `确认永久删除已选择的 ${responseIds.length} 份反馈？`,
        detail: "删除后无法恢复，综合评分与分项均值也会立即重新计算。",
        confirmLabel: "永久删除",
      }))
    )
      return;

    setMutating(action);
    try {
      await api(`/api/maps/${mapId}/feedback/responses/batch`, {
        method: "POST",
        body: { action, responseIds },
      });
      toast(
        action === "delete"
          ? `已删除 ${responseIds.length} 份反馈`
          : action === "star"
            ? `已关注 ${responseIds.length} 份反馈`
            : `已取消关注 ${responseIds.length} 份反馈`,
      );
      setSelected([]);
      if (
        action === "delete" &&
        page > 1 &&
        responseIds.length === data.responses.length
      ) {
        changePage(page - 1);
      } else {
        await load();
      }
    } catch (requestError) {
      toast(requestError.message, "danger");
    } finally {
      setMutating("");
    }
  };

  if (loading && !data)
    return <div className="loading-state">正在读取问卷反馈…</div>;
  if (!data)
    return (
      <ErrorState title="问卷反馈读取失败" description={error} onRetry={load} />
    );

  const { summary, responses, pagination } = data;
  const allSelected =
    responses.length > 0 &&
    responses.every((item) => selected.includes(item.id));
  const hasFilters =
    Boolean(query) || starred !== "all" || contact !== "all" || score !== "all";
  const viewChanged = hasFilters || sort !== "created_desc";
  const sortLabel = SORT_OPTIONS.find(([value]) => value === sort)?.[1];

  return (
    <div className="feedback-admin" aria-busy={loading || Boolean(mutating)}>
      {error && (
        <InlineAlert
          tone="danger"
          title="问卷反馈刷新失败"
          description={error}
          action={<Button onClick={load}>重新尝试</Button>}
        />
      )}

      <section className="feedback-link-bar" aria-label="玩家问卷链接">
        <div>
          <span className="feedback-link-icon" aria-hidden="true">
            <MessageSquareText size={18} />
          </span>
          <span>
            <strong>玩家问卷链接</strong>
            <small>任何获得此链接的玩家都可以提交反馈。</small>
          </span>
        </div>
        <code title={publicUrl}>{publicUrl}</code>
        <div className="feedback-link-actions">
          <Button icon={Copy} onClick={copyPublicUrl}>
            复制链接
          </Button>
          <a
            className="btn btn-primary btn-md"
            href={data.publicPath}
            target="_blank"
            rel="noreferrer"
          >
            <ExternalLink size={16} />
            打开问卷
          </a>
        </div>
      </section>

      <section className="feedback-overview">
        <div className="feedback-score-summary">
          <span className="feedback-score-label">综合评分</span>
          <div>
            <strong>
              {summary.averageScore === null
                ? "—"
                : summary.averageScore.toFixed(2)}
            </strong>
            <span>/ 5.00</span>
          </div>
          <ScoreStars value={summary.averageScore} />
          <p>共 {formatNumber(summary.responseCount)} 份反馈</p>
        </div>
        <div className="feedback-dimension-list">
          <header>
            <strong>分项评分</strong>
            <span>全部问卷平均值</span>
          </header>
          {FEEDBACK_DIMENSIONS.map(({ key, label }) => {
            const dimensionScore = summary.dimensions[key];
            return (
              <div className="feedback-dimension-row" key={key}>
                <span>{label}</span>
                <i>
                  <b style={{ width: `${(dimensionScore || 0) * 20}%` }} />
                </i>
                <strong>
                  {dimensionScore === null ? "—" : dimensionScore.toFixed(2)}
                </strong>
              </div>
            );
          })}
        </div>
      </section>

      <section className="feedback-responses">
        <header className="feedback-responses-head">
          <div>
            <h3>玩家反馈</h3>
          </div>
          <div className="feedback-responses-head-meta">
            <span>
              {hasFilters ? (
                <>
                  筛选 <strong>{formatNumber(pagination.total)}</strong> 份
                  <i aria-hidden="true">/</i> 全部{" "}
                  <strong>{formatNumber(summary.responseCount)}</strong> 份
                </>
              ) : (
                <>
                  共 <strong>{formatNumber(summary.responseCount)}</strong> 份
                </>
              )}
            </span>
            {manageable && responses.length > 0 && (
              <label className="feedback-select-all">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={() =>
                    setSelected(
                      allSelected
                        ? []
                        : responses.map((response) => response.id),
                    )
                  }
                />
                <span>全选本页</span>
              </label>
            )}
          </div>
        </header>

        <form
          className="feedback-filter-toolbar"
          onSubmit={(event) => {
            event.preventDefault();
            updateView({ q: searchDraft.trim() });
          }}
        >
          <div className="feedback-filter-search">
            <label htmlFor="feedback-search">关键词</label>
            <div className="feedback-filter-search-control">
              <Search size={15} />
              <input
                id="feedback-search"
                value={searchDraft}
                maxLength={200}
                onChange={(event) => setSearchDraft(event.target.value)}
                placeholder="搜索联系方式或建议"
              />
              <Button type="submit" size="sm">
                搜索
              </Button>
            </div>
          </div>
          <div className="feedback-filter-options">
            <FeedbackSelect
              label="关注状态"
              value={starred}
              options={STARRED_OPTIONS}
              onChange={(value) => updateView({ starred: value })}
            />
            <FeedbackSelect
              label="联系方式"
              value={contact}
              options={CONTACT_OPTIONS}
              onChange={(value) => updateView({ contact: value })}
            />
            <FeedbackSelect
              label="评分区间"
              value={score}
              options={SCORE_OPTIONS}
              onChange={(value) => updateView({ score: value })}
            />
            <FeedbackSelect
              label="排序方式"
              value={sort}
              options={SORT_OPTIONS}
              onChange={(value) => updateView({ sort: value })}
            />
            <Button
              icon={RotateCcw}
              size="sm"
              disabled={!viewChanged}
              onClick={resetFilters}
            >
              重置
            </Button>
          </div>
        </form>

        {selected.length > 0 && (
          <div className="feedback-batch-bar" role="status">
            <span>
              已选 <strong>{selected.length}</strong> 份
            </span>
            <div>
              <Button
                size="sm"
                disabled={Boolean(mutating)}
                onClick={() => applyBatch("star")}
              >
                ★ 关注
              </Button>
              <Button
                size="sm"
                disabled={Boolean(mutating)}
                onClick={() => applyBatch("unstar")}
              >
                ☆ 取消关注
              </Button>
              <Button
                variant="danger"
                size="sm"
                icon={Trash2}
                disabled={Boolean(mutating)}
                onClick={() => applyBatch("delete")}
              >
                删除
              </Button>
            </div>
          </div>
        )}

        {responses.length ? (
          <div className="feedback-response-list">
            {responses.map((response) => (
              <article
                className={`feedback-response-row ${response.isStarred ? "is-starred" : ""} ${selected.includes(response.id) ? "is-selected" : ""}`}
                key={response.id}
              >
                <header>
                  <div className="feedback-response-meta">
                    {manageable && (
                      <label className="feedback-row-check">
                        <input
                          type="checkbox"
                          checked={selected.includes(response.id)}
                          onChange={() =>
                            setSelected((current) =>
                              current.includes(response.id)
                                ? current.filter((id) => id !== response.id)
                                : [...current, response.id],
                            )
                          }
                        />
                        <span className="sr-only">
                          选择反馈 #{String(response.id).padStart(4, "0")}
                        </span>
                      </label>
                    )}
                    {manageable ? (
                      <button
                        type="button"
                        className={`feedback-star-toggle ${response.isStarred ? "active" : ""}`}
                        aria-label={
                          response.isStarred ? "取消关注" : "关注反馈"
                        }
                        aria-pressed={response.isStarred}
                        disabled={Boolean(mutating)}
                        onClick={() =>
                          applyBatch(response.isStarred ? "unstar" : "star", [
                            response.id,
                          ])
                        }
                      >
                        {response.isStarred ? "★" : "☆"}
                      </button>
                    ) : (
                      response.isStarred && (
                        <span className="feedback-star-readonly" title="已关注">
                          ★
                        </span>
                      )
                    )}
                    <span className="feedback-response-id">
                      #{String(response.id).padStart(4, "0")}
                    </span>
                    <span
                      className="feedback-response-score"
                      aria-label={`综合评分 ${response.averageScore.toFixed(2)} 分`}
                    >
                      <strong>{response.averageScore.toFixed(2)}</strong>
                    </span>
                    <time dateTime={response.createdAt}>
                      {formatDate(response.createdAt)}
                    </time>
                    <div className="feedback-response-ratings">
                      {FEEDBACK_DIMENSIONS.map(({ key, label }) => (
                        <span key={key}>
                          <em>{label}</em>
                          <b>{response.ratings[key]}</b>
                        </span>
                      ))}
                    </div>
                  </div>
                  <dl className="feedback-response-contact">
                    <ContactItem
                      label="QQ"
                      value={response.qq}
                      onCopy={copyContact}
                    />
                    <ContactItem
                      label="微信"
                      value={response.wechat}
                      onCopy={copyContact}
                    />
                  </dl>
                </header>
                <div className="feedback-response-body">
                  <div className="feedback-response-copy">
                    <FeedbackText
                      label="当前内容优化建议"
                      value={response.optimizationSuggestion}
                    />
                    <FeedbackText
                      label="后续内容期待"
                      value={response.futureContent}
                    />
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={MessageSquareText}
            title={hasFilters ? "没有匹配的反馈" : "还没有收到反馈"}
            description={
              hasFilters
                ? "调整筛选条件，或重置后查看全部玩家反馈。"
                : "复制上方链接发送给玩家，提交后评分和建议会显示在这里。"
            }
            action={
              hasFilters ? (
                <Button onClick={resetFilters}>重置筛选</Button>
              ) : null
            }
          />
        )}
        {pagination.total > pagination.limit && (
          <PaginationControls
            pagination={pagination}
            onPageChange={changePage}
            noun="份反馈"
          />
        )}
        <span className="sr-only" aria-live="polite">
          当前按{sortLabel}排序{loading ? "，正在更新" : ""}
        </span>
      </section>
    </div>
  );
}

function FeedbackSelect({ label, value, options, onChange }) {
  return (
    <label className="feedback-filter-select">
      <span>{label}</span>
      <select
        className="select-compact"
        value={value}
        aria-label={label}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map(([option, text]) => (
          <option value={option} key={option}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
}

function ContactItem({ label, value, onCopy }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        {value ? (
          <>
            <code>{value}</code>
            <button
              type="button"
              onClick={() => onCopy(label, value)}
              aria-label={`复制${label}号并去添加`}
            >
              <Copy size={12} />
              复制
            </button>
          </>
        ) : (
          <span>未填写</span>
        )}
      </dd>
    </div>
  );
}

function ScoreStars({ value }) {
  return (
    <div
      className="feedback-score-stars"
      aria-label={
        value === null ? "暂无评分" : `综合评分 ${value.toFixed(2)} 分`
      }
    >
      {[1, 2, 3, 4, 5].map((starScore) => (
        <Star
          key={starScore}
          size={18}
          className={
            value !== null && starScore <= Math.round(value) ? "active" : ""
          }
          aria-hidden="true"
        />
      ))}
    </div>
  );
}

function FeedbackText({ label, value }) {
  return (
    <div className="feedback-response-text">
      <span>{label}</span>
      <p className={value ? "" : "is-empty"}>{value || "—"}</p>
    </div>
  );
}

function optionValue(value, options, fallback) {
  return options.some(([option]) => option === value) ? value : fallback;
}

function defaultValue(name) {
  return {
    starred: "all",
    contact: "all",
    score: "all",
    sort: "created_desc",
  }[name];
}
