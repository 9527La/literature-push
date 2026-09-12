import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownUp, Check, ChevronDown, Download, Eye, EyeOff, Filter, Keyboard, RefreshCw, Search, Star, X } from "lucide-react";
import { api } from "../../lib/api.js";
import { ARTICLE_PAGE_SIZE, DEFAULT_FILTERS } from "../../lib/constants.js";
import { downloadTextFile, toBibtex, toRis } from "../../lib/export.js";
import { isChineseJournalArticle, isChineseSourceText } from "../../lib/format.js";
import { groupJournals, journalAbbr } from "../../lib/journal.js";
import ArticleCard from "../../components/ArticleCard.jsx";
import EmptyState from "../../components/EmptyState.jsx";
import useListShortcuts from "../../hooks/useListShortcuts.js";
import ArticleDialog from "./ArticleDialog.jsx";

function Feed({ articles, subscribedJournals, journals, filters, setFilters, markRead, toggleFavorite, displayPreferences, onDisplayPreferencesChange, onArticleUpdated, canPersonalize, onLoadMore, hasMoreArticles, loadingMoreArticles, queryKey = "", notify, onRefresh = null, refreshing = false, onDataChanged = null }) {
  const [selectedArticle, setSelectedArticle] = useState(null);
  const [filterOpen, setFilterOpen] = useState(true);
  const [collapsedFilterGroups, setCollapsedFilterGroups] = useState({
    search: false,
    journal: false,
    date: false,
    flags: false,
    keyword: false,
    sort: false
  });
  const [topKeywords, setTopKeywords] = useState([]);
  const [visibleCount, setVisibleCount] = useState(50);
  const [cursorIndex, setCursorIndex] = useState(-1);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [batchBusy, setBatchBusy] = useState("");
  const searchInputRef = useRef(null);
  const sentinelRef = useRef(null);
  const preparationHandlersRef = useRef({});
  const [preparation, setPreparation] = useState({ active: false, total: 0, completed: 0, enriched: 0, enrichedAbstract: 0, enrichedKeywords: 0, translated: 0, failed: 0, failedAbstract: 0, failedKeywords: 0, message: "" });
  const attemptedPreparationIdsRef = useRef(new Set());
  const preparationJobRef = useRef("");
  const preparationTimerRef = useRef(null);
  const preparationDelayRef = useRef(1500);
  const autoPreparationStartedRef = useRef(false);
  const preparationMountedRef = useRef(true);

  useEffect(() => {
    api.get("/api/keyword-stats").then((data) => {
      setTopKeywords(data.keywords || []);
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
    preparationMountedRef.current = true;
    return () => {
      preparationMountedRef.current = false;
      preparationJobRef.current = "";
      preparationDelayRef.current = 1500;
      if (preparationTimerRef.current) clearTimeout(preparationTimerRef.current);
    };
  }, []);

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

  function filterGroupHeader(group, label, icon = null) {
    const contentId = `feed-filter-group-${group}`;
    const collapsed = Boolean(collapsedFilterGroups[group]);
    return (
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

  function articleNeedsPreparation(article) {
    return !article.abstract?.trim()
      || !article.keywords?.trim()
      || (!isChineseSourceText(article.title) && !article.translated_title?.trim())
      || (Boolean(article.abstract?.trim()) && !isChineseSourceText(article.abstract) && !article.translated_abstract?.trim());
  }

  async function pollPreparationJob(jobId) {
    if (!preparationMountedRef.current || preparationJobRef.current !== jobId) return;
    try {
      const job = await api.get(`/api/articles/prepare/${jobId}`);
      if (job.results?.length) handleArticleUpdated(job.results);
      const finished = job.status === "complete";
      setPreparation({
        active: !finished,
        total: job.total,
        completed: job.completed,
        enriched: job.enriched,
        enrichedAbstract: job.enrichedAbstract,
        enrichedKeywords: job.enrichedKeywords,
        translated: job.translated,
        failed: job.failed,
        failedAbstract: job.failedAbstract,
        failedKeywords: job.failedKeywords,
        message: finished
          ? `后台补全完成：摘要 +${job.enrichedAbstract || 0}，关键词 +${job.enrichedKeywords || 0}，翻译 +${job.translated || 0}；失败：摘要 ${job.failedAbstract || 0}，关键词 ${job.failedKeywords || 0}，其他 ${Math.max((job.failed || 0) - (job.failedAbstract || 0) - (job.failedKeywords || 0), 0)}。`
          : "已有内容已从本地数据库直接显示，正在后台补全缺失的摘要、关键词和中文翻译。"
      });
      if (finished) {
        preparationJobRef.current = "";
        preparationTimerRef.current = setTimeout(() => {
          if (preparationMountedRef.current) setPreparation((current) => ({ ...current, message: "" }));
        }, 6000);
        return;
      }
      const delay = preparationDelayRef.current;
      preparationDelayRef.current = Math.min(delay * 2, 5000);
      preparationTimerRef.current = setTimeout(() => pollPreparationJob(jobId), delay);
    } catch (error) {
      preparationJobRef.current = "";
      setPreparation((current) => ({ ...current, active: false, message: `批量补全暂未完成：${error.message}` }));
    }
  }

  async function startArticlePreparation(ids, { force = false } = {}) {
    if (preparationJobRef.current) return;
    const uniqueIds = [...new Set(ids.map(Number).filter((id) => Number.isInteger(id) && id > 0))];
    const selectedIds = force
      ? uniqueIds
      : uniqueIds.filter((id) => !attemptedPreparationIdsRef.current.has(id));
    if (!selectedIds.length) return;
    selectedIds.forEach((id) => attemptedPreparationIdsRef.current.add(id));
    preparationDelayRef.current = 1500;
    setPreparation({ active: true, total: selectedIds.length, completed: 0, enriched: 0, enrichedAbstract: 0, enrichedKeywords: 0, translated: 0, failed: 0, failedAbstract: 0, failedKeywords: 0, message: `已从本地数据库直接显示已有内容，正在创建 ${selectedIds.length} 篇缺失内容的补全任务…` });
    try {
      const job = await api.post("/api/articles/prepare", { ids: selectedIds });
      preparationJobRef.current = job.jobId;
      setPreparation((current) => ({ ...current, total: job.total, message: "已有内容已从本地数据库直接显示，正在后台补全缺失的摘要、关键词和中文翻译。" }));
      await pollPreparationJob(job.jobId);
    } catch (error) {
      setPreparation((current) => ({ ...current, active: false, message: `无法启动批量补全：${error.message}` }));
    }
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
  const visibleTranslatedCount = visibleArticles.filter((article) => (
    article.translated_title && article.translated_title !== article.title
  )).length;
  const visibleAbstractCount = visibleArticles.filter((article) => Boolean(article.abstract?.trim())).length;
  const visibleTranslatedAbstractCount = visibleArticles.filter((article) => (
    !isChineseJournalArticle(article, journals) && Boolean(article.translated_abstract?.trim())
  )).length;
  const visiblePendingArticles = visibleArticles.filter(articleNeedsPreparation);
  const visibleReadyCount = visibleArticles.length - visiblePendingArticles.length;
  const visiblePendingCount = visiblePendingArticles.length;
  const visiblePreparationKey = visibleArticles.map((article) => [
    article.id,
    Boolean(article.abstract?.trim()),
    Boolean(article.keywords?.trim()),
    Boolean(article.translated_title?.trim()),
    Boolean(article.translated_abstract?.trim())
  ].join(":" )).join("|");

  useEffect(() => {
    if (autoPreparationStartedRef.current || preparationJobRef.current || !visibleArticles.length) return;
    const missingIds = visiblePendingArticles.map((article) => article.id);
    if (!missingIds.length) return;
    autoPreparationStartedRef.current = true;
    void startArticlePreparation(missingIds);
  }, [visiblePreparationKey, preparation.active, visibleArticles.length]);

  useEffect(() => {
    // A completion notice belongs to the page that started the job. Clear it
    // when the user switches to a different journal/filter so it is not
    // mistaken for another round of background loading.
    if (!preparation.active && preparation.message) {
      setPreparation((current) => ({ ...current, message: "" }));
    }
  }, [visiblePreparationKey]);

  preparationHandlersRef.current.startArticlePreparation = startArticlePreparation;
  // Stable wrappers keep every memoized card's props identical between renders.
  const requestPreparation = useCallback((ids, options) => (
    preparationHandlersRef.current.startArticlePreparation(ids, options)
  ), []);

  const hasMoreList = visibleCount < sortedArticles.length || hasMoreArticles;
  const loadMore = useCallback(async () => {
    if (visibleCount < sortedArticles.length) {
      setVisibleCount((count) => count + ARTICLE_PAGE_SIZE);
      return;
    }
    const loaded = await onLoadMore?.();
    if (loaded) setVisibleCount((count) => count + ARTICLE_PAGE_SIZE);
  }, [visibleCount, sortedArticles.length, onLoadMore]);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasMoreList) return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && !loadingMoreArticles) void loadMore();
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
      `电力文献-${stamp}-${selectedArticles.length}篇.${format === "ris" ? "ris" : "bib"}`,
      format === "ris" ? toRis(selectedArticles) : toBibtex(selectedArticles)
    );
    notify?.(`已导出 ${selectedArticles.length} 篇文献（${format === "ris" ? "RIS" : "BibTeX"}）。`, { type: "success" });
  }

  const journalGroups = useMemo(() => groupJournals(journals), [journals]);

  const activeFilterCount = filters.journal.length + filters.keyword.length
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
        <div className={`filter-group ${collapsedFilterGroups.search ? "is-collapsed" : ""}`}>
          {filterGroupHeader("search", "搜索", <Search size={14} aria-hidden="true" />)}
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
          {filterGroupHeader("journal", "期刊")}
          <div className="filter-group-content" id="feed-filter-group-journal" hidden={collapsedFilterGroups.journal}>
            {/* Grouped by publisher so a 15-journal catalogue reads as four
                blocks instead of one long list. Empty groups never render. */}
            {journalGroups.map((group) => (
              <div className="journal-group" key={group.key}>
                <div className="journal-group-head">
                  <span className={`journal-group-dot tone-${group.key}`} aria-hidden="true" />
                  <span className="journal-group-label">{group.label}</span>
                  <span className="journal-group-count">{group.items.length} 本</span>
                </div>
                <div className="keyword-filter-list journal-filter-list">
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
            ))}
          </div>
        </div>
        <div className={`filter-group ${collapsedFilterGroups.date ? "is-collapsed" : ""}`}>
          {filterGroupHeader("date", "时间范围")}
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
          {filterGroupHeader("flags", "筛选", <Filter size={14} aria-hidden="true" />)}
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
          {filterGroupHeader("keyword", "关键词")}
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
          <span className="display-summary" role="status">
            {`数据库已载入 ${visibleReadyCount} 篇`}
            {visiblePendingCount > 0 && ` · ${visiblePendingCount} 篇待补全`}
            {displayPreferences.bilingual && ` · ${visibleTranslatedCount} 篇有中文标题`}
            {displayPreferences.abstract && ` · ${visibleAbstractCount} 篇有摘要`}
            {displayPreferences.translatedAbstract && ` · ${visibleTranslatedAbstractCount} 篇有中文摘要`}
          </span>
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

        {(preparation.active || preparation.message) && (
          <div className={`preparation-bar ${preparation.active ? "active" : ""}`} role="status" aria-live="polite">
            <div className="preparation-copy">
              <strong>{preparation.active ? "正在补全当前页面缺失内容" : "当前页面后台补全结果"}</strong>
              <span>{preparation.message || "已有内容直接来自本地数据库，仅对缺失的摘要、关键词和翻译进行补全。"}</span>
            </div>
            {preparation.active && (
              <div className="preparation-progress">
                <progress max={Math.max(preparation.total, 1)} value={preparation.completed} />
                <span>{preparation.completed}/{preparation.total}</span>
              </div>
            )}
            {visiblePendingCount > 0 && (
              <button
                className="secondary compact"
                type="button"
                disabled={preparation.active}
                onClick={() => startArticlePreparation(visiblePendingArticles.map((article) => article.id), { force: true })}
              >
                <RefreshCw size={14} className={preparation.active ? "spin" : ""} /> 批量补全当前批次
              </button>
            )}
          </div>
        )}

        <div className="article-count" role="status" aria-live="polite">
          共 <strong>{sortedArticles.length}</strong> 篇文献
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
                preparationActive={preparation.active}
                canPersonalize={canPersonalize}
                isCursor={index === cursorIndex}
                onOpen={setSelectedArticle}
                markRead={markRead}
                toggleFavorite={toggleFavorite}
                requestPreparation={requestPreparation}
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
          hideTranslatedAbstract={isChineseJournalArticle(selectedArticle, journals)}
        />
      )}
    </div>
  );
}

export default Feed;
