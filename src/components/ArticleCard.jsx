import { memo } from "react";
import { Check, FileText, Globe, Heart, Languages, Star } from "lucide-react";
import Highlight from "./Highlight.jsx";
import { formatDate, formatRelativeDate, isChineseJournalArticle } from "../lib/format.js";
import { findJournal, journalAbbr, journalGroup } from "../lib/journal.js";

/** Cards show the three strongest keywords; the rest collapse into "+N". */
const KEYWORD_PREVIEW_LIMIT = 3;

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
  onSelectKeyword,
  selectable = false,
  selected = false,
  onToggleSelect,
  isCursor = false
}) {
  const showTranslatedAbstract = displayPreferences.translatedAbstract
    && !isChineseJournalArticle(article, journals);
  const prepare = () => requestPreparation([article.id], { force: true });
  const absoluteDate = formatDate(article.published_at);

  const journalRecord = findJournal(journals, article.journal);
  const tone = journalGroup(journalRecord || article.journal);
  const keywords = String(article.keywords || "")
    .split(/[;；]/)
    .map((keyword) => keyword.trim())
    .filter(Boolean);
  const hiddenKeywordCount = Math.max(0, keywords.length - KEYWORD_PREVIEW_LIMIT);

  return (
    <article className={`article ${article.is_read ? "read" : "unread"} ${article.is_favorite ? "favorited" : ""}${isCursor ? " is-cursor" : ""}${selected ? " is-selected" : ""}${selectable ? " has-select" : ""}`}>
      {selectable && (
        <label className="article-select" title="选中后可批量操作">
          <input
            type="checkbox"
            checked={selected}
            aria-label={`选择《${article.title}》`}
            onChange={() => onToggleSelect?.(article.id)}
          />
        </label>
      )}
      <div className="article-main">
        {/* Publication date leads the row: it is the axis a reader scans on, and
            the journal identity follows as one visual unit after the divider. */}
        <div className="article-meta">
          <time dateTime={absoluteDate} title={absoluteDate}>{formatRelativeDate(article.published_at)}</time>
          <span className="meta-divider" aria-hidden="true" />
          <span className={`journal-mark tone-${tone}`} aria-hidden="true">{journalAbbr(article.journal)}</span>
          <span className="article-journal">{article.journal || "未知期刊"}</span>
          {/* Unread is already carried by the 3px colour bar and the title
              weight, so only the exceptions (已读 / 收藏) get a badge. */}
          {article.is_read ? <span className="article-status-badge read-badge"><Check size={11} /> 已读</span> : null}
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
        {displayPreferences.keywords && keywords.length > 0 && (
          <div className="keywords">
            {keywords.slice(0, KEYWORD_PREVIEW_LIMIT).map((keyword, index) => (
              <button
                type="button"
                className={`keyword-tag ${highlightTerms.some((term) => keyword.toLowerCase().includes(term.toLowerCase())) ? "keyword-tag-highlight" : ""}`}
                key={index}
                title={`按关键词「${keyword}」筛选`}
                onClick={() => onSelectKeyword?.(keyword)}
              >
                <Highlight text={keyword} terms={highlightTerms} />
              </button>
            ))}
            {hiddenKeywordCount > 0 && (
              <button
                type="button"
                className="keyword-more"
                title={`还有 ${hiddenKeywordCount} 个关键词，打开详情查看`}
                onClick={() => onOpen(article)}
              >
                +{hiddenKeywordCount}
              </button>
            )}
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
          <FileText size={18} />
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
