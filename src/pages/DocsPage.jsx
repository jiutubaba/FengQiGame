import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Braces,
  Check,
  Clipboard,
  Code2,
  FileClock,
  Search,
  Sparkles,
} from "lucide-react";
import {
  Badge,
  Button,
  EmptyState,
  SectionHead,
  useToast,
} from "../components/ui";

function safeText(value) {
  if (value == null) return "—";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

function ApiDetail({ module, api, onBack }) {
  const toast = useToast();
  const params = Array.isArray(api.params) ? api.params : [];
  const returnValue = api.return_value || api.returns || "无返回值";
  const callTemplate = `${api.is_async ? "await " : ""}japi.${api.name}(${params.map((param) => param.name || param.key || "value").join(", ")})`;
  return (
    <div className="doc-detail page-enter">
      <button className="doc-back" onClick={onBack}>
        <ArrowLeft size={15} />
        返回函数列表
      </button>
      <div className="doc-detail-hero">
        <div>
          <span className="eyebrow">{module.name} · API REFERENCE</span>
          <h1>{api.name}</h1>
          <div>
            <Badge tone={api.is_async ? "warning" : "positive"}>
              {api.is_async ? "ASYNC" : "SYNC"}
            </Badge>
            <code>{api.id}</code>
          </div>
        </div>
        <Button
          icon={Clipboard}
          onClick={() => {
            navigator.clipboard?.writeText(callTemplate);
            toast("调用模板已复制");
          }}
        >
          复制调用
        </Button>
      </div>
      <p className="doc-description">{api.desc || "该接口暂无补充说明。"}</p>
      <section className="doc-code-block">
        <div>
          <span>Lua 调用模板</span>
          <button onClick={() => navigator.clipboard?.writeText(callTemplate)}>
            <Clipboard size={14} />
            复制
          </button>
        </div>
        <pre>
          <code>{callTemplate}</code>
        </pre>
      </section>
      <section className="doc-param-section">
        <div className="subsection-head">
          <div>
            <span className="eyebrow">PARAMETERS · {params.length}</span>
            <h3>参数</h3>
          </div>
        </div>
        {params.length ? (
          <div className="param-list">
            {params.map((param, index) => (
              <div key={`${param.name}-${index}`}>
                <code>{param.name || param.key || `arg${index + 1}`}</code>
                <Badge>{param.type || param.value_type || "any"}</Badge>
                <span>{param.desc || param.description || "—"}</span>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState icon={Braces} title="该函数不需要参数" />
        )}
      </section>
      <section className="doc-return">
        <span className="eyebrow">RETURNS</span>
        <h3>返回值</h3>
        <pre>{safeText(returnValue)}</pre>
      </section>
    </div>
  );
}

export default function DocsPage() {
  const [view, setView] = useState("functions");
  const [docs, setDocs] = useState(null);
  const [home, setHome] = useState(null);
  const [lua, setLua] = useState(null);
  const [changes, setChanges] = useState(null);
  const [moduleId, setModuleId] = useState("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(null);
  useEffect(() => {
    Promise.all([
      fetch("/data/xyplugin-docs.json").then((response) => response.json()),
      fetch("/data/xyplugin-home.json").then((response) => response.json()),
      fetch("/data/xyplugin-lua.json").then((response) => response.json()),
      fetch("/data/xyplugin-changelog.json").then((response) =>
        response.json(),
      ),
    ]).then(([docsData, homeData, luaData, changesData]) => {
      setDocs(docsData.data);
      setHome(homeData.data);
      setLua(luaData.data);
      setChanges(changesData.data);
    });
  }, []);

  const apiRows = useMemo(() => {
    if (!docs) return [];
    return docs.modules
      .flatMap((module) => module.apis.map((api) => ({ module, api })))
      .filter(
        ({ module, api }) =>
          (moduleId === "all" || module.id === moduleId) &&
          (!query ||
            api.name.toLowerCase().includes(query.toLowerCase()) ||
            (api.desc || "").toLowerCase().includes(query.toLowerCase())),
      );
  }, [docs, moduleId, query]);

  if (!docs || !home || !lua || !changes)
    return <div className="loading-block">正在载入 JAPI 接口文档…</div>;
  if (selected)
    return (
      <ApiDetail
        module={selected.module}
        api={selected.api}
        onBack={() => setSelected(null)}
      />
    );

  return (
    <div className="docs-page page-enter">
      <div className="docs-masthead">
        <div>
          <span className="docs-brand-mark">XY</span>
          <span>
            <strong>XYPlugin</strong>
            <small>FUNCTION REFERENCE</small>
          </span>
        </div>
        <nav>
          {[
            ["home", "插件主页"],
            ["functions", "函数索引"],
            ["lua", "Lua 引擎"],
            ["changelog", "更新日志"],
          ].map(([id, label]) => (
            <button
              key={id}
              className={view === id ? "active" : ""}
              onClick={() => setView(id)}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="docs-count">
          <span>{docs.moduleCount} 模块</span>
          <span>{docs.apiCount} 函数</span>
        </div>
      </div>
      {view === "home" && (
        <div className="docs-home">
          <section className="docs-home-hero">
            <span className="eyebrow">PLUGIN HOME</span>
            <h1>{home.home.title}</h1>
            <p>{home.home.subtitle}</p>
            <div className="docs-stats">
              <div>
                <strong>{home.home.stats.api_count}</strong>
                <span>JAPI 函数</span>
              </div>
              <div>
                <strong>{home.home.stats.module_count}</strong>
                <span>函数模块</span>
              </div>
              <div>
                <strong>{home.home.stats.lua_module_count}</strong>
                <span>Lua 模块</span>
              </div>
            </div>
          </section>
          <section className="docs-release-copy">
            <div>
              <span className="eyebrow">CURRENT RELEASE</span>
              <h2>运行能力与更新摘要</h2>
            </div>
            <pre>{home.home.desc}</pre>
          </section>
        </div>
      )}

      {view === "functions" && (
        <>
          <section className="docs-index-hero">
            <span className="eyebrow">JAPI · LIVING REFERENCE</span>
            <h1>
              一份会呼吸的
              <br />
              <em>接口档案</em>
            </h1>
            <p>按模块浏览全部 JAPI 函数；每一次调用都应当可被追溯。</p>
          </section>
          <div className="docs-browser">
            <aside className="doc-module-list">
              <div>
                <strong>模块分类</strong>
                <span>{docs.moduleCount} 项</span>
              </div>
              <button
                className={moduleId === "all" ? "active" : ""}
                onClick={() => setModuleId("all")}
              >
                <span>全部函数</span>
                <b>{docs.apiCount}</b>
              </button>
              {docs.modules.map((module) => (
                <button
                  key={module.id}
                  className={moduleId === module.id ? "active" : ""}
                  onClick={() => setModuleId(module.id)}
                >
                  <span>{module.name}</span>
                  <b>{module.count}</b>
                </button>
              ))}
            </aside>
            <section className="doc-api-list">
              <div className="doc-api-head">
                <div>
                  <h2>
                    {moduleId === "all"
                      ? "全部函数"
                      : docs.modules.find((item) => item.id === moduleId)?.name}
                  </h2>
                  <p>当前显示 {apiRows.length} 个接口</p>
                </div>
                <div className="search-box">
                  <Search size={15} />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="搜索函数或说明"
                  />
                </div>
              </div>
              <div className="api-row-list">
                {apiRows.map(({ module, api }) => (
                  <button
                    key={`${module.id}-${api.id}`}
                    onClick={() => setSelected({ module, api })}
                  >
                    <span className="api-module">{module.name}</span>
                    <span className="api-name">
                      <strong>{api.name}</strong>
                      <small>{api.desc || "暂无说明"}</small>
                    </span>
                    {api.is_async && <Badge tone="warning">ASYNC</Badge>}
                    <ArrowRight size={15} />
                  </button>
                ))}
              </div>
            </section>
          </div>
        </>
      )}

      {view === "lua" && (
        <div className="lua-docs">
          <section className="lua-hero">
            <span className="eyebrow">
              LUA ENGINE · {lua.moduleCount} MODULES
            </span>
            <h1>Lua 引擎</h1>
            <p>{lua.home?.desc || "按 require 路径浏览运行时模块。"}</p>
          </section>
          <div className="lua-module-grid">
            {lua.modules.map((module) => (
              <article key={module.id}>
                <div>
                  <Code2 size={18} />
                  <code>require '{module.require_path}'</code>
                </div>
                <h3>{module.title || module.name}</h3>
                <p>{module.desc || "暂无模块说明。"}</p>
                {module.demo_code && (
                  <pre>
                    {module.demo_code.slice(0, 420)}
                    {module.demo_code.length > 420 ? "\n…" : ""}
                  </pre>
                )}
                <span>更新 {module.update_at?.slice(0, 10) || "—"}</span>
              </article>
            ))}
          </div>
        </div>
      )}

      {view === "changelog" && (
        <div className="changelog-docs">
          <section className="changelog-hero">
            <span className="eyebrow">VERSION HISTORY</span>
            <h1>{changes.title}</h1>
            <p>{changes.subtitle}</p>
          </section>
          <div className="changelog-list">
            {changes.releases.map((release, index) => (
              <article key={`${release.version}-${index}`}>
                <div className="change-version">
                  <span>{release.date}</span>
                  <h2>{release.version}</h2>
                  {release.tag && <Badge tone="positive">{release.tag}</Badge>}
                </div>
                <div className="change-content">
                  {release.note && <p>{release.note}</p>}
                  {(release.changes || []).map((change, itemIndex) => (
                    <div key={itemIndex}>
                      <Check size={15} />
                      <span>
                        {typeof change === "string"
                          ? change
                          : change.text ||
                            change.desc ||
                            JSON.stringify(change)}
                      </span>
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
