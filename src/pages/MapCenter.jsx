import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowUpRight,
  Grid2X2,
  List,
  Plus,
  Search,
  ShieldCheck,
} from "lucide-react";
import {
  Link,
  useNavigate,
  useOutletContext,
  useSearchParams,
} from "react-router";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import {
  Button,
  EmptyState,
  ErrorState,
  Field,
  InlineAlert,
  Modal,
  SectionHead,
  useToast,
} from "../components/ui";
import { formatDate, formatNumber } from "../utils/format";
import { PROJECT_PLATFORMS } from "../utils/projects";

export default function MapCenter() {
  const [viewParams, setViewParams] = useSearchParams();
  const [view, setView] = useState(() =>
    viewParams.get("view") === "list" ? "list" : "grid",
  );
  const [search, setSearch] = useState(() => viewParams.get("q") || "");
  const [maps, setMaps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [form, setForm] = useState({
    name: "",
    description: "",
    platform: "kk",
  });
  const navigate = useNavigate();
  const toast = useToast();
  const { isAdmin } = useAuth();
  const { syncMaps } = useOutletContext();

  const loadMaps = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const rows = await api("/api/maps");
      setMaps(rows);
      syncMaps(rows);
    } catch (error) {
      setLoadError(error.message);
    } finally {
      setLoading(false);
    }
  }, [syncMaps]);

  useEffect(() => {
    loadMaps();
  }, [loadMaps]);
  useEffect(() => {
    const next = new URLSearchParams();
    if (search.trim()) next.set("q", search.trim());
    if (view !== "grid") next.set("view", view);
    setViewParams(next, { replace: true });
  }, [search, setViewParams, view]);

  const filtered = useMemo(
    () =>
      maps.filter(
        (item) =>
          item.name.toLowerCase().includes(search.toLowerCase()) ||
          String(item.id).includes(search),
      ),
    [maps, search],
  );
  const platformGroups = useMemo(
    () =>
      PROJECT_PLATFORMS.map((platform) => ({
        ...platform,
        projects: filtered.filter(
          (project) => project.platform === platform.value,
        ),
      })).filter((platform) => platform.projects.length),
    [filtered],
  );

  const createMap = async () => {
    setCreating(true);
    setCreateError("");
    try {
      const created = await api("/api/maps", { method: "POST", body: form });
      setCreateOpen(false);
      setForm({ name: "", description: "", platform: "kk" });
      toast("项目已创建");
      await loadMaps();
      navigate(`/maps/${created.id}/metrics`);
    } catch (error) {
      setCreateError(error.message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="page-stack page-enter map-center-page">
      <SectionHead
        eyebrow="PROJECT DIRECTORY"
        title="项目中心"
        description={
          isAdmin
            ? "按平台查看全部项目，并配置用户访问权限。"
            : "仅显示管理员已授权给你的项目和功能。"
        }
        actions={
          isAdmin && (
            <Button
              variant="primary"
              icon={Plus}
              onClick={() => {
                setCreateError("");
                setCreateOpen(true);
              }}
            >
              新建项目
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
            placeholder="搜索项目名称或 ID"
            aria-label="搜索项目名称或 ID"
          />
        </div>
        <div className="view-toggle">
          <button
            type="button"
            className={view === "list" ? "active" : ""}
            onClick={() => setView("list")}
            aria-pressed={view === "list"}
          >
            <List size={16} />
            列表视图
          </button>
          <button
            type="button"
            className={view === "grid" ? "active" : ""}
            onClick={() => setView("grid")}
            aria-pressed={view === "grid"}
          >
            <Grid2X2 size={16} />
            卡片视图
          </button>
        </div>
        <span className="result-count">共 {filtered.length} 个项目</span>
      </div>

      {loadError && maps.length > 0 && (
        <InlineAlert
          tone="danger"
          title="项目列表刷新失败"
          description={loadError}
          action={<Button onClick={loadMaps}>重新尝试</Button>}
        />
      )}

      {loading && !maps.length ? (
        <div className="loading-state">正在读取项目数据…</div>
      ) : loadError && !maps.length ? (
        <ErrorState description={loadError} onRetry={loadMaps} />
      ) : filtered.length ? (
        <div className="platform-groups">
          {platformGroups.map((platform, platformIndex) => (
            <section className="platform-group" key={platform.value}>
              <header className="platform-group-head">
                <span>{String(platformIndex + 1).padStart(2, "0")}</span>
                <div>
                  <h2>{platform.label}</h2>
                  <p>{platform.description}</p>
                </div>
                <small>{platform.projects.length} 个项目</small>
              </header>
              <div className={`map-list map-list-${view}`}>
                {platform.projects.map((map) => (
                  <Link
                    className="map-card"
                    key={map.id}
                    to={`/maps/${map.id}/metrics`}
                    aria-label={`打开项目 ${map.name}`}
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
                      <span className="map-open-icon" aria-hidden="true">
                        <ArrowUpRight size={18} />
                      </span>
                    </div>
                    <div className="map-card-body">
                      <div className="map-title-row">
                        <div>
                          <span>
                            PROJECT / {String(map.id).padStart(3, "0")}
                          </span>
                          <h3>{map.name}</h3>
                        </div>
                      </div>
                      <div className="map-meta">
                        <span>
                          <small>项目 ID</small>
                          <b>{map.id}</b>
                        </span>
                        <span>
                          <small>累计用户</small>
                          <b>{formatNumber(map.cumulativeUsers)}</b>
                        </span>
                        <span className="map-meta-games">
                          <small>累计有效局</small>
                          <b>{formatNumber(map.totalGameCount)}</b>
                        </span>
                      </div>
                      <div className="map-card-foot">
                        <span>负责人 · {map.ownerName || "未指定"}</span>
                        <span>更新 {formatDate(map.updatedAt)}</span>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={ShieldCheck}
          title={search.trim() ? "没有匹配的项目" : "当前没有可访问的项目"}
          description={
            search.trim()
              ? "请尝试其他项目名称或 ID。"
              : isAdmin
                ? "创建第一个项目后即可开始接入游戏客户端。"
                : "请联系管理员为账号分配地图与功能权限。"
          }
        />
      )}

      <Modal
        open={createOpen}
        onClose={() => !creating && setCreateOpen(false)}
        title="新建项目"
        eyebrow="CREATE PROJECT"
        closeOnBackdrop={!creating}
        closeOnEscape={!creating}
        footer={
          <>
            <Button onClick={() => setCreateOpen(false)} disabled={creating}>
              取消
            </Button>
            <Button
              variant="primary"
              onClick={createMap}
              disabled={!form.name.trim() || creating}
            >
              {creating ? "正在创建…" : "创建项目"}
            </Button>
          </>
        }
      >
        {createError && (
          <InlineAlert
            tone="danger"
            title="项目创建失败"
            description={createError}
          />
        )}
        <Field label="所属平台">
          <div className="platform-choice-grid">
            {PROJECT_PLATFORMS.map((platform) => (
              <label
                className={form.platform === platform.value ? "active" : ""}
                key={platform.value}
              >
                <input
                  type="radio"
                  name="project-platform"
                  value={platform.value}
                  checked={form.platform === platform.value}
                  onChange={() =>
                    setForm({ ...form, platform: platform.value })
                  }
                />
                <span>
                  <strong>{platform.label}</strong>
                  <small>{platform.description}</small>
                </span>
              </label>
            ))}
          </div>
        </Field>
        <Field label="项目名称">
          <input
            className="input"
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            placeholder="请输入唯一的项目名称"
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
      </Modal>
    </div>
  );
}
