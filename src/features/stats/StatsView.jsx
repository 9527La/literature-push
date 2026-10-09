import { useEffect, useMemo, useState } from "react";
import { BarChart3, Cloud, Compass, Filter, Globe, Network, Search, X } from "lucide-react";
import { api } from "../../lib/api.js";
import { articleDate, formatDate, isChineseJournalArticle } from "../../lib/format.js";
import { directionVar } from "../../lib/directions.js";
import ArticleDialog from "../feed/ArticleDialog.jsx";
import EmptyState from "../../components/EmptyState.jsx";
import WordCloud from "./WordCloud.jsx";
import CooccurrenceView from "./CooccurrenceView.jsx";

const DIRECTION_WINDOWS = [
  { key: "7", label: "近 7 日" },
  { key: "30", label: "近 30 日" },
  { key: "365", label: "全部" }
];
const MATRIX_GROUPS = [
  { key: "ieee", label: "IEEE" },
  { key: "elsevier", label: "爱思唯尔" },
  { key: "cn", label: "中文刊" },
  { key: "other", label: "其他" }
];

function StatsView({ journals, markRead, toggleFavorite }) {
  const [filters, setFilters] = useState({ journal: "", from: "", to: "" });
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [selectedKeyword, setSelectedKeyword] = useState(null);
  const [selectedArticle, setSelectedArticle] = useState(null);
  const [keywordSearch, setKeywordSearch] = useState("");
  const [viewMode, setViewMode] = useState("list");
  const [cooccurrenceData, setCooccurrenceData] = useState(null);
  const [directionStats, setDirectionStats] = useState(null);
  const [directionWindow, setDirectionWindow] = useState("30");

  async function fetchStats() {
    setLoading(true);
    setSelectedKeyword(null);
    try {
      const params = new URLSearchParams();
      if (filters.journal) params.set("journal", filters.journal);
      if (filters.from) params.set("from", filters.from);
      if (filters.to) params.set("to", filters.to);
      const result = await api.get(`/api/keyword-stats?${params}`);
      setStats(result);
      
      const coResult = await api.get(`/api/keyword-cooccurrence?${params}`);
      setCooccurrenceData(coResult);
    } catch {
      setStats(null);
      setCooccurrenceData(null);
    } finally {
      setLoading(false);
    }
  }

  async function openArticle(article) {
    const missingFields = [
      !String(article.abstract || "").trim() ? "abstract" : "",
      !String(article.keywords || "").trim() ? "keywords" : ""
    ].filter(Boolean);
    if (!missingFields.length) {
      setSelectedArticle(article);
      return;
    }
    try {
      const full = await api.get(`/api/articles/${article.id}/enrich?fields=${encodeURIComponent(missingFields.join(","))}`);
      setSelectedArticle(full);
    } catch (error) {
      setSelectedArticle(error.article ? { ...article, ...error.article } : article);
    }
  }

  useEffect(() => {
    fetchStats();
  }, []);

  useEffect(() => {
    // 方向统计独立于关键词统计的筛选条件（全站口径），失败时整块隐藏。
    api.getDirectionStats({ window: directionWindow, matrix: true })
      .then(setDirectionStats)
      .catch(() => setDirectionStats(null));
  }, [directionWindow]);

  const directionMax = useMemo(() => {
    const useRecent = directionWindow !== "365";
    return Math.max(1, ...(directionStats?.directions || []).map((d) => (useRecent ? d.lastN : d.total)));
  }, [directionStats, directionWindow]);

  const maxCount = stats?.keywords?.[0]?.count || 1;
  
  const filteredKeywords = useMemo(() => {
    if (!stats?.keywords) return [];
    if (!keywordSearch.trim()) return stats.keywords;
    const search = keywordSearch.toLowerCase();
    return stats.keywords.filter((item) => item.keyword.toLowerCase().includes(search));
  }, [stats?.keywords, keywordSearch]);

  return (
    <div className="stats-view">
      <section className="stats-filters">
        <label>
          <Filter size={16} />
          <select
            value={filters.journal}
            onChange={(e) => setFilters({ ...filters, journal: e.target.value })}
          >
            <option value="">全部期刊</option>
            {journals.map((j) => (
              <option value={j.name} key={j.name}>{j.name}</option>
            ))}
          </select>
        </label>
        <input
          type="date"
          value={filters.from}
          onChange={(e) => setFilters({ ...filters, from: e.target.value })}
          aria-label="开始日期"
        />
        <input
          type="date"
          value={filters.to}
          onChange={(e) => setFilters({ ...filters, to: e.target.value })}
          aria-label="结束日期"
        />
        <button className="primary" onClick={fetchStats} disabled={loading}>
          <BarChart3 size={16} /> {loading ? "统计中..." : "统计"}
        </button>
      </section>

      {stats && (
        <>
          <div className="stats-summary" role="status" aria-live="polite">
            共 <strong>{stats.totalArticles}</strong> 篇文献，提取出 <strong>{stats.keywords.length}</strong> 个不重复关键词
            {keywordSearch && <>，匹配 <strong>{filteredKeywords.length}</strong> 个</>}
          </div>

          <div className="stats-view-toggle">
            <button 
              className={`stats-view-btn ${viewMode === "list" ? "active" : ""}`}
              onClick={() => setViewMode("list")}
            >
              <BarChart3 size={14} /> 列表
            </button>
            <button 
              className={`stats-view-btn ${viewMode === "wordcloud" ? "active" : ""}`}
              onClick={() => setViewMode("wordcloud")}
            >
              <Cloud size={14} /> 词云
            </button>
            <button 
              className={`stats-view-btn ${viewMode === "cooccurrence" ? "active" : ""}`}
              onClick={() => setViewMode("cooccurrence")}
            >
              <Network size={14} /> 共现
            </button>
          </div>

          <div className="stats-layout">
            <div className="keyword-freq-list">
              <div className="keyword-search-box">
                <Search size={14} />
                <input
                  type="text"
                  placeholder="搜索关键词..."
                  value={keywordSearch}
                  onChange={(e) => setKeywordSearch(e.target.value)}
                />
                {keywordSearch && (
                  <button className="keyword-search-clear" onClick={() => setKeywordSearch("")}>
                    <X size={12} />
                  </button>
                )}
              </div>
              
              {viewMode === "wordcloud" ? (
                <WordCloud 
                  keywords={filteredKeywords} 
                  maxCount={maxCount}
                  onSelect={setSelectedKeyword}
                  selectedKeyword={selectedKeyword}
                />
              ) : viewMode === "cooccurrence" ? (
                <CooccurrenceView data={cooccurrenceData} loading={loading} />
              ) : (
                filteredKeywords.length === 0 ? (
                  <EmptyState
                    art="keywords"
                    title="所选条件下没有关键词"
                    description="换一个期刊或放宽时间范围，通常会带回可统计的关键词。"
                  />
                ) : (
                  filteredKeywords.map((item, i) => (
                    <button
                      key={item.keyword}
                      className={`keyword-freq-item ${selectedKeyword === item.keyword ? "selected" : ""}`}
                      onClick={() => setSelectedKeyword(selectedKeyword === item.keyword ? null : item.keyword)}
                    >
                      <span className="keyword-freq-rank">{i + 1}</span>
                      <span className="keyword-freq-name">{item.keyword}</span>
                      <div className="keyword-freq-bar-wrap">
                        <div
                          className="keyword-freq-bar"
                          style={{ width: `${(item.count / maxCount) * 100}%` }}
                        />
                      </div>
                      <span className="keyword-freq-count">{item.count}</span>
                    </button>
                  ))
                )
              )}
            </div>

            {selectedKeyword && (
              <div className="keyword-articles-panel">
                <div className="keyword-articles-header">
                  <h3>{selectedKeyword}</h3>
                  <span className="keyword-articles-count">
                    {(stats.keywords.find((k) => k.keyword === selectedKeyword)?.articles || []).length} 篇文献
                  </span>
                  <button className="icon-button" aria-label="关闭关键词文献列表" onClick={() => setSelectedKeyword(null)}>
                    <X size={18} />
                  </button>
                </div>
                <div className="keyword-articles-list">
                  {(stats.keywords.find((k) => k.keyword === selectedKeyword)?.articles || []).map((article) => (
                    /* A button may not contain a link: split the card into a
                       "open abstract" button plus a separate source link. */
                    <div className="keyword-article-card" key={article.id}>
                      <button type="button" className="keyword-article-open" onClick={() => openArticle(article)}>
                        <div className="keyword-article-meta">
                          <span>{article.journal}</span>
                          <span>{formatDate(articleDate(article))}</span>
                        </div>
                        <div className="keyword-article-title">{article.title}</div>
                      </button>
                      {article.url && (
                        <a
                          href={article.url}
                          target="_blank"
                          rel="noreferrer"
                          className="keyword-article-link"
                        >
                          <Globe size={14} /> 原文链接
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {directionStats && (
            <section className="direction-stats-panel" aria-label="研究方向分布">
              <div className="direction-stats-head">
                <h3><Compass size={16} aria-hidden="true" /> 研究方向分布</h3>
                <div className="direction-window-toggle" role="tablist" aria-label="统计窗口">
                  {DIRECTION_WINDOWS.map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      className={`stats-view-btn ${directionWindow === item.key ? "active" : ""}`}
                      onClick={() => setDirectionWindow(item.key)}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
              <p className="direction-coverage" role="status">
                已分类 <strong>{directionStats.coverage.classified}</strong> / {directionStats.coverage.total} 篇
                {directionStats.coverage.pendingReview > 0 && <>，待复核 <strong>{directionStats.coverage.pendingReview}</strong> 篇</>}
              </p>
              <div className="direction-bars">
                {directionStats.directions
                  .filter((d) => (directionWindow === "365" ? d.total : d.lastN) > 0)
                  .sort((a, b) => (directionWindow === "365" ? b.total - a.total : b.lastN - a.lastN))
                  .map((d) => {
                    const count = directionWindow === "365" ? d.total : d.lastN;
                    return (
                      <div className="direction-bar-row" key={d.key}>
                        <span className="direction-bar-label">{d.label}</span>
                        <div className="direction-bar-track">
                          <div
                            className="direction-bar"
                            style={{
                              width: `${Math.max(2, (count / directionMax) * 100)}%`,
                              background: directionVar(d.key)
                            }}
                          />
                        </div>
                        <span className="direction-bar-count">{count}</span>
                      </div>
                    );
                  })}
              </div>
              {directionStats.matrix && (
                <table className="direction-matrix">
                  <thead>
                    <tr>
                      <th scope="col">方向</th>
                      {MATRIX_GROUPS.map((group) => <th scope="col" key={group.key}>{group.label}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {directionStats.directions.map((d) => {
                      const cells = MATRIX_GROUPS.map((group) => directionStats.matrix[d.key]?.[group.key] || 0);
                      const rowMax = Math.max(1, ...cells);
                      if (cells.every((n) => n === 0)) return null;
                      return (
                        <tr key={d.key}>
                          <th scope="row">
                            <span className="direction-dot" style={{ "--dir-key": directionVar(d.key) }} aria-hidden="true" />
                            {d.label}
                          </th>
                          {cells.map((n, i) => (
                            <td
                              key={MATRIX_GROUPS[i].key}
                              style={n > 0 ? { background: `color-mix(in srgb, ${directionVar(d.key)} ${Math.round(8 + (n / rowMax) * 52)}%, transparent)` } : undefined}
                            >
                              {n > 0 ? n : "–"}
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </section>
          )}
        </>
      )}

      {selectedArticle && (
        <ArticleDialog
          article={selectedArticle}
          close={() => setSelectedArticle(null)}
          markRead={markRead}
          toggleFavorite={toggleFavorite}
          onOpenArticle={setSelectedArticle}
          hideTranslatedAbstract={isChineseJournalArticle(selectedArticle, journals)}
        />
      )}
    </div>
  );
}

export default StatsView;
