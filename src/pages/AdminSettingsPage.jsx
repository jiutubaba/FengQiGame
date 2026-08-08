import { useCallback, useEffect, useState } from "react";
import { Activity, Database, Save, ShieldCheck, Users } from "lucide-react";
import { api } from "../api/client";
import {
  Button,
  ErrorState,
  Field,
  InlineAlert,
  SectionHead,
  useToast,
} from "../components/ui";
import { formatNumber } from "../utils/format";

const defaultSettings = {
  siteName: "风起游戏",
  supportContact: "",
  maintenanceNotice: "",
  timezone: "Asia/Shanghai",
};

export default function AdminSettingsPage() {
  const [status, setStatus] = useState(null),
    [settings, setSettings] = useState(defaultSettings),
    [savedSettings, setSavedSettings] = useState(null);
  const [loading, setLoading] = useState(true),
    [saving, setSaving] = useState(false),
    [loadError, setLoadError] = useState(""),
    [saveError, setSaveError] = useState("");
  const toast = useToast();
  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const [nextStatus, nextSettings] = await Promise.all([
        api("/api/system/status"),
        api("/api/admin/settings"),
      ]);
      const normalizedSettings = { ...defaultSettings, ...nextSettings };
      setStatus(nextStatus);
      setSettings(normalizedSettings);
      setSavedSettings(normalizedSettings);
    } catch (error) {
      setLoadError(error.message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  const save = async () => {
    setSaving(true);
    setSaveError("");
    try {
      await api("/api/admin/settings", { method: "PUT", body: settings });
      setSavedSettings({ ...settings });
      toast("系统设置已保存");
    } catch (error) {
      setSaveError(error.message);
    } finally {
      setSaving(false);
    }
  };
  const dirty = Boolean(
    savedSettings && JSON.stringify(settings) !== JSON.stringify(savedSettings),
  );
  const cards = status
    ? [
        [Users, "账号数量", status.users],
        [Database, "地图数量", status.maps],
        [Activity, "有效会话", status.activeSessions],
        [ShieldCheck, "24 小时审计事件", status.auditEvents24h],
      ]
    : [];
  return (
    <div className="page-stack page-enter">
      <SectionHead
        eyebrow="SYSTEM CONTROL"
        title="系统设置"
        description="系统参数持久化到数据库；基础设施密钥只通过服务器环境变量配置。"
        actions={
          <Button
            variant="primary"
            icon={Save}
            onClick={save}
            disabled={loading || saving || !dirty}
          >
            {saving ? "正在保存…" : dirty ? "保存设置" : "设置已保存"}
          </Button>
        }
      />
      {loading ? (
        <div className="loading-state">正在读取系统设置…</div>
      ) : loadError ? (
        <ErrorState description={loadError} onRetry={load} />
      ) : (
        <>
          {dirty && (
            <InlineAlert
              title="有未保存修改"
              description="确认内容无误后保存，成功后才会写入系统设置。"
            />
          )}
          {saveError && (
            <InlineAlert
              tone="danger"
              title="系统设置保存失败"
              description={saveError}
              action={<Button onClick={save}>重新保存</Button>}
            />
          )}
          <div className="system-stat-grid">
            {cards.map(([Icon, label, value]) => (
              <article key={label}>
                <Icon size={18} />
                <span>
                  <small>{label}</small>
                  <strong>{formatNumber(value)}</strong>
                </span>
              </article>
            ))}
          </div>
          <section className="profile-form-panel">
            <div className="subsection-head">
              <div>
                <span className="eyebrow">PUBLIC SETTINGS</span>
                <h3>站点信息</h3>
                <p>这些字段不包含密码、数据库地址或 API Key。</p>
              </div>
            </div>
            <div className="form-grid">
              <Field label="站点名称">
                <input
                  className="input"
                  value={settings.siteName}
                  onChange={(event) =>
                    setSettings({ ...settings, siteName: event.target.value })
                  }
                />
              </Field>
              <Field label="支持联系方式">
                <input
                  className="input"
                  value={settings.supportContact}
                  onChange={(event) =>
                    setSettings({
                      ...settings,
                      supportContact: event.target.value,
                    })
                  }
                />
              </Field>
              <Field label="时区">
                <input
                  className="input"
                  value={settings.timezone}
                  onChange={(event) =>
                    setSettings({ ...settings, timezone: event.target.value })
                  }
                />
              </Field>
              <Field label="维护公告">
                <textarea
                  className="input"
                  rows="4"
                  value={settings.maintenanceNotice}
                  onChange={(event) =>
                    setSettings({
                      ...settings,
                      maintenanceNotice: event.target.value,
                    })
                  }
                />
              </Field>
            </div>
          </section>
          <section className="security-notice">
            <ShieldCheck size={20} />
            <div>
              <strong>基础设施配置</strong>
              <p>
                数据库口令、管理员初始密码、反向代理和上传上限通过部署环境变量管理，不会写入网页或数据库设置接口。
              </p>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
