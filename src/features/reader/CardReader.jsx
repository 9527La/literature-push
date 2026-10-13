import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Copy, List, Star, StickyNote, X } from "lucide-react";
import { api } from "../../lib/api.js";
import { journalAbbr, journalGroup } from "../../lib/journal.js";
import { directionLabel, directionVar } from "../../lib/directions.js";
import { articleDate, formatCitationGB7714, formatDate } from "../../lib/format.js";

/**
 * 卡片阅读模式（全屏覆盖层）——一条接一条快速翻阅，免反复开关详情弹窗。
 *
 * 2026-10-13 v2 增补（用户圈选 9 项）：
 *  - 断点续读：按"范围指纹"记忆读到第几条，重开自动回到上次位置（localStorage）
 *  - 读即标记：向下翻页时自动标记已读（默认开，可关；localStorage）
 *  - 读完本批：目录抽屉内一键把本批（当前筛选范围）剩余未读标记为已读（两步确认，>300 篇禁用）
 *  - 相关文献：卡片底部列出相关文献，点击即在阅读链中跳转（不在本批则插入到当前条之后）
 *  - 目录抽屉：全批列表 + 序号跳转 + 阅读中改范围（仅未读 / 仅有速评 / 按期刊）
 *  - 中英对照：中文摘要版可展开英文原段
 *  - 卡片内备注：随手记一句，保存到收藏备注（未收藏自动先收藏）
 *  - 一键复制引用：GB/T 7714 格式复制到剪贴板（含非安全上下文回退）
 *  - 分享直达：#feed?reader=1（由 Feed 负责写入 hash）
 *
 * 其他：三版本（速评/中文摘要/原文）记忆、跳过已读、键盘 ←→/空格/1/2/3/F/R/D/C/N/Esc、
 * 整卡色系随出版社 tone 五色系（头部色带/标签/关键词/边框/标记），方向 chip 在刊名右侧。
 */

const VIEW_OPTIONS = [
  { key: "brief", label: "速评版" },
  { key: "zh", label: "中文摘要版" },
  { key: "en", label: "原文版" }
];
const VIEW_STORE_KEY = "cardReaderView";
const SKIP_STORE_KEY = "cardReaderSkipRead";
const READ_ON_FLIP_KEY = "cardReaderReadOnFlip";
const PAIRED_STORE_KEY = "cardReaderShowEn";
const PROGRESS_STORE_KEY = "cardReaderProgress";
const DRAWER_RENDER_CAP = 500; // 目录抽屉最多渲染行数（超大范围时提示缩小范围）
const BATCH_READ_MAX = 300; // 读完本批的篇数上限（防超大范围批量打库）

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
/** 剪贴板（含非安全上下文回退：局域网 http 下 navigator.clipboard 不可用）。 */
async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* 落到回退 */ }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

export default function CardReader({ open, onClose, title = "", ids = [], briefs = [], canPersonalize = false, onArticleUpdated = null }) {
  const [order, setOrder] = useState([]);
  const [articleMap, setArticleMap] = useState(() => new Map());
  const [loading, setLoading] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [view, setView] = useState(() => {
    const stored = readStore(VIEW_STORE_KEY, "brief");
    return VIEW_OPTIONS.some((option) => option.key === stored) ? stored : "brief";
  });
  const [skipRead, setSkipRead] = useState(() => readStore(SKIP_STORE_KEY, "0") === "1");
  const [readOnFlip, setReadOnFlip] = useState(() => readStore(READ_ON_FLIP_KEY, "1") === "1");
  const [showEn, setShowEn] = useState(() => readStore(PAIRED_STORE_KEY, "0") === "1");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [onlyBrief, setOnlyBrief] = useState(false);
  const [journalFilter, setJournalFilter] = useState([]);
  const [notes, setNotes] = useState(() => new Map());
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);
  const [relatedMap, setRelatedMap] = useState(() => new Map());
  const [copied, setCopied] = useState(false);
  const [hint, setHint] = useState("");
  const [batchConfirm, setBatchConfirm] = useState(false);
  const [batchBusy, setBatchBusy] = useState(false);
  const skipReadRef = useRef(skipRead);
  const readOnFlipRef = useRef(readOnFlip);
  const cardRef = useRef(null);
  const loadedKeyRef = useRef("");
  const hintTimerRef = useRef(null);

  const briefMap = useMemo(() => new Map((briefs || []).map((brief) => [brief.id, brief])), [briefs]);
  const idsKey = (ids || []).join(",");
  const orderKey = order.join(",");
  // 范围指纹：标题 + 条数 + 首尾 id（同一范围重开可续读；换范围即视为新会话）
  const scopeKey = order.length ? `${title}|${order.length}|${order[0]}|${order[order.length - 1]}` : "";

  // 外部 ids 变化 → 重建批次（并清空进度游标与筛选）
  useEffect(() => {
    const next = (ids || []).filter((id) => Number.isInteger(id) && id > 0);
    setOrder(next);
    setCursor(0);
    setDrawerOpen(false);
    setJournalFilter([]);
    setOnlyUnread(false);
    setOnlyBrief(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  // 打开时批量取文章元数据（full=1：完整中英文摘要）
  useEffect(() => {
    if (!open || !order.length) return undefined;
    if (loadedKeyRef.current === orderKey) return undefined;
    loadedKeyRef.current = orderKey;
    let cancelled = false;
    setLoading(true);
    const chunks = [];
    for (let index = 0; index < order.length; index += 100) chunks.push(order.slice(index, index + 100));
    Promise.all(chunks.map((chunk) => api.get(`/api/articles?ids=${chunk.join(",")}&limit=100&full=1`)))
      .then((results) => {
        if (cancelled) return;
        const map = new Map();
        for (const data of results) for (const article of data.articles || []) map.set(article.id, article);
        setArticleMap((prev) => new Map([...prev, ...map]));
      })
      .catch(() => { /* 失败保持空态 */ })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, orderKey, order]);

  // 打开时取收藏备注（备注存在收藏记录上；仅登录个人账户可用）
  useEffect(() => {
    if (!open || !canPersonalize) return undefined;
    let cancelled = false;
    api.get("/api/favorites")
      .then((data) => {
        if (cancelled) return;
        const map = new Map();
        for (const item of data.favorites || []) if (item.note) map.set(item.id, item.note);
        setNotes(map);
      })
      .catch(() => { /* 静默 */ });
    return () => { cancelled = true; };
  }, [open, canPersonalize]);

  // 覆盖期间锁定背景滚动
  useEffect(() => {
    if (!open) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [open]);

  useEffect(() => { skipReadRef.current = skipRead; }, [skipRead]);
  useEffect(() => { readOnFlipRef.current = readOnFlip; }, [readOnFlip]);

  const isRead = useCallback((id) => Boolean(articleMap.get(id)?.is_read), [articleMap]);

  // 阅读中改范围：筛选出可见列表（文章未加载时按通过处理，保证计数稳定）
  const list = useMemo(() => {
    const journalSet = new Set(journalFilter);
    return order.filter((id) => {
      if (onlyBrief && !briefMap.has(id)) return false;
      const article = articleMap.get(id);
      if (!article) return true;
      if (onlyUnread && article.is_read) return false;
      if (journalSet.size && !journalSet.has(String(article.journal || "").trim())) return false;
      return true;
    });
  }, [order, articleMap, briefMap, onlyUnread, onlyBrief, journalFilter]);

  // 批次内期刊清单（目录抽屉的期刊筛选）
  const journalOptions = useMemo(() => {
    const counts = new Map();
    for (const id of order) {
      const name = String(articleMap.get(id)?.journal || "").trim();
      if (!name) continue;
      counts.set(name, (counts.get(name) || 0) + 1);
    }
    return [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [order, articleMap]);

  const unreadCount = useMemo(() => order.filter((id) => !isRead(id)).length, [order, isRead]);

  const currentId = list[cursor];
  const article = currentId ? articleMap.get(currentId) || null : null;
  const brief = currentId ? briefMap.get(currentId) || null : null;
  const total = list.length;

  function flashHint(text) {
    setHint(text);
    if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
    hintTimerRef.current = setTimeout(() => setHint(""), 2600);
  }

  // ── 已读 / 收藏 / 备注（乐观更新 + 接口回滚）──────────────────────────
  function applyArticlePatch(id, patch) {
    setArticleMap((map) => {
      const existing = map.get(id);
      if (!existing) return map;
      const updated = { ...existing, ...patch };
      onArticleUpdated?.(updated);
      return new Map(map).set(id, updated);
    });
  }
  async function markReadById(id) {
    if (!canPersonalize || isRead(id)) return;
    applyArticlePatch(id, { is_read: 1 });
    try {
      await api.post(`/api/articles/${id}/read`);
    } catch {
      applyArticlePatch(id, { is_read: 0 });
    }
  }
  async function toggleRead() {
    if (!article || !canPersonalize) return;
    const next = article.is_read ? 0 : 1;
    applyArticlePatch(article.id, { is_read: next });
    try {
      await api.post(`/api/articles/${article.id}/read`);
    } catch {
      applyArticlePatch(article.id, { is_read: next ? 0 : 1 });
    }
  }
  async function toggleFav() {
    if (!article || !canPersonalize) return;
    const next = article.is_favorite ? 0 : 1;
    applyArticlePatch(article.id, { is_favorite: next });
    try {
      await api.post(`/api/articles/${article.id}/favorite`);
    } catch {
      applyArticlePatch(article.id, { is_favorite: next ? 0 : 1 });
    }
  }
  async function saveNote() {
    if (!article || !canPersonalize || noteSaving) return;
    const value = noteDraft.trim();
    setNoteSaving(true);
    try {
      if (!article.is_favorite) {
        await api.post(`/api/articles/${article.id}/favorite`);
        applyArticlePatch(article.id, { is_favorite: 1 });
      }
      await api.put(`/api/favorites/${article.id}`, { note: value });
      setNotes((map) => new Map(map).set(article.id, value));
      setNoteOpen(false);
      flashHint(value ? "备注已保存" : "备注已清空");
    } catch {
      flashHint("备注保存失败，请稍后重试");
    } finally {
      setNoteSaving(false);
    }
  }
  async function copyCitation() {
    if (!article) return;
    const text = formatCitationGB7714(article);
    if (!text) { flashHint("该文献缺少标题，无法生成引用"); return; }
    const ok = await copyText(text);
    setCopied(true);
    flashHint(ok ? "已复制 GB/T 7714 引用" : "复制失败，请手动复制");
    setTimeout(() => setCopied(false), 1800);
  }
  async function markRemainingRead() {
    const targets = list.filter((id) => !isRead(id));
    if (!targets.length) { flashHint("本批已全部标记为已读"); setBatchConfirm(false); return; }
    setBatchBusy(true);
    const chunk = 6;
    for (let index = 0; index < targets.length; index += chunk) {
      await Promise.all(targets.slice(index, index + chunk).map(async (id) => {
        applyArticlePatch(id, { is_read: 1 });
        try { await api.post(`/api/articles/${id}/read`); } catch { applyArticlePatch(id, { is_read: 0 }); }
      }));
    }
    setBatchBusy(false);
    setBatchConfirm(false);
    flashHint(`已标记 ${targets.length} 篇为已读`);
  }

  // 翻页（skipRead 跳过已读；readOnFlip 自动标记已读）
  const step = useCallback((direction) => {
    setCursor((current) => {
      let next = current + direction;
      while (next >= 0 && next < list.length && skipReadRef.current && isRead(list[next])) next += direction;
      if (next < 0 || next >= list.length) return current;
      if (direction > 0 && readOnFlipRef.current) {
        const targetId = list[next];
        if (targetId && !isRead(targetId)) markReadById(targetId);
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, isRead]);

  const canPrev = useMemo(() => {
    let next = cursor - 1;
    while (next >= 0 && skipRead && isRead(list[next])) next -= 1;
    return next >= 0;
  }, [cursor, list, skipRead, isRead]);
  const canNext = useMemo(() => {
    let next = cursor + 1;
    while (next < list.length && skipRead && isRead(list[next])) next += 1;
    return next < list.length;
  }, [cursor, list, skipRead, isRead]);

  // 续读：首次打开该范围时回到上次位置
  useEffect(() => {
    if (!open || loading || !order.length || !scopeKey) return;
    let stored = null;
    try { stored = JSON.parse(readStore(PROGRESS_STORE_KEY, "null")); } catch { stored = null; }
    if (!stored || stored.key !== scopeKey) return;
    const idAt = order[stored.orderIndex];
    const nextIndex = idAt !== undefined ? list.findIndex((id) => id === idAt) : -1;
    if (nextIndex > 0) {
      setCursor(nextIndex);
      flashHint(`已续读上次位置 · 第 ${nextIndex + 1} / ${list.length} 条`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, loading, scopeKey]);

  // 记录进度（顺序以未筛选的 order 为准，避免筛选污染）
  useEffect(() => {
    if (!open || !scopeKey || !currentId) return undefined;
    const orderIndex = order.indexOf(currentId);
    if (orderIndex < 0) return undefined;
    const timer = setTimeout(() => {
      writeStore(PROGRESS_STORE_KEY, JSON.stringify({ key: scopeKey, orderIndex, total: order.length, title, at: Date.now() }));
    }, 400);
    return () => clearTimeout(timer);
  }, [open, scopeKey, currentId, order, title]);

  // 相关文献（当前条，懒加载并缓存）
  useEffect(() => {
    if (!open || !currentId || relatedMap.has(currentId)) return undefined;
    let cancelled = false;
    api.get(`/api/articles/${currentId}/related`)
      .then((data) => {
        if (cancelled) return;
        setRelatedMap((map) => new Map(map).set(currentId, Array.isArray(data?.articles) ? data.articles : []));
      })
      .catch(() => {
        if (!cancelled) setRelatedMap((map) => new Map(map).set(currentId, []));
      });
    return () => { cancelled = true; };
  }, [open, currentId, relatedMap]);

  // 备注草稿跟随当前条
  useEffect(() => {
    setNoteOpen(false);
    setNoteDraft(currentId ? notes.get(currentId) || "" : "");
  }, [currentId, notes]);

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
  function toggleReadOnFlip() {
    setReadOnFlip((current) => {
      const next = !current;
      readOnFlipRef.current = next;
      writeStore(READ_ON_FLIP_KEY, next ? "1" : "0");
      return next;
    });
  }
  function toggleShowEn() {
    setShowEn((current) => {
      const next = !current;
      writeStore(PAIRED_STORE_KEY, next ? "1" : "0");
      return next;
    });
  }
  function jumpTo(index) {
    setCursor(Math.min(Math.max(index, 0), Math.max(list.length - 1, 0)));
    setDrawerOpen(false);
  }
  function clearRangeFilters() {
    setOnlyUnread(false);
    setOnlyBrief(false);
    setJournalFilter([]);
  }

  // 相关文献跳转：本批内直接跳；不在本批则插入到当前条之后（形成阅读链）
  async function jumpToRelated(item) {
    const id = item?.id;
    if (!id) return;
    const inList = list.indexOf(id);
    if (inList >= 0) { jumpTo(inList); return; }
    const inOrder = order.indexOf(id);
    if (inOrder >= 0) {
      clearRangeFilters();
      setCursor(order.indexOf(id));
      return;
    }
    if (!articleMap.has(id)) {
      try {
        const data = await api.get(`/api/articles?ids=${id}&limit=1&full=1`);
        const found = data.articles?.[0];
        if (found) setArticleMap((map) => new Map(map).set(found.id, found));
      } catch { /* 元数据失败也插入，卡片显示加载态 */ }
    }
    setOrder((prev) => {
      const index = prev.indexOf(currentId);
      const next = [...prev];
      next.splice(index + 1, 0, id);
      return next;
    });
    clearRangeFilters();
    setTimeout(() => setCursor((current) => current + 1), 0);
    flashHint("已把相关文献接在当前条之后");
  }

  // 进度条点击/拖拽跳转
  function seekFromEvent(event) {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1);
    setCursor(Math.round(ratio * Math.max(list.length - 1, 0)));
  }

  // 键盘快捷键（打开期间生效；输入框聚焦时不劫持）
  useEffect(() => {
    if (!open) return undefined;
    function onKey(event) {
      const tag = event.target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (event.key === "Escape") {
        event.preventDefault();
        if (drawerOpen) setDrawerOpen(false);
        else if (noteOpen) setNoteOpen(false);
        else onClose?.();
        return;
      }
      if (event.key === "ArrowLeft" || event.key === "ArrowUp") { event.preventDefault(); step(-1); return; }
      if (event.key === "ArrowRight" || event.key === "ArrowDown" || event.key === " ") { event.preventDefault(); step(1); return; }
      if (event.key === "1") switchView("brief");
      else if (event.key === "2") switchView("zh");
      else if (event.key === "3") switchView("en");
      else if (event.key === "f" || event.key === "F") toggleFav();
      else if (event.key === "r" || event.key === "R") toggleRead();
      else if (event.key === "d" || event.key === "D") setDrawerOpen((current) => !current);
      else if (event.key === "c" || event.key === "C") copyCitation();
      else if (event.key === "n" || event.key === "N") setNoteOpen((current) => !current);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // 换卡/换视图滚动回顶
  useEffect(() => {
    if (cardRef.current) cardRef.current.scrollTop = 0;
  }, [cursor, view]);

  useEffect(() => () => { if (hintTimerRef.current) clearTimeout(hintTimerRef.current); }, []);

  if (!open) return null;

  const tone = article ? journalGroup(article.journal) : "other";
  const progress = total ? Math.round(((cursor + 1) / total) * 100) : 0;
  const note = currentId ? notes.get(currentId) || "" : "";
  const related = currentId ? relatedMap.get(currentId) || [] : [];
  const filtersActive = onlyUnread || onlyBrief || journalFilter.length > 0;

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
      const canPair = Boolean(article.abstract) && Boolean(article.translated_abstract);
      body = (
        <>
          <p className="cr-abstract">{article.translated_abstract || article.abstract || "（暂无摘要）"}</p>
          {canPair && (
            <div className="cr-pair">
              <button type="button" className="cr-pair-toggle" aria-expanded={showEn} onClick={toggleShowEn}>
                {showEn ? "收起英文原文" : "对照英文原文"}
              </button>
              {showEn && <p className="cr-abstract cr-abstract--en cr-abstract--paired">{article.abstract}</p>}
            </div>
          )}
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
          <label className="cr-switch" title="翻页时自动跳过已读文献">
            <input type="checkbox" checked={skipRead} onChange={toggleSkipRead} />
            跳过已读
          </label>
          <label className="cr-switch" title="向下翻页时自动标记已读">
            <input type="checkbox" checked={readOnFlip} onChange={toggleReadOnFlip} />
            读即标记
          </label>
          <button type="button" className={`cr-icon-btn${drawerOpen ? " on" : ""}`} title="目录与筛选（D）" aria-label="打开目录" onClick={() => setDrawerOpen((current) => !current)}>
            <List size={16} />
          </button>
          <span className="cr-progress">第 <strong>{total ? cursor + 1 : 0}</strong> / {total} 条</span>
          <button type="button" className="cr-close" title="退出（Esc）" aria-label="退出卡片阅读" onClick={onClose}>
            <X size={17} />
          </button>
        </div>
      </header>
      <div
        className="cr-bar"
        role="slider"
        aria-label="阅读进度（可点击或拖动跳转）"
        aria-valuemin={1}
        aria-valuemax={Math.max(total, 1)}
        aria-valuenow={total ? cursor + 1 : 1}
        onPointerDown={(event) => { event.currentTarget.setPointerCapture?.(event.pointerId); seekFromEvent(event); }}
        onPointerMove={(event) => { if (event.buttons === 1) seekFromEvent(event); }}
      >
        <i style={{ width: `${progress}%` }} />
      </div>

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
            <div className="cr-card-foot">
              {related.length > 0 && (
                <div className="cr-related">
                  <span className="cr-related-label">相关文献</span>
                  <div className="cr-related-list">
                    {related.slice(0, 3).map((item) => (
                      <button key={item.id} type="button" className={`cr-related-item tone-${journalGroup(item.journal)}`} title={item.title} onClick={() => jumpToRelated(item)}>
                        <span className="cr-related-mark">{journalAbbr(item.journal)}</span>
                        <span className="cr-related-title">{item.title}</span>
                        <ChevronRight size={13} aria-hidden="true" />
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className={`cr-note${noteOpen ? " is-open" : ""}`}>
                <button type="button" className={`cr-note-toggle${note ? " has-note" : ""}`} onClick={() => setNoteOpen((current) => !current)}>
                  <StickyNote size={14} aria-hidden="true" />
                  {note ? `备注：${note.length > 24 ? `${note.slice(0, 24)}…` : note}` : "添加备注"}
                </button>
                {noteOpen && (
                  <div className="cr-note-editor">
                    <textarea
                      className="cr-note-input"
                      rows={2}
                      placeholder="随手记一句（保存到收藏备注）"
                      value={noteDraft}
                      onChange={(event) => setNoteDraft(event.target.value)}
                    />
                    <div className="cr-note-actions">
                      <span className="cr-note-hint">{canPersonalize ? (article.is_favorite ? "" : "保存将同时收藏该文献") : "登录个人账户后可记备注"}</span>
                      <button type="button" className="cr-note-save" disabled={!canPersonalize || noteSaving} onClick={saveNote}>
                        {noteSaving ? "保存中…" : "保存备注"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
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
          <button type="button" className="cr-action" disabled={!article} title="复制 GB/T 7714 引用（C）" onClick={copyCitation}>
            <Copy size={15} aria-hidden="true" />
            {copied ? "已复制" : "复制引用"}
          </button>
        </div>
        <button type="button" className="cr-nav cr-nav--primary" disabled={!canNext} onClick={() => step(1)}>
          下一条<ChevronRight size={16} aria-hidden="true" />
        </button>
      </footer>
      <p className="cr-hint">
        ← → 翻页（空格=下一条）· 1 / 2 / 3 切换版本 · F 收藏 · R 已读 · C 复制引用 · N 备注 · D 目录 · Esc 退出
      </p>
      {hint && <div className="cr-toast" role="status">{hint}</div>}

      {drawerOpen && (
        <aside className="cr-drawer" aria-label="阅读目录">
          <header className="cr-drawer-head">
            <strong>目录</strong>
            <span className="cr-drawer-count">第 {total ? cursor + 1 : 0} / {total} 条{filtersActive ? "（已筛选）" : ""}</span>
            <button type="button" className="cr-icon-btn" title="关闭（Esc）" onClick={() => setDrawerOpen(false)}><X size={15} /></button>
          </header>
          <div className="cr-drawer-filters">
            <button type="button" className={`cr-drawer-chip${onlyUnread ? " on" : ""}`} onClick={() => { setOnlyUnread((current) => !current); setCursor(0); }}>
              仅未读{unreadCount ? `（${unreadCount}）` : ""}
            </button>
            <button type="button" className={`cr-drawer-chip${onlyBrief ? " on" : ""}`} onClick={() => { setOnlyBrief((current) => !current); setCursor(0); }}>
              仅有速评
            </button>
            {filtersActive && (
              <button type="button" className="cr-drawer-chip is-reset" onClick={() => { clearRangeFilters(); setCursor(0); }}>
                清除筛选
              </button>
            )}
          </div>
          {journalOptions.length > 1 && (
            <div className="cr-drawer-journals">
              {journalOptions.slice(0, 14).map((option) => {
                const on = journalFilter.includes(option.name);
                return (
                  <button
                    key={option.name}
                    type="button"
                    className={`cr-drawer-jchip tone-${journalGroup(option.name)}${on ? " on-solid" : ""}`}
                    title={`${option.name}（${option.count} 篇）`}
                    onClick={() => {
                      setJournalFilter((prev) => (prev.includes(option.name) ? prev.filter((name) => name !== option.name) : [...prev, option.name]));
                      setCursor(0);
                    }}
                  >
                    {journalAbbr(option.name)}
                    <span className="cr-drawer-jcount">{option.count}</span>
                  </button>
                );
              })}
              {journalOptions.length > 14 && <span className="cr-drawer-more">+{journalOptions.length - 14} 种</span>}
            </div>
          )}
          <ol className="cr-drawer-list">
            {list.slice(0, DRAWER_RENDER_CAP).map((id, index) => {
              const item = articleMap.get(id);
              const toneOf = journalGroup(item?.journal || "");
              return (
                <li key={id}>
                  <button
                    type="button"
                    className={`cr-drawer-row tone-${toneOf}${index === cursor ? " is-current" : ""}${item?.is_read ? " is-read" : ""}`}
                    onClick={() => jumpTo(index)}
                  >
                    <span className="cr-drawer-index">{index + 1}</span>
                    <span className="cr-drawer-mark">{journalAbbr(item?.journal)}</span>
                    <span className="cr-drawer-title" title={item?.translated_title || item?.title}>{item?.translated_title || item?.title || `#${id}`}</span>
                    <span className="cr-drawer-date">{formatDate(articleDate(item || {}))}</span>
                  </button>
                </li>
              );
            })}
            {list.length > DRAWER_RENDER_CAP && (
              <li className="cr-drawer-cap">仅显示前 {DRAWER_RENDER_CAP} 条 · 缩小范围后可浏览全部</li>
            )}
          </ol>
          <footer className="cr-drawer-foot">
            {batchConfirm ? (
              <>
                <span className="cr-drawer-warn">确认把本批剩余 {unreadCount} 篇全部标记为已读？</span>
                <div className="cr-drawer-foot-actions">
                  <button type="button" className="cr-drawer-cancel" onClick={() => setBatchConfirm(false)}>取消</button>
                  <button type="button" className="cr-drawer-danger" disabled={batchBusy} onClick={markRemainingRead}>
                    {batchBusy ? "标记中…" : "确认标记"}
                  </button>
                </div>
              </>
            ) : (
              <button
                type="button"
                className="cr-drawer-batch"
                disabled={!canPersonalize || unreadCount === 0 || unreadCount > BATCH_READ_MAX}
                title={unreadCount > BATCH_READ_MAX ? `本批超过 ${BATCH_READ_MAX} 篇，请缩小范围后批量标记` : "把本批剩余未读一键标记为已读"}
                onClick={() => setBatchConfirm(true)}
              >
                读完本批（剩余 {unreadCount} 篇{unreadCount > BATCH_READ_MAX ? " · 超上限" : ""}）
              </button>
            )}
          </footer>
        </aside>
      )}
    </div>
  );
}
