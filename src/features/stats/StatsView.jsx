import { useEffect, useMemo, useState } from "react";
import { BarChart3, Cloud, ExternalLink, Filter, Search, Share2, X } from "lucide-react";
import { api } from "../../lib/api.js";
import { formatDate, isChineseJournalArticle } from "../../lib/format.js";
import ArticleDialog from "../feed/ArticleDialog.jsx";
import EmptyState from "../../components/EmptyState.jsx";
import WordCloud from "./WordCloud.jsx";
import CooccurrenceView from "./CooccurrenceView.jsx";

function StatsView({ journals, markRead, toggleFavorite }) {
  const [filters, setFilters] = useState({ journal: "", from: "", to: "" });
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [selectedKeyword, setSelectedKeyword] = useState(null);
  const [selectedArticle, setSelectedArticle] = useState(null);
  const [keywordSearch, setKeywordSearch] = useState("");
  const [viewMode, setViewMode] = useState("list");
  const [cooccurrenceData, setCooccurrenceData] = useState(null);

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
              <Share2 size={14} /> 共现
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
                    icon={Search}
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
                          <span>{formatDate(article.published_at)}</span>
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
                          <ExternalLink size={12} /> 原文链接
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {selectedArticle && (
        <ArticleDialog
          article={selectedArticle}
          close={() => setSelectedArticle(null)}
          markRead={markRead}
          toggleFavorite={toggleFavorite}
          hideTranslatedAbstract={isChineseJournalArticle(selectedArticle, journals)}
        />
      )}
    </div>
  );
}

export default StatsView;
