import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { Plus, RefreshCw, Search, ShieldAlert } from "lucide-react";
import { api } from "../../api/client";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Field,
  FilterSummary,
  InlineAlert,
  Modal,
  Switch,
  useConfirm,
  useToast,
} from "../../components/ui";
import { formatDate, formatNumber } from "../../utils/format";

const severityLabels = {
  low: "低",
  medium: "中",
  high: "高",
  critical: "紧急",
};
const riskStatusLabels = {
  open: "待处置",
  reviewed: "已复核",
  blocked: "已封禁",
  ignored: "已忽略",
};
const severityTone = (severity) =>
  severity === "critical" || severity === "high"
    ? "danger"
    : severity === "medium"
      ? "warning"
      : "neutral";
const riskStatusTone = (status) =>
  status === "blocked"
    ? "danger"
    : status === "reviewed"
      ? "positive"
      : status === "open"
        ? "warning"
        : "neutral";

export default function RiskPanel({ mapId, can }) {
  const [viewParams, setViewParams] = useSearchParams();
  const manageable = can("risk.manage");
  const [rules, setRules] = useState([]);
  const [events, setEvents] = useState([]);
  const [summary, setSummary] = useState({
    open: 0,
    critical: 0,
    blocked: 0,
    total: 0,
  });
  const [query, setQuery] = useState(() => viewParams.get("q") || "");
  const [status, setStatus] = useState(() => {
    const value = viewParams.get("status");
    if (value === "all") return "";
    return Object.hasOwn(riskStatusLabels, value) ? value : "open";
  });
  const [editingRule, setEditingRule] = useState(null);
  const [resolving, setResolving] = useState(null);
  const [loading, setLoading] = useState(true);
  const [ruleLoading, setRuleLoading] = useState(true);
  const [eventLoadError, setEventLoadError] = useState("");
  const [ruleLoadError, setRuleLoadError] = useState("");
  const previousRiskMapId = useRef(mapId);
  const confirmAction = useConfirm();
  const toast = useToast();

  const loadRules = useCallback(async () => {
    setRuleLoading(true);
    setRuleLoadError("");
    try {
      setRules(await api(`/api/maps/${mapId}/risk/rules`));
    } catch (error) {
      setRuleLoadError(error.message);
    } finally {
      setRuleLoading(false);
    }
  }, [mapId]);

  const loadEvents = useCallback(async () => {
    setLoading(true);
    setEventLoadError("");
    try {
      const params = new URLSearchParams({ limit: "100" });
      if (query.trim()) params.set("q", query.trim());
      if (status) params.set("status", status);
      const result = await api(`/api/maps/${mapId}/risk/events?${params}`);
      setEvents(result.items);
      setSummary(result.summary);
    } catch (error) {
      setEventLoadError(error.message);
    } finally {
      setLoading(false);
    }
  }, [mapId, query, status]);

  useEffect(() => {
    loadRules();
  }, [loadRules]);
  useEffect(() => {
    if (previousRiskMapId.current === mapId) return;
    previousRiskMapId.current = mapId;
    setQuery("");
    setStatus("open");
  }, [mapId]);
  useEffect(() => {
    const next = new URLSearchParams();
    if (query.trim()) next.set("q", query.trim());
    next.set("status", status || "all");
    setViewParams(next, { replace: true });
  }, [query, setViewParams, status]);
  useEffect(() => {
    const timer = setTimeout(loadEvents, 180);
    return () => clearTimeout(timer);
  }, [loadEvents]);

  const saveRule = async () => {
    try {
      const id = editingRule.id;
      await api(`/api/maps/${mapId}/risk/rules${id ? `/${id}` : ""}`, {
        method: id ? "PATCH" : "POST",
        body: {
          ruleKey: editingRule.ruleKey,
          name: editingRule.name,
          severity: editingRule.severity,
          enabled: editingRule.enabled,
        },
      });
      setEditingRule(null);
      toast("风控规则已保存");
      loadRules();
    } catch (error) {
      toast(error.message, "danger");
    }
  };

  const removeRule = async (rule) => {
    if (
      !(await confirmAction({
        title: "删除风控规则",
        description: `确认删除规则“${rule.name}”？`,
        detail: "规则会被删除，历史事件仍会保留当时的规则快照。",
        confirmLabel: "确认删除",
      }))
    )
      return;
    try {
      await api(`/api/maps/${mapId}/risk/rules/${rule.id}`, {
        method: "DELETE",
      });
      toast("风控规则已删除");
      loadRules();
    } catch (error) {
      toast(error.message, "danger");
    }
  };

  const startResolve = (event) =>
    setResolving({
      ...event,
      nextStatus: event.status,
      nextItemBan: event.itemBan,
      nextDataBan: event.dataBan,
      nextRankBan: event.rankBan,
      note: event.details?.resolutionNote || "",
    });

  const resolve = async () => {
    try {
      await api(`/api/maps/${mapId}/risk/events/${resolving.id}`, {
        method: "PATCH",
        body: {
          status: resolving.nextStatus,
          itemBan: resolving.nextItemBan,
          dataBan: resolving.nextDataBan,
          rankBan: resolving.nextRankBan,
          note: resolving.note,
        },
      });
      setResolving(null);
      toast("风险事件已完成处置");
      loadEvents();
    } catch (error) {
      toast(error.message, "danger");
    }
  };

  return (
    <>
      <div className="operations-context-line risk-summary-line">
        <div>
          <span>待处置</span>
          <strong>{formatNumber(summary.open)}</strong>
        </div>
        <div>
          <span>紧急事件</span>
          <strong className="danger-text">
            {formatNumber(summary.critical)}
          </strong>
        </div>
        <div>
          <span>已封禁</span>
          <strong>{formatNumber(summary.blocked)}</strong>
        </div>
        <div>
          <span>累计事件</span>
          <strong>{formatNumber(summary.total)}</strong>
        </div>
      </div>

      <div className="module-toolbar operations-toolbar">
        <div className="section-actions filter-actions">
          <div className="search-box">
            <Search size={16} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="玩家、UID 或规则"
              aria-label="搜索风险事件中的玩家、UID 或规则"
            />
          </div>
          <select
            className="input status-filter"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="">全部状态</option>
            {Object.entries(riskStatusLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <Button icon={RefreshCw} onClick={loadEvents} disabled={loading}>
          {loading ? "刷新中…" : "刷新事件"}
        </Button>
      </div>

      <FilterSummary
        items={[
          ...(query.trim() ? [`搜索：${query.trim()}`] : []),
          `状态：${status ? riskStatusLabels[status] : "全部状态"}`,
        ]}
        resultText={loading ? "正在更新…" : `当前返回 ${events.length} 条事件`}
        onClear={() => {
          setQuery("");
          setStatus("");
        }}
      />

      {eventLoadError && events.length > 0 && (
        <InlineAlert
          tone="danger"
          title="风险事件刷新失败"
          description={`${eventLoadError}；当前仍显示上一次成功读取的数据。`}
          action={<Button onClick={loadEvents}>重新尝试</Button>}
        />
      )}
      {ruleLoadError && rules.length > 0 && (
        <InlineAlert
          tone="danger"
          title="风控规则刷新失败"
          description={`${ruleLoadError}；当前仍显示上一次成功读取的数据。`}
          action={<Button onClick={loadRules}>重新尝试</Button>}
        />
      )}

      <div className="operations-workspace risk-workspace">
        <section className="operations-main risk-events-main">
          {loading && !events.length ? (
            <div className="loading-state">正在读取风险事件…</div>
          ) : eventLoadError && !events.length ? (
            <ErrorState
              title="风险事件读取失败"
              description={eventLoadError}
              onRetry={loadEvents}
            />
          ) : events.length ? (
            <div className="table-shell">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>等级</th>
                    <th>玩家</th>
                    <th>触发规则</th>
                    <th>次数</th>
                    <th>状态</th>
                    <th>发生时间</th>
                    {manageable && <th className="align-right">操作</th>}
                  </tr>
                </thead>
                <tbody>
                  {events.map((event) => (
                    <tr key={event.id}>
                      <td>
                        <Badge tone={severityTone(event.severity)}>
                          {severityLabels[event.severity]}
                        </Badge>
                      </td>
                      <td>
                        <div className="event-player">
                          <strong>{event.playerName}</strong>
                          <code>{event.uid}</code>
                        </div>
                      </td>
                      <td>
                        <strong>{event.ruleName}</strong>
                        <small className="cell-subline">{event.ruleKey}</small>
                      </td>
                      <td>{formatNumber(event.count)}</td>
                      <td>
                        <Badge tone={riskStatusTone(event.status)}>
                          {riskStatusLabels[event.status]}
                        </Badge>
                      </td>
                      <td className="muted-cell">
                        {formatDate(event.occurredAt)}
                      </td>
                      {manageable && (
                        <td className="align-right">
                          <button
                            className="table-action"
                            onClick={() => startResolve(event)}
                          >
                            <ShieldAlert size={14} />
                            处置
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              icon={ShieldAlert}
              title="当前筛选下没有风险事件"
              description="客户端按已启用规则上报后，事件会进入这里等待处置。"
            />
          )}
        </section>

        <aside className="operations-rail risk-rule-rail">
          <div className="operations-rail-head">
            <div>
              <span className="eyebrow">RISK RULES</span>
              <strong>{rules.length} 条规则</strong>
            </div>
            {manageable && (
              <button
                className="icon-button"
                aria-label="新建风控规则"
                onClick={() =>
                  setEditingRule({
                    ruleKey: "",
                    name: "",
                    severity: "medium",
                    enabled: true,
                  })
                }
              >
                <Plus size={17} />
              </button>
            )}
          </div>
          <div className="risk-rule-list">
            {rules.map((rule) => (
              <div key={rule.id}>
                <span>
                  <Badge tone={severityTone(rule.severity)}>
                    {severityLabels[rule.severity]}
                  </Badge>
                </span>
                <div>
                  <strong>{rule.name}</strong>
                  <code>{rule.ruleKey}</code>
                </div>
                <i className={rule.enabled ? "is-online" : ""} />
                {manageable && (
                  <div className="rail-row-actions">
                    <button onClick={() => setEditingRule({ ...rule })}>
                      编辑
                    </button>
                    <button className="danger" onClick={() => removeRule(rule)}>
                      删除
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
          {ruleLoading && !rules.length ? (
            <p className="rail-empty">正在读取风控规则…</p>
          ) : ruleLoadError && !rules.length ? (
            <div className="rail-error" role="alert">
              <span>规则读取失败</span>
              <button type="button" onClick={loadRules}>
                重试
              </button>
            </div>
          ) : (
            !rules.length && (
              <p className="rail-empty">创建规则后，客户端才可上报对应事件。</p>
            )
          )}
        </aside>
      </div>

      <Modal
        open={Boolean(editingRule)}
        onClose={() => setEditingRule(null)}
        title={`${editingRule?.id ? "编辑" : "新建"}风控规则`}
        eyebrow="RISK RULE"
        footer={
          <>
            <Button onClick={() => setEditingRule(null)}>取消</Button>
            <Button
              variant="primary"
              onClick={saveRule}
              disabled={!editingRule?.ruleKey || !editingRule?.name}
            >
              保存
            </Button>
          </>
        }
      >
        {editingRule && (
          <>
            <Field label="规则名称">
              <input
                className="input"
                value={editingRule.name}
                onChange={(event) =>
                  setEditingRule({ ...editingRule, name: event.target.value })
                }
                placeholder="例如 异常资源增长"
              />
            </Field>
            <Field label="规则 Key" hint="需要与游戏客户端上报的 ruleKey 一致">
              <input
                className="input"
                value={editingRule.ruleKey}
                onChange={(event) =>
                  setEditingRule({
                    ...editingRule,
                    ruleKey: event.target.value,
                  })
                }
                placeholder="abnormal_resource_growth"
              />
            </Field>
            <Field label="风险等级">
              <select
                className="input"
                value={editingRule.severity}
                onChange={(event) =>
                  setEditingRule({
                    ...editingRule,
                    severity: event.target.value,
                  })
                }
              >
                {Object.entries(severityLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="接收上报">
              <Switch
                checked={editingRule.enabled}
                onChange={(value) =>
                  setEditingRule({ ...editingRule, enabled: value })
                }
                label={editingRule.enabled ? "已启用" : "已停用"}
              />
            </Field>
          </>
        )}
      </Modal>

      <Modal
        open={Boolean(resolving)}
        onClose={() => setResolving(null)}
        title={`处置风险事件 · ${resolving?.playerName || ""}`}
        eyebrow="RISK RESOLUTION"
        wide
        danger={resolving?.severity === "critical"}
        footer={
          <>
            <Button onClick={() => setResolving(null)}>取消</Button>
            <Button variant="primary" onClick={resolve}>
              保存处置结果
            </Button>
          </>
        }
      >
        {resolving && (
          <div className="resolution-layout">
            <div>
              <Field label="事件状态">
                <select
                  className="input"
                  value={resolving.nextStatus}
                  onChange={(event) =>
                    setResolving({
                      ...resolving,
                      nextStatus: event.target.value,
                    })
                  }
                >
                  {Object.entries(riskStatusLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="ban-switches">
                <Switch
                  checked={resolving.nextItemBan}
                  onChange={(value) =>
                    setResolving({ ...resolving, nextItemBan: value })
                  }
                  label="物品封禁"
                />
                <Switch
                  checked={resolving.nextDataBan}
                  onChange={(value) =>
                    setResolving({ ...resolving, nextDataBan: value })
                  }
                  label="存档封禁"
                />
                <Switch
                  checked={resolving.nextRankBan}
                  onChange={(value) =>
                    setResolving({ ...resolving, nextRankBan: value })
                  }
                  label="榜单封禁"
                />
              </div>
              <Field label="处置说明">
                <textarea
                  className="input"
                  rows="5"
                  value={resolving.note}
                  onChange={(event) =>
                    setResolving({ ...resolving, note: event.target.value })
                  }
                  placeholder="记录复核依据或处理原因"
                />
              </Field>
            </div>
            <div className="event-evidence">
              <span className="eyebrow">EVENT EVIDENCE</span>
              <strong>{resolving.ruleName}</strong>
              <small>{formatDate(resolving.occurredAt)}</small>
              <pre>{JSON.stringify(resolving.details || {}, null, 2)}</pre>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
