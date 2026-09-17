import { useEffect, useState } from "react";
import { ANALYTICS_FEATURES } from "../../../shared/analytics.js";
import { api } from "../../api/client";
import { Button, InlineAlert, useToast } from "../../components/ui";

export default function AnalyticsFeatures({
  map,
  mapId,
  isAdmin,
  refreshMap,
  onDirtyChange,
}) {
  const [features, setFeatures] = useState(map.analyticsFeatures);
  const [revision, setRevision] = useState(map.analyticsRevision);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const toast = useToast();
  useEffect(() => {
    setFeatures(map.analyticsFeatures);
    setRevision(map.analyticsRevision);
  }, [map.id, map.analyticsFeatures, map.analyticsRevision]);
  const changed = ANALYTICS_FEATURES.some(
    ({ key }) => features.includes(key) !== map.analyticsFeatures.includes(key),
  );
  useEffect(() => {
    onDirtyChange(changed);
  }, [changed, onDirtyChange]);
  async function save() {
    setSaving(true);
    setError("");
    try {
      await api(`/api/maps/${mapId}/analytics-features`, {
        method: "PUT",
        body: { features, revision },
      });
      await refreshMap();
      toast("开放功能已保存");
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="page-stack">
      <div className="config-surface-head">
        <div>
          <h3>开放功能</h3>
          <p>仅影响当前项目。关闭后停止采集并隐藏数据页，历史记录保留。</p>
        </div>
      </div>
      <p className="analytics-muted">
        基础经营指标及原有业务功能保持开放。以下玩法分析按需启用，由地图端接入。
      </p>
      {error && (
        <InlineAlert
          tone="danger"
          title="保存失败"
          description={error}
          action={<Button onClick={refreshMap}>重新读取配置</Button>}
        />
      )}
      <div className="analytics-feature-list">
        {ANALYTICS_FEATURES.map(({ key, name, description }) => (
          <label className="analytics-feature-row" key={key}>
            <input
              type="checkbox"
              checked={features.includes(key)}
              disabled={!isAdmin || saving}
              onChange={(e) =>
                setFeatures((current) =>
                  e.target.checked
                    ? [...current, key]
                    : current.filter((item) => item !== key),
                )
              }
            />
            <span>
              <strong>{name}</strong>
              <small>{description}</small>
            </span>
            <span className="analytics-muted">
              {features.includes(key) ? "开放" : "关闭"}
            </span>
          </label>
        ))}
      </div>
      {isAdmin ? (
        <div>
          <Button
            variant="primary"
            disabled={!changed || saving}
            onClick={save}
          >
            {saving ? "保存中…" : "保存开放功能"}
          </Button>
          {changed && <span className="analytics-muted">　有未保存修改</span>}
        </div>
      ) : (
        <p className="analytics-muted">仅管理员可以修改开放功能。</p>
      )}
    </div>
  );
}
