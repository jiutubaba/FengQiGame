import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BarChart3, CircleHelp, RefreshCw } from "lucide-react";
import { api } from "../../api/client";
import {
  Button,
  EmptyState,
  ErrorState,
  InlineAlert,
} from "../../components/ui";
import { formatDate, formatNumber } from "../../utils/format";

const metricDefinitions = [
  {
    key: "cumulativeUsers",
    label: "累计用户",
    help: "从自动统计起始日开始，至少被正式对局事件上报过一次的去重玩家 UID 数；统计起始日前的数据不会回填。",
  },
  {
    key: "onlineUsers",
    label: "在线用户",
    help: "当前未结束对局中，最近 120 秒内通过开局或心跳上报的去重玩家 UID 数；结束上报后立即离线。",
    trendable: false,
  },
  {
    key: "validGameCount",
    label: "游戏有效局",
    help: "当天开始，且服务端从首次开局到首次结束或最后心跳观测到的时长严格超过 10 分钟的去重对局数；同一 sessionId 只计一局。",
    automaticOnly: true,
  },
  {
    key: "dailyNewUsers",
    label: "日新增用户",
    help: "当天首次出现在本地图自动统计中的去重玩家 UID 数。",
  },
  {
    key: "dailyActiveUsers",
    label: "日活跃用户",
    help: "当天被正式对局开始、心跳或结束事件上报过的去重玩家 UID 数。",
  },
  {
    key: "lostUserCount",
    label: "流失用户数",
    help: "当天刚满连续 30 个自然日未活跃的去重玩家数；同一段沉默只在达标当天计算一次。",
  },
  {
    key: "returnUserCount",
    label: "回流用户数",
    help: "上次活跃后连续 30 个自然日未活跃，并在当天再次活跃的去重玩家数。",
  },
  {
    key: "activeUserRetentionRate",
    label: "活跃用户次留率",
    help: "昨日活跃且今日仍活跃的玩家数 ÷ 昨日活跃玩家数。没有昨日活跃样本时显示为暂无数据。",
    percentage: true,
    numeratorKey: "activeUserRetainedCount",
    denominatorKey: "activeUserCohortCount",
  },
  {
    key: "newUserRetentionRate",
    label: "新增用户次留率",
    help: "昨日新增且今日仍活跃的玩家数 ÷ 昨日新增玩家数。没有昨日新增样本时显示为暂无数据。",
    percentage: true,
    numeratorKey: "newUserRetainedCount",
    denominatorKey: "newUserCohortCount",
  },
  {
    key: "sevenDayRetentionRate",
    label: "新增用户七日留存率",
    help: "7 个自然日前新增且今日仍活跃的玩家数 ÷ 7 日前新增玩家数；按第 7 天当日活跃计算。",
    percentage: true,
    numeratorKey: "sevenDayRetainedCount",
    denominatorKey: "sevenDayCohortCount",
  },
  {
    key: "replayRate",
    label: "复玩率",
    help: "当天进入至少 4 个不同正式对局的玩家数 ÷ 当日日活跃玩家数。",
    percentage: true,
    numeratorKey: "replayUserCount",
    denominatorKey: "replayCohortCount",
  },
];

function metricCardValue(metric, summary, automatic) {
  if (metric.automaticOnly && !automatic) return "—";
  if (
    metric.percentage &&
    automatic &&
    Number(summary[metric.denominatorKey] || 0) === 0
  ) {
    return "—";
  }
  const value = Number(summary[metric.key] || 0);
  return metric.percentage ? `${value}%` : formatNumber(value);
}

function metricCardContext(metric, summary, previous, automatic) {
  if (metric.key === "onlineUsers") return "实时 · 120 秒心跳窗口";
  if (metric.automaticOnly && !automatic) return "需要接入自动会话统计";
  if (metric.percentage && automatic) {
    const denominator = Number(summary[metric.denominatorKey] || 0);
    if (!denominator) return "暂无可计算样本";
    return `${formatNumber(summary[metric.numeratorKey])} / ${formatNumber(denominator)} 人`;
  }
  if (!previous) return "暂无昨日数据";
  const currentValue = Number(summary[metric.key] || 0);
  const previousValue = Number(previous[metric.key] || 0);
  const adjacentDates = areAdjacentMetricDates(summary.date, previous.date);
  const comparisonLabel = adjacentDates
    ? "较昨日全天"
    : `较上次快照${previous.date ? `（${previous.date}）` : ""}`;
  if (metric.key === "cumulativeUsers") {
    const delta = currentValue - previousValue;
    return adjacentDates
      ? `今日净增 ${delta >= 0 ? "+" : ""}${formatNumber(delta)}`
      : `${comparisonLabel} ${delta >= 0 ? "+" : ""}${formatNumber(delta)}`;
  }
  if (metric.percentage) {
    const delta = currentValue - previousValue;
    return `${comparisonLabel} ${delta >= 0 ? "+" : ""}${delta.toFixed(2)} 个百分点`;
  }
  if (!previousValue) {
    return `${comparisonLabel} ${currentValue >= 0 ? "+" : ""}${formatNumber(currentValue)}`;
  }
  const change = ((currentValue - previousValue) / previousValue) * 100;
  return `${comparisonLabel} ${change >= 0 ? "+" : ""}${change.toFixed(2)}%`;
}

function areAdjacentMetricDates(currentDate, previousDate) {
  const current = Date.parse(`${currentDate}T00:00:00Z`);
  const previous = Date.parse(`${previousDate}T00:00:00Z`);
  return (
    Number.isFinite(current) &&
    Number.isFinite(previous) &&
    current - previous === 86_400_000
  );
}

export default function MetricsPanel({ mapId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [selectedMetricKey, setSelectedMetricKey] =
    useState("dailyActiveUsers");
  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      setData(await api(`/api/maps/${mapId}/metrics`));
    } catch (error) {
      setLoadError(error.message);
    } finally {
      setLoading(false);
    }
  }, [mapId]);
  useEffect(() => {
    load();
  }, [load]);
  if (loading && !data)
    return <div className="loading-state">正在统计地图数据…</div>;
  if (loadError && !data)
    return (
      <ErrorState
        title="地图指标读取失败"
        description={loadError}
        onRetry={load}
      />
    );
  const summary = data?.summary || {};
  const trends = data?.trends || [];
  const previous = trends.length > 1 ? trends.at(-2) : null;
  const automatic = data?.source === "automatic";
  const selectedMetric =
    metricDefinitions.find((metric) => metric.key === selectedMetricKey) ||
    metricDefinitions[0];
  const metricGroups = [
    {
      id: "core",
      title: "活跃与对局",
      keys: [
        "onlineUsers",
        "dailyActiveUsers",
        "dailyNewUsers",
        "validGameCount",
      ],
    },
    {
      id: "flow",
      title: "用户规模",
      keys: ["cumulativeUsers", "lostUserCount", "returnUserCount"],
    },
    {
      id: "retention",
      title: "留存与复玩",
      keys: [
        "activeUserRetentionRate",
        "newUserRetentionRate",
        "sevenDayRetentionRate",
        "replayRate",
      ],
    },
  ];
  const renderMetricCard = (metric) => {
    const trendable = metric.trendable !== false;
    const selected = selectedMetricKey === metric.key;
    return (
      <article
        className={`metric-cell ${selected ? "is-selected" : ""} ${trendable ? "is-trendable" : ""}`}
        key={metric.key}
      >
        <div className="metric-cell-top">
          <span>{metric.label}</span>
          <button
            type="button"
            className="metric-help-button"
            aria-label={`${metric.label}口径：${metric.help}`}
            data-tooltip={metric.help}
          >
            <CircleHelp size={15} />
          </button>
        </div>
        {trendable ? (
          <button
            type="button"
            className="metric-trend-button"
            aria-label={`查看${metric.label}趋势`}
            aria-pressed={selected}
            onClick={() => setSelectedMetricKey(metric.key)}
          >
            <strong>{metricCardValue(metric, summary, automatic)}</strong>
          </button>
        ) : (
          <div className="metric-static-content">
            <strong>{metricCardValue(metric, summary, automatic)}</strong>
          </div>
        )}
        <small className="metric-context">
          {metricCardContext(metric, summary, previous, automatic)}
        </small>
      </article>
    );
  };
  return (
    <>
      {loadError && (
        <InlineAlert
          tone="danger"
          title="地图指标刷新失败"
          description={`${loadError}；当前仍显示上一次成功读取的数据。`}
          action={<Button onClick={load}>重新尝试</Button>}
        />
      )}
      <div className="metrics-toolbar">
        <div className="metrics-freshness">
          <span>
            <span className="pulse-dot" />
            {automatic ? "自动聚合" : "历史快照"}
          </span>
          <span>
            北京时间
            {data?.calculatedAt ? ` · ${formatDate(data.calculatedAt)}` : ""}
          </span>
        </div>
        <Button icon={RefreshCw} onClick={load} disabled={loading}>
          {loading ? "统计中…" : "刷新统计"}
        </Button>
      </div>
      <div className="metrics-overview" aria-label="经营指标概览">
        {metricGroups.map((group) => (
          <section
            className="metric-group"
            key={group.id}
            aria-label={group.title}
          >
            <div className="metric-group-head">
              <h3>{group.title}</h3>
            </div>
            <div className="metric-grid">
              {group.keys.map((key) =>
                renderMetricCard(
                  metricDefinitions.find((metric) => metric.key === key),
                ),
              )}
            </div>
          </section>
        ))}
      </div>
      <TrendChart
        key={selectedMetric.key}
        rows={trends}
        metric={selectedMetric}
        automatic={automatic}
      />
      <div className="data-footnote">
        <CircleHelp size={16} />
        <span>
          {data?.epochDate ? `统计起始 ${data.epochDate} · ` : ""}
          {data?.source === "automatic"
            ? "指标由对局开始、60 秒心跳与结束事件实时聚合。"
            : "当前尚无自动会话数据，正在兼容显示客户端上报的历史快照。"}
        </span>
      </div>
    </>
  );
}

function TrendChart({ rows, metric, automatic }) {
  const [activeIndex, setActiveIndex] = useState(null);
  const [width, setWidth] = useState(680);
  const chartRef = useRef(null);
  const height = 224;
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width > 0) setWidth(entry.contentRect.width);
    });
    observer.observe(chart);
    return () => observer.disconnect();
  }, [rows, metric, automatic]);
  const { indexedRows, chartRows, points, segments, min, max } = useMemo(() => {
    const indexedRows = rows.map((item, sourceIndex) => ({
      ...item,
      sourceIndex,
    }));
    const chartRows =
      metric.percentage && automatic
        ? indexedRows.filter(
            (item) => Number(item[metric.denominatorKey] || 0) > 0,
          )
        : indexedRows;
    const values = chartRows.map((item) => Number(item[metric.key] || 0));
    const lowest = Math.min(...values),
      highest = Math.max(...values);
    const min = lowest === highest ? Math.min(0, lowest) : lowest;
    const max = lowest === highest ? Math.max(1, highest) : highest;
    const points = chartRows.map((item, index) => ({
      ...item,
      x: 56 + item.sourceIndex * ((width - 88) / Math.max(1, rows.length - 1)),
      y: 188 - ((values[index] - min) / (max - min)) * 160,
    }));
    const segments = points.reduce((groups, point) => {
      const previous = groups.at(-1)?.at(-1);
      if (!previous || point.sourceIndex !== previous.sourceIndex + 1)
        groups.push([point]);
      else groups.at(-1).push(point);
      return groups;
    }, []);
    return { indexedRows, chartRows, points, segments, min, max };
  }, [rows, metric, automatic, width]);
  if (metric.automaticOnly && !automatic)
    return (
      <EmptyState
        icon={BarChart3}
        title="需要接入自动会话统计"
        description="旧指标快照没有逐局开始、心跳和结束时间，不能推算超过 10 分钟的有效局。"
      />
    );
  if (!chartRows.length)
    return (
      <EmptyState
        icon={BarChart3}
        title={metric.percentage ? "暂无可计算样本" : "暂无趋势数据"}
        description={
          metric.percentage
            ? "当前日期范围内没有可用于计算该比例的分母样本。"
            : "接入游戏客户端并上报指标后，这里会显示近 30 天趋势。"
        }
      />
    );
  const activePoint = activeIndex === null ? null : points[activeIndex];
  const activeValue = activePoint
    ? metric.percentage
      ? `${Number(activePoint[metric.key] || 0)}%`
      : formatNumber(activePoint[metric.key])
    : "";
  const selectNearestPoint = (event) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const pointerX = ((event.clientX - bounds.left) / bounds.width) * width;
    let nearestIndex = 0;
    for (let index = 1; index < points.length; index += 1) {
      if (
        Math.abs(points[index].x - pointerX) <
        Math.abs(points[nearestIndex].x - pointerX)
      ) {
        nearestIndex = index;
      }
    }
    setActiveIndex(nearestIndex);
  };
  const moveActivePoint = (direction) => {
    setActiveIndex((current) => {
      if (current === null) return direction > 0 ? 0 : points.length - 1;
      return Math.min(points.length - 1, Math.max(0, current + direction));
    });
  };
  return (
    <div className="chart-wrap">
      <div className="chart-head">
        <div>
          <h3>{metric.label}趋势</h3>
          <p>
            {rows[0]?.date} — {rows.at(-1)?.date}
          </p>
        </div>
        <div className="chart-summary">
          <strong>
            {metric.percentage
              ? `${Number(chartRows.at(-1)[metric.key] || 0)}%`
              : formatNumber(chartRows.at(-1)[metric.key])}
          </strong>
          <span>最近有效数据 · {chartRows.at(-1).date}</span>
        </div>
      </div>
      <div className="trend-chart-stage" ref={chartRef}>
        <svg
          className="trend-chart"
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          tabIndex="0"
          aria-label={`${metric.label}趋势。移动鼠标查看节点，键盘左右方向键切换日期，Escape 关闭提示。`}
          aria-describedby={activePoint ? "metric-trend-tooltip" : undefined}
          onFocus={() =>
            setActiveIndex((current) => current ?? points.length - 1)
          }
          onBlur={() => setActiveIndex(null)}
          onPointerMove={selectNearestPoint}
          onPointerDown={selectNearestPoint}
          onPointerLeave={(event) => {
            if (event.pointerType === "mouse") setActiveIndex(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") {
              event.preventDefault();
              moveActivePoint(-1);
            } else if (event.key === "ArrowRight") {
              event.preventDefault();
              moveActivePoint(1);
            } else if (event.key === "Escape") {
              setActiveIndex(null);
            }
          }}
        >
          {[0, 1, 2, 3].map((index) => (
            <g key={index}>
              <line
                x1="56"
                y1={28 + index * (160 / 3)}
                x2={width - 32}
                y2={28 + index * (160 / 3)}
                className="chart-gridline"
              />
              <text
                x="44"
                y={32 + index * (160 / 3)}
                textAnchor="end"
                className="chart-label"
              >
                {metric.percentage
                  ? `${(max - (index * (max - min)) / 3).toFixed(1)}%`
                  : formatNumber(Math.round(max - (index * (max - min)) / 3))}
              </text>
            </g>
          ))}
          {segments.map((segment) => {
            const line = segment.map((item) => `${item.x},${item.y}`).join(" ");
            const area = `${segment[0].x},188 ${line} ${segment.at(-1).x},188`;
            return (
              <g key={`segment-${segment[0].sourceIndex}`}>
                <polygon points={area} className="chart-area" />
                <polyline points={line} className="chart-line" />
              </g>
            );
          })}
          {activePoint && (
            <line
              x1={activePoint.x}
              y1="28"
              x2={activePoint.x}
              y2="188"
              className="chart-crosshair"
            />
          )}
          {points.map((item, index) => (
            <circle
              key={`${item.date}-${index}`}
              cx={item.x}
              cy={item.y}
              r={
                index === activeIndex
                  ? 5
                  : index === points.length - 1
                    ? 4
                    : 2.5
              }
              className={`chart-point ${index === activeIndex ? "is-active" : ""}`}
            />
          ))}
          {indexedRows.map((item, index) => {
            const labelCount = width < 440 ? 2 : 4;
            const step = Math.max(
              1,
              Math.ceil((indexedRows.length - 1) / labelCount),
            );
            return (
              (index === 0 ||
                index === indexedRows.length - 1 ||
                (index % step === 0 &&
                  index < indexedRows.length - 1 - step / 2)) && (
                <text
                  key={`label-${item.date}-${index}`}
                  x={
                    56 +
                    index * ((width - 88) / Math.max(1, indexedRows.length - 1))
                  }
                  y={height - 15}
                  textAnchor="middle"
                  className="chart-label"
                >
                  {String(item.date).slice(5, 10)}
                </text>
              )
            );
          })}
        </svg>
        {activePoint && (
          <div
            id="metric-trend-tooltip"
            className={`chart-tooltip ${activePoint.x < width * 0.16 ? "is-left" : activePoint.x > width * 0.84 ? "is-right" : ""}`}
            style={{
              "--chart-x": `${(activePoint.x / width) * 100}%`,
              "--chart-y": `${(activePoint.y / height) * 100}%`,
            }}
            role="tooltip"
            aria-live="polite"
          >
            <span>{activePoint.date}</span>
            <strong>{activeValue}</strong>
            <small>{metric.label}</small>
          </div>
        )}
      </div>
    </div>
  );
}
