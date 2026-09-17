import { useEffect, useState } from "react";
import { NavLink, useSearchParams } from "react-router";
import { ANALYTICS_FEATURES } from "../../../shared/analytics.js";
import { api } from "../../api/client";
import { Button, EmptyState, ErrorState, Field } from "../../components/ui";

const today = () =>
  new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
const rate = (n, d) => (d ? `${((n / d) * 100).toFixed(2)}%` : "—");
const seconds = (value) =>
  value == null ? "—" : `${Number(value).toFixed(1)} 秒`;

export function AnalyticsLinks({ map, mapId }) {
  return (
    <nav className="analytics-tabs" aria-label="项目数据分类">
      <NavLink to={`/maps/${mapId}/metrics`}>经营指标</NavLink>
      {ANALYTICS_FEATURES.filter(({ key }) =>
        map.analyticsFeatures.includes(key),
      ).map(({ key, name }) => (
        <NavLink key={key} to={`/maps/${mapId}/analysis-${key}`}>
          {name}
        </NavLink>
      ))}
    </nav>
  );
}

export default function AnalyticsPanel({ map, mapId, feature }) {
  const [params, setParams] = useSearchParams();
  const date = params.get("date") || today();
  const version = params.get("version") || "";
  const difficulty = params.get("difficulty") || "";
  const [form, setForm] = useState({ date, version, difficulty });
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [page, setPage] = useState(1);
  useEffect(
    () => setForm({ date, version, difficulty }),
    [date, version, difficulty],
  );
  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setError("");
    setLoading(true);
    setPage(1);
    const query = new URLSearchParams({ date });
    if (version) query.set("version", version);
    if (difficulty) query.set("difficulty", difficulty);
    api(`/api/maps/${mapId}/analytics/${feature}?${query}`, {
      signal: controller.signal,
    })
      .then(setData)
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [mapId, feature, date, version, difficulty, reload]);
  const choices = feature === "choices";
  const stages = feature === "stages";
  const rows = data?.rows || [];
  const visibleRows = rows.slice((page - 1) * 25, page * 25);
  const columns = choices
    ? [
        "选择场景",
        "选择轮次",
        "候选",
        "出现次数",
        "选择次数",
        "被选率",
        "出现人数",
        "选择人数",
      ]
    : [
        "统计对象",
        "参与人数",
        "成功人数",
        "人数成功率",
        "尝试次数",
        "成功",
        "失败",
        "明确退出",
        "未结算",
        "次数成功率",
        ...(feature === "challenges" ? ["失败率"] : []),
        ...(stages ? ["退出率"] : []),
        "成功耗时中位数",
        ...(feature === "challenges" ? ["失败剩余进度均值", "进度样本数"] : []),
      ];
  return (
    <>
      <AnalyticsLinks map={map} mapId={mapId} />
      <form
        className="analytics-filters"
        onSubmit={(e) => {
          e.preventDefault();
          const next = new URLSearchParams();
          Object.entries(form).forEach(([key, value]) => {
            if (value) next.set(key, value);
          });
          setParams(next);
          setReload((value) => value + 1);
        }}
      >
        <Field label="统计日期 · 北京时间">
          <input
            aria-label="统计日期"
            className="input"
            required
            type="date"
            value={form.date}
            onChange={(e) => setForm({ ...form, date: e.target.value })}
          />
        </Field>
        <Field label="地图版本">
          <input
            aria-label="地图版本"
            className="input"
            maxLength={64}
            placeholder="全部版本"
            value={form.version}
            onChange={(e) => setForm({ ...form, version: e.target.value })}
          />
        </Field>
        <Field label="难度">
          <input
            aria-label="难度"
            className="input"
            maxLength={64}
            placeholder="全部难度"
            value={form.difficulty}
            onChange={(e) => setForm({ ...form, difficulty: e.target.value })}
          />
        </Field>
        <Button type="submit" disabled={loading}>
          {loading ? "查询中…" : "查询"}
        </Button>
      </form>
      <p className="analytics-muted">
        {date} · {version || "全部版本"} · {difficulty || "全部难度"}。
        {choices
          ? "被选率 = 选择次数 ÷ 候选出现次数；人数按当日、场景、轮次与候选去重。"
          : "按开始日统计；人数按对象去重，次数按尝试计算。未结算包含进行中或未收到结束事件，不推断为失败。"}
      </p>
      {loading ? (
        <div className="loading-state">正在读取分析数据…</div>
      ) : error ? (
        <ErrorState
          title="分析数据读取失败"
          description={error}
          onRetry={() => setReload((value) => value + 1)}
        />
      ) : !rows.length ? (
        <EmptyState
          title="当前筛选下暂无数据"
          description="此功能已开放。请由地图端接入事件上报，或调整日期、版本与难度。"
        />
      ) : (
        <>
          <section className="analytics-chart">
            <h3>
              {choices
                ? "候选被选率"
                : stages
                  ? "阶段退出率"
                  : feature === "challenges"
                    ? "挑战失败率"
                    : "次数成功率"}{" "}
              <small className="analytics-muted">
                前 12 项 · 完整数据见下表
              </small>
            </h3>
            {rows.slice(0, 12).map((row, index) => {
              const numerator = choices
                ? row.selected
                : stages
                  ? row.exits
                  : feature === "challenges"
                    ? row.failures
                    : row.successes;
              const denominator = choices ? row.offered : row.attempts;
              const label = choices
                ? `${row.object_name} · 第 ${row.position} 次 · ${row.candidate_name}`
                : row.object_name;
              return (
                <div className="analytics-bar-row" key={index}>
                  <span title={label}>{label}</span>
                  <div className="analytics-bar-track">
                    <div
                      style={{
                        width: `${denominator ? (numerator / denominator) * 100 : 0}%`,
                      }}
                    />
                  </div>
                  <strong>{rate(numerator, denominator)}</strong>
                  <small>
                    {numerator} / {denominator}
                  </small>
                </div>
              );
            })}
          </section>
          <div className="table-shell">
            <table className="data-table">
              <thead>
                <tr>
                  {columns.map((column) => (
                    <th key={column}>{column}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row, index) => (
                  <tr key={index}>
                    <td>
                      <strong>{row.object_name}</strong>
                      <small className="analytics-key">{row.object_key}</small>
                    </td>
                    {choices ? (
                      <>
                        <td>{row.position}</td>
                        <td>
                          {row.candidate_name}
                          <small className="analytics-key">
                            {row.candidate_key}
                          </small>
                        </td>
                        <td>{row.offered}</td>
                        <td>{row.selected}</td>
                        <td>{rate(row.selected, row.offered)}</td>
                        <td>{row.offered_users}</td>
                        <td>{row.selected_users}</td>
                      </>
                    ) : (
                      <>
                        <td>{row.users}</td>
                        <td>{row.successful_users}</td>
                        <td>{rate(row.successful_users, row.users)}</td>
                        <td>{row.attempts}</td>
                        <td>{row.successes}</td>
                        <td>{row.failures}</td>
                        <td>{row.exits}</td>
                        <td>{row.unresolved}</td>
                        <td>{rate(row.successes, row.attempts)}</td>
                        {feature === "challenges" && (
                          <td>{rate(row.failures, row.attempts)}</td>
                        )}
                        {stages && <td>{rate(row.exits, row.attempts)}</td>}
                        <td>{seconds(row.median_seconds)}</td>
                        {feature === "challenges" && (
                          <>
                            <td>
                              {row.remaining_percent == null
                                ? "—"
                                : `${Number(row.remaining_percent).toFixed(2)}%`}
                            </td>
                            <td>{row.remaining_samples}</td>
                          </>
                        )}
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="analytics-pagination">
            <span>
              共 {rows.length} 项 · 第 {page} /{" "}
              {Math.max(1, Math.ceil(rows.length / 25))} 页 · 窄屏可横向滑动表格
            </span>
            <Button disabled={page <= 1} onClick={() => setPage(page - 1)}>
              上一页
            </Button>
            <Button
              disabled={page * 25 >= rows.length}
              onClick={() => setPage(page + 1)}
            >
              下一页
            </Button>
          </div>
          {!choices && (
            <p className="analytics-muted">
              成功率以全部尝试为分母，未结算会影响当日结果。耗时由地图上报；失败剩余进度仅统计有上报的失败样本。
            </p>
          )}
          {data.reasons.length > 0 && (
            <section>
              <h3>失败与退出原因</h3>
              <div className="table-shell">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>对象</th>
                      <th>结果</th>
                      <th>原因</th>
                      <th>次数</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.reasons.map((row, index) => (
                      <tr key={index}>
                        <td>
                          {rows.find(
                            (item) => item.object_key === row.object_key,
                          )?.object_name || row.object_key}
                        </td>
                        <td>{row.outcome === "failure" ? "失败" : "退出"}</td>
                        <td>{row.reason}</td>
                        <td>{row.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
      <details className="analytics-integration">
        <summary>地图接入说明</summary>
        <p>
          使用拥有“上报指标”权限的地图 API Key，调用 POST
          /api/fq/analytics/events。统计对象、版本和难度由地图定义。
        </p>
        <p>
          {choices
            ? "一次已结束的选择提交候选集合和最终选择；主动放弃时 selectedKey 传 null。position 表示第几次选择。"
            : "每次尝试先上报 start，确认成功后再上报 end。共同结算的多人挑战只报一份，开始时提交全部参与者 UID。"}
        </p>
        <p>
          网络重试保留原 eventId
          与正文。关闭功能会拒绝上报，重新开启后历史数据保留。完整字段与示例见仓库《游戏客户端接入》文档。
        </p>
      </details>
    </>
  );
}
