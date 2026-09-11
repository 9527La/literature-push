import { memo } from "react";
import { Check, Globe, Heart, Languages, ScrollText, Star } from "lucide-react";
import Highlight from "./Highlight.jsx";
import { formatDate, isChineseJournalArticle } from "../lib/format.js";

function ArticleCard({
  article,
  journals,
  displayPreferences,
  highlightTerms,
  preparationActive,
  canPersonalize,
  onOpen,
  markRead,
  toggleFavorite,
  requestPreparation,
  isCursor = false
}) {
  const showTranslatedAbstract = displayPreferences.translatedAbstract
    && !isChineseJournalArticle(article, journals);
  const prepare = () => requestPreparation([article.id], { force: true });

  return (
    <article className={`article ${article.is_read ? "read" : "unread"} ${article.is_favorite ? "favorited" : ""}${isCursor ? " is-cursor" : ""}`}>
      <div className="article-main">
        <div className="article-meta">
          <span>{article.journal || "未知期刊"}</span>
          <span>{formatDate(article.published_at)}</span>
          {article.year && <span>{article.year}</span>}
          {article.is_read ? <span className="article-status-badge read-badge"><Check size={11} /> 已读</span> : <span className="article-status-badge unread-badge">未读</span>}
          {article.is_favorite ? <span className="article-status-badge fav-badge"><Star size={11} /> 收藏</span> : null}
        </div>
        <button className="title-button" onClick={() => onOpen(article)}>
          <Highlight text={article.title} terms={highlightTerms} />
        </button>
        {displayPreferences.bilingual && article.translated_title && article.translated_title !== article.title && (
          <p className="translated-title"><Languages size={14} /> {article.translated_title}</p>
        )}
        {displayPreferences.bilingual && !article.translated_title && (
          <button type="button" className="translation-missing" disabled={preparationActive} onClick={prepare}>
            <Languages size={13} /> 获取中文翻译
          </button>
        )}
        {displayPreferences.authors && article.authors && <p className="authors"><Highlight text={article.authors} terms={highlightTerms} /></p>}
        {displayPreferences.keywords && article.keywords && (
          <div className="keywords">
            {article.keywords.split(/[;；]/).map((kw) => kw.trim()).filter(Boolean).map((kw, i) => (
              <span className={`keyword-tag ${highlightTerms.some((t) => kw.toLowerCase().includes(t.toLowerCase())) ? "keyword-tag-highlight" : ""}`} key={i}>
                <Highlight text={kw} terms={highlightTerms} />
              </span>
            ))}
          </div>
        )}
        {displayPreferences.abstract && (
          article.abstract
            ? <p className="abstract"><Highlight text={article.abstract} terms={highlightTerms} /></p>
            : <button type="button" className="abstract-missing" disabled={preparationActive} onClick={prepare}>获取摘要与中文翻译</button>
        )}
        {showTranslatedAbstract && article.translated_abstract && (
          <div className="translated-abstract"><span>中文摘要</span><p>{article.translated_abstract}</p></div>
        )}
        {showTranslatedAbstract && article.abstract && !article.translated_abstract && (
          <button type="button" className="translation-missing" disabled={preparationActive} onClick={prepare}>
            <Languages size={13} /> 获取中文摘要
          </button>
        )}
      </div>
      <div className="article-actions">
        <button type="button" title="查看摘要" aria-label="查看摘要" onClick={() => onOpen(article)}>
          <ScrollText size={18} />
        </button>
        <button
          type="button"
          title={canPersonalize ? (article.is_read ? "取消已读" : "标记已读") : "登录个人账户后可标记已读"}
          aria-label={canPersonalize ? (article.is_read ? "取消已读" : "标记已读") : "登录个人账户后可标记已读"}
          aria-pressed={Boolean(article.is_read)}
          className={`action-read ${article.is_read ? "action-done" : ""}`}
          onClick={() => markRead(article.id)}
          disabled={!canPersonalize}
        >
          <Check size={18} />
        </button>
        <button
          type="button"
          title={canPersonalize ? (article.is_favorite ? "取消收藏" : "收藏") : "登录个人账户后可收藏"}
          aria-label={canPersonalize ? (article.is_favorite ? "取消收藏" : "收藏") : "登录个人账户后可收藏"}
          aria-pressed={Boolean(article.is_favorite)}
          className={`action-favorite ${article.is_favorite ? "selected" : ""}`}
          onClick={() => toggleFavorite(article.id)}
          disabled={!canPersonalize}
        >
          {article.is_favorite
            ? <Star size={18} fill="currentColor" />
            : <Heart size={18} />}
        </button>
        {article.url && (
          <a title="打开原文网页" aria-label="打开原文网页" href={article.url} target="_blank" rel="noopener noreferrer">
            <Globe size={18} />
          </a>
        )}
      </div>
    </article>
  );
}

export default memo(ArticleCard);
