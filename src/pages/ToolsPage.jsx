import { useEffect, useMemo, useState } from "react";
import { Check, History, PackageOpen, Search } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { Badge, EmptyState, SectionHead } from "../components/ui";

function extractReleases(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const latest = {
    version:
      doc.querySelector(".hero-highlight-version")?.textContent.trim() || "—",
    meta: [...doc.querySelectorAll(".hero-highlight-meta")].map((item) =>
      item.textContent.trim(),
    ),
    file: doc.querySelector(".download-file")?.textContent.trim() || "",
    notes: [...doc.querySelectorAll(".note-item")].map((item) =>
      item.textContent.trim(),
    ),
  };
  const history = [...doc.querySelectorAll(".timeline-item")].map((item) => ({
    version: item.querySelector(".timeline-version")?.textContent.trim(),
    meta: [...item.querySelectorAll(".timeline-meta span")].map((node) =>
      node.textContent.trim(),
    ),
    notes: [...item.querySelectorAll(".timeline-note")].map((node) =>
      node.textContent.trim(),
    ),
  }));
  return { latest, history };
}

export default function ToolsPage() {
  const [params, setParams] = useSearchParams();
  const product = params.get("product") === "model" ? "model" : "xywe";
  const [data, setData] = useState(null);
  const [query, setQuery] = useState("");
  useEffect(() => {
    setData(null);
    fetch(
      product === "xywe"
        ? "/data/xywe-releases.html"
        : "/data/model-releases.html",
    )
      .then((response) => response.text())
      .then((html) => setData(extractReleases(html)));
  }, [product]);
  const filtered = useMemo(
    () =>
      data?.history.filter(
        (item) =>
          !query ||
          item.version.toLowerCase().includes(query.toLowerCase()) ||
          item.notes.some((note) => note.includes(query)),
      ) || [],
    [data, query],
  );
  const title = product === "xywe" ? "XYWE 版本更新" : "模型预览工具版本更新";
  return (
    <div className="page-stack page-enter">
      <SectionHead
        eyebrow="TOOL RELEASES"
        title={title}
        description="随项目部署的版本档案与历史发布记录；安装包需由管理员放入受控文件空间。"
      />
      <div className="product-switch">
        <button
          className={product === "xywe" ? "active" : ""}
          onClick={() => setParams({})}
        >
          XYWE 编辑器
        </button>
        <button
          className={product === "model" ? "active" : ""}
          onClick={() => setParams({ product: "model" })}
        >
          模型预览工具
        </button>
      </div>
      {!data ? (
        <div className="loading-block">正在读取版本档案…</div>
      ) : (
        <>
          <section className="latest-release">
            <div className="latest-release-copy">
              <span className="eyebrow">LATEST BUILD</span>
              <h2>{data.latest.version}</h2>
              <div>
                {data.latest.meta.map((item) => (
                  <span key={item}>{item}</span>
                ))}
              </div>
            </div>
            <div className="latest-file">
              <PackageOpen size={22} />
              <span>
                <small>安装包</small>
                <strong>{data.latest.file}</strong>
              </span>
            </div>
            <div className="latest-actions">
              <Badge tone="warning">安装包未托管</Badge>
            </div>
          </section>
          <div className="release-notes">
            <div className="subsection-head">
              <div>
                <span className="eyebrow">RELEASE NOTES</span>
                <h3>本次更新内容</h3>
              </div>
            </div>
            {data.latest.notes.length ? (
              data.latest.notes.map((note) => (
                <div key={note}>
                  <Check size={15} />
                  {note}
                </div>
              ))
            ) : (
              <p>当前版本未填写更新说明。</p>
            )}
          </div>
          <div className="history-head">
            <div>
              <span className="eyebrow">RELEASE HISTORY</span>
              <h3>
                历史版本记录 <Badge>{data.history.length} 个版本</Badge>
              </h3>
            </div>
            <div className="search-box">
              <Search size={15} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索版本或更新内容"
              />
            </div>
          </div>
          <div className="release-timeline">
            {filtered.map((release, index) => (
              <article key={`${release.version}-${index}`}>
                <div className="timeline-axis">
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <i />
                </div>
                <div className="release-row">
                  <div className="release-version">
                    <strong>{release.version}</strong>
                    {release.meta.slice(0, 4).map((item) => (
                      <span key={item}>{item}</span>
                    ))}
                  </div>
                  <div className="release-change-list">
                    {release.notes.length ? (
                      release.notes.map((note) => <p key={note}>{note}</p>)
                    ) : (
                      <p>维护版本，无额外说明。</p>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
          {!filtered.length && (
            <EmptyState
              icon={History}
              title="没有匹配的版本"
              description="尝试搜索其它版本号或关键词。"
            />
          )}
        </>
      )}
    </div>
  );
}
