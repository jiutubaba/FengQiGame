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

function DifficultyChart({ rows, percentages }) {
  const series = percentages
    ? ["人数通关率", "次数通关率"]
    : ["选择人数", "通关人数"];
  const maxCount = Math.max(...rows.map((row) => row.selected_users));
  const ceiling = percentages ? 100 : Math.max(5, Math.ceil(maxCount / 5) * 5);
  const width = Math.max(480, rows.length * 50 + 64);
  const plotHeight = 220;
  const groupWidth = (width - 64) / rows.length;
  const colors = percentages ? ["#4487eb", "#63a78e"] : ["#a8afb8", "#4487eb"];
  return (
    <section className="analytics-chart difficulty-chart">
      <h3>{percentages ? "各难度通关率" : "选择人数与通关人数"}</h3>
      <div
        className="difficulty-chart-scroll"
        tabIndex={0}
        role="region"
        aria-label={`${percentages ? "通关率" : "人数"}图表，可横向滚动，精确数值见下方表格`}
      >
        <svg
          style={{ minWidth: rows.length > 12 ? width : 360 }}
          viewBox={`0 0 ${width} 285`}
          role="img"
          aria-label={series.join("与")}
        >
          {Array.from({ length: 6 }, (_, index) => {
            const value = (ceiling * (5 - index)) / 5;
            const y = 18 + (plotHeight * index) / 5;
            return (
              <g key={index}>
                <line
                  x1={52}
                  y1={y}
                  x2={width - 12}
                  y2={y}
                  stroke="var(--line-soft)"
                />
                <text x={44} y={y + 4} textAnchor="end">
                  {value.toLocaleString("zh-CN")}
                  {percentages ? "%" : ""}
                </text>
              </g>
            );
          })}
          {rows.map((row, index) => {
            const values = percentages
              ? [
                  (100 * row.cleared_users) / row.selected_users,
                  (100 * row.cleared_count) / row.selected_count,
                ]
              : [row.selected_users, row.cleared_users];
            const center = 52 + groupWidth * (index + 0.5);
            return (
              <g key={row.difficulty}>
                {values.map((value, position) => {
                  const height = (value / ceiling) * plotHeight;
                  return (
                    <rect
                      key={position}
                      x={center - 23 + position * 24}
                      y={18 + plotHeight - height}
                      width={21}
                      height={height}
                      rx={3}
                      fill={colors[position]}
                    >
                      <title>
                        难度 {row.difficulty} · {series[position]}：
                        {percentages
                          ? `${value.toFixed(2)}%`
                          : value.toLocaleString("zh-CN")}
                      </title>
                    </rect>
                  );
                })}
                <text x={center} y={262} textAnchor="middle">
                  难度 {row.difficulty}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <div className="difficulty-legend">
        {series.map((label, index) => (
          <span key={label}>
            <i style={{ background: colors[index] }} />
            {label}
            {percentages ? " %" : ""}
          </span>
        ))}
      </div>
    </section>
  );
}

function DifficultyResults({ rows }) {
  return (
    <>
      <div className="difficulty-charts">
        <DifficultyChart rows={rows} percentages />
        <DifficultyChart rows={rows} />
      </div>
      <section className="difficulty-details">
        <h3>各难度明细</h3>
        <p className="analytics-muted">
          人数通关率 = 通关人数 ÷ 选择人数；次数通关率 = 通关次数 ÷ 选择次数。
        </p>
        <div className="table-shell">
          <table className="data-table difficulty-table">
            <thead>
              <tr>
                {[
                  "难度",
                  "选择人数",
                  "通关人数",
                  "人数通关率",
                  "选择次数",
                  "通关次数",
                  "次数通关率",
                ].map((label) => (
                  <th key={label}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.difficulty}>
                  <td>
                    <strong>难度 {row.difficulty}</strong>
                  </td>
                  <td>{row.selected_users.toLocaleString("zh-CN")}</td>
                  <td>{row.cleared_users.toLocaleString("zh-CN")}</td>
                  <td className="difficulty-rate">
                    {rate(row.cleared_users, row.selected_users)}
                  </td>
                  <td>{row.selected_count.toLocaleString("zh-CN")}</td>
                  <td>{row.cleared_count.toLocaleString("zh-CN")}</td>
                  <td>{rate(row.cleared_count, row.selected_count)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="analytics-muted">
          例如：同一玩家当天选择难度 1 三次、通关一次，计选择 1 人、通关 1
          人、选择 3 次、通关 1
          次。跨日通关归入选择难度当天；未通关记录仍计入选择次数。
        </p>
      </section>
    </>
  );
}

export default function AnalyticsPanel({ map, mapId, feature }) {
  const [params, setParams] = useSearchParams();
  const date = params.get("date") || today();
  const version = params.get("version") || "";
  const difficulty =
    feature === "difficulty" ? "" : params.get("difficulty") || "";
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
  const isDifficulty = feature === "difficulty";
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
        "阶段",
        "进入人数",
        "完成人数",
        "人数完成率",
        "进入次数",
        "完成次数",
        "失败次数",
        "主动退出次数",
        "未结束次数",
        "次数完成率",
        "退出率",
        "完成耗时中位数",
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
            if (value && !(isDifficulty && key === "difficulty"))
              next.set(key, value.trim());
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
        {!isDifficulty && (
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
        )}
        <Button type="submit" disabled={loading}>
          {loading ? "查询中…" : "查询"}
        </Button>
      </form>
      <p className="analytics-muted">
        {date} · {version || "全部版本"} · {difficulty || "全部难度"}。
        {isDifficulty
          ? "按选择难度的日期统计。同一玩家当天在同一难度只计 1 人，每局选择与通关分别计次；多人局按各玩家分别计次。"
          : choices
            ? "被选率 = 选择次数 ÷ 候选出现次数；人数按当日、场景、轮次与候选去重。"
            : "按进入阶段的日期统计；同一玩家在同一阶段只计 1 人。进入一次阶段计 1 次；未结束表示仍在进行或尚未上报结果，不计为失败。"}
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
      ) : isDifficulty ? (
        <DifficultyResults rows={rows} />
      ) : (
        <>
          <section className="analytics-chart">
            <h3>
              {choices ? "候选被选率" : "阶段退出率"}{" "}
              <small className="analytics-muted">
                前 12 项 · 完整数据见下表
              </small>
            </h3>
            {rows.slice(0, 12).map((row, index) => {
              const numerator = choices ? row.selected : row.exits;
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
                    </td>
                    {choices ? (
                      <>
                        <td>{row.position}</td>
                        <td>{row.candidate_name}</td>
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
                        <td>{rate(row.exits, row.attempts)}</td>
                        <td>{seconds(row.median_seconds)}</td>
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
              完成率、退出率以进入次数为分母，未结束记录也包含在内。耗时仅统计已完成的阶段。
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
          {isDifficulty
            ? "玩家确定本局难度时上报 difficulty_select，确认成功后，通关时上报 difficulty_clear。两条记录使用同一个 playId 和 uid；同一局中每位玩家分别上报。难度使用 1～1000 的整数，按地图实际难度编号上报。"
            : choices
              ? "一次已结束的选择提交候选集合和最终选择；主动放弃时 selectedKey 传 null。position 表示第几次选择。"
              : "进入阶段上报 start，确认成功后在完成、失败或主动退出时上报 end。共同结算的多人阶段只报一份，进入时提交全部参与者 UID。"}
        </p>
        <p>
          网络重试保留原 eventId
          与正文。关闭功能会拒绝上报，重新开启后历史数据保留。完整字段与示例见仓库《游戏客户端接入》文档。
        </p>
      </details>
    </>
  );
}
