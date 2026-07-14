import { useCallback, useEffect, useState } from "react";
import { ListChecks, RefreshCw } from "lucide-react";
import { api } from "../api/client";
import {
  Badge,
  Button,
  EmptyState,
  SectionHead,
  useToast,
} from "../components/ui";
import { formatDate } from "../utils/format";

export default function AdminAuditPage() {
  const [rows, setRows] = useState([]),
    [loading, setLoading] = useState(true);
  const toast = useToast();
  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await api("/api/system/audit?limit=100"));
    } catch (error) {
      toast(error.message, "danger");
    } finally {
      setLoading(false);
    }
  }, [toast]);
  useEffect(() => {
    load();
  }, [load]);
  return (
    <div className="page-stack page-enter">
      <SectionHead
        eyebrow="AUDIT TRAIL"
        title="审计日志"
        description="登录、账号权限、地图配置、数据修改和危险操作均记录操作者与来源。"
        actions={
          <Button icon={RefreshCw} onClick={load}>
            刷新
          </Button>
        }
      />
      {loading ? (
        <div className="loading-state">正在读取审计日志…</div>
      ) : rows.length ? (
        <div className="table-shell">
          <table className="data-table">
            <thead>
              <tr>
                <th>时间</th>
                <th>操作者</th>
                <th>动作</th>
                <th>资源</th>
                <th>地图</th>
                <th>来源 IP</th>
                <th>详情</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{formatDate(row.created_at)}</td>
                  <td>
                    <strong>{row.display_name || "系统"}</strong>
                    <small className="cell-subtitle">
                      {row.username || "—"}
                    </small>
                  </td>
                  <td>
                    <Badge>{row.action}</Badge>
                  </td>
                  <td>
                    <code>
                      {row.resource_type}:{row.resource_id || "—"}
                    </code>
                  </td>
                  <td>{row.map_id || "—"}</td>
                  <td>
                    <code>{row.ip || "—"}</code>
                  </td>
                  <td>
                    <details>
                      <summary>查看</summary>
                      <pre className="audit-details">
                        {JSON.stringify(row.details || {}, null, 2)}
                      </pre>
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState icon={ListChecks} title="还没有审计记录" />
      )}
    </div>
  );
}
