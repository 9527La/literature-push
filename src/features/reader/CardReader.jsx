import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Star, X } from "lucide-react";
import { api } from "../../lib/api.js";
import { journalAbbr, journalGroup } from "../../lib/journal.js";
import { directionLabel, directionVar } from "../../lib/directions.js";
import { articleDate, formatDate } from "../../lib/format.js";

/**
 * 卡片阅读模式（全屏覆盖层）——一条接一条快速翻阅，免反复开关详情弹窗。
 *
 * - 三个版本：速评（paperBriefs 三段式）/ 中文摘要 / 原文；顶栏或键盘 1/2/3 切换，
 *   上次选择记忆在 localStorage（cardReaderView）。
 * - 键盘：← → 上下条、1/2/3 切版、F 收藏、R 已读、Esc 退出。
 * - 「跳过已读」开关（localStorage cardReaderSkipRead）：翻页时跳过已读条目。
 * - 整卡色系随出版社（tone 四色：边框 / 头部色带 / 阴影 / 标记），头部行 =
 *   期刊标记 + 刊名 + 研究方向 chip + 日期。
 * - 收藏 / 已读复用现有接口（登录个人账户后生效），操作结果经 onArticleUpdated 回传。
 */

const VIEW_OPTIONS = [
  { key: "brief", label: "速评版" },
  { key: "zh", label: "中文摘要版" },
  { key: "en", label: "原文版" }
];
const VIEW_STORE_KEY = "cardReaderView";
const SKIP_STORE_KEY = "cardReaderSkipRead";

function readStore(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : value;
  } catch {
    return fallback;
  }
}
function writeStore(key, value) {
  try { localStorage.setItem(key, value); } catch { /* 忽略隐私模式写入失败 */ }
}

function splitKeywords(value) {
  return String(value || "").split(/[;；]/).map((item) => item.trim()).filter(Boolean);
}

export default function CardReader({ open, onClose, title = "", ids = [], briefs = [], canPersonalize = false, onArticleUpdated = null }) {
  const [articleMap, setArticleMap] = useState(() => new Map());
  const [loading, setLoading] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [view, setView] = useState(() => {
    const stored = readStore(VIEW_STORE_KEY, "brief");
    return VIEW_OPTIONS.some((option) => option.key === stored) ? stored : "brief";
  });
  const [skipRead, setSkipRead] = useState(() => readStore(SKIP_STORE_KEY, "0") === "1");
  const skipReadRef = useRef(skipRead);
  const cardRef = useRef(null);

  const order = useMemo(() => (ids || []).filter((id) => Number.isInteger(id) && id > 0), [ids]);
  const briefMap = useMemo(() => new Map((briefs || []).map((brief) => [brief.id, brief])), [briefs]);
  const orderKey = order.join(",");

  // 打开时批量取文章元数据（列表接口已含翻译标题/摘要字段），并按「跳过已读」落位
  useEffect(() => {
    if (!open || !order.length) return undefined;
    let cancelled = false;
    setLoading(true);
    const chunks = [];
    for (let index = 0; index < order.length; index += 100) chunks.push(order.slice(index, index + 100));
    Promise.all(chunks.map((chunk) => api.get(`/api/articles?ids=${chunk.join(",")}&limit=100`)))
      .then((results) => {
        if (cancelled) return;
        const map = new Map();
        for (const data of results) for (const article of data.articles || []) map.set(article.id, article);
        setArticleMap(map);
        let start = 0;
        if (skipReadRef.current) {
          const firstUnread = order.findIndex((id) => !map.get(id)?.is_read);
          start = firstUnread >= 0 ? firstUnread : 0;
        }
        setCursor(start);
      })
      .catch(() => {
        if (!cancelled) setArticleMap(new Map());
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [open, orderKey]);

  // 覆盖期间锁定背景滚动
  useEffect(() => {
    if (!open) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [open]);

  const isRead = useCallback((id) => Boolean(articleMap.get(id)?.is_read), [articleMap]);

  // 翻页：skipRead 时跳过已读；找不到目标则原地不动
  const step = useCallback((direction) => {
    setCursor((current) => {
      let next = current + direction;
      while (next >= 0 && next < order.length && skipReadRef.current && isRead(order[next])) {
        next += direction;
      }
      if (next < 0 || next >= order.length) return current;
      return next;
    });
  }, [order, isRead]);

  const canPrev = useMemo(() => {
    let next = cursor - 1;
    while (next >= 0 && skipRead && isRead(order[next])) next -= 1;
    return next >= 0;
  }, [cursor, order, skipRead, isRead]);
  const canNext = useMemo(() => {
    let next = cursor + 1;
    while (next < order.length && skipRead && isRead(order[next])) next += 1;
    return next < order.length;
  }, [cursor, order, skipRead, isRead]);

  function switchView(next) {
    setView(next);
    writeStore(VIEW_STORE_KEY, next);
  }
  function toggleSkipRead() {
    setSkipRead((current) => {
      const next = !current;
      skipReadRef.current = next;
      writeStore(SKIP_STORE_KEY, next ? "1" : "0");
      return next;
    });
  }

  const currentId = order[cursor];
  const article = currentId ? articleMap.get(currentId) || null : null;
  const brief = currentId ? briefMap.get(currentId) || null : null;

  async function toggleRead() {
    if (!article || !canPersonalize) return;
    const next = article.is_read ? 0 : 1;
    const updated = { ...article, is_read: next };
    setArticleMap((map) => new Map(map).set(article.id, updated));
    onArticleUpdated?.(updated);
    try {
      await api.post(`/api/articles/${article.id}/read`);
    } catch {
      setArticleMap((map) => new Map(map).set(article.id, article));
      onArticleUpdated?.(article);
    }
  }
  async function toggleFav() {
    if (!article || !canPersonalize) return;
    const next = article.is_favorite ? 0 : 1;
    const updated = { ...article, is_favorite: next };
    setArticleMap((map) => new Map(map).set(article.id, updated));
    onArticleUpdated?.(updated);
    try {
      await api.post(`/api/articles/${article.id}/favorite`);
    } catch {
      setArticleMap((map) => new Map(map).set(article.id, article));
      onArticleUpdated?.(article);
    }
  }

  // 键盘快捷键（打开期间生效）
  useEffect(() => {
    if (!open) return undefined;
    function onKey(event) {
      if (event.key === "Escape") { event.preventDefault(); onClose?.(); return; }
      if (event.key === "ArrowLeft" || event.key === "ArrowUp") { event.preventDefault(); step(-1); return; }
      if (event.key === "ArrowRight" || event.key === "ArrowDown") { event.preventDefault(); step(1); return; }
      if (event.key === "1") switchView("brief");
      else if (event.key === "2") switchView("zh");
      else if (event.key === "3") switchView("en");
      else if (event.key === "f" || event.key === "F") toggleFav();
      else if (event.key === "r" || event.key === "R") toggleRead();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // 换卡滚动回顶
  useEffect(() => {
    if (cardRef.current) cardRef.current.scrollTop = 0;
  }, [cursor, view]);

  if (!open) return null;

  const total = order.length;
  const tone = article ? journalGroup(article.journal) : "other";
  const progress = total ? Math.round(((cursor + 1) / total) * 100) : 0;

  let body = null;
  if (article) {
    if (view === "brief") {
      body = brief ? (
        <div className="cr-brief">
          <div className="cr-brief-row"><span className="cr-brief-label">研究对象</span><span className="cr-brief-value">{brief.object || "—"}</span></div>
          <div className="cr-brief-row"><span className="cr-brief-label">研究方法</span><span className="cr-brief-value">{brief.method || "—"}</span></div>
          <div className="cr-brief-row"><span className="cr-brief-label">核心结论</span><span className="cr-brief-value">{brief.finding || "—"}</span></div>
        </div>
      ) : (
        <p className="cr-empty-note">该文献本期暂无速评（速评随周报生成）。可按「2」切换到中文摘要版查看完整摘要。</p>
      );
    } else if (view === "zh") {
      const keywords = splitKeywords(article.keywords).slice(0, 8);
      body = (
        <>
          <p className="cr-abstract">{article.translated_abstract || article.abstract || "（暂无摘要）"}</p>
          {keywords.length > 0 && (
            <div className="cr-keywords">{keywords.map((keyword) => <span key={keyword} className="cr-keyword">{keyword}</span>)}</div>
          )}
        </>
      );
    } else {
      const keywords = splitKeywords(article.keywords).slice(0, 8);
      body = (
        <>
          {article.authors && <p className="cr-authors">{article.authors}</p>}
          <p className="cr-abstract cr-abstract--en">{article.abstract || "（暂无原文摘要）"}</p>
          {keywords.length > 0 && (
            <div className="cr-keywords">{keywords.map((keyword) => <span key={keyword} className="cr-keyword">{keyword}</span>)}</div>
          )}
        </>
      );
    }
  }

  return (
    <div className="card-reader" role="dialog" aria-modal="true" aria-label="卡片阅读模式">
      <header className="cr-head">
        <div className="cr-head-left">
          <span className="cr-brand">卡片阅读</span>
          {title && <span className="cr-scope" title={title}>{title}</span>}
        </div>
        <div className="cr-views" role="tablist" aria-label="卡片版本">
          {VIEW_OPTIONS.map((option) => (
            <button
              key={option.key}
              type="button"
              role="tab"
              aria-selected={view === option.key}
              className={view === option.key ? "on" : ""}
              onClick={() => switchView(option.key)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="cr-head-right">
          <label className="cr-skip" title="翻页时自动跳过已读文献">
            <input type="checkbox" checked={skipRead} onChange={toggleSkipRead} />
            跳过已读
          </label>
          <span className="cr-progress">第 <strong>{total ? cursor + 1 : 0}</strong> / {total} 条</span>
          <button type="button" className="cr-close" title="退出（Esc）" aria-label="退出卡片阅读" onClick={onClose}>
            <X size={17} />
          </button>
        </div>
      </header>
      <div className="cr-bar" aria-hidden="true"><i style={{ width: `${progress}%` }} /></div>

      <main className="cr-stage">
        {loading || !article ? (
          <div className={`cr-card cr-card--loading tone-${tone}`}><p className="cr-loading">{order.length ? "正在加载文献…" : "此范围内没有可阅读的文献。"}</p></div>
        ) : (
          <article className={`cr-card tone-${tone}`} ref={cardRef} aria-live="polite">
            <div className="cr-card-head">
              <span className="cr-mark">{journalAbbr(article.journal)}</span>
              <span className="cr-journal" title={article.journal || ""}>{article.journal || "未知期刊"}</span>
              {article.research_direction && (
                <span className="cr-direction" style={{ "--dir-key": directionVar(article.research_direction) }} title={`研究方向：${directionLabel(article.research_direction)}`}>
                  <span className="cr-direction-dot" aria-hidden="true" />
                  {directionLabel(article.research_direction)}
                </span>
              )}
              <span className="cr-date">{formatDate(articleDate(article))}</span>
            </div>
            <div className="cr-card-body">
              <h2 className="cr-title">{article.translated_title || article.title || "未命名文献"}</h2>
              {view !== "en" && article.translated_title && article.title && <p className="cr-original-title">{article.title}</p>}
              {body}
            </div>
          </article>
        )}
      </main>

      <footer className="cr-foot">
        <button type="button" className="cr-nav" disabled={!canPrev} onClick={() => step(-1)}>
          <ChevronLeft size={16} aria-hidden="true" />上一条
        </button>
        <div className="cr-actions">
          <button
            type="button"
            className={`cr-action${article?.is_favorite ? " is-on-fav" : ""}`}
            disabled={!article || !canPersonalize}
            title={canPersonalize ? "收藏（F）" : "登录个人账户后可收藏"}
            onClick={toggleFav}
          >
            <Star size={15} fill={article?.is_favorite ? "currentColor" : "none"} aria-hidden="true" />
            {article?.is_favorite ? "已收藏" : "收藏"}
          </button>
          <button
            type="button"
            className={`cr-action${article?.is_read ? " is-on-read" : ""}`}
            disabled={!article || !canPersonalize}
            title={canPersonalize ? "标记已读（R）" : "登录个人账户后可标记"}
            onClick={toggleRead}
          >
            <Check size={15} aria-hidden="true" />
            {article?.is_read ? "已读" : "标记已读"}
          </button>
        </div>
        <button type="button" className="cr-nav cr-nav--primary" disabled={!canNext} onClick={() => step(1)}>
          下一条<ChevronRight size={16} aria-hidden="true" />
        </button>
      </footer>
      <p className="cr-hint">← → 翻页 · 1 / 2 / 3 切换版本 · F 收藏 · R 已读 · Esc 退出</p>
    </div>
  );
}
