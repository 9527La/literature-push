import { useCallback, useEffect, useRef, useState } from "react";
import { CalendarDays, ScrollText } from "lucide-react";
import { api } from "../../lib/api.js";
import { renderInlineMarkdown, renderMarkdown } from "../../lib/markdown.jsx";
import EmptyState from "../../components/EmptyState.jsx";

const DETAIL_TIMEOUT_MS = 20000;

/**
 * 每日资讯视图（PLAN-DAILY-NEWS.md）。
 * 数据：GET /api/daily-news（日期列表+各板块条数）、GET /api/daily-news/detail?date=（单日全文）。
 * Markdown 结构由定时任务按锁定模板生成：概览分组（`#N` 锚点）→ 逐条详情 → 免责声明。
 */
function parseDailyNewsMarkdown(markdown) {
  const result = { title: null, groups: [], sections: [], footer: "" };
  if (!markdown) return result;
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");

  let inOverview = false;
  let currentGroup = null;
  let currentSection = null;
  let inFooter = false;

  for (const line of lines) {
    if (result.title === null && /^#\s+/.test(line)) {
      result.title = line.replace(/^#\s+/, "").trim();
      continue;
    }
    if (/^##\s+概览\s*$/.test(line)) {
      inOverview = true;
      continue;
    }
    const sectionMatch = line.match(/^##\s+(.+)$/);
    if (sectionMatch && !/^##\s+概览\s*$/.test(line)) {
      inOverview = false;
      currentGroup = null;
      const rawTitle = sectionMatch[1].trim();
      const nMatch = rawTitle.match(/`#(\d+)`/);
      const n = nMatch ? Number(nMatch[1]) : null;
      currentSection = {
        n,
        title: rawTitle.replace(/`#\d+`/g, "").trim(),
        body: []
      };
      result.sections.push(currentSection);
      continue;
    }
    if (inFooter) {
      result.footer += (result.footer ? "\n" : "") + line.trim();
      continue;
    }
    if (/^\*\*提示\*\*/.test(line.trim())) {
      inFooter = true;
      result.footer = line.trim();
      continue;
    }
    if (inOverview) {
      const groupMatch = line.match(/^###\s+(.+)$/);
      if (groupMatch) {
        currentGroup = { name: groupMatch[1].trim(), items: [], note: "" };
        result.groups.push(currentGroup);
        continue;
      }
      const itemMatch = line.match(/^-\s+(.+)$/);
      if (itemMatch && currentGroup) {
        const raw = itemMatch[1].trim();
        const nMatch = raw.match(/`#(\d+)`/);
        currentGroup.items.push({
          n: nMatch ? Number(nMatch[1]) : null,
          text: raw.replace(/`#\d+`/g, "").trim()
        });
        continue;
      }
      if (currentGroup && line.trim() && !/^(-{3,}|\*\s*\*\s*\*)$/.test(line.trim())) {
        currentGroup.note = (currentGroup.note ? currentGroup.note + " " : "") + line.trim();
      }
      continue;
    }
    if (currentSection) {
      currentSection.body.push(line);
    }
  }

  for (const section of result.sections) {
    // 去掉条目首尾的 * * * / --- 分隔线（卡片化渲染后视觉上由卡片间距承担）
    while (section.body.length && /^\s*(\*\s*\*\s*\*|-{3,}|_{3,})\s*$/.test(section.body[0])) section.body.shift();
    while (section.body.length && /^\s*(\*\s*\*\s*\*|-{3,}|_{3,})\s*$/.test(section.body[section.body.length - 1])) section.body.pop();
    section.body = section.body.join("\n").trim();
  }
  return result;
}

function countByGroupName(parsed) {
  const map = new Map();
  for (const group of parsed.groups) map.set(group.name, group.items.length);
  return map;
}

export default function DailyNewsView() {
  const [list, setList] = useState(null);
  const [listError, setListError] = useState(null);
  const [selectedDate, setSelectedDate] = useState(null);
  const [parsed, setParsed] = useState(null);
  const [detailError, setDetailError] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [flashN, setFlashN] = useState(null);
  const detailRequestId = useRef(0);
  const flashTimer = useRef(null);

  useEffect(() => {
    let active = true;
    setListError(null);
    api
      .get("/api/daily-news")
      .then((data) => {
        if (!active) return;
        setList(data);
        if (data.items?.length) setSelectedDate(data.items[0].date);
      })
      .catch((error) => {
        if (active) setListError(error.message || "加载每日资讯失败");
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!selectedDate) return;
    const requestId = ++detailRequestId.current;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DETAIL_TIMEOUT_MS);
    setDetailLoading(true);
    setDetailError(null);
    api
      .get(`/api/daily-news/detail?date=${encodeURIComponent(selectedDate)}`, { signal: controller.signal })
      .then((data) => {
        if (detailRequestId.current !== requestId) return;
        setParsed(parseDailyNewsMarkdown(data.markdown || ""));
        setDetailLoading(false);
      })
      .catch((error) => {
        if (detailRequestId.current !== requestId) return;
        if (controller.signal.aborted) {
          setDetailError("加载超时，请稍后重试");
        } else {
          setDetailError(error.message || "加载失败");
        }
        setParsed(null);
        setDetailLoading(false);
      })
      .finally(() => clearTimeout(timer));
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [selectedDate]);

  useEffect(() => () => {
    if (flashTimer.current) clearTimeout(flashTimer.current);
  }, []);

  const jumpToItem = useCallback((n) => {
    if (n === null || n === undefined) return;
    const target = document.getElementById(`daily-item-${n}`);
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    setFlashN(n);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlashN(null), 1600);
  }, []);

  if (listError) {
    return (
      <EmptyState
        icon={ScrollText}
        title="每日资讯加载失败"
        description={listError}
        action={<button className="secondary" onClick={() => window.location.reload()}>重试</button>}
      />
    );
  }
  if (list === null) return <div className="daily-loading">加载中…</div>;
  if (!list.items.length) {
    return (
      <EmptyState
        art="inbox"
        title="还没有每日资讯"
        description="定时任务每天 00:30 生成前一天的电力能源政策与新闻，请稍后再来。"
      />
    );
  }

  const groupCounts = parsed ? countByGroupName(parsed) : new Map();
  const selectedMeta = list.items.find((item) => item.date === selectedDate);

  return (
    <div className="daily-news">
      <aside className="daily-rail" aria-label="资讯日期列表">
        <div className="daily-rail-head">
          <ScrollText size={16} />
          <span>每日资讯</span>
        </div>
        {list.items.map((item) => (
          <button
            key={item.date}
            className={item.date === selectedDate ? "daily-date active" : "daily-date"}
            onClick={() => setSelectedDate(item.date)}
          >
            <span className="daily-date-value">
              <CalendarDays size={13} />
              {item.date}
            </span>
            <span className="daily-date-meta">
              政策 {item.groups.find((g) => g.name === "政策文件")?.count ?? 0} · 新闻 {item.groups.find((g) => g.name === "重点新闻")?.count ?? 0}
            </span>
          </button>
        ))}
      </aside>

      <section className="daily-content">
        {detailLoading ? (
          <div className="daily-loading">加载中…</div>
        ) : detailError ? (
          <EmptyState
            icon={ScrollText}
            title="该日资讯加载失败"
            description={detailError}
            action={<button className="secondary" onClick={() => setSelectedDate(selectedDate)}>重试</button>}
          />
        ) : parsed && parsed.sections.length === 0 ? (
          <EmptyState icon={ScrollText} title="该日暂无资讯内容" description="文件可能尚未生成完整，请稍后刷新。" />
        ) : parsed ? (
          <>
            <header className="daily-head">
              <h2>{parsed.title || `电力能源每日资讯 ${selectedDate}`}</h2>
              {selectedMeta && (
                <span className="daily-head-meta">
                  共 {selectedMeta.total} 条 · 政策 {groupCounts.get("政策文件") ?? 0} · 新闻 {groupCounts.get("重点新闻") ?? 0}
                </span>
              )}
            </header>

            {parsed.groups.length > 0 && (
              <div className="daily-overview">
                {parsed.groups.map((group) => (
                  <div className="daily-overview-group" key={group.name}>
                    <h3>
                      {group.name}
                      <span className="daily-overview-count">{group.items.length}</span>
                    </h3>
                    {group.note && <p className="daily-overview-note">{group.note}</p>}
                    {group.items.length > 0 && (
                      <ul>
                        {group.items.map((item) => (
                          <li key={item.n ?? item.text}>
                            <button type="button" onClick={() => jumpToItem(item.n)}>
                              <span className="daily-no">{item.n === null ? "" : `#${item.n}`}</span>
                              <span className="daily-overview-text">{item.text}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            )}

            {parsed.sections.map((section) => (
              <article
                className={section.n !== null && section.n === flashN ? "daily-item flash" : "daily-item"}
                id={section.n !== null ? `daily-item-${section.n}` : undefined}
                key={section.n ?? section.title}
              >
                <h3>
                  {section.n !== null && <span className="daily-no">#{section.n}</span>}
                  {section.title}
                </h3>
                {renderMarkdown(section.body)}
              </article>
            ))}

            {parsed.footer && <p className="daily-footer">{renderInlineMarkdown(parsed.footer)}</p>}
          </>
        ) : null}
      </section>
    </div>
  );
}
