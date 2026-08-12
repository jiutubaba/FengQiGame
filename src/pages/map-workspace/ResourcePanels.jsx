import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowLeft,
  ArrowUpRight,
  Check,
  Clipboard,
  CloudUpload,
  Download,
  Edit3,
  Eye,
  File,
  FileArchive,
  FileImage,
  FileJson,
  FileKey2,
  Folder,
  FolderPlus,
  KeyRound,
  Plus,
  RadioTower,
  RefreshCw,
  Trash2,
  Upload,
} from "lucide-react";
import { api, download } from "../../api/client";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Field,
  InlineAlert,
  Modal,
  Switch,
  useConfirm,
  useToast,
} from "../../components/ui";
import { formatBytes, formatDate, formatNumber } from "../../utils/format";

export function ResourcePanel({ mapId, resource }) {
  const isAnchor = resource === "anchors",
    label = isAnchor ? "主播" : "埋点";
  const [items, setItems] = useState([]),
    [editing, setEditing] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const confirmAction = useConfirm();
  const toast = useToast();
  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      setItems(await api(`/api/maps/${mapId}/${resource}`));
    } catch (error) {
      setLoadError(error.message);
    } finally {
      setLoading(false);
    }
  }, [mapId, resource]);
  useEffect(() => {
    load();
  }, [load]);
  const startCreate = () =>
    setEditing(
      isAnchor
        ? { name: "", enabled: true, giftConfigText: "{}" }
        : { pointKey: "", name: "", enabled: true },
    );
  const save = async () => {
    try {
      const id = editing.id,
        path = `/api/maps/${mapId}/${resource}${id ? `/${id}` : ""}`,
        body = isAnchor
          ? {
              name: editing.name,
              enabled: editing.enabled,
              giftConfig: JSON.parse(editing.giftConfigText),
            }
          : {
              pointKey: editing.pointKey,
              name: editing.name,
              enabled: editing.enabled,
            };
      await api(path, {
        method: id ? "PATCH" : "POST",
        body,
      });
      setEditing(null);
      toast(`${label}已保存`);
      load();
    } catch (error) {
      toast(
        error instanceof SyntaxError
          ? "礼包配置 JSON 格式不正确"
          : error.message,
        "danger",
      );
    }
  };
  const remove = async (item) => {
    if (
      !(await confirmAction({
        title: `删除${label}`,
        description: `确认删除“${item.name}”？`,
        detail: isAnchor
          ? "主播名单及其专属配置将被删除。"
          : "埋点定义将被删除，既有累计数据按服务端规则处理。",
        confirmLabel: "确认删除",
      }))
    )
      return;
    try {
      await api(`/api/maps/${mapId}/${resource}/${item.id}`, {
        method: "DELETE",
      });
      toast(`${label}已删除`);
      load();
    } catch (error) {
      toast(error.message, "danger");
    }
  };
  const exportRows = () => {
    const blob = new Blob([JSON.stringify(items, null, 2)], {
        type: "application/json",
      }),
      url = URL.createObjectURL(blob),
      anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `map-${mapId}-${resource}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };
  if (loading && !items.length) {
    return <div className="loading-state">正在读取{label}配置…</div>;
  }
  if (loadError && !items.length) {
    return (
      <ErrorState
        title={`${label}配置读取失败`}
        description={loadError}
        onRetry={load}
      />
    );
  }
  return (
    <>
      {loadError && (
        <InlineAlert
          tone="danger"
          title={`${label}配置刷新失败`}
          description={`${loadError}；当前仍显示上一次成功读取的数据。`}
          action={<Button onClick={load}>重新尝试</Button>}
        />
      )}
      <div className="module-toolbar">
        <span className="result-count">
          {items.length} 条{label}配置
        </span>
        <div className="section-actions">
          <Button icon={Download} onClick={exportRows}>
            导出 JSON
          </Button>
          <Button variant="primary" icon={Plus} onClick={startCreate}>
            添加{label}
          </Button>
        </div>
      </div>
      {items.length ? (
        <div className="table-shell">
          <table className="data-table">
            <thead>
              <tr>
                {!isAnchor && <th>埋点 Key</th>}
                <th>{label}名称</th>
                <th>状态</th>
                {isAnchor ? <th>礼包配置</th> : <th>触发次数</th>}
                <th>更新时间</th>
                <th className="align-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  {!isAnchor && (
                    <td>
                      <code>{item.pointKey}</code>
                    </td>
                  )}
                  <td>
                    <strong>{item.name}</strong>
                  </td>
                  <td>
                    <Badge tone={item.enabled ? "positive" : "neutral"}>
                      {item.enabled ? "启用" : "禁用"}
                    </Badge>
                  </td>
                  <td>
                    {isAnchor
                      ? `${Object.keys(item.giftConfig || {}).length} 项`
                      : formatNumber(item.triggerCount)}
                  </td>
                  <td className="muted-cell">{formatDate(item.updatedAt)}</td>
                  <td className="align-right">
                    <button
                      className="table-action"
                      onClick={() =>
                        setEditing(
                          isAnchor
                            ? {
                                ...item,
                                giftConfigText: JSON.stringify(
                                  item.giftConfig || {},
                                  null,
                                  2,
                                ),
                              }
                            : { ...item },
                        )
                      }
                    >
                      <Edit3 size={14} />
                      编辑
                    </button>
                    <button
                      className="table-action danger"
                      onClick={() => remove(item)}
                    >
                      <Trash2 size={14} />
                      删除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState
          icon={isAnchor ? RadioTower : Activity}
          title={`当前地图暂无${label}`}
          description={`点击“添加${label}”创建第一条配置。`}
        />
      )}
      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={`${editing?.id ? "编辑" : "添加"}${label}`}
        eyebrow={isAnchor ? "ANCHOR" : "TRACKING POINT"}
        footer={
          <>
            <Button onClick={() => setEditing(null)}>取消</Button>
            <Button
              variant="primary"
              onClick={save}
              disabled={!editing?.name || (!isAnchor && !editing?.pointKey)}
            >
              保存
            </Button>
          </>
        }
      >
        {editing && (
          <>
            {!isAnchor && (
              <Field label="埋点 Key">
                <input
                  className="input"
                  value={editing.pointKey}
                  onChange={(event) =>
                    setEditing({ ...editing, pointKey: event.target.value })
                  }
                />
              </Field>
            )}
            <Field label={`${label}名称`}>
              <input
                className="input"
                value={editing.name}
                onChange={(event) =>
                  setEditing({ ...editing, name: event.target.value })
                }
              />
            </Field>
            <Field label="启用状态">
              <Switch
                checked={editing.enabled}
                onChange={(value) => setEditing({ ...editing, enabled: value })}
                label={editing.enabled ? "启用" : "禁用"}
              />
            </Field>
            {isAnchor && (
              <Field label="礼包配置 JSON">
                <textarea
                  className="input"
                  rows="5"
                  value={editing.giftConfigText}
                  onChange={(event) =>
                    setEditing({
                      ...editing,
                      giftConfigText: event.target.value,
                    })
                  }
                />
              </Field>
            )}
          </>
        )}
      </Modal>
    </>
  );
}

export function LogsPanel({ mapId, can }) {
  const [logs, setLogs] = useState([]),
    [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const confirmAction = useConfirm(),
    toast = useToast(),
    canDelete = can("map.edit");
  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      setLogs(await api(`/api/maps/${mapId}/logs?limit=100`));
    } catch (error) {
      setLoadError(error.message);
    } finally {
      setLoading(false);
    }
  }, [mapId]);
  useEffect(() => {
    load();
  }, [load]);
  const remove = async (item) => {
    if (
      !(await confirmAction({
        title: "删除运行日志",
        description: "确认删除这条聚合日志？",
        detail: `该日志累计上传 ${formatNumber(item.uploadCount)} 次，删除后无法恢复。`,
        confirmLabel: "确认删除",
      }))
    )
      return;
    try {
      await api(`/api/maps/${mapId}/logs/${item.id}`, {
        method: "DELETE",
      });
      toast("日志已删除");
      load();
    } catch (error) {
      toast(error.message, "danger");
    }
  };
  if (loading && !logs.length) {
    return <div className="loading-state">正在读取运行日志…</div>;
  }
  if (loadError && !logs.length) {
    return (
      <ErrorState
        title="运行日志读取失败"
        description={loadError}
        onRetry={load}
      />
    );
  }
  return (
    <>
      {loadError && (
        <InlineAlert
          tone="danger"
          title="运行日志刷新失败"
          description={`${loadError}；当前仍显示上一次成功读取的数据。`}
          action={<Button onClick={load}>重新尝试</Button>}
        />
      )}
      <div className="module-toolbar">
        <div className="api-inline">
          <span>GAME CLIENT API</span>
          <code>POST /api/fq/logs</code>
          <small>需要 game.logs.write 权限</small>
        </div>
        <Button icon={RefreshCw} onClick={load} disabled={loading}>
          {loading ? "刷新中…" : "刷新"}
        </Button>
      </div>
      {logs.length ? (
        <div className="table-shell">
          <table className="data-table">
            <thead>
              <tr>
                <th>日志内容</th>
                <th>上传人数</th>
                <th>上传次数</th>
                <th>更新时间</th>
                <th className="align-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((item) => (
                <tr key={item.id}>
                  <td>
                    <code className="log-code">{item.context}</code>
                  </td>
                  <td>{formatNumber(item.playerCount)}</td>
                  <td>{formatNumber(item.uploadCount)}</td>
                  <td>{formatDate(item.updatedAt)}</td>
                  <td className="align-right">
                    <button
                      className="table-action"
                      onClick={() => setDetail(item)}
                    >
                      <Eye size={14} />
                      查看
                    </button>
                    {canDelete && (
                      <button
                        className="table-action danger"
                        onClick={() => remove(item)}
                      >
                        <Trash2 size={14} />
                        删除
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState
          icon={FileArchive}
          title="暂无运行日志"
          description="游戏客户端上报后会自动按相同内容聚合。"
        />
      )}
      <Modal
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        title="日志详情"
        eyebrow="LOG DETAIL"
        wide
      >
        <pre className="log-detail">{detail?.context}</pre>
      </Modal>
    </>
  );
}

export function FilesPanel({ mapId }) {
  const [items, setItems] = useState([]),
    [folder, setFolder] = useState(""),
    [folderOpen, setFolderOpen] = useState(false),
    [folderName, setFolderName] = useState(""),
    [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [loadedFolder, setLoadedFolder] = useState(null);
  const inputRef = useRef(null),
    confirmAction = useConfirm(),
    toast = useToast();
  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const nextItems = await api(
        `/api/maps/${mapId}/files?folder=${encodeURIComponent(folder)}`,
      );
      setItems(nextItems);
      setLoadedFolder(folder);
    } catch (error) {
      setLoadError(error.message);
    } finally {
      setLoading(false);
    }
  }, [mapId, folder]);
  useEffect(() => {
    load();
  }, [load]);
  const uploadFiles = async (files) => {
    if (!files?.length) return;
    const form = new FormData();
    [...files].forEach((file) => form.append("files", file));
    setUploading(true);
    try {
      await api(
        `/api/maps/${mapId}/files/upload?folder=${encodeURIComponent(folder)}`,
        { method: "POST", body: form },
      );
      toast("文件上传完成");
      load();
    } catch (error) {
      toast(error.message, "danger");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };
  const createFolder = async () => {
    try {
      await api(`/api/maps/${mapId}/files/folder`, {
        method: "POST",
        body: { name: folderName, parent: folder },
      });
      setFolderOpen(false);
      setFolderName("");
      toast("文件夹已创建");
      load();
    } catch (error) {
      toast(error.message, "danger");
    }
  };
  const remove = async (item) => {
    if (
      !(await confirmAction({
        title: item.kind === "folder" ? "删除文件夹" : "删除文件",
        description: `确认删除“${item.name}”${item.kind === "folder" ? "及其全部内容" : ""}？`,
        detail:
          item.kind === "folder"
            ? "文件夹内的全部文件和子目录都会一并删除，无法撤销。"
            : "文件删除后无法从后台恢复。",
        confirmLabel: "确认删除",
      }))
    )
      return;
    try {
      await api(`/api/maps/${mapId}/files/${item.id}`, { method: "DELETE" });
      toast("已删除");
      load();
    } catch (error) {
      toast(error.message, "danger");
    }
  };
  const openItem = (item) =>
    item.kind === "folder"
      ? setFolder(item.relativePath)
      : download(
          `/api/maps/${mapId}/files/${item.id}/download`,
          item.name,
        ).catch((error) => toast(error.message, "danger"));
  const parent = folder.includes("/")
    ? folder.slice(0, folder.lastIndexOf("/"))
    : "";
  const hasCurrentFolderData = loadedFolder === folder;
  if (loading && !hasCurrentFolderData) {
    return <div className="loading-state">正在读取文件目录…</div>;
  }
  if (loadError && !hasCurrentFolderData) {
    return (
      <ErrorState
        title="文件目录读取失败"
        description={loadError}
        onRetry={load}
      />
    );
  }
  return (
    <>
      {loadError && (
        <InlineAlert
          tone="danger"
          title="文件目录刷新失败"
          description={`${loadError}；当前仍显示上一次成功读取的数据。`}
          action={<Button onClick={load}>重新尝试</Button>}
        />
      )}
      <div
        className="file-drop-banner"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          uploadFiles(event.dataTransfer.files);
        }}
      >
        <CloudUpload size={22} />
        <div>
          <strong>拖入文件即可上传</strong>
          <small>单文件上限由服务器 UPLOAD_MAX_MB 配置，禁止可执行脚本。</small>
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          onChange={(event) => uploadFiles(event.target.files)}
        />
        <Button
          variant="primary"
          icon={Upload}
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? "正在上传…" : "上传文件"}
        </Button>
      </div>
      <div className="file-toolbar">
        <div className="folder-crumb">
          <Folder size={15} />
          <strong>根目录</strong>
          {folder && (
            <>
              <ArrowUpRight size={14} />
              <span>{folder}</span>
            </>
          )}
        </div>
        <div className="section-actions">
          <Button icon={FolderPlus} onClick={() => setFolderOpen(true)}>
            新建文件夹
          </Button>
          <Button
            icon={ArrowLeft}
            onClick={() => setFolder(parent)}
            disabled={!folder}
          >
            返回上级
          </Button>
          <Button icon={RefreshCw} onClick={load} disabled={loading}>
            {loading ? "刷新中…" : "刷新列表"}
          </Button>
        </div>
      </div>
      {items.length ? (
        <div className="file-grid">
          {items.map((item) => {
            const Icon =
              item.kind === "folder"
                ? Folder
                : item.mimeType?.includes("image")
                  ? FileImage
                  : item.mimeType?.includes("json")
                    ? FileJson
                    : File;
            return (
              <article key={item.id} className="file-item">
                <button className="file-open" onClick={() => openItem(item)}>
                  <div className={`file-icon file-${item.kind}`}>
                    <Icon size={26} />
                  </div>
                  <div className="file-copy">
                    <strong>{item.name}</strong>
                    <span>
                      {item.kind === "folder"
                        ? "文件夹"
                        : formatBytes(item.sizeBytes)}{" "}
                      · {formatDate(item.updatedAt)}
                    </span>
                  </div>
                </button>
                <button aria-label="删除" onClick={() => remove(item)}>
                  <Trash2 size={16} />
                </button>
              </article>
            );
          })}
        </div>
      ) : (
        <EmptyState
          icon={Folder}
          title="当前目录为空"
          description="上传文件或创建文件夹后会显示在这里。"
        />
      )}
      <Modal
        open={folderOpen}
        onClose={() => setFolderOpen(false)}
        title="新建文件夹"
        eyebrow="NEW FOLDER"
        footer={
          <>
            <Button onClick={() => setFolderOpen(false)}>取消</Button>
            <Button
              variant="primary"
              onClick={createFolder}
              disabled={!folderName.trim()}
            >
              创建
            </Button>
          </>
        }
      >
        <Field label="文件夹名称" hint="名称不能包含路径分隔符">
          <input
            className="input"
            value={folderName}
            onChange={(event) => setFolderName(event.target.value)}
          />
        </Field>
      </Modal>
    </>
  );
}

const apiPermissionLabels = {
  "game.players.write": "写入玩家",
  "game.archives.read": "读取存档",
  "game.archives.write": "写入存档",
  "game.logs.write": "上报日志",
  "game.metrics.write": "上报指标",
  "game.points.write": "写入埋点",
  "game.leaderboards.read": "读取排行榜",
  "game.leaderboards.write": "写入排行榜",
  "game.risk.write": "上报风险事件",
  "game.messages.read": "读取消息",
  "game.gifts.read": "领取礼包",
};

export function ApiKeysPanel({ mapId }) {
  const [keys, setKeys] = useState([]),
    [open, setOpen] = useState(false),
    [detail, setDetail] = useState(null),
    [loadingKeyId, setLoadingKeyId] = useState(null),
    [copyingKeyId, setCopyingKeyId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [form, setForm] = useState({ name: "", permissions: [] }),
    confirmAction = useConfirm(),
    toast = useToast();
  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      setKeys(await api(`/api/maps/${mapId}/api-keys`));
    } catch (error) {
      setLoadError(error.message);
    } finally {
      setLoading(false);
    }
  }, [mapId]);
  useEffect(() => {
    load();
  }, [load]);
  const create = async () => {
    try {
      const key = await api(`/api/maps/${mapId}/api-keys`, {
        method: "POST",
        body: form,
      });
      setDetail(key);
      setOpen(false);
      setForm({ name: "", permissions: [] });
      load();
    } catch (error) {
      toast(error.message, "danger");
    }
  };
  const view = async (key) => {
    setLoadingKeyId(key.id);
    try {
      setDetail(await api(`/api/maps/${mapId}/api-keys/${key.id}`));
    } catch (error) {
      toast(error.message, "danger");
    } finally {
      setLoadingKeyId(null);
    }
  };
  const copy = async (key) => {
    if (!key.token_available) {
      toast("此 Key 创建于可查看功能上线前，无法复制完整 Token", "danger");
      return;
    }
    setCopyingKeyId(key.id);
    try {
      const current =
        detail?.id === key.id
          ? detail
          : await api(`/api/maps/${mapId}/api-keys/${key.id}`);
      if (!current.token) throw new Error("此 API Key 没有可复制的完整 Token");
      if (!navigator.clipboard) throw new Error("当前浏览器不支持剪切板复制");
      await navigator.clipboard.writeText(current.token);
      toast("API Key 已复制");
    } catch (error) {
      toast(error.message, "danger");
    } finally {
      setCopyingKeyId(null);
    }
  };
  const disable = async (key) => {
    if (
      !(await confirmAction({
        title: "停用 API Key",
        description: `确认停用 API Key“${key.name}”？`,
        detail: "使用该 Token 的游戏客户端会立即失去接口访问权限。",
        confirmLabel: "确认停用",
      }))
    )
      return;
    try {
      await api(`/api/maps/${mapId}/api-keys/${key.id}`, { method: "DELETE" });
      toast("API Key 已停用");
      load();
    } catch (error) {
      toast(error.message, "danger");
    }
  };
  if (loading && !keys.length) {
    return <div className="loading-state">正在读取 API Key…</div>;
  }
  if (loadError && !keys.length) {
    return (
      <ErrorState
        title="API Key 读取失败"
        description={loadError}
        onRetry={load}
      />
    );
  }
  return (
    <>
      {loadError && (
        <InlineAlert
          tone="danger"
          title="API Key 刷新失败"
          description={`${loadError}；当前仍显示上一次成功读取的数据。`}
          action={<Button onClick={load}>重新尝试</Button>}
        />
      )}
      <div className="module-toolbar">
        <div className="api-inline">
          <span>HEADER</span>
          <code>FQ-Map-Key: fqmap_...</code>
          <small>可随时查看详情或复制完整 Token</small>
        </div>
        <Button variant="primary" icon={KeyRound} onClick={() => setOpen(true)}>
          创建 API Key
        </Button>
      </div>
      {keys.length ? (
        <div className="table-shell">
          <table className="data-table">
            <thead>
              <tr>
                <th>名称</th>
                <th>Token</th>
                <th>接口权限</th>
                <th>最后使用</th>
                <th>状态</th>
                <th className="align-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {keys.map((key) => (
                <tr key={key.id}>
                  <td>
                    <strong>{key.name}</strong>
                  </td>
                  <td>
                    <div className="token-cell">
                      <code>{key.token_prefix}…</code>
                      <button
                        className="icon-button token-copy-button"
                        type="button"
                        onClick={() => copy(key)}
                        disabled={
                          !key.token_available || copyingKeyId === key.id
                        }
                        title={
                          key.token_available
                            ? "复制完整 Token"
                            : "旧 Key 未保存可恢复密文"
                        }
                        aria-label={`复制 ${key.name} 的完整 Token`}
                      >
                        <Clipboard size={13} />
                      </button>
                    </div>
                  </td>
                  <td>
                    {key.permissions
                      .map((permission) => apiPermissionLabels[permission])
                      .join("、")}
                  </td>
                  <td>{formatDate(key.last_used_at)}</td>
                  <td>
                    <Badge
                      tone={key.status === "active" ? "positive" : "neutral"}
                    >
                      {key.status === "active" ? "有效" : "已停用"}
                    </Badge>
                  </td>
                  <td className="align-right">
                    <button
                      className="table-action"
                      type="button"
                      onClick={() => view(key)}
                      disabled={loadingKeyId === key.id}
                    >
                      <Eye size={14} />
                      {loadingKeyId === key.id ? "加载中" : "查看详情"}
                    </button>
                    {key.status === "active" && (
                      <button
                        className="table-action danger"
                        onClick={() => disable(key)}
                      >
                        <Trash2 size={14} />
                        停用
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState
          icon={FileKey2}
          title="还没有游戏客户端 API Key"
          description="按最小权限原则为地图创建独立 Key。"
        />
      )}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="创建游戏客户端 API Key"
        eyebrow="CLIENT CREDENTIAL"
        footer={
          <>
            <Button onClick={() => setOpen(false)}>取消</Button>
            <Button
              variant="primary"
              onClick={create}
              disabled={!form.name || !form.permissions.length}
            >
              创建
            </Button>
          </>
        }
      >
        <Field label="名称">
          <input
            className="input"
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            placeholder="例如 地图游戏服务器"
          />
        </Field>
        <div className="permission-grid">
          {Object.entries(apiPermissionLabels).map(([value, label]) => (
            <label key={value}>
              <input
                type="checkbox"
                checked={form.permissions.includes(value)}
                onChange={() =>
                  setForm({
                    ...form,
                    permissions: form.permissions.includes(value)
                      ? form.permissions.filter((item) => item !== value)
                      : [...form.permissions, value],
                  })
                }
              />
              <span>
                <Check size={14} />
                {label}
                <code>{value}</code>
              </span>
            </label>
          ))}
        </div>
      </Modal>
      <Modal
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        title="API Key 详情"
        eyebrow="CLIENT TOKEN"
        footer={
          detail?.token_available ? (
            <Button
              variant="primary"
              icon={Clipboard}
              onClick={() => copy(detail)}
              disabled={copyingKeyId === detail?.id}
            >
              {copyingKeyId === detail?.id ? "复制中…" : "复制 Token"}
            </Button>
          ) : (
            <Button onClick={() => setDetail(null)}>关闭</Button>
          )
        }
      >
        <div className="token-detail-grid">
          <div>
            <span>名称</span>
            <strong>{detail?.name}</strong>
          </div>
          <div>
            <span>状态</span>
            <strong>{detail?.status === "active" ? "有效" : "已停用"}</strong>
          </div>
          <div>
            <span>最后使用</span>
            <strong>{formatDate(detail?.last_used_at)}</strong>
          </div>
        </div>
        <div className="token-detail-permissions">
          <span>接口权限</span>
          <p>
            {detail?.permissions
              ?.map(
                (permission) => apiPermissionLabels[permission] || permission,
              )
              .join("、")}
          </p>
        </div>
        {detail?.token_available ? (
          <>
            <p className="modal-intro">
              完整 Token 由服务端加密保存，仅在具备 API Key 管理权限时解密查看。
            </p>
            <div className="secret-token-row">
              <code className="secret-token">{detail?.token}</code>
              <button
                className="icon-button"
                type="button"
                onClick={() => copy(detail)}
                disabled={copyingKeyId === detail?.id}
                title="复制完整 Token"
                aria-label="复制完整 Token"
              >
                <Clipboard size={16} />
              </button>
            </div>
          </>
        ) : (
          <p className="warning-note">
            此 Key 创建于可查看功能上线前，当时数据库只保存哈希，无法恢复完整
            Token。请创建新 Key 并在客户端切换后停用旧 Key。
          </p>
        )}
      </Modal>
    </>
  );
}
