/**
 * 三字段结构化速评卡（研究速览 v2）。
 *
 * 配色走期刊组色系（tone-ieee/elsevier/cn/other，与信息流卡片一致），不随研究方向
 * 变色；无 brief（旧格式期数）降级为一行速评 + 「旧格式」角标。
 *
 * 2026-10-15 从 ReportsView.jsx 抽出：研究速览的三个标签页（一周速览 / 月度趋势 /
 * 当日新增）共用同一张卡，抽成独立模块避免「当日新增」面板反向 import ReportsView
 * 形成循环依赖。抽出后 ReportsView 与 DailyDigestPanel 都在同一个懒加载分包内，
 * 不影响 Vite 分包。
 */
import { Check, Star } from "lucide-react";
import { journalAbbr, journalGroup } from "../../lib/journal.js";
import { formatRelativeDate } from "../../lib/format.js";

/** 三字段速评字段区（研究对象/研究方法/核心结论）。 */
export function BriefFields({ brief }) {
  return (
    <span className="reports-brief-fields">
      <span className="reports-brief-field"><span className="k">研究对象</span><span className="v">{brief.object}</span></span>
      <span className="reports-brief-field"><span className="k">研究方法</span><span className="v">{brief.method}</span></span>
      <span className="reports-brief-field"><span className="k">核心结论</span><span className="v">{brief.finding}</span></span>
    </span>
  );
}

/**
 * brief  — 三字段速评（{object, method, finding, topic?}），缺失时降级为 fallbackText
 * showLegacyBadge — 无 brief 时是否显示「旧格式」角标。周报/月报的旧期数需要它；
 *                   「当日新增」的卡片契约本就要求全覆盖，缺 brief 只是 AI 还没跑，
 *                   标「旧格式」会误导，故传 false。
 *
 * 注：曾有过 focus / reason 两个 prop（「重点关注」角标与关注理由），随着该板块在
 * 2026-10-15 下线一并移除，避免留下永不渲染的死分支。
 */
function BriefCard({ id, article, brief, fallbackText, showLegacyBadge = true, onOpen }) {
  const tone = article ? journalGroup(article.journal) : "";
  const hasBrief = Boolean(brief && brief.object && brief.method && brief.finding);
  const inner = (
    <>
      <span className="reports-brief-head">
        {article ? (
          <>
            <span className="reports-brief-mark">{journalAbbr(article.journal) || (article.journal || "").slice(0, 4)}</span>
            <span className="reports-brief-journal">{article.journal}</span>
            {article.is_read ? <span className="article-status-badge read-badge"><Check size={11} /> 已读</span> : null}
            {article.is_favorite ? <span className="article-status-badge fav-badge"><Star size={11} /> 收藏</span> : null}
            <span className="reports-brief-date">{formatRelativeDate(article.display_date || article.published_at)}</span>
          </>
        ) : (
          <span className="reports-brief-journal">文献 #{id}</span>
        )}
      </span>
      <span className="reports-brief-body">
        {article && (
          <>
            <span className="reports-brief-title">{article.translated_title || article.title}</span>
            {article.title && article.translated_title && article.title !== article.translated_title && (
              <span className="reports-brief-title-en">{article.title}</span>
            )}
          </>
        )}
        {hasBrief ? (
          <BriefFields brief={brief} />
        ) : (
          <span className="reports-brief-legacy">
            {fallbackText || (article ? "" : `文献 #${id}`)}
            {showLegacyBadge && <span className="reports-legacy-badge">旧格式</span>}
          </span>
        )}
      </span>
      <span className="reports-brief-open" aria-hidden="true">详情 ›</span>
    </>
  );
  const clickable = Boolean(article);
  const className = `reports-brief-card${tone ? ` tone-${tone}` : ""}`;
  return clickable ? (
    <button
      type="button"
      className={className}
      data-article-id={id}
      onClick={() => onOpen(id)}
    >
      {inner}
    </button>
  ) : (
    <div className={`${className} is-fallback`} data-article-id={id}>
      {inner}
    </div>
  );
}

export default BriefCard;
