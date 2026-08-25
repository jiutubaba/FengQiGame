import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import {
  Download,
  Edit3,
  Save,
  Settings2,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import { api, download } from "../../api/client";
import {
  Button,
  ErrorState,
  Field,
  InlineAlert,
  Modal,
  useConfirm,
  useToast,
} from "../../components/ui";
import {
  PRELOAD_CODE_LIMIT_BYTES,
  createPreloadWorkspace,
  normalizePreloadWorkspace,
  preloadWorkspaceBytes,
} from "../../../shared/preload-workspace.js";
import PreloadWorkspace from "./PreloadWorkspace";

const configSections = [
  ["ranks", "榜单配置"],
  ["gifts", "礼包配置"],
  ["anchorGifts", "主播福利礼包"],
  ["globals", "全局存档"],
  ["dayLimits", "存档每日上限"],
  ["randomGroups", "随机数存档"],
  ["preloadCode", "预加载代码"],
];

export default function ConfigPanel({
  map,
  mapId,
  isAdmin,
  can,
  refreshMap,
  refreshMaps,
}) {
  const [active, setActive] = useState("basic");
  const [config, setConfig] = useState(null);
  const [mapForm, setMapForm] = useState({
    name: map.name,
    description: map.description || "",
    coverPath: map.coverPath || "",
  });
  const [editor, setEditor] = useState("");
  const [preloadWorkspace, setPreloadWorkspace] = useState(() =>
    createPreloadWorkspace(),
  );
  const [clearOpen, setClearOpen] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const [deleteStep, setDeleteStep] = useState(0);
  const [deleting, setDeleting] = useState(false);
  const [clearSaving, setClearSaving] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [mapSaving, setMapSaving] = useState(false);
  const [sectionSaving, setSectionSaving] = useState(false);
  const [configError, setConfigError] = useState("");
  const [mapSaveError, setMapSaveError] = useState("");
  const [sectionSaveError, setSectionSaveError] = useState("");
  const [sectionSaveConflict, setSectionSaveConflict] = useState(false);
  const [clearError, setClearError] = useState("");
  const [archiveError, setArchiveError] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const navigate = useNavigate();
  const confirmAction = useConfirm();
  const toast = useToast();
  const editable = can("map.edit");
  const sectionEditable = editable && (active !== "preloadCode" || isAdmin);

  const load = useCallback(async () => {
    setConfigError("");
    try {
      setConfig(await api(`/api/maps/${mapId}/config`));
    } catch (error) {
      setConfigError(error.message);
    }
  }, [mapId]);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    if (!config || active === "basic") return;
    if (active === "preloadCode") {
      setPreloadWorkspace(configPreloadWorkspace(config));
    } else {
      setEditor(JSON.stringify(config[active] || [], null, 2));
    }
  }, [active, config]);

  const mapChanged =
    mapForm.name !== map.name ||
    mapForm.description !== (map.description || "") ||
    mapForm.coverPath !== (map.coverPath || "");
  const savedEditor =
    !config || active === "basic"
      ? ""
      : JSON.stringify(config[active] || [], null, 2);
  const savedPreloadWorkspace = config
    ? configPreloadWorkspace(config)
    : createPreloadWorkspace();
  const sectionChanged =
    active !== "basic" &&
    Boolean(config) &&
    (active === "preloadCode"
      ? JSON.stringify(preloadWorkspace) !==
        JSON.stringify(savedPreloadWorkspace)
      : editor !== savedEditor);
  const preloadCodeBytes = preloadWorkspaceBytes(preloadWorkspace);
  const preloadCodeOverLimit =
    active === "preloadCode" && preloadCodeBytes > PRELOAD_CODE_LIMIT_BYTES;

  const selectSection = async (nextSection) => {
    if (nextSection === active) return;
    if (
      (active === "basic" ? mapChanged : sectionChanged) &&
      !(await confirmAction({
        title: "放弃未保存修改",
        description: "当前板块还有未保存修改，确认切换吗？",
        detail: "继续切换后，本板块尚未保存的内容会被还原。",
        confirmLabel: "放弃修改",
      }))
    )
      return;
    if (active === "basic") {
      setMapForm({
        name: map.name,
        description: map.description || "",
        coverPath: map.coverPath || "",
      });
    } else if (active === "preloadCode") {
      setPreloadWorkspace(savedPreloadWorkspace);
    } else {
      setEditor(savedEditor);
    }
    setMapSaveError("");
    setSectionSaveError("");
    setSectionSaveConflict(false);
    setActive(nextSection);
  };

  const saveMap = async () => {
    setMapSaving(true);
    setMapSaveError("");
    try {
      await api(`/api/maps/${mapId}`, {
        method: "PATCH",
        body: { ...mapForm, coverPath: mapForm.coverPath || null },
      });
      await refreshMap();
      toast("地图基础信息已保存");
    } catch (error) {
      setMapSaveError(error.message);
    } finally {
      setMapSaving(false);
    }
  };
  const saveSection = async () => {
    setSectionSaving(true);
    setSectionSaveError("");
    setSectionSaveConflict(false);
    try {
      const body =
        active === "preloadCode"
          ? {
              preloadWorkspace,
              expectedUpdatedAt: config.updatedAt,
            }
          : { [active]: JSON.parse(editor) };
      const next = await api(`/api/maps/${mapId}/config`, {
        method: "PUT",
        body,
      });
      setConfig(next);
      toast(active === "preloadCode" ? "预加载代码已打包保存" : "配置已保存");
    } catch (error) {
      setSectionSaveConflict(error.code === "CONFLICT");
      setSectionSaveError(
        error instanceof SyntaxError ? "JSON 格式不正确" : error.message,
      );
    } finally {
      setSectionSaving(false);
    }
  };
  const exportConfig = () => {
    const blob = new Blob([JSON.stringify(config, null, 2)], {
        type: "application/json",
      }),
      url = URL.createObjectURL(blob),
      anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `map-${mapId}-config.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };
  const clearRuntime = async () => {
    setClearSaving(true);
    setClearError("");
    try {
      const counts = await api(`/api/maps/${mapId}/runtime/clear`, {
        method: "POST",
        body: { confirmName },
      });
      setClearOpen(false);
      setConfirmName("");
      toast(
        `运行数据已清理：${Object.values(counts).reduce((sum, value) => sum + value, 0)} 条`,
      );
    } catch (error) {
      setClearError(error.message);
    } finally {
      setClearSaving(false);
    }
  };
  const archiveMap = async () => {
    if (
      !(await confirmAction({
        title: "归档地图",
        description: `确认归档地图“${map.name}”？`,
        detail: "归档后会退出普通地图列表，但关联业务数据仍会保留。",
        confirmLabel: "确认归档",
      }))
    )
      return;
    setArchiving(true);
    setArchiveError("");
    try {
      await api(`/api/maps/${mapId}`, { method: "DELETE" });
      toast("地图已归档");
      navigate("/maps");
    } catch (error) {
      setArchiveError(error.message);
    } finally {
      setArchiving(false);
    }
  };
  const deleteMapPermanently = async () => {
    setDeleting(true);
    setDeleteError("");
    try {
      await api(`/api/maps/${mapId}/permanent`, {
        method: "DELETE",
        body: { confirmMapId: map.id, confirmName: map.name },
      });
      setDeleteStep(0);
      await refreshMaps();
      toast("地图及服务器数据已永久删除");
      navigate("/maps");
    } catch (error) {
      setDeleteError(error.message);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="config-layout">
      <aside className="config-sidebar">
        <span className="nav-label">配置板块</span>
        <button
          className={active === "basic" ? "active" : ""}
          onClick={() => selectSection("basic")}
        >
          <Edit3 size={16} />
          基础信息
        </button>
        {configSections.map(([key, label]) => (
          <button
            key={key}
            className={active === key ? "active" : ""}
            onClick={() => selectSection(key)}
          >
            <Settings2 size={16} />
            {label}
          </button>
        ))}
      </aside>
      <section className="config-surface">
        {active === "basic" ? (
          <>
            <div className="config-surface-head">
              <div>
                <span className="eyebrow">MAP SETTINGS</span>
                <h3>地图基础信息</h3>
                <p>地图名称全局唯一，运行数据仅归属于当前地图。</p>
              </div>
              {editable && (
                <Button
                  variant="primary"
                  icon={Save}
                  onClick={saveMap}
                  disabled={!mapChanged || mapSaving}
                >
                  {mapSaving
                    ? "正在保存…"
                    : mapChanged
                      ? "保存地图"
                      : "地图已保存"}
                </Button>
              )}
            </div>
            {mapChanged && (
              <InlineAlert
                title="有未保存修改"
                description="切换配置板块前，请先保存或明确放弃当前修改。"
              />
            )}
            {configError && (
              <InlineAlert
                tone="danger"
                title="完整配置读取失败"
                description={configError}
                action={<Button onClick={load}>重新尝试</Button>}
              />
            )}
            {mapSaveError && (
              <InlineAlert
                tone="danger"
                title="地图基础信息保存失败"
                description={mapSaveError}
                action={<Button onClick={saveMap}>重新保存</Button>}
              />
            )}
            <div className="form-grid">
              <Field label="地图名称">
                <input
                  className="input"
                  value={mapForm.name}
                  onChange={(event) =>
                    setMapForm({ ...mapForm, name: event.target.value })
                  }
                  readOnly={!editable}
                />
              </Field>
              <Field label="封面路径">
                <input
                  className="input"
                  value={mapForm.coverPath}
                  onChange={(event) =>
                    setMapForm({ ...mapForm, coverPath: event.target.value })
                  }
                  readOnly={!editable}
                  placeholder="例如 /api/maps/.../files/.../download?inline=1"
                />
              </Field>
              <Field label="说明">
                <textarea
                  className="input"
                  rows="4"
                  value={mapForm.description}
                  onChange={(event) =>
                    setMapForm({ ...mapForm, description: event.target.value })
                  }
                  readOnly={!editable}
                />
              </Field>
            </div>
            <div className="form-actions">
              <Button icon={Download} onClick={exportConfig} disabled={!config}>
                导出完整配置
              </Button>
              {isAdmin && (
                <>
                  <Button
                    variant="danger"
                    icon={ShieldAlert}
                    onClick={() => {
                      setClearError("");
                      setClearOpen(true);
                    }}
                  >
                    清理运行数据
                  </Button>
                  <Button
                    variant="danger"
                    icon={Trash2}
                    onClick={archiveMap}
                    disabled={archiving}
                  >
                    {archiving ? "正在归档…" : "归档地图"}
                  </Button>
                </>
              )}
            </div>
            {archiveError && (
              <InlineAlert
                tone="danger"
                title="地图归档失败"
                description={archiveError}
                action={<Button onClick={archiveMap}>重新归档</Button>}
              />
            )}
            {isAdmin && (
              <div className="danger-zone map-delete-zone">
                <div>
                  <ShieldAlert size={19} />
                  <span>
                    <strong>永久删除地图</strong>
                    <small>
                      清除玩家、存档、配置、榜单、礼包、日志、API Key
                      和上传文件， 不可撤销。
                    </small>
                  </span>
                </div>
                <Button
                  variant="danger"
                  icon={Trash2}
                  onClick={() => {
                    setDeleteError("");
                    setDeleteStep(1);
                  }}
                >
                  永久删除
                </Button>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="config-surface-head">
              <div>
                <span className="eyebrow">CONFIGURATION DATA</span>
                <h3>{configSections.find(([key]) => key === active)?.[1]}</h3>
                <p>
                  {active === "preloadCode"
                    ? "将 Lua 文件直接放在根目录，保存后由服务端统一打包下发。"
                    : "使用 JSON 数组维护结构化配置，保存前会进行语法校验。"}
                </p>
              </div>
              {sectionEditable && (
                <Button
                  variant="primary"
                  icon={Save}
                  onClick={saveSection}
                  disabled={
                    !sectionChanged ||
                    sectionSaving ||
                    Boolean(configError) ||
                    preloadCodeOverLimit
                  }
                >
                  {sectionSaving
                    ? "正在保存…"
                    : sectionChanged
                      ? active === "preloadCode"
                        ? "保存并发布"
                        : "保存配置"
                      : active === "preloadCode"
                        ? "代码已保存"
                        : "配置已保存"}
                </Button>
              )}
            </div>
            {configError ? (
              <ErrorState description={configError} onRetry={load} />
            ) : (
              <>
                {sectionChanged && (
                  <InlineAlert
                    title="有未保存修改"
                    description={
                      active === "preloadCode"
                        ? "保存后会从 main.lua 开始打包，并更新游戏启动接口下发的代码。"
                        : "保存前会校验当前配置格式。"
                    }
                  />
                )}
                {sectionSaveError && (
                  <InlineAlert
                    tone="danger"
                    title="配置保存失败"
                    description={sectionSaveError}
                    action={
                      <Button
                        onClick={sectionSaveConflict ? load : saveSection}
                      >
                        {sectionSaveConflict ? "重新读取" : "重新保存"}
                      </Button>
                    }
                  />
                )}
                {active === "preloadCode" ? (
                  <PreloadWorkspace
                    workspace={preloadWorkspace}
                    onChange={setPreloadWorkspace}
                    editable={sectionEditable}
                    compiledBytes={preloadCodeBytes}
                    overLimit={preloadCodeOverLimit}
                  />
                ) : (
                  <div className="config-editor-stack">
                    <textarea
                      className="code-editor config-editor"
                      spellCheck="false"
                      value={editor}
                      onChange={(event) => setEditor(event.target.value)}
                      readOnly={!sectionEditable}
                    />
                  </div>
                )}
              </>
            )}
          </>
        )}
      </section>
      <Modal
        open={clearOpen}
        onClose={() => {
          if (!clearSaving) setClearOpen(false);
        }}
        danger
        title="清理运行数据"
        eyebrow="DANGEROUS OPERATION"
        footer={
          <>
            <Button onClick={() => setClearOpen(false)} disabled={clearSaving}>
              取消
            </Button>
            <Button
              variant="danger"
              onClick={clearRuntime}
              disabled={confirmName !== map.name || clearSaving}
            >
              {clearSaving ? "正在清理…" : "确认清理"}
            </Button>
          </>
        }
      >
        {clearError && (
          <InlineAlert
            tone="danger"
            title="运行数据清理失败"
            description={clearError}
            action={<Button onClick={clearRuntime}>重新清理</Button>}
          />
        )}
        <p className="warning-note">
          将删除当前地图的玩家、礼包资格、消息、日志、指标、排行榜实时数据与快照、风控事件，并把埋点次数归零。排行榜定义、风控规则、地图配置和文件不会删除，操作会写入审计日志。
        </p>
        <Field label={`输入地图名称“${map.name}”确认`}>
          <input
            className="input"
            value={confirmName}
            onChange={(event) => setConfirmName(event.target.value)}
          />
        </Field>
      </Modal>
      <Modal
        open={deleteStep === 1}
        onClose={() => setDeleteStep(0)}
        danger
        title="永久删除地图"
        eyebrow="PERMANENT DELETION · 第一次确认"
        footer={
          <>
            <Button onClick={() => setDeleteStep(0)}>取消</Button>
            <Button
              variant="danger"
              icon={ShieldAlert}
              onClick={() => setDeleteStep(2)}
            >
              确认风险，继续删除
            </Button>
          </>
        }
      >
        <p className="warning-note danger-warning">
          此操作不是归档，也不是清理运行数据。继续后将进入最终确认。
        </p>
        <ul className="danger-consequence-list">
          <li>删除当前地图的全部玩家与存档数据。</li>
          <li>删除地图配置、礼包、榜单及快照、风控、日志和 API Key。</li>
          <li>删除服务器上传卷中该地图的全部文件。</li>
          <li>后台不提供撤销或恢复按钮。</li>
        </ul>
      </Modal>
      <Modal
        open={deleteStep === 2}
        onClose={() => {
          if (!deleting) setDeleteStep(0);
        }}
        danger
        title={`最终确认：永久删除“${map.name}”`}
        eyebrow="PERMANENT DELETION · 第二次确认"
        footer={
          <>
            <Button onClick={() => setDeleteStep(0)} disabled={deleting}>
              取消
            </Button>
            <Button
              variant="danger"
              icon={Trash2}
              onClick={deleteMapPermanently}
              disabled={deleting}
            >
              {deleting ? "正在永久删除…" : "确认永久删除"}
            </Button>
          </>
        }
      >
        {deleteError && (
          <InlineAlert
            tone="danger"
            title="地图永久删除失败"
            description={deleteError}
          />
        )}
        <div className="permanent-delete-target">
          <span>即将永久删除</span>
          <strong>{map.name}</strong>
          <code>地图 ID：{map.id}</code>
        </div>
        <p className="warning-note danger-warning">
          确认后，当前在线数据库和上传卷中的地图数据将不可恢复。历史审计记录会保留，已有数据库与上传卷备份仍按原保留期管理。
        </p>
      </Modal>
    </div>
  );
}

function configPreloadWorkspace(config) {
  return config.preloadWorkspace
    ? normalizePreloadWorkspace(config.preloadWorkspace)
    : createPreloadWorkspace(config.preloadCode || "");
}
