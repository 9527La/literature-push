import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowDownUp, ArrowUp, BookOpen, BookOpenCheck, CalendarDays, Check, ChevronDown, Compass, Download, Eye, EyeOff, Filter, RefreshCw, RotateCcw, Search, Star, Tag, X } from "lucide-react";
import { api } from "../../lib/api.js";
import { ARTICLE_PAGE_SIZE, DEFAULT_FILTERS } from "../../lib/constants.js";
import { downloadTextFile, toBibtex, toRis } from "../../lib/export.js";
import { isChineseJournalArticle, isChineseSourceText } from "../../lib/format.js";
import { groupJournals, journalAbbr } from "../../lib/journal.js";
import { DIRECTIONS, directionLabel, directionVar } from "../../lib/directions.js";
import ArticleCard from "../../components/ArticleCard.jsx";
import EmptyState from "../../components/EmptyState.jsx";
import ArticleDialog from "./ArticleDialog.jsx";
import ReaderSetup from "./ReaderSetup.jsx";
import CardReader from "../reader/CardReader.jsx";
import useCollapsedGroups from "../../hooks/useCollapsedGroups.js";

/** 时间快捷区间（甲-2）：按本地时区生成 YYYY-MM-DD，与站内业务日口径一致。 */
function dateInputValue(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
function quickRangeDates(key) {
  const now = new Date();
  const to = dateInputValue(now);
  if (key === "month") {
    return { from: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`, to };
  }
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (key === "7" ? 6 : 29));
  return { from: dateInputValue(start), to };
}
const QUICK_RANGES = [
  { key: "7", label: "近 7 日" },
  { key: "30", label: "近 30 日" },
  { key: "month", label: "本月" }
];
/** 阅读状态（2026-10-13）：全部 / 未读 / 已读——前者清空 unread+read，后两者互斥。 */
const READ_STATES = [
  { key: "all", label: "全部" },
  { key: "unread", label: "未读" },
  { key: "read", label: "已读" }
];

/** 长列表浮动「回到顶部」（乙-4）：滚动超过一屏后浮现，显示文档滚动进度。 */
function BackToTop() {
  const [state, setState] = useState({ visible: false, progress: 0 });
  useEffect(() => {
    let raf = 0;
    const update = () => {
      raf = 0;
      const doc = document.documentElement;
      const max = doc.scrollHeight - window.innerHeight;
      const progress = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
      setState({ visible: window.scrollY > 480, progress });
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(update); };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    update();
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);
  if (!state.visible) return null;
  const percent = Math.round(state.progress * 100);
  return (
    <button
      type="button"
      className="back-to-top"
      title={`回到顶部（已滚动 ${percent}%）`}
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
    >
      <span className="back-to-top-prog" aria-hidden="true"><span style={{ width: `${percent}%` }} /></span>
      <ArrowUp size={13} aria-hidden="true" />
      <span className="back-to-top-pct" aria-hidden="true">{percent}%</span>
      回到顶部
    </button>
  );
}

function Feed({ articles, articlesTotal = 0, subscribedJournals, journals, filters, setFilters, markRead, toggleFavorite, displayPreferences, onDisplayPreferencesChange, onArticleUpdated, canPersonalize, canModerate = false, onLoadMore, hasMoreArticles, loadingMoreArticles, listUpdating = false, queryKey = "", notify, onRefresh = null, refreshing = false, onDataChanged = null }) {
  const [selectedArticle, setSelectedArticle] = useState(null);
  // 筛选面板默认收起（需求 2）：文献库首屏让位给文献列表，需要时点「打开筛选」。
  const [filterOpen, setFilterOpen] = useState(false);
  // 文献库双子模块（2026-10-13）：文献总览 / 卡片阅读（范围选择 → 目录 → 全屏卡片阅读）
  const [feedMode, setFeedMode] = useState(() => {
    try { return localStorage.getItem("feedMode") === "reader" ? "reader" : "overview"; } catch { return "overview"; }
  });
  const [readerSession, setReaderSession] = useState(null);
  function switchFeedMode(mode) {
    setFeedMode(mode);
    try { localStorage.setItem("feedMode", mode); } catch { /* 忽略隐私模式写入失败 */ }
  }
  // 折叠分组状态（S4：与期刊小节、研究速览分组共用同一 hook）
  const { isCollapsed: isFilterGroupCollapsed, toggle: toggleFilterGroup } = useCollapsedGroups({
    search: true,
    journal: true,
    direction: true,
    date: true,
    flags: true,
    keyword: true,
    sort: true
  });
  const { isCollapsed: isJournalGroupCollapsed, toggle: toggleJournalGroup } = useCollapsedGroups();
  const [topKeywords, setTopKeywords] = useState([]);
  const [directionCounts, setDirectionCounts] = useState(null);
  const [visibleCount, setVisibleCount] = useState(50);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [batchBusy, setBatchBusy] = useState("");
  // 期刊小节折叠（需求 2）：出版社分组可展开/收起，默认全部展开。
  const searchInputRef = useRef(null);
  const sentinelRef = useRef(null);

  // ── 入场 stagger（B3-2）─────────────────────────────────────────────────
  // 只给「本批新挂载」的卡片算入场延迟：列表长度增长时，增长起点就是本批的
  // 第一张卡。纯视觉层——不触碰 loading/requestId/commitArticles 任何逻辑，
  // CSS 动画只在元素首次挂载时播一次，已挂载卡片重新渲染不会重播。
  // 注意：visibleArticles 在下方 useMemo/slice 之后才有定义，effect 必须放在
  // 它后面（依赖数组在渲染期求值，放前面会踩 TDZ）。
  const enterStartRef = useRef(0);
  const prevVisibleCountRef = useRef(0);

  useEffect(() => {
    api.get("/api/keyword-stats").then((data) => {
      setTopKeywords(data.keywords || []);
    }).catch(() => {});
    // 方向计数只用于筛选面板展示，失败时面板退化为无计数 chips。
    api.get("/api/directions").then((data) => {
      setDirectionCounts(data.directions || []);
    }).catch(() => {});
  }, []);

  // Reset pagination (and any batch selection) only when the *query* changes.
  // Depending on the `filters` object reset the list on every keystroke,
  // because setFilters re-creates that object even when nothing moved.
  useEffect(() => {
    setVisibleCount(50);
    setSelectedIds((current) => (current.size ? new Set() : current));
  }, [queryKey]);

  useEffect(() => {
    if (!selectedArticle) return;
    const latest = articles.find((article) => article.id === selectedArticle.id);
    if (!latest) return;
    setSelectedArticle((current) => current ? { ...current, ...latest } : current);
  }, [articles]);

  function toggleDisplay(field) {
    onDisplayPreferencesChange({ ...displayPreferences, [field]: !displayPreferences[field] });
  }

  function filterGroupHeader(group, label, icon = null, clear = null) {
    const contentId = `feed-filter-group-${group}`;
    const collapsed = isFilterGroupCollapsed(group);
    return (
      <div className="filter-group-head-row">
        <button
          className="filter-group-toggle"
          type="button"
          aria-expanded={!collapsed}
          aria-controls={contentId}
          onClick={() => toggleFilterGroup(group)}
        >
          <span>{icon}{label}</span>
          <ChevronDown size={15} aria-hidden="true" />
        </button>
        {clear?.active && (
          <button
            className="filter-group-clear"
            type="button"
            title={`清除${label}筛选`}
            onClick={clear.onClear}
          >
            清除
          </button>
        )}
      </div>
    );
  }

  function handleArticleUpdated(nextArticles) {
    const updates = (Array.isArray(nextArticles) ? nextArticles : [nextArticles]).filter((article) => article?.id);
    onArticleUpdated(updates);
    setSelectedArticle((current) => {
      if (!current) return current;
      const update = updates.find((article) => article.id === current.id);
      return update ? { ...current, ...update } : current;
    });
  }

  // Only show articles from subscribed journals（P4：memo 化，父组件每次
  // 渲染不再触发全量 filter；subscribedJournals 由 App 侧 useMemo 保证引用稳定）
  const filteredArticles = useMemo(() => articles.filter((article) =>
    subscribedJournals.length === 0 || subscribedJournals.includes(article.journal)
  ), [articles, subscribedJournals]);

  const highlightTerms = useMemo(() => {
    const terms = [];
    if (filters.q && filters.q.trim()) terms.push(filters.q.trim());
    if (filters.keyword && filters.keyword.length) terms.push(...filters.keyword);
    return terms;
  }, [filters.q, filters.keyword]);

  const sortedArticles = useMemo(() => {
    if (filters.sort !== "relevance" || !highlightTerms.length) return filteredArticles;
    // P4：每篇只做一次小写化；超长摘要截断到前 2000 字符计分（命中密度
    // 在开头已经足够区分，尾部扫描纯属浪费主线程时间）。
    const terms = highlightTerms.map((term) => String(term).toLowerCase()).filter(Boolean);
    if (!terms.length) return filteredArticles;
    const countIn = (hay, needle) => {
      let count = 0;
      let pos = 0;
      while ((pos = hay.indexOf(needle, pos)) !== -1) { count++; pos += needle.length; }
      return count;
    };
    return [...filteredArticles].map((a) => {
      const title = String(a.title || "").toLowerCase();
      const keywords = String(a.keywords || "").toLowerCase();
      const abstract = String(a.abstract || "").toLowerCase().slice(0, 2000);
      let score = 0;
      let total = 0;
      for (const term of terms) {
        const titleCount = countIn(title, term);
        const keywordCount = countIn(keywords, term);
        const abstractCount = countIn(abstract, term);
        score += titleCount * 3 + keywordCount * 2 + abstractCount;
        total += titleCount + keywordCount + abstractCount;
      }
      return { ...a, _score: score, _total: total };
    }).sort((a, b) => b._score - a._score || b._total - a._total);
  }, [filteredArticles, filters.sort, highlightTerms]);

  const counts = useMemo(() => {
    let read = 0;
    let favorite = 0;
    for (const article of sortedArticles) {
      if (article.is_read) read += 1;
      if (article.is_favorite) favorite += 1;
    }
    return { read, favorite };
  }, [sortedArticles]);

  const visibleArticles = sortedArticles.slice(0, visibleCount);

  // 入场 stagger 批次起点（B3-2）：长度增长时，旧长度就是本批第一张卡的下标；
  // 长度不变或缩短（换筛选）时回到 0，让新键卡片从头级联。必须在
  // visibleArticles 定义之后调用（依赖数组渲染期求值）。
  useLayoutEffect(() => {
    const count = visibleArticles.length;
    enterStartRef.current = count > prevVisibleCountRef.current ? prevVisibleCountRef.current : 0;
    prevVisibleCountRef.current = count;
  }, [visibleArticles.length]);

  const hasMoreList = visibleCount < sortedArticles.length || hasMoreArticles;
  // 滚动哨兵和「加载下一批」按钮都会走到这里。实现放在 ref 里，observer 的
  // effect 才不会依赖「每次父组件渲染都会换新引用」的回调。并发也用 ref 拦：
  // state 要等下一次渲染才生效，拦不住同一帧里按钮和哨兵的两次触发。
  const loadMoreImplRef = useRef(null);
  const loadMoreBusyRef = useRef(false);
  const loadStateRef = useRef({ loading: false });
  const sentinelVisibleRef = useRef(false);
  // 观察器在重建和状态变化时都会回调一次：哨兵只要一直待在视口里，就会被反复
  // 触发。有进展时这正是「滚到底就继续加载」该有的样子；一旦某一批没有任何
  // 进展（请求被丢弃或失败），就必须停下来，否则会变成不停打接口。
  const autoLoadStalledRef = useRef(false);
  loadStateRef.current.loading = loadingMoreArticles;
  loadMoreImplRef.current = async () => {
    if (loadMoreBusyRef.current || loadStateRef.current.loading) return false;
    loadMoreBusyRef.current = true;
    try {
      if (visibleCount < sortedArticles.length) {
        setVisibleCount((count) => count + ARTICLE_PAGE_SIZE);
        return true;
      }
      const loaded = await onLoadMore?.();
      if (loaded) setVisibleCount((count) => count + ARTICLE_PAGE_SIZE);
      return Boolean(loaded);
    } finally {
      loadMoreBusyRef.current = false;
    }
  };
  const loadMore = useCallback(() => loadMoreImplRef.current(), []);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasMoreList) return undefined;
    const observer = new IntersectionObserver((entries) => {
      const entry = entries[0];
      const wasVisible = sentinelVisibleRef.current;
      sentinelVisibleRef.current = entry.isIntersecting;
      if (!entry.isIntersecting) {
        // 哨兵离开了视口：用户还在往下看，放开重试。
        autoLoadStalledRef.current = false;
        return;
      }
      if (loadStateRef.current.loading) return;
      if (autoLoadStalledRef.current && wasVisible) return;
      autoLoadStalledRef.current = false;
      void loadMore().then((progressed) => {
        if (!progressed) autoLoadStalledRef.current = true;
      });
    }, { rootMargin: "240px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMoreList, loadingMoreArticles, loadMore]);

  const selectedArticles = useMemo(
    () => sortedArticles.filter((article) => selectedIds.has(article.id)),
    [sortedArticles, selectedIds]
  );

  const toggleSelect = useCallback((id) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // One click on a keyword turns browsing into a focused search, which is the
  // fastest path into the topic the reader actually cares about.
  const selectKeyword = useCallback((keyword) => {
    setFilters((current) => {
      const active = Array.isArray(current.keyword) ? current.keyword : [];
      return {
        ...current,
        keyword: active.includes(keyword) ? active.filter((item) => item !== keyword) : [...active, keyword]
      };
    });
    setFilterOpen(true);
  }, [setFilters]);

  async function runBatch(action) {
    const targets = selectedArticles.filter((article) => (action === "read" ? !article.is_read : !article.is_favorite));
    if (!targets.length) {
      setSelectedIds(new Set());
      notify?.(`选中的 ${selectedArticles.length} 篇已经是目标状态。`, { type: "info" });
      return;
    }
    setBatchBusy(action);
    const patches = [];
    let failed = 0;
    for (const article of targets) {
      try {
        if (action === "read") {
          await api.post(`/api/articles/${article.id}/read`);
          patches.push({ id: article.id, is_read: 1 });
        } else {
          await api.post(`/api/articles/${article.id}/favorite`);
          patches.push({ id: article.id, is_favorite: 1 });
        }
      } catch {
        failed += 1;
      }
    }
    if (patches.length) onArticleUpdated(patches);
    setBatchBusy("");
    setSelectedIds(new Set());
    const label = action === "read" ? "标记已读" : "加入收藏";
    // U4：成功后给 8 秒撤销窗口——误选 50 篇批量已读，如今一键还原。
    notify?.(
      failed ? `已完成 ${patches.length} 篇${label}，${failed} 篇失败。` : `已${label} ${patches.length} 篇。`,
      { type: failed ? "warning" : "success", action: patches.length ? { label: "撤销", onClick: () => undoBatch(action, patches) } : null }
    );
    await onDataChanged?.();
  }

  /** U4：撤销批量操作。同一 toggle 接口再次调用即回原状态；失败的篇数如实告知。 */
  async function undoBatch(action, patches) {
    if (!patches.length) return;
    let failed = 0;
    for (const patch of patches) {
      try {
        await api.post(`/api/articles/${patch.id}/${action === "read" ? "read" : "favorite"}`);
      } catch {
        failed += 1;
      }
    }
    const revert = patches.map((patch) => (
      action === "read" ? { id: patch.id, is_read: 0 } : { id: patch.id, is_favorite: 0 }
    ));
    onArticleUpdated(revert);
    notify?.(
      failed ? `已撤销，但 ${failed} 篇恢复失败，请手动修改。` : `已撤销：${patches.length} 篇恢复原状态。`,
      { type: failed ? "warning" : "info" }
    );
    await onDataChanged?.();
  }

  function exportSelection(format) {
    if (!selectedArticles.length) return;
    const stamp = new Date().toISOString().slice(0, 10);
    downloadTextFile(
      `电气前沿速递-${stamp}-${selectedArticles.length}篇.${format === "ris" ? "ris" : "bib"}`,
      format === "ris" ? toRis(selectedArticles) : toBibtex(selectedArticles)
    );
    notify?.(`已导出 ${selectedArticles.length} 篇文献（${format === "ris" ? "RIS" : "BibTeX"}）。`, { type: "success" });
  }

  const journalGroups = useMemo(() => groupJournals(journals), [journals]);

  const activeFilterCount = filters.journal.length + filters.direction.length + filters.keyword.length
    + (filters.q ? 1 : 0) + (filters.from ? 1 : 0) + (filters.to ? 1 : 0)
    + (filters.unread ? 1 : 0) + (filters.read ? 1 : 0) + (filters.favorite ? 1 : 0);

  return (
    <div className={`content-layout ${filterOpen ? "filters-open" : "filters-closed"}${feedMode === "reader" ? " feed-reader-mode" : ""}`}>
      {filterOpen && <div className="filter-scrim" aria-hidden="true" onClick={() => setFilterOpen(false)} />}
      <aside className="filter-panel" id="feed-filters">
        <div className="filter-panel-header">
          <div><span className="eyebrow">检索工具</span><h2>筛选条件</h2></div>
          <button className="icon-button filter-close-button" type="button" title="收起筛选" aria-label="收起筛选" onClick={() => setFilterOpen(false)}><X size={18} /></button>
        </div>
        {activeFilterCount > 0 && (
          <button
            className="secondary compact filter-reset-all"
            type="button"
            title="清除全部筛选条件"
            onClick={() => setFilters({ ...DEFAULT_FILTERS })}
          >
            <RotateCcw size={13} /> 清除全部筛选（{activeFilterCount}）
          </button>
        )}
        <div className={`filter-group ${isFilterGroupCollapsed("search") ? "is-collapsed" : ""}`}>
          {filterGroupHeader("search", "搜索", <Search size={14} aria-hidden="true" />, {
            active: Boolean(filters.q),
            onClear: () => setFilters({ ...filters, q: "" })
          })}
          <div className="filter-group-content" id="feed-filter-group-search" hidden={isFilterGroupCollapsed("search")}>
            <div className="search-field">
              <Search size={14} className="search-field-icon" aria-hidden="true" />
              <input
                className="search-input"
                ref={searchInputRef}
                value={filters.q}
                aria-label="搜索标题、摘要、作者或关键词"
                onChange={(event) => setFilters({ ...filters, q: event.target.value })}
                placeholder="搜索标题、摘要、作者或关键词"
              />
              {/* U1：原「按 / 键聚焦搜索框」kbd 提示已移除——快捷键功能
                  于 2026-10-09 整体移除（见 706af2e），提示成了永不兑现的
                  承诺；如后续重做快捷键，请与提示同步上线。 */}
              {filters.q && (
                <button className="search-clear" type="button" aria-label="清除搜索" onClick={() => setFilters({ ...filters, q: "" })}>
                  <X size={14} />
                </button>
              )}
            </div>
          </div>
        </div>
        <div className={`filter-group ${isFilterGroupCollapsed("journal") ? "is-collapsed" : ""}`}>
          {filterGroupHeader("journal", "期刊", <BookOpen size={14} aria-hidden="true" />, {
            active: filters.journal.length > 0,
            onClear: () => setFilters({ ...filters, journal: [] })
          })}
          <div className="filter-group-content" id="feed-filter-group-journal" hidden={isFilterGroupCollapsed("journal")}>
            {/* Grouped by publisher so a 15-journal catalogue reads as four
                blocks instead of one long list. Empty groups never render.
                Each block is collapsible (需求 2): the head toggles its list. */}
            {journalGroups.map((group) => {
              const groupCollapsed = isJournalGroupCollapsed(group.key);
              const names = group.items.map((j) => j.name);
              const selectedInGroup = names.filter((n) => filters.journal.includes(n)).length;
              const allSelected = names.length > 0 && selectedInGroup === names.length;
              const toggleAllInGroup = () => {
                const next = allSelected
                  ? filters.journal.filter((n) => !names.includes(n))
                  : [...new Set([...filters.journal, ...names])];
                setFilters({ ...filters, journal: next });
              };
              return (
                <div className="journal-group" key={group.key}>
                  <div className="journal-group-row">
                    <button
                      type="button"
                      className={`journal-group-head${groupCollapsed ? " is-collapsed" : ""}`}
                      aria-expanded={!groupCollapsed}
                      aria-controls={`feed-journal-group-${group.key}`}
                      onClick={() => toggleJournalGroup(group.key)}
                    >
                      <span className={`journal-group-dot tone-${group.key}`} aria-hidden="true" />
                      <span className="journal-group-label">{group.label}</span>
                      <span className="journal-group-count">{group.items.length} 本</span>
                      <ChevronDown size={14} className="journal-group-chevron" aria-hidden="true" />
                    </button>
                    {/* 出版社级全选（需求）：勾选一键选中小节全部期刊，部分选中为半选态；
                        放在组头 button 外，避免嵌套交互元素与折叠点击冲突。 */}
                    <label
                      className={`journal-group-selectall${allSelected ? " is-all" : ""}`}
                      title={`全选/取消「${group.label}」全部期刊`}
                    >
                      <input
                        type="checkbox"
                        checked={allSelected}
                        ref={(el) => { if (el) el.indeterminate = selectedInGroup > 0 && !allSelected; }}
                        onChange={toggleAllInGroup}
                      />
                      全选
                    </label>
                  </div>
                  <div className="keyword-filter-list journal-filter-list" id={`feed-journal-group-${group.key}`} hidden={groupCollapsed}>
                    {group.items.map((j) => (
                      <button
                        key={j.name}
                        className={`keyword-filter-chip journal-filter-chip tone-${group.key} ${filters.journal.includes(j.name) ? "active" : ""}`}
                        onClick={() => {
                          const next = filters.journal.includes(j.name)
                            ? filters.journal.filter((k) => k !== j.name)
                            : [...filters.journal, j.name];
                          setFilters({ ...filters, journal: next });
                        }}
                        title={j.name}
                      >
                        <span className="kw-name">{j.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div className={`filter-group ${isFilterGroupCollapsed("direction") ? "is-collapsed" : ""}`}>
          {filterGroupHeader("direction", "研究方向", <Compass size={14} aria-hidden="true" />, {
            active: filters.direction.length > 0,
            onClear: () => setFilters({ ...filters, direction: [] })
          })}
          <div className="filter-group-content" id="feed-filter-group-direction" hidden={isFilterGroupCollapsed("direction")}>
            <div className="keyword-filter-list direction-filter-list">
              {/* 「其他」不进入文献库展示与筛选入口（需求 3）：后端默认排除
                  research_direction='other'，这里不再提供豁免入口；数据保留，
                  管理端与 /api/directions 统计仍可见。 */}
              {DIRECTIONS.filter((direction) => direction.key !== "other").map((direction) => {
                const count = directionCounts?.find((item) => item.key === direction.key)?.total;
                const active = filters.direction.includes(direction.key);
                return (
                  <button
                    key={direction.key}
                    className={`direction-filter-chip ${active ? "active" : ""}`}
                    style={active ? { "--dir-key": directionVar(direction.key) } : undefined}
                    onClick={() => {
                      const next = filters.direction.includes(direction.key)
                        ? filters.direction.filter((k) => k !== direction.key)
                        : [...filters.direction, direction.key];
                      setFilters({ ...filters, direction: next });
                    }}
                    title={directionLabel(direction.key)}
                  >
                    <span className="direction-dot" style={{ "--dir-key": directionVar(direction.key) }} aria-hidden="true" />
                    <span className="kw-name">{directionLabel(direction.key)}</span>
                    {typeof count === "number" && <span className="kw-count">{count}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        <div className={`filter-group ${isFilterGroupCollapsed("date") ? "is-collapsed" : ""}`}>
          {filterGroupHeader("date", "时间范围", <CalendarDays size={14} aria-hidden="true" />, {
            active: Boolean(filters.from || filters.to),
            onClear: () => setFilters({ ...filters, from: "", to: "" })
          })}
          <div className="filter-group-content" id="feed-filter-group-date" hidden={isFilterGroupCollapsed("date")}>
            {/* 甲-2：快捷区间——点击回填起止日期，再点取消；与摘要条联动 */}
            <div className="feed-date-quick" role="group" aria-label="时间快捷区间">
              {QUICK_RANGES.map((item) => {
                const target = quickRangeDates(item.key);
                const active = filters.from === target.from && filters.to === target.to;
                return (
                  <button
                    key={item.key}
                    type="button"
                    className={`feed-date-quick-chip${active ? " on" : ""}`}
                    aria-pressed={active}
                    title={active ? `取消「${item.label}」` : `${item.label}：${target.from} ~ ${target.to}`}
                    onClick={() => setFilters({ ...filters, from: active ? "" : target.from, to: active ? "" : target.to })}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
            <input
              type="date"
              value={filters.from}
              onChange={(event) => setFilters({ ...filters, from: event.target.value })}
              aria-label="开始日期"
            />
            <input
              type="date"
              value={filters.to}
              onChange={(event) => setFilters({ ...filters, to: event.target.value })}
              aria-label="结束日期"
            />
          </div>
        </div>
        <div className={`filter-group ${isFilterGroupCollapsed("flags") ? "is-collapsed" : ""}`}>
          {filterGroupHeader("flags", "筛选", <Filter size={14} aria-hidden="true" />, {
            active: Boolean(filters.unread || filters.favorite),
            onClear: () => setFilters({ ...filters, unread: false, favorite: false })
          })}
          <div className="filter-group-content" id="feed-filter-group-flags" hidden={isFilterGroupCollapsed("flags")}>
            <div className="filter-row">
              <label className="checkline">
                <input
                  type="checkbox"
                  checked={filters.unread}
                  onChange={(event) => setFilters({ ...filters, unread: event.target.checked })}
                />
                仅未读
              </label>
              <label className="checkline">
                <input
                  type="checkbox"
                  checked={filters.favorite}
                  onChange={(event) => setFilters({ ...filters, favorite: event.target.checked })}
                />
                仅收藏
              </label>
            </div>
          </div>
        </div>
        <div className={`filter-group ${isFilterGroupCollapsed("keyword") ? "is-collapsed" : ""}`}>
          {filterGroupHeader("keyword", "关键词", <Tag size={14} aria-hidden="true" />, {
            active: filters.keyword.length > 0,
            onClear: () => setFilters({ ...filters, keyword: [] })
          })}
          <div className="filter-group-content" id="feed-filter-group-keyword" hidden={isFilterGroupCollapsed("keyword")}>
            <div className="keyword-filter-list">
              {topKeywords.map((item) => (
                <button
                  key={item.keyword}
                  className={`keyword-filter-chip ${filters.keyword.includes(item.keyword) ? "active" : ""}`}
                  onClick={() => {
                    const next = filters.keyword.includes(item.keyword)
                      ? filters.keyword.filter((k) => k !== item.keyword)
                      : [...filters.keyword, item.keyword];
                    setFilters({ ...filters, keyword: next });
                  }}
                  title={item.keyword}
                >
                  <span className="kw-name">{item.keyword}</span>
                  <span className="kw-count">{item.count}</span>
                </button>
              ))}
              {topKeywords.length === 0 && <span style={{ fontSize: 12, color: "var(--text-muted)" }}>暂无数据</span>}
            </div>
          </div>
        </div>
        <div className={`filter-group ${isFilterGroupCollapsed("sort") ? "is-collapsed" : ""}`}>
          {filterGroupHeader("sort", "排序", <ArrowDownUp size={14} aria-hidden="true" />)}
          <div className="filter-group-content" id="feed-filter-group-sort" hidden={isFilterGroupCollapsed("sort")}>
            <label className="sort-select">
              <ArrowDownUp size={14} />
              <select
                value={filters.sort}
                onChange={(event) => setFilters({ ...filters, sort: event.target.value })}
              >
                <option value="desc">最新优先</option>
                <option value="asc">最早优先</option>
                <option value="relevance">按相关性</option>
              </select>
            </label>
          </div>
        </div>
      </aside>
      <section className="content-main">
        {/* A3：每视图一个 h1。文献库的页面标题此前缺失（只有筛选面板的 h2），
            屏幕阅读器无法按标题导航；用 sr-only 保持视觉不变。 */}
        <h1 className="sr-only">文献库</h1>
        {feedMode === "reader" && (
          <ReaderSetup journals={journals} onStart={(session) => setReaderSession(session)} onExit={() => switchFeedMode("overview")} />
        )}
        <div className="feed-toolbar">
          {/* Two equal columns instead of two free-floating buttons: the pair
              used to share one flex row with the display toggles and collapsed
              into a vertical stack as soon as the list area got narrow. */}
          <div className="feed-toolbar-actions">
            <button className="secondary filter-toggle" type="button" aria-expanded={filterOpen} aria-controls="feed-filters" onClick={() => setFilterOpen((current) => !current)}>
              <Filter size={15} /> {filterOpen ? "收起筛选" : "打开筛选"}
              {activeFilterCount > 0 && <span className="filter-count-badge">{activeFilterCount}</span>}
            </button>
            {/* 卡片阅读入口（2026-10-13）：与「打开筛选」并排的第二列 */}
            <button className="secondary feed-cardread-entry" type="button" title="按范围逐条卡片式阅读文献" onClick={() => switchFeedMode("reader")}>
              <BookOpenCheck size={15} /> 卡片阅读
            </button>
          </div>
        {/* 2026-10-13：工具栏快捷筛选——时间范围（与面板快捷区间同源）与阅读状态（按用户） */}
        <div className="feed-quick-group" role="group" aria-label="时间范围">
          <span className="feed-quick-label">时间范围</span>
          {QUICK_RANGES.map((item) => {
            const target = quickRangeDates(item.key);
            const active = filters.from === target.from && filters.to === target.to;
            return (
              <button
                key={`toolbar-${item.key}`}
                type="button"
                className={`feed-quick-chip${active ? " on" : ""}`}
                aria-pressed={active}
                title={active ? `取消「${item.label}」` : `${item.label}：${target.from} ~ ${target.to}`}
                onClick={() => setFilters({ ...filters, from: active ? "" : target.from, to: active ? "" : target.to })}
              >
                {item.label}
              </button>
            );
          })}
        </div>
        <div className="feed-quick-group" role="group" aria-label="阅读状态">
          <span className="feed-quick-label">阅读状态</span>
          {READ_STATES.map((item) => {
            const active = item.key === "all"
              ? !filters.unread && !filters.read
              : (item.key === "unread" ? Boolean(filters.unread) : Boolean(filters.read));
            return (
              <button
                key={`toolbar-${item.key}`}
                type="button"
                className={`feed-quick-chip${active ? " on" : ""}`}
                aria-pressed={active}
                title={item.key === "all" ? "显示全部阅读状态" : `只看${item.label}的文献`}
                onClick={() => setFilters({ ...filters, unread: item.key === "unread", read: item.key === "read" })}
              >
                {item.label}
              </button>
            );
          })}
        </div>
        <div className="display-toggles">
          <span className="display-toggles-label">显示内容</span>
          {/* A4：显示开关统一 aria-pressed + 动态 aria-label，屏幕阅读器可播报开关态 */}
          <button type="button" className={`display-toggle ${displayPreferences.authors ? "active" : ""}`} aria-pressed={displayPreferences.authors} aria-label={displayPreferences.authors ? "隐藏作者" : "显示作者"} title={displayPreferences.authors ? "隐藏作者" : "显示作者"} onClick={() => toggleDisplay("authors")}>
            {displayPreferences.authors ? <Eye size={14} /> : <EyeOff size={14} />} 作者
          </button>
          <button type="button" className={`display-toggle ${displayPreferences.keywords ? "active" : ""}`} aria-pressed={displayPreferences.keywords} aria-label={displayPreferences.keywords ? "隐藏关键词" : "显示关键词"} title={displayPreferences.keywords ? "隐藏关键词" : "显示关键词"} onClick={() => toggleDisplay("keywords")}>
            {displayPreferences.keywords ? <Eye size={14} /> : <EyeOff size={14} />} 关键词
          </button>
          <button type="button" className={`display-toggle ${displayPreferences.abstract ? "active" : ""}`} aria-pressed={displayPreferences.abstract} aria-label={displayPreferences.abstract ? "隐藏摘要" : "显示摘要"} title={displayPreferences.abstract ? "隐藏摘要" : "显示摘要"} onClick={() => toggleDisplay("abstract")}>
            {displayPreferences.abstract ? <Eye size={14} /> : <EyeOff size={14} />} 摘要
          </button>
          <button
            type="button"
            className={`display-toggle ${displayPreferences.bilingual ? "active" : ""}`}
            aria-pressed={displayPreferences.bilingual}
            aria-label={displayPreferences.bilingual ? "隐藏中文标题" : "显示中文标题"}
            title={displayPreferences.bilingual ? "隐藏中文标题" : "显示中文标题"}
            onClick={() => toggleDisplay("bilingual")}
          >
            {displayPreferences.bilingual ? <Eye size={14} /> : <EyeOff size={14} />}
            中文标题
          </button>
          <button type="button" className={`display-toggle ${displayPreferences.translatedAbstract ? "active" : ""}`} aria-pressed={displayPreferences.translatedAbstract} aria-label={displayPreferences.translatedAbstract ? "隐藏中文摘要" : "显示中文摘要"} title={displayPreferences.translatedAbstract ? "隐藏中文摘要" : "显示中文摘要"} onClick={() => toggleDisplay("translatedAbstract")}>
            {displayPreferences.translatedAbstract ? <Eye size={14} /> : <EyeOff size={14} />} 中文摘要
          </button>
        </div>
        </div>

        {/* 甲-1：生效筛选摘要条——一 chip 一组，点标签打开筛选面板、点 × 单组移除 */}
        {activeFilterCount > 0 && (
          <div className="feed-filter-summary" role="region" aria-label="已生效的筛选条件">
            <span className="feed-filter-summary-label">已选条件</span>
            {filters.journal.length > 0 && (
              <span className="feed-filter-chip">
                <button type="button" className="feed-filter-chip-label" title={`期刊：${filters.journal.join("、")}（点击打开筛选面板）`} onClick={() => setFilterOpen(true)}>
                  期刊 ×{filters.journal.length}
                </button>
                <button type="button" className="feed-filter-chip-x" aria-label="移除期刊筛选" title="移除期刊筛选" onClick={() => setFilters({ ...filters, journal: [] })}><X size={11} aria-hidden="true" /></button>
              </span>
            )}
            {filters.direction.length > 0 && (
              <span className="feed-filter-chip">
                <button type="button" className="feed-filter-chip-label" title={`方向：${filters.direction.map(directionLabel).join("、")}（点击打开筛选面板）`} onClick={() => setFilterOpen(true)}>
                  方向 ×{filters.direction.length}
                </button>
                <button type="button" className="feed-filter-chip-x" aria-label="移除方向筛选" title="移除方向筛选" onClick={() => setFilters({ ...filters, direction: [] })}><X size={11} aria-hidden="true" /></button>
              </span>
            )}
            {filters.keyword.length > 0 && (
              <span className="feed-filter-chip">
                <button type="button" className="feed-filter-chip-label" title={`关键词：${filters.keyword.join("、")}（点击打开筛选面板）`} onClick={() => setFilterOpen(true)}>
                  关键词 ×{filters.keyword.length}
                </button>
                <button type="button" className="feed-filter-chip-x" aria-label="移除关键词筛选" title="移除关键词筛选" onClick={() => setFilters({ ...filters, keyword: [] })}><X size={11} aria-hidden="true" /></button>
              </span>
            )}
            {filters.q && (
              <span className="feed-filter-chip">
                <button type="button" className="feed-filter-chip-label" title={`搜索：${filters.q}`} onClick={() => setFilterOpen(true)}>
                  搜索「{filters.q.length > 12 ? `${filters.q.slice(0, 12)}…` : filters.q}」
                </button>
                <button type="button" className="feed-filter-chip-x" aria-label="移除搜索词" title="移除搜索词" onClick={() => setFilters({ ...filters, q: "" })}><X size={11} aria-hidden="true" /></button>
              </span>
            )}
            {(filters.from || filters.to) && (
              <span className="feed-filter-chip">
                <button type="button" className="feed-filter-chip-label" title="时间范围（点击打开筛选面板）" onClick={() => setFilterOpen(true)}>
                  时间 {filters.from || "…"} ~ {filters.to || "…"}
                </button>
                <button type="button" className="feed-filter-chip-x" aria-label="移除时间筛选" title="移除时间筛选" onClick={() => setFilters({ ...filters, from: "", to: "" })}><X size={11} aria-hidden="true" /></button>
              </span>
            )}
            {filters.unread && (
              <span className="feed-filter-chip">
                <span className="feed-filter-chip-static">仅未读</span>
                <button type="button" className="feed-filter-chip-x" aria-label="移除仅未读筛选" title="移除仅未读筛选" onClick={() => setFilters({ ...filters, unread: false })}><X size={11} aria-hidden="true" /></button>
              </span>
            )}
            {filters.read && (
              <span className="feed-filter-chip">
                <span className="feed-filter-chip-static">仅已读</span>
                <button type="button" className="feed-filter-chip-x" aria-label="移除仅已读筛选" title="移除仅已读筛选" onClick={() => setFilters({ ...filters, read: false })}><X size={11} aria-hidden="true" /></button>
              </span>
            )}
            {filters.favorite && (
              <span className="feed-filter-chip">
                <span className="feed-filter-chip-static">仅收藏</span>
                <button type="button" className="feed-filter-chip-x" aria-label="移除仅收藏筛选" title="移除仅收藏筛选" onClick={() => setFilters({ ...filters, favorite: false })}><X size={11} aria-hidden="true" /></button>
              </span>
            )}
            <button type="button" className="feed-filter-summary-clear" onClick={() => setFilters({ ...DEFAULT_FILTERS })}>
              清除全部
            </button>
          </div>
        )}

        {/* U5/P3：列表后台更新提示（stale-while-revalidate：旧结果驻留，不闪空） */}
        {listUpdating && (
          <p className="list-updating-pill" role="status">正在更新，显示的是上次结果</p>
        )}

        <div className="article-count" role="status" aria-live="polite">
          共 <strong>{articlesTotal || sortedArticles.length}</strong> 篇文献
          {counts.read > 0 && <>，已读 <strong>{counts.read}</strong> 篇</>}
          {counts.favorite > 0 && <>，收藏 <strong>{counts.favorite}</strong> 篇</>}
        </div>

        {selectedIds.size > 0 && (
          <div className="batch-bar" role="region" aria-label="批量操作">
            <span className="batch-bar-count">已选 <strong>{selectedIds.size}</strong> 篇</span>
            {batchBusy && <span className="batch-bar-busy" role="status" aria-live="polite">正在处理…</span>}
            <button className="secondary compact" type="button" disabled={Boolean(batchBusy)} onClick={() => runBatch("read")}>
              <Check size={14} /> 全部标记已读
            </button>
            <button className="secondary compact" type="button" disabled={Boolean(batchBusy)} onClick={() => runBatch("favorite")}>
              <Star size={14} /> 批量收藏
            </button>
            <button className="secondary compact" type="button" disabled={Boolean(batchBusy)} onClick={() => exportSelection("ris")}>
              <Download size={14} /> 导出 RIS
            </button>
            <button className="secondary compact" type="button" disabled={Boolean(batchBusy)} onClick={() => exportSelection("bibtex")}>
              <Download size={14} /> 导出 BibTeX
            </button>
            <button className="link-button batch-bar-clear" type="button" onClick={() => setSelectedIds(new Set())}>取消选择</button>
          </div>
        )}

        <div className="article-list" id="article-list">
          {sortedArticles.length === 0 ? (
            activeFilterCount > 0 ? (
              <EmptyState
                art="search"
                title="没有符合当前条件的文献"
                description="期刊、关键词、时间范围、未读与收藏筛选的组合没有命中任何记录。清空条件即可回到完整列表。"
                action={<button className="secondary" type="button" onClick={() => setFilters({ ...DEFAULT_FILTERS })}>清除全部筛选条件</button>}
              />
            ) : (
              <EmptyState
                art="inbox"
                title="还没有文献数据"
                description="数据库中暂时没有可显示的文献，可以立即从公开数据源刷新获取。"
                action={onRefresh ? (
                  <button className="primary" type="button" disabled={refreshing} onClick={() => onRefresh()}>
                    <RefreshCw size={15} className={refreshing ? "spin" : ""} /> {refreshing ? "刷新中" : "立即刷新"}
                  </button>
                ) : null}
              />
            )
          ) : (
            visibleArticles.map((article, index) => (
              <ArticleCard
                key={article.id}
                article={article}
                journals={journals}
                displayPreferences={displayPreferences}
                highlightTerms={highlightTerms}
                canPersonalize={canPersonalize}
                enterDelay={Math.min(Math.max(index - enterStartRef.current, 0), 15) * 40}
                onOpen={setSelectedArticle}
                markRead={markRead}
                toggleFavorite={toggleFavorite}
                onSelectKeyword={selectKeyword}
                selectable={canPersonalize}
                selected={selectedIds.has(article.id)}
                onToggleSelect={toggleSelect}
              />
            ))
          )}
        </div>
        <div ref={sentinelRef} aria-hidden="true" className="load-sentinel" />
        {hasMoreList && <div className="load-more"><button
          className="secondary"
          type="button"
          disabled={loadingMoreArticles}
          onClick={loadMore}
        >
          {loadingMoreArticles ? "加载中…" : hasMoreArticles ? "加载下一批文献" : `继续显示下一批文献（剩余 ${sortedArticles.length - visibleCount} 篇）`}
        </button></div>}
      </section>
      <BackToTop />
      <CardReader
        open={Boolean(readerSession)}
        onClose={() => setReaderSession(null)}
        title={readerSession?.title || ""}
        ids={readerSession?.ids || []}
        briefs={readerSession?.briefs || []}
        canPersonalize={canPersonalize}
        onArticleUpdated={onArticleUpdated}
      />
      {selectedArticle && (
        <ArticleDialog
          article={selectedArticle}
          close={() => setSelectedArticle(null)}
          markRead={markRead}
          toggleFavorite={toggleFavorite}
          onArticleUpdated={handleArticleUpdated}
          onOpenArticle={setSelectedArticle}
          hideTranslatedAbstract={isChineseJournalArticle(selectedArticle, journals)}
          canModerate={canModerate}
        />
      )}
    </div>
  );
}

export default Feed;
