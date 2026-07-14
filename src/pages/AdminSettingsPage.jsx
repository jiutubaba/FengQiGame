import { useCallback, useEffect, useState } from "react";
import { Activity, Database, Save, ShieldCheck, Users } from "lucide-react";
import { api } from "../api/client";
import { Button, Field, SectionHead, useToast } from "../components/ui";
import { formatNumber } from "../utils/format";

export default function AdminSettingsPage() {
  const [status, setStatus] = useState(null),
    [settings, setSettings] = useState({
      siteName: "风起游戏",
      supportContact: "",
      maintenanceNotice: "",
      timezone: "Asia/Shanghai",
    });
  const toast = useToast();
  const load = useCallback(async () => {
    try {
      const [nextStatus, nextSettings] = await Promise.all([
        api("/api/system/status"),
        api("/api/admin/settings"),
      ]);
      setStatus(nextStatus);
      setSettings((current) => ({ ...current, ...nextSettings }));
    } catch (error) {
      toast(error.message, "danger");
    }
  }, [toast]);
  useEffect(() => {
    load();
  }, [load]);
  const save = async () => {
    try {
      await api("/api/admin/settings", { method: "PUT", body: settings });
      toast("系统设置已保存");
    } catch (error) {
      toast(error.message, "danger");
    }
  };
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
          <Button variant="primary" icon={Save} onClick={save}>
            保存设置
          </Button>
        }
      />
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
                setSettings({ ...settings, supportContact: event.target.value })
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
    </div>
  );
}
