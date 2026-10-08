import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowDownUp, BookOpen, CalendarDays, Check, ChevronDown, Compass, Download, Eye, EyeOff, Filter, Keyboard, RefreshCw, RotateCcw, Search, Star, Tag, X } from "lucide-react";
import { api } from "../../lib/api.js";
import { ARTICLE_PAGE_SIZE, DEFAULT_FILTERS } from "../../lib/constants.js";
import { downloadTextFile, toBibtex, toRis } from "../../lib/export.js";
import { isChineseJournalArticle, isChineseSourceText } from "../../lib/format.js";
import { groupJournals, journalAbbr } from "../../lib/journal.js";
import { DIRECTIONS, directionLabel, directionVar } from "../../lib/directions.js";
import ArticleCard from "../../components/ArticleCard.jsx";
import EmptyState from "../../components/EmptyState.jsx";
import useListShortcuts from "../../hooks/useListShortcuts.js";
import ArticleDialog from "./ArticleDialog.jsx";

function Feed({ articles, articlesTotal = 0, subscribedJournals, journals, filters, setFilters, markRead, toggleFavorite, displayPreferences, onDisplayPreferencesChange, onArticleUpdated, canPersonalize, canModerate = false, onLoadMore, hasMoreArticles, loadingMoreArticles, queryKey = "", notify, onRefresh = null, refreshing = false, onDataChanged = null }) {
  const [selectedArticle, setSelectedArticle] = useState(null);
  const [filterOpen, setFilterOpen] = useState(true);
  const [collapsedFilterGroups, setCollapsedFilterGroups] = useState({
    search: false,
    journal: false,
    direction: false,
    date: false,
    flags: false,
    keyword: false,
    sort: false
  });
  const [topKeywords, setTopKeywords] = useState([]);
  const [directionCounts, setDirectionCounts] = useState(null);
  const [visibleCount, setVisibleCount] = useState(50);
  const [cursorIndex, setCursorIndex] = useState(-1);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [batchBusy, setBatchBusy] = useState("");
  // 期刊小节折叠（需求 2）：出版社分组可展开/收起，默认全部展开。
  const [collapsedJournalGroups, setCollapsedJournalGroups] = useState(() => new Set());
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

  function toggleFilterGroup(group) {
    setCollapsedFilterGroups((current) => ({ ...current, [group]: !current[group] }));
  }

  function filterGroupHeader(group, label, icon = null, clear = null) {
    const contentId = `feed-filter-group-${group}`;
    const collapsed = Boolean(collapsedFilterGroups[group]);
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

  function toggleJournalGroup(key) {
    setCollapsedJournalGroups((current) => {
      const next = new Set(current);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
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

  // Only show articles from subscribed journals
  const filteredArticles = articles.filter((article) =>
    subscribedJournals.length === 0 || subscribedJournals.includes(article.journal)
  );

  const highlightTerms = useMemo(() => {
    const terms = [];
    if (filters.q && filters.q.trim()) terms.push(filters.q.trim());
    if (filters.keyword && filters.keyword.length) terms.push(...filters.keyword);
    return terms;
  }, [filters.q, filters.keyword]);

  const sortedArticles = useMemo(() => {
    if (filters.sort !== "relevance" || !highlightTerms.length) return filteredArticles;
    const countMatches = (text, terms) => {
      if (!text) return 0;
      const lower = text.toLowerCase();
      let count = 0;
      for (const t of terms) {
        const tl = t.toLowerCase();
        let pos = 0;
        while ((pos = lower.indexOf(tl, pos)) !== -1) { count++; pos += tl.length; }
      }
      return count;
    };
    return [...filteredArticles].map((a) => {
      const titleCount = countMatches(a.title, highlightTerms);
      const keywordCount = countMatches(a.keywords, highlightTerms);
      const abstractCount = countMatches(a.abstract, highlightTerms);
      const score = titleCount * 3 + keywordCount * 2 + abstractCount;
      return { ...a, _score: score, _total: titleCount + keywordCount + abstractCount };
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

  const openByIndex = useCallback((index) => {
    const article = visibleArticles[index];
    if (article) setSelectedArticle(article);
  }, [visibleArticles]);
  const toggleReadByIndex = useCallback((index) => {
    const article = visibleArticles[index];
    if (article) markRead(article.id);
  }, [markRead, visibleArticles]);
  const toggleFavoriteByIndex = useCallback((index) => {
    const article = visibleArticles[index];
    if (article) toggleFavorite(article.id);
  }, [toggleFavorite, visibleArticles]);
  const focusSearchInput = useCallback(() => {
    setFilterOpen(true);
    searchInputRef.current?.focus();
  }, []);

  useListShortcuts({
    enabled: !selectedArticle && visibleArticles.length > 0,
    count: visibleArticles.length,
    index: cursorIndex,
    setIndex: setCursorIndex,
    onOpen: openByIndex,
    onToggleRead: toggleReadByIndex,
    onToggleFavorite: toggleFavoriteByIndex,
    onFocusSearch: focusSearchInput
  });

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
    notify?.(
      failed ? `已完成 ${patches.length} 篇${label}，${failed} 篇失败。` : `已${label} ${patches.length} 篇。`,
      { type: failed ? "warning" : "success" }
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
    + (filters.unread ? 1 : 0) + (filters.favorite ? 1 : 0);

  return (
    <div className={`content-layout ${filterOpen ? "filters-open" : "filters-closed"}`}>
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
        <div className={`filter-group ${collapsedFilterGroups.search ? "is-collapsed" : ""}`}>
          {filterGroupHeader("search", "搜索", <Search size={14} aria-hidden="true" />, {
            active: Boolean(filters.q),
            onClear: () => setFilters({ ...filters, q: "" })
          })}
          <div className="filter-group-content" id="feed-filter-group-search" hidden={collapsedFilterGroups.search}>
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
              {filters.q ? (
                <button className="search-clear" type="button" aria-label="清除搜索" onClick={() => setFilters({ ...filters, q: "" })}>
                  <X size={14} />
                </button>
              ) : (
                <kbd className="search-kbd" title="按 / 键聚焦搜索框">/</kbd>
              )}
            </div>
          </div>
        </div>
        <div className={`filter-group ${collapsedFilterGroups.journal ? "is-collapsed" : ""}`}>
          {filterGroupHeader("journal", "期刊", <BookOpen size={14} aria-hidden="true" />, {
            active: filters.journal.length > 0,
            onClear: () => setFilters({ ...filters, journal: [] })
          })}
          <div className="filter-group-content" id="feed-filter-group-journal" hidden={collapsedFilterGroups.journal}>
            {/* Grouped by publisher so a 15-journal catalogue reads as four
                blocks instead of one long list. Empty groups never render.
                Each block is collapsible (需求 2): the head toggles its list. */}
            {journalGroups.map((group) => {
              const groupCollapsed = collapsedJournalGroups.has(group.key);
              return (
                <div className="journal-group" key={group.key}>
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
        <div className={`filter-group ${collapsedFilterGroups.direction ? "is-collapsed" : ""}`}>
          {filterGroupHeader("direction", "研究方向", <Compass size={14} aria-hidden="true" />, {
            active: filters.direction.length > 0,
            onClear: () => setFilters({ ...filters, direction: [] })
          })}
          <div className="filter-group-content" id="feed-filter-group-direction" hidden={collapsedFilterGroups.direction}>
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
        <div className={`filter-group ${collapsedFilterGroups.date ? "is-collapsed" : ""}`}>
          {filterGroupHeader("date", "时间范围", <CalendarDays size={14} aria-hidden="true" />, {
            active: Boolean(filters.from || filters.to),
            onClear: () => setFilters({ ...filters, from: "", to: "" })
          })}
          <div className="filter-group-content" id="feed-filter-group-date" hidden={collapsedFilterGroups.date}>
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
        <div className={`filter-group ${collapsedFilterGroups.flags ? "is-collapsed" : ""}`}>
          {filterGroupHeader("flags", "筛选", <Filter size={14} aria-hidden="true" />, {
            active: Boolean(filters.unread || filters.favorite),
            onClear: () => setFilters({ ...filters, unread: false, favorite: false })
          })}
          <div className="filter-group-content" id="feed-filter-group-flags" hidden={collapsedFilterGroups.flags}>
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
        <div className={`filter-group ${collapsedFilterGroups.keyword ? "is-collapsed" : ""}`}>
          {filterGroupHeader("keyword", "关键词", <Tag size={14} aria-hidden="true" />, {
            active: filters.keyword.length > 0,
            onClear: () => setFilters({ ...filters, keyword: [] })
          })}
          <div className="filter-group-content" id="feed-filter-group-keyword" hidden={collapsedFilterGroups.keyword}>
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
        <div className={`filter-group ${collapsedFilterGroups.sort ? "is-collapsed" : ""}`}>
          {filterGroupHeader("sort", "排序", <ArrowDownUp size={14} aria-hidden="true" />)}
          <div className="filter-group-content" id="feed-filter-group-sort" hidden={collapsedFilterGroups.sort}>
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
        <div className="feed-toolbar">
          {/* Two equal columns instead of two free-floating buttons: the pair
              used to share one flex row with the display toggles and collapsed
              into a vertical stack as soon as the list area got narrow. */}
          <div className="feed-toolbar-actions">
            <button className="secondary filter-toggle" type="button" aria-expanded={filterOpen} aria-controls="feed-filters" onClick={() => setFilterOpen((current) => !current)}>
              <Filter size={15} /> {filterOpen ? "收起筛选" : "打开筛选"}
              {activeFilterCount > 0 && <span className="filter-count-badge">{activeFilterCount}</span>}
            </button>
            <button className="secondary shortcuts-toggle" type="button" aria-expanded={shortcutsOpen} aria-controls="feed-shortcuts" onClick={() => setShortcutsOpen((current) => !current)}>
              <Keyboard size={15} /> 快捷键
            </button>
          </div>
        <div className="display-toggles">
          <span className="display-toggles-label">显示内容</span>
          <button type="button" className={`display-toggle ${displayPreferences.authors ? "active" : ""}`} onClick={() => toggleDisplay("authors")}>
            {displayPreferences.authors ? <Eye size={14} /> : <EyeOff size={14} />} 作者
          </button>
          <button type="button" className={`display-toggle ${displayPreferences.keywords ? "active" : ""}`} onClick={() => toggleDisplay("keywords")}>
            {displayPreferences.keywords ? <Eye size={14} /> : <EyeOff size={14} />} 关键词
          </button>
          <button type="button" className={`display-toggle ${displayPreferences.abstract ? "active" : ""}`} onClick={() => toggleDisplay("abstract")}>
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
          <button type="button" className={`display-toggle ${displayPreferences.translatedAbstract ? "active" : ""}`} onClick={() => toggleDisplay("translatedAbstract")}>
            {displayPreferences.translatedAbstract ? <Eye size={14} /> : <EyeOff size={14} />} 中文摘要
          </button>
        </div>
        </div>

        {shortcutsOpen && (
          <div className="shortcuts-panel" id="feed-shortcuts">
            <div className="shortcuts-panel-head">
              <strong>键盘快捷键</strong>
              <button className="icon-button" type="button" aria-label="关闭快捷键说明" onClick={() => setShortcutsOpen(false)}><X size={16} /></button>
            </div>
            <dl className="shortcuts-list">
              <div><dt><kbd>j</kbd> / <kbd>↓</kbd></dt><dd>移动到下一条</dd></div>
              <div><dt><kbd>k</kbd> / <kbd>↑</kbd></dt><dd>移动到上一条</dd></div>
              <div><dt><kbd>Enter</kbd></dt><dd>打开当前条摘要</dd></div>
              <div><dt><kbd>r</kbd></dt><dd>切换已读</dd></div>
              <div><dt><kbd>f</kbd></dt><dd>切换收藏</dd></div>
              <div><dt><kbd>/</kbd></dt><dd>聚焦搜索框</dd></div>
              <div><dt><kbd>Esc</kbd></dt><dd>取消当前选中</dd></div>
            </dl>
            <p className="shortcuts-note">在输入框内按上面的字母不会触发快捷键；带 Ctrl / Meta / Alt 的组合键也不会被拦截。</p>
          </div>
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

        <div className="article-list">
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
                isCursor={index === cursorIndex}
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
