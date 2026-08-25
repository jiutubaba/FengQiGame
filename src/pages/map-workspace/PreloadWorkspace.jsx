import { useEffect, useMemo, useRef, useState } from "react";
import { indentWithTab } from "@codemirror/commands";
import {
  HighlightStyle,
  StreamLanguage,
  indentUnit,
  syntaxHighlighting,
} from "@codemirror/language";
import { lua as luaLegacyMode } from "@codemirror/legacy-modes/mode/lua";
import { lintGutter, setDiagnostics } from "@codemirror/lint";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { basicSetup } from "codemirror";
import {
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  FileCode2,
  Pencil,
  Plus,
  Trash2,
  Upload,
} from "lucide-react";
import {
  PRELOAD_CODE_LIMIT_BYTES,
  PRELOAD_ENTRY_PATH,
  normalizePreloadWorkspace,
  preloadWorkspaceDiagnostics,
  preloadWorkspaceErrors,
} from "../../../shared/preload-workspace.js";
import { Button, Field, Modal, useConfirm } from "../../components/ui";

const luaLanguage = StreamLanguage.define(luaLegacyMode);
const PRELOAD_EDITOR_MIN_HEIGHT = 240;
const PRELOAD_EDITOR_MAX_HEIGHT = 960;
const vscodeHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: "#c586c0" },
  { tag: [tags.bool, tags.null], color: "#569cd6" },
  { tag: tags.number, color: "#b5cea8" },
  { tag: [tags.string, tags.special(tags.string)], color: "#ce9178" },
  {
    tag: [tags.lineComment, tags.blockComment, tags.comment],
    color: "#6a9955",
  },
  { tag: [tags.function(tags.variableName), tags.labelName], color: "#dcdcaa" },
  {
    tag: [tags.definition(tags.variableName), tags.variableName],
    color: "#9cdcfe",
  },
  { tag: [tags.propertyName, tags.attributeName], color: "#9cdcfe" },
  { tag: [tags.typeName, tags.className], color: "#4ec9b0" },
  { tag: tags.operator, color: "#d4d4d4" },
  { tag: [tags.punctuation, tags.bracket], color: "#d4d4d4" },
  { tag: [tags.invalid, tags.meta], color: "#f44747" },
]);
const vscodeEditorTheme = EditorView.theme(
  {
    "&": {
      height: "100%",
      backgroundColor: "#1e1e1e",
      color: "#d4d4d4",
      fontSize: "13px",
    },
    "&.cm-focused": { outline: "none" },
    ".cm-scroller": {
      overflow: "auto",
      fontFamily: "var(--font-mono)",
      lineHeight: "22px",
    },
    ".cm-content": {
      minWidth: "max-content",
      padding: "14px 0 28px",
      caretColor: "#aeafad",
    },
    ".cm-line": { padding: "0 18px 0 8px" },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "#aeafad" },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
      {
        backgroundColor: "#264f78",
      },
    ".cm-activeLine": { backgroundColor: "#2a2d2e" },
    ".cm-gutters": {
      borderRight: "1px solid #333333",
      backgroundColor: "#1e1e1e",
      color: "#858585",
    },
    ".cm-gutterElement": { minWidth: "42px", padding: "0 10px 0 6px" },
    ".cm-activeLineGutter": { backgroundColor: "#2a2d2e", color: "#c6c6c6" },
    ".cm-foldGutter .cm-gutterElement": { minWidth: "18px", padding: "0 4px" },
    ".cm-lintRange-error": {
      textDecoration: "underline wavy #f14c4c 1px",
      textUnderlineOffset: "3px",
    },
    ".cm-lintRange-warning": {
      textDecoration: "underline wavy #cca700 1px",
      textUnderlineOffset: "3px",
    },
    ".cm-tooltip": {
      border: "1px solid #454545",
      backgroundColor: "#252526",
      color: "#e7e7e7",
    },
    ".cm-tooltip-lint": {
      padding: "7px 9px",
      fontFamily: "var(--font-ui)",
      fontSize: "12px",
    },
    ".cm-panels": { backgroundColor: "#252526", color: "#d4d4d4" },
    ".cm-searchMatch": { backgroundColor: "rgba(234, 201, 82, 0.28)" },
    ".cm-searchMatch.cm-searchMatch-selected": {
      backgroundColor: "rgba(81, 149, 212, 0.48)",
    },
  },
  { dark: true },
);

export default function PreloadWorkspace({
  workspace,
  onChange,
  editable,
  compiledBytes,
  overLimit,
}) {
  const [selectedFilePath, setSelectedFilePath] = useState(null);
  const [nodeDialog, setNodeDialog] = useState(null);
  const [nodeError, setNodeError] = useState("");
  const [importError, setImportError] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [editorHeight, setEditorHeight] = useState(defaultEditorHeight);
  const [editorCursor, setEditorCursor] = useState({ line: 1, column: 1 });
  const editorViewRef = useRef(null);
  const editorFrameRef = useRef(null);
  const editorResizeRef = useRef(null);
  const fileInputRef = useRef(null);
  const confirmAction = useConfirm();
  const selectedFile = workspace.files.find(
    (file) => file.path === selectedFilePath,
  );
  const [workspaceDiagnostics, setWorkspaceDiagnostics] = useState(() =>
    preloadWorkspaceDiagnostics(workspace),
  );
  const selectedDiagnostics = useMemo(
    () =>
      selectedFile
        ? workspaceDiagnostics.filter(
            (diagnostic) => diagnostic.path === selectedFile.path,
          )
        : [],
    [selectedFile, workspaceDiagnostics],
  );
  const firstSelectedDiagnostic = selectedDiagnostics[0];

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setWorkspaceDiagnostics(preloadWorkspaceDiagnostics(workspace));
    }, 260);
    return () => window.clearTimeout(timeout);
  }, [workspace]);

  useEffect(() => {
    if (selectedFilePath && !selectedFile) {
      setSelectedFilePath(null);
    }
  }, [selectedFile, selectedFilePath]);

  const items = useMemo(() => {
    return workspace.files.map((file) => ({
      path: file.path,
      name: baseName(file.path),
      sizeBytes: new TextEncoder().encode(file.content).byteLength,
      diagnosticCount: workspaceDiagnostics.filter(
        (diagnostic) => diagnostic.path === file.path,
      ).length,
    }));
  }, [workspace.files, workspaceDiagnostics]);
  const sourceBytes = items.reduce((sum, item) => sum + item.sizeBytes, 0);

  const updateFile = (content) => {
    onChange(
      normalizePreloadWorkspace({
        ...workspace,
        files: workspace.files.map((file) =>
          file.path === selectedFilePath ? { ...file, content } : file,
        ),
      }),
    );
  };

  const openCreate = () => {
    setNodeError("");
    setNodeDialog({
      mode: "create",
      sourcePath: "",
      value: "",
    });
  };

  const openRename = (sourcePath) => {
    setNodeError("");
    setNodeDialog({ mode: "rename", sourcePath, value: baseName(sourcePath) });
  };

  const submitNode = () => {
    const targetPath = nodeDialog.value.trim();
    if (targetPath.includes("/") || targetPath.includes("\\")) {
      setNodeError("这里只使用根目录，请直接填写 Lua 文件名");
      return;
    }
    const next =
      nodeDialog.mode === "create"
        ? {
            ...workspace,
            files: [...workspace.files, { path: targetPath, content: "" }],
          }
        : {
            ...workspace,
            files: workspace.files.map((file) =>
              file.path === nodeDialog.sourcePath
                ? { ...file, path: targetPath }
                : file,
            ),
          };
    const normalized = normalizePreloadWorkspace(next);
    const error = preloadWorkspaceErrors(normalized)[0];
    if (error) {
      setNodeError(error);
      return;
    }
    onChange(normalized);
    setNodeDialog(null);
    setSelectedFilePath(targetPath);
  };

  const deleteFile = async (path) => {
    if (
      !(await confirmAction({
        title: "删除文件",
        description: `确认删除“${path}”？`,
        detail: "删除后将在保存预加载代码时生效。",
        confirmLabel: "确认删除",
      }))
    ) {
      return;
    }
    const next = normalizePreloadWorkspace({
      ...workspace,
      files: workspace.files.filter((file) => file.path !== path),
    });
    onChange(next);
    if (selectedFilePath === path) {
      setSelectedFilePath(null);
    }
  };

  const importLuaFiles = async (fileList) => {
    const droppedFiles = [...fileList];
    if (!droppedFiles.length) return;
    const invalidFile = droppedFiles.find(
      (file) => !file.name.toLocaleLowerCase("en-US").endsWith(".lua"),
    );
    if (invalidFile) {
      setImportError(`只支持 .lua 文件：${invalidFile.name}`);
      return;
    }
    const existingPaths = new Set(
      workspace.files.map((file) => file.path.toLocaleLowerCase("en-US")),
    );
    const importedPaths = new Set();
    const duplicateFile = droppedFiles.find((file) => {
      const key = file.name.toLocaleLowerCase("en-US");
      if (existingPaths.has(key) || importedPaths.has(key)) return true;
      importedPaths.add(key);
      return false;
    });
    if (duplicateFile) {
      setImportError(`同名文件已存在：${duplicateFile.name}`);
      return;
    }
    try {
      const importedFiles = await Promise.all(
        droppedFiles.map(async (file) => ({
          path: file.name,
          content: await file.text(),
        })),
      );
      const normalized = normalizePreloadWorkspace({
        ...workspace,
        files: [...workspace.files, ...importedFiles],
      });
      const error = preloadWorkspaceErrors(normalized)[0];
      if (error) {
        setImportError(error);
        return;
      }
      onChange(normalized);
      setImportError("");
      setSelectedFilePath(importedFiles[0].path);
    } catch {
      setImportError("读取 Lua 文件失败，请重新选择文件");
    }
  };

  const focusFirstDiagnostic = () => {
    const diagnostic = firstSelectedDiagnostic;
    const view = editorViewRef.current;
    if (!diagnostic || !view) return;
    view.dispatch({
      selection: { anchor: diagnostic.from },
      effects: EditorView.scrollIntoView(diagnostic.from, { y: "center" }),
    });
    view.focus();
  };

  const startEditorResize = (event) => {
    if (event.button !== 0 || !editorFrameRef.current) return;
    editorResizeRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startHeight: editorFrameRef.current.getBoundingClientRect().height,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const resizeEditor = (event) => {
    const resize = editorResizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    setEditorHeight(
      clampEditorHeight(resize.startHeight + event.clientY - resize.startY),
    );
  };

  const finishEditorResize = (event) => {
    if (editorResizeRef.current?.pointerId !== event.pointerId) return;
    editorResizeRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const resizeEditorWithKeyboard = (event) => {
    const heightStep = event.shiftKey ? 80 : 24;
    const nextHeight = {
      ArrowUp: editorHeight - heightStep,
      ArrowDown: editorHeight + heightStep,
      Home: PRELOAD_EDITOR_MIN_HEIGHT,
      End: PRELOAD_EDITOR_MAX_HEIGHT,
    }[event.key];
    if (nextHeight === undefined) return;
    event.preventDefault();
    setEditorHeight(clampEditorHeight(nextHeight));
  };

  return (
    <div
      className={`preload-workspace${dragActive ? " is-dragging" : ""}`}
      onDragEnter={(event) => {
        event.preventDefault();
        if (editable) setDragActive(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setDragActive(false);
        }
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragActive(false);
        if (editable) importLuaFiles(event.dataTransfer.files);
      }}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept=".lua"
        multiple
        hidden
        onChange={(event) => {
          importLuaFiles(event.target.files);
          event.target.value = "";
        }}
      />
      {dragActive && editable && (
        <div className="preload-drop-overlay" aria-hidden="true">
          <Upload size={24} />
          <strong>松开即可导入到根目录</strong>
          <span>支持同时拖入多个 .lua 文件</span>
        </div>
      )}
      <div className="preload-repo-toolbar">
        <nav className="preload-breadcrumb" aria-label="预加载代码位置">
          <button type="button" onClick={() => setSelectedFilePath(null)}>
            <FileCode2 size={16} />
            preload
          </button>
          {selectedFile && (
            <span>
              <ChevronRight size={14} />
              <strong>{selectedFile.path}</strong>
            </span>
          )}
        </nav>
        {editable && (
          <div className="preload-repo-actions">
            <Button
              size="sm"
              icon={Upload}
              onClick={() => fileInputRef.current?.click()}
            >
              导入 Lua
            </Button>
            <Button size="sm" icon={Plus} onClick={openCreate}>
              新建文件
            </Button>
          </div>
        )}
      </div>

      {importError && (
        <div className="preload-import-error" role="alert">
          <CircleAlert size={15} />
          <span>{importError}</span>
          <button type="button" onClick={() => setImportError("")}>
            关闭
          </button>
        </div>
      )}

      {selectedFile ? (
        <div className="preload-file-editor">
          <div className="preload-file-head">
            <div>
              <FileCode2 size={17} />
              <strong>{selectedFile.path}</strong>
              {selectedFile.path === PRELOAD_ENTRY_PATH && (
                <span className="preload-entry-badge">入口</span>
              )}
            </div>
            <div>
              <button type="button" onClick={() => setSelectedFilePath(null)}>
                返回目录
              </button>
              {editable && selectedFile.path !== PRELOAD_ENTRY_PATH && (
                <>
                  <button
                    type="button"
                    onClick={() => openRename(selectedFile.path)}
                  >
                    <Pencil size={14} />
                    重命名
                  </button>
                  <button
                    type="button"
                    className="danger"
                    onClick={() => deleteFile(selectedFile.path)}
                  >
                    <Trash2 size={14} />
                    删除
                  </button>
                </>
              )}
            </div>
          </div>
          <div
            ref={editorFrameRef}
            className={`preload-code-frame${editable ? "" : " is-readonly"}`}
            style={{ height: `${editorHeight}px` }}
          >
            <LuaCodeEditor
              key={selectedFile.path}
              editorViewRef={editorViewRef}
              value={selectedFile.content}
              onChange={updateFile}
              editable={editable}
              label={`${selectedFile.path} Lua 代码编辑器`}
              diagnostics={selectedDiagnostics}
              onCursorChange={setEditorCursor}
            />
          </div>
          <div
            className="preload-editor-resizer"
            role="separator"
            aria-label="调整代码编辑器高度"
            aria-orientation="horizontal"
            aria-valuemin={PRELOAD_EDITOR_MIN_HEIGHT}
            aria-valuemax={PRELOAD_EDITOR_MAX_HEIGHT}
            aria-valuenow={Math.round(editorHeight)}
            tabIndex={0}
            title="上下拖动调整代码编辑器高度"
            onPointerDown={startEditorResize}
            onPointerMove={resizeEditor}
            onPointerUp={finishEditorResize}
            onPointerCancel={finishEditorResize}
            onKeyDown={resizeEditorWithKeyboard}
          >
            <span aria-hidden="true" />
          </div>
          <div
            className={`preload-editor-status${
              selectedDiagnostics.length ? " has-issues" : ""
            }`}
            aria-live="polite"
          >
            {selectedDiagnostics.length ? (
              <button
                type="button"
                title={firstSelectedDiagnostic.message}
                onClick={focusFirstDiagnostic}
              >
                <CircleAlert size={13} />
                {selectedDiagnostics.length} 个检查问题 · 第{" "}
                {firstSelectedDiagnostic.line} 行，第{" "}
                {firstSelectedDiagnostic.column} 列
              </button>
            ) : (
              <span>
                <CheckCircle2 size={13} />
                未发现语法或引用问题
              </span>
            )}
            <div>
              <span>
                Ln {editorCursor.line}, Col {editorCursor.column}
              </span>
              <span>Spaces: 2</span>
              <span>UTF-8</span>
              <strong>Lua</strong>
            </div>
          </div>
          <div className="preload-file-foot">
            <span>
              其他文件需由 <code>main.lua</code> 的{" "}
              <code>require("文件名.lua")</code> 链加载
            </span>
            <span>
              {formatBytes(
                new TextEncoder().encode(selectedFile.content).byteLength,
              )}
            </span>
          </div>
        </div>
      ) : (
        <div className="preload-file-browser">
          <div className="preload-list-head">
            <span>名称</span>
            <span>大小</span>
            <span aria-hidden="true" />
          </div>
          {items.map((item) => (
            <div className="preload-list-row" key={item.path}>
              <button
                type="button"
                className="preload-node-button"
                onClick={() => setSelectedFilePath(item.path)}
              >
                <FileCode2 size={17} />
                <span className="preload-node-name" title={item.path}>
                  {item.name}
                </span>
                {item.path === PRELOAD_ENTRY_PATH && (
                  <span className="preload-entry-badge">入口</span>
                )}
                {item.diagnosticCount > 0 && (
                  <span
                    className="preload-diagnostic-badge"
                    title={`${item.diagnosticCount} 个检查问题`}
                  >
                    <CircleAlert size={12} />
                    {item.diagnosticCount}
                  </span>
                )}
              </button>
              <span>{formatBytes(item.sizeBytes)}</span>
              <span className="preload-row-actions">
                {editable && item.path !== PRELOAD_ENTRY_PATH && (
                  <>
                    <button
                      type="button"
                      title="重命名"
                      aria-label={`重命名 ${item.path}`}
                      onClick={() => openRename(item.path)}
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      type="button"
                      className="danger"
                      title="删除"
                      aria-label={`删除 ${item.path}`}
                      onClick={() => deleteFile(item.path)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </>
                )}
              </span>
            </div>
          ))}
          {!items.length && (
            <div className="preload-empty-folder">
              <Upload size={22} />
              <strong>把 Lua 文件拖到这里</strong>
              {editable && (
                <Button size="sm" onClick={() => fileInputRef.current?.click()}>
                  选择 Lua 文件
                </Button>
              )}
            </div>
          )}
        </div>
      )}

      <div
        id="preload-code-size"
        className={`preload-workspace-status${overLimit ? " is-over-limit" : ""}${
          workspaceDiagnostics.length ? " has-diagnostics" : ""
        }`}
        title={`源码 ${sourceBytes} 字节，安全压缩后 ${compiledBytes} 字节`}
      >
        <span>
          根目录 · {workspace.files.length} 个 Lua 文件 ·{" "}
          {workspaceDiagnostics.length
            ? `${workspaceDiagnostics.length} 个检查问题`
            : "语法与引用检查通过"}
        </span>
        <strong>
          源码 {formatBytes(sourceBytes)} · 压缩后 {formatBytes(compiledBytes)}/
          {PRELOAD_CODE_LIMIT_BYTES / 1024} KB
        </strong>
      </div>

      <Modal
        open={Boolean(nodeDialog)}
        onClose={() => setNodeDialog(null)}
        title={nodeDialogTitle(nodeDialog)}
        eyebrow="PRELOAD WORKSPACE"
        footer={
          <>
            <Button onClick={() => setNodeDialog(null)}>取消</Button>
            <Button variant="primary" onClick={submitNode}>
              确认
            </Button>
          </>
        }
      >
        {nodeDialog && (
          <Field
            label="文件名"
            hint="文件会直接保存在 preload 根目录，只支持 .lua 扩展名。"
            error={nodeError}
          >
            <input
              className="input"
              value={nodeDialog.value}
              onChange={(event) => {
                setNodeError("");
                setNodeDialog({ ...nodeDialog, value: event.target.value });
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") submitNode();
              }}
              placeholder={"例如 优先炮击.lua"}
              autoFocus
            />
          </Field>
        )}
      </Modal>
    </div>
  );
}

function LuaCodeEditor({
  value,
  onChange,
  editable,
  label,
  editorViewRef,
  diagnostics,
  onCursorChange,
}) {
  const hostRef = useRef(null);
  const onChangeRef = useRef(onChange);
  const cursorRef = useRef(onCursorChange);
  const editableCompartmentRef = useRef(new Compartment());

  onChangeRef.current = onChange;
  cursorRef.current = onCursorChange;

  useEffect(() => {
    if (!hostRef.current) return undefined;
    const editableExtensions = editorExtensions(editable, label);
    const reportCursor = (view) => {
      const position = view.state.selection.main.head;
      const line = view.state.doc.lineAt(position);
      cursorRef.current({
        line: line.number,
        column: position - line.from + 1,
      });
    };
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          luaLanguage,
          indentUnit.of("  "),
          keymap.of([indentWithTab]),
          syntaxHighlighting(vscodeHighlightStyle),
          vscodeEditorTheme,
          lintGutter(),
          EditorState.tabSize.of(2),
          editableCompartmentRef.current.of(editableExtensions),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              onChangeRef.current(update.state.doc.toString());
            }
            if (update.selectionSet || update.docChanged) {
              reportCursor(update.view);
            }
          }),
        ],
      }),
    });
    editorViewRef.current = view;
    reportCursor(view);

    return () => {
      if (editorViewRef.current === view) editorViewRef.current = null;
      view.destroy();
    };
  }, []);

  useEffect(() => {
    const view = editorViewRef.current;
    if (!view) return;
    view.dispatch({
      effects: editableCompartmentRef.current.reconfigure(
        editorExtensions(editable, label),
      ),
    });
  }, [editable, editorViewRef, label]);

  useEffect(() => {
    const view = editorViewRef.current;
    if (!view) return;
    const currentValue = view.state.doc.toString();
    if (currentValue === value) return;
    view.dispatch({
      changes: { from: 0, to: currentValue.length, insert: value },
    });
  }, [editorViewRef, value]);

  useEffect(() => {
    const view = editorViewRef.current;
    if (view) view.dispatch(setDiagnostics(view.state, diagnostics));
  }, [diagnostics, editorViewRef]);

  return <div ref={hostRef} className="preload-code-editor" />;
}

function editorExtensions(editable, label) {
  return [
    EditorState.readOnly.of(!editable),
    EditorView.editable.of(editable),
    EditorView.contentAttributes.of({
      "aria-label": label,
      "aria-readonly": String(!editable),
      spellcheck: "false",
    }),
  ];
}

function nodeDialogTitle(dialog) {
  if (!dialog) return "";
  return dialog.mode === "rename" ? "重命名 Lua 文件" : "新建 Lua 文件";
}

function baseName(value) {
  return value.slice(value.lastIndexOf("/") + 1);
}

function formatBytes(value) {
  if (value < 1024) return `${value} B`;
  return `${(value / 1024).toFixed(value < 10 * 1024 ? 1 : 0)} KB`;
}

function defaultEditorHeight() {
  return typeof window !== "undefined" && window.innerWidth <= 760 ? 420 : 460;
}

function clampEditorHeight(value) {
  return Math.min(
    PRELOAD_EDITOR_MAX_HEIGHT,
    Math.max(PRELOAD_EDITOR_MIN_HEIGHT, Math.round(value)),
  );
}
