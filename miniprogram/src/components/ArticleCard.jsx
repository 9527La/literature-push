import { View, Text } from "@tarojs/components";
import { articleDate, formatDate, formatRelativeDate, isChineseJournalArticle } from "../lib/format.js";
import { findJournal, journalAbbr, journalGroup } from "../lib/journal.js";
import { directionLabel } from "../lib/directions.js";

/**
 * 文献卡片（期刊身份条结构，自网站 ArticleCard 平移）：
 * 实底期刊徽章 + 刊名居左；已读/收藏徽章、AI 方向 chip（实底白字）、
 * 相对日期居右；标题 2 行截断、作者 1 行、摘要 3 行。
 * 交互由父级接管：点击进详情、长按快捷操作。
 */
const KEYWORD_PREVIEW_LIMIT = 3;

export default function ArticleCard({ article, journals = [], displayPrefs, onOpen, onLongPress }) {
  const dateValue = articleDate(article);
  const journalRecord = findJournal(journals, article.journal);
  const tone = journalGroup(journalRecord || article.journal);
  const keywords = String(article.keywords || "")
    .split(/[;；]/)
    .map((keyword) => keyword.trim())
    .filter(Boolean);
  const hiddenCount = Math.max(0, keywords.length - KEYWORD_PREVIEW_LIMIT);
  const direction = article.research_direction || "";
  const showTranslated = displayPrefs?.translatedAbstract
    && !isChineseJournalArticle(article, journals)
    && article.translated_abstract;

  return (
    <View
      className={`acard tone-${tone}${article.is_read ? " read" : ""}`}
      onClick={() => onOpen?.(article)}
      onLongPress={() => onLongPress?.(article)}
    >
      <View className="acard-head">
        <Text className="jmark">{journalAbbr(article.journal)}</Text>
        <Text className="jname">{article.journal || "未知期刊"}</Text>
        {article.is_read ? <Text className="badge badge-read">✓ 已读</Text> : null}
        {article.is_favorite ? <Text className="badge badge-fav">★ 收藏</Text> : null}
        <View className="head-spacer" />
        {direction ? <Text className={`dir-chip dir-${direction}`}>{directionLabel(direction)}</Text> : null}
        <Text className="head-date">{formatRelativeDate(dateValue)}</Text>
      </View>
      <View className="acard-title">{article.title}</View>
      {displayPrefs?.bilingual && article.translated_title && article.translated_title !== article.title ? (
        <View className="acard-title-2">{article.translated_title}</View>
      ) : null}
      {displayPrefs?.authors && article.authors ? <View className="acard-authors">{article.authors}</View> : null}
      {displayPrefs?.keywords && keywords.length > 0 ? (
        <View className="acard-kws">
          {keywords.slice(0, KEYWORD_PREVIEW_LIMIT).map((keyword, index) => (
            <Text className="kw-tag" key={index}>{keyword}</Text>
          ))}
          {hiddenCount > 0 ? <Text className="kw-tag">+{hiddenCount}</Text> : null}
        </View>
      ) : null}
      {displayPrefs?.abstract && article.abstract ? <View className="acard-abstract">{article.abstract}</View> : null}
      {showTranslated ? (
        <View className="acard-ta">
          <View className="acard-ta-label">中文摘要</View>
          <View>{article.translated_abstract}</View>
        </View>
      ) : null}
      {/* 无障碍/调试辅助：绝对日期由详情页承载 */}
      <View className="hint" style={{ display: "none" }}>{formatDate(dateValue)}</View>
    </View>
  );
}
