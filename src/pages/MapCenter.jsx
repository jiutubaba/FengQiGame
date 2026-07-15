import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowUpRight,
  Grid2X2,
  List,
  Plus,
  Search,
  ShieldCheck,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import {
  Badge,
  Button,
  EmptyState,
  Field,
  Modal,
  SectionHead,
  useToast,
} from "../components/ui";
import { environmentLabel, formatDate, formatNumber } from "../utils/format";

export default function MapCenter() {
  const [view, setView] = useState("grid");
  const [search, setSearch] = useState("");
  const [maps, setMaps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({
    name: "",
    description: "",
    runtimeEnv: "release",
  });
  const navigate = useNavigate();
  const toast = useToast();
  const { isAdmin } = useAuth();

  const loadMaps = useCallback(async () => {
    setLoading(true);
    try {
      setMaps(await api("/api/maps"));
    } catch (error) {
      toast(error.message, "danger");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadMaps();
  }, [loadMaps]);

  const filtered = useMemo(
    () =>
      maps.filter(
        (item) =>
          item.name.toLowerCase().includes(search.toLowerCase()) ||
          String(item.id).includes(search),
      ),
    [maps, search],
  );

  const createMap = async () => {
    try {
      const created = await api("/api/maps", { method: "POST", body: form });
      setCreateOpen(false);
      setForm({ name: "", description: "", runtimeEnv: "release" });
      toast("地图已创建");
      await loadMaps();
      navigate(`/maps/${created.id}/metrics`);
    } catch (error) {
      toast(error.message, "danger");
    }
  };

  return (
    <div className="page-stack page-enter map-center-page">
      <SectionHead
        eyebrow="MAP DIRECTORY"
        title="地图中心"
        description={
          isAdmin
            ? "管理员可查看全部地图，并配置用户访问权限。"
            : "仅显示管理员已授权给你的地图和功能。"
        }
        actions={
          isAdmin && (
            <Button
              variant="primary"
              icon={Plus}
              onClick={() => setCreateOpen(true)}
            >
              新建地图
            </Button>
          )
        }
      />
      <div className="toolbar-row">
        <div className="search-box">
          <Search size={16} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索地图名称或 ID"
          />
        </div>
        <div className="view-toggle">
          <button
            className={view === "list" ? "active" : ""}
            onClick={() => setView("list")}
          >
            <List size={16} />
            列表视图
          </button>
          <button
            className={view === "grid" ? "active" : ""}
            onClick={() => setView("grid")}
          >
            <Grid2X2 size={16} />
            卡片视图
          </button>
        </div>
        <span className="result-count">共 {filtered.length} 张地图</span>
      </div>

      {loading ? (
        <div className="loading-state">正在读取地图数据…</div>
      ) : filtered.length ? (
        <div className={`map-list map-list-${view}`}>
          {filtered.map((map) => (
            <article
              className="map-card"
              key={map.id}
              role="link"
              tabIndex={0}
              aria-label={`打开地图 ${map.name}`}
              onClick={() => navigate(`/maps/${map.id}/metrics`)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  navigate(`/maps/${map.id}/metrics`);
                }
              }}
            >
              <div
                className={`map-cover ${map.coverPath ? "has-cover" : "is-placeholder"}`}
              >
                <img
                  src={map.coverPath || "/assets/fengqi-mark.svg?v=attio"}
                  alt={map.coverPath ? `${map.name} 封面` : ""}
                  loading="lazy"
                />
                <div className="map-cover-shade" />
                <Badge tone="positive" dot>
                  {environmentLabel(map.runtimeEnv)}
                </Badge>
                <span className="map-open-icon" aria-hidden="true">
                  <ArrowUpRight size={18} />
                </span>
              </div>
              <div className="map-card-body">
                <div className="map-title-row">
                  <div>
                    <span>MAP / {String(map.id).padStart(3, "0")}</span>
                    <h3>{map.name}</h3>
                  </div>
                </div>
                <div className="map-meta">
                  <span>
                    <small>地图 ID</small>
                    <b>{map.id}</b>
                  </span>
                  <span>
                    <small>累计用户</small>
                    <b>{formatNumber(map.cumulativeUsers)}</b>
                  </span>
                  <span className="map-meta-games">
                    <small>总局数</small>
                    <b>{formatNumber(map.totalGameCount)}</b>
                  </span>
                </div>
                <div className="map-card-foot">
                  <span>负责人 · {map.ownerName || "未指定"}</span>
                  <span>更新 {formatDate(map.updatedAt)}</span>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={ShieldCheck}
          title="当前没有可访问的地图"
          description={
            isAdmin
              ? "创建第一张地图后即可开始接入游戏客户端。"
              : "请联系管理员为账号分配地图与功能权限。"
          }
        />
      )}

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="新建地图"
        eyebrow="CREATE MAP"
        footer={
          <>
            <Button onClick={() => setCreateOpen(false)}>取消</Button>
            <Button
              variant="primary"
              onClick={createMap}
              disabled={!form.name.trim()}
            >
              创建地图
            </Button>
          </>
        }
      >
        <Field label="地图名称">
          <input
            className="input"
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            placeholder="请输入唯一的地图名称"
          />
        </Field>
        <Field label="说明">
          <textarea
            className="input"
            rows="4"
            value={form.description}
            onChange={(event) =>
              setForm({ ...form, description: event.target.value })
            }
            placeholder="用途、负责人或接入说明"
          />
        </Field>
        <Field label="默认运行环境">
          <select
            className="input"
            value={form.runtimeEnv}
            onChange={(event) =>
              setForm({ ...form, runtimeEnv: event.target.value })
            }
          >
            <option value="release">正式服</option>
            <option value="lobby">测试大厅</option>
            <option value="test">测试服</option>
          </select>
        </Field>
      </Modal>
    </div>
  );
}
