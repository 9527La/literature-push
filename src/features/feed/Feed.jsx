import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownUp, ChevronDown, Eye, EyeOff, Filter, RefreshCw, Search, X } from "lucide-react";
import { api } from "../../lib/api.js";
import { ARTICLE_PAGE_SIZE } from "../../lib/constants.js";
import { isChineseJournalArticle, isChineseSourceText } from "../../lib/format.js";
import ArticleCard from "../../components/ArticleCard.jsx";
import useListShortcuts from "../../hooks/useListShortcuts.js";
import ArticleDialog from "./ArticleDialog.jsx";

function Feed({ articles, subscribedJournals, journals, filters, setFilters, markRead, toggleFavorite, displayPreferences, onDisplayPreferencesChange, onArticleUpdated, canPersonalize, onLoadMore, hasMoreArticles, loadingMoreArticles }) {
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

  useEffect(() => setVisibleCount(50), [filters]);

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
            <input
              className="search-input"
              ref={searchInputRef}
              value={filters.q}
              onChange={(event) => setFilters({ ...filters, q: event.target.value })}
              placeholder="搜索标题、摘要、作者或关键词"
            />
          </div>
        </div>
        <div className={`filter-group ${collapsedFilterGroups.journal ? "is-collapsed" : ""}`}>
          {filterGroupHeader("journal", "期刊")}
          <div className="filter-group-content" id="feed-filter-group-journal" hidden={collapsedFilterGroups.journal}>
            <div className="keyword-filter-list journal-filter-list">
              {journals.map((j) => (
                <button
                  key={j.name}
                  className={`keyword-filter-chip ${filters.journal.includes(j.name) ? "active" : ""}`}
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
          <button className="secondary filter-toggle" type="button" aria-expanded={filterOpen} aria-controls="feed-filters" onClick={() => setFilterOpen((current) => !current)}>
            <Filter size={15} /> {filterOpen ? "收起筛选" : "打开筛选"}
            {activeFilterCount > 0 && <span className="filter-count-badge">{activeFilterCount}</span>}
          </button>
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

        <div className="article-count">
          共 <strong>{sortedArticles.length}</strong> 篇文献
          {counts.read > 0 && <>，已读 <strong>{counts.read}</strong> 篇</>}
          {counts.favorite > 0 && <>，收藏 <strong>{counts.favorite}</strong> 篇</>}
        </div>

        <div className="article-list">
          {sortedArticles.length === 0 ? (
            <div className="empty">暂无文献。点击刷新从公开数据源获取，或调整筛选条件。</div>
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
