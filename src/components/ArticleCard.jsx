import { memo } from "react";
import { Check, FileText, Globe, Heart, Languages, Star, Tag } from "lucide-react";
import Highlight from "./Highlight.jsx";
import { articleDate, formatDate, formatRelativeDate } from "../lib/format.js";
import { findJournal, journalAbbr, journalGroup } from "../lib/journal.js";
import { directionLabel, directionVar } from "../lib/directions.js";

/** Cards show the three strongest keywords; the rest collapse into "+N". */
const KEYWORD_PREVIEW_LIMIT = 3;

function ArticleCard({
  article,
  journals,
  displayPreferences,
  highlightTerms,
  canPersonalize,
  onOpen,
  markRead,
  toggleFavorite,
  onSelectKeyword,
  selectable = false,
  selected = false,
  onToggleSelect,
  isCursor = false,
  // 入场 stagger 延迟（B3-2，毫秒）。CSS 动画只在卡片首次挂载时播一次；
  // 传 0（默认）时等价于无额外延迟。
  enterDelay = 0
}) {
  const showTranslatedAbstract = displayPreferences.translatedAbstract;
  // 统一日期口径：正式出版用出版日、提前访问用入库日（后端 display_date）。
  const dateValue = articleDate(article);
  const absoluteDate = formatDate(dateValue);

  const journalRecord = findJournal(journals, article.journal);
  const tone = journalGroup(journalRecord || article.journal);
  const keywords = String(article.keywords || "")
    .split(/[;；]/)
    .map((keyword) => keyword.trim())
    .filter(Boolean);
  const hiddenKeywordCount = Math.max(0, keywords.length - KEYWORD_PREVIEW_LIMIT);
  const direction = article.research_direction || "";
  const directionTip = direction
    ? `${article.direction_source === "manual" ? "人工确认" : "AI 方向"} · 置信 ${Number(article.direction_confidence ?? 0).toFixed(2)}${article.direction_reason ? ` · ${article.direction_reason}` : ""}`
    : "";

  return (
    <article
      className={`article tone-${tone} ${article.is_read ? "read" : "unread"} ${article.is_favorite ? "favorited" : ""}${isCursor ? " is-cursor" : ""}${selected ? " is-selected" : ""}${selectable ? " has-select" : ""}`}
      style={enterDelay ? { "--enter-delay": `${enterDelay}ms` } : undefined}
    >
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
        {/* 期刊身份条（方案 B）：实底徽章 + 刊名居左，已读/收藏徽章、AI 方向
            标签（实底白字，整卡最重的语义标签）与相对日期居右。日期仍走
            first_public_at 口径（display_date），悬停给绝对日期。 */}
        <div className="article-head">
          <span className={`journal-mark tone-${tone}`} aria-hidden="true">{journalAbbr(article.journal)}</span>
          <span className="article-journal">{article.journal || "未知期刊"}</span>
          {/* Unread is already carried by the 3px colour bar and the title
              weight, so only the exceptions (已读 / 收藏) get a badge. */}
          {article.is_read ? <span className="article-status-badge read-badge"><Check size={11} /> 已读</span> : null}
          {article.is_favorite ? <span className="article-status-badge fav-badge"><Star size={11} /> 收藏</span> : null}
          <span className="article-head-spacer" aria-hidden="true" />
          {direction && (
            <span
              className="direction-chip"
              style={{ "--dir-key": directionVar(direction) }}
              title={directionTip}
            >
              <Tag size={11} aria-hidden="true" />
              {directionLabel(direction)}
            </span>
          )}
          <time dateTime={absoluteDate} title={absoluteDate}>{formatRelativeDate(dateValue)}</time>
          {/* 动作按钮顶部横向 + 中文名（需求 5）：替代右侧竖排图标栏，标题占满整行 */}
          <span className="article-actions-inline">
            <button type="button" title="查看摘要" aria-label="查看摘要" onClick={() => onOpen(article)}>
              <FileText size={12} /> 摘要
            </button>
            <button
              type="button"
              title={canPersonalize ? (article.is_read ? "取消已读" : "标记已读") : "登录个人账户后可标记已读"}
              aria-label={canPersonalize ? (article.is_read ? "取消已读" : "标记已读") : "登录个人账户后可标记已读"}
              aria-pressed={Boolean(article.is_read)}
              className={article.is_read ? "action-done" : ""}
              onClick={() => markRead(article.id)}
              disabled={!canPersonalize}
            >
              <Check size={12} /> {article.is_read ? "已读" : "未读"}
            </button>
            <button
              type="button"
              title={canPersonalize ? (article.is_favorite ? "取消收藏" : "收藏") : "登录个人账户后可收藏"}
              aria-label={canPersonalize ? (article.is_favorite ? "取消收藏" : "收藏") : "登录个人账户后可收藏"}
              aria-pressed={Boolean(article.is_favorite)}
              className={article.is_favorite ? "action-faved" : ""}
              onClick={() => toggleFavorite(article.id)}
              disabled={!canPersonalize}
            >
              {article.is_favorite
                ? <Star size={12} fill="currentColor" />
                : <Heart size={12} />}
              {article.is_favorite ? "已藏" : "收藏"}
            </button>
            {article.url && (
              <a title="打开原文网页" aria-label="打开原文网页" href={article.url} target="_blank" rel="noopener noreferrer">
                <Globe size={12} /> 原文
              </a>
            )}
          </span>
        </div>
        <button className="title-button" onClick={() => onOpen(article)}>
          <Highlight text={article.title} terms={highlightTerms} />
        </button>
        {displayPreferences.bilingual && article.translated_title && article.translated_title !== article.title && (
          <p className="translated-title"><Languages size={14} /> {article.translated_title}</p>
        )}
        {displayPreferences.authors && article.authors && <p className="authors"><Highlight text={article.authors} terms={highlightTerms} /></p>}
        {displayPreferences.keywords && keywords.length > 0 && (
          <div className="keywords">
            {/* 关键词胶囊：浅底次级标签。AI 方向标签已升格为期刊身份条里的
                实底标签（行首），两者主次分明，不再挤在同一行抢权重。 */}
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
        {displayPreferences.abstract && article.abstract && (
          <p className="abstract"><Highlight text={article.abstract} terms={highlightTerms} /></p>
        )}
        {showTranslatedAbstract && article.translated_abstract && (
          <div className="translated-abstract"><span>中文摘要</span><p>{article.translated_abstract}</p></div>
        )}
      </div>
    </article>
  );
}

export default memo(ArticleCard);
