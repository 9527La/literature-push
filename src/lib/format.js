export function formatDate(value) {
  if (!value) return "未知日期";
  if (/^\d{8}$/.test(value)) return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6)}`;
  return String(value).slice(0, 10);
}

/**
 * 文献日期（展示口径）。
 *
 * 后端按全站统一规则算好 `display_date`：优先 first_public_at（论文第一次正式
 * 公开的日期，Online First / Available online / 网络首发按首发日计，正式出版按
 * 出版日计，无外部时间时兜底为系统收录日），未回填的旧数据回落旧口径。前端一律
 * 用这个字段，不再直接读 `published_at` —— 否则在线首发论文会显示成几个月后的
 * 「未来日期」。老响应里没有该字段时回落到 published_at，保证不显示空白。
 */
export function articleDate(article) {
  return article?.display_date || article?.published_at || "";
}

export function formatDateTime(value) {
  if (!value) return "未知时间";
  const raw = String(value);
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw.replace("T", " ").replace(/\.\d+Z$/, "").slice(0, 19);
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(date).replace(/\//g, "-");
}

const HOUR_MS = 3600000;
const DAY_MS = 24 * HOUR_MS;

/**
 * Relative publication time.
 *
 * "3 天前" answers "should I read this now?" far better than an absolute date,
 * but past a month the exact date matters again, and past a year the month is
 * all that is still meaningful.
 */
export function formatRelativeDate(value, now = Date.now()) {
  if (!value) return "未知日期";
  const raw = String(value);
  const date = new Date(/^\d{8}$/.test(raw) ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6)}T00:00:00` : raw);
  if (Number.isNaN(date.getTime())) return formatDate(value);

  const elapsed = now - date.getTime();
  if (elapsed < 0) return formatDate(value);
  if (elapsed < HOUR_MS) return "刚刚";
  if (elapsed < DAY_MS) return `${Math.floor(elapsed / HOUR_MS)} 小时前`;
  if (elapsed < 7 * DAY_MS) return `${Math.floor(elapsed / DAY_MS)} 天前`;
  if (elapsed < 30 * DAY_MS) return formatDate(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function isChineseSourceText(value) {
  const text = String(value || "").trim();
  return Boolean(text) && /[\u3400-\u9fff]/u.test(text);
}

/**
 * GB/T 7714-2015（顺序编码制）期刊文献引用串。
 *
 * 库内没有页码字段，按规范允许的缺省处理省略「: 页码」；作者名单保持原文
 * （「姓, 名」顺列与逗号分隔的多人名单无法可靠区分，不强行重排），作者分隔
 * 符号 ≥3 个时按规范补「等 / et al」。任何字段缺失都跳过对应片段，保证残缺
 * 记录也能给出可用的引用串。
 */
export function formatCitationGB7714(article) {
  if (!article) return "";
  const title = String(article.title || "").trim();
  if (!title) return "";
  const rawAuthors = String(article.authors || "").trim();
  const etAl = rawAuthors && (rawAuthors.match(/[;；,，]/g) || []).length >= 3
    ? (isChineseSourceText(rawAuthors) ? " 等" : " et al")
    : "";
  const authorPart = rawAuthors ? `${rawAuthors}${etAl}. ` : "";

  const year = String(articleDate(article) || "").slice(0, 4) || String(article.year || "").trim();
  const journal = String(article.journal || "").trim();
  const volume = String(article.volume || "").trim();
  const issue = String(article.issue || "").trim();
  const volumePart = volume && issue ? `${volume}(${issue})` : volume || (issue ? `(${issue})` : "");
  const doi = String(article.doi || "").trim();

  const sourcePart = journal
    ? `${journal}${year ? `, ${year}` : ""}${volumePart ? `, ${volumePart}` : ""}`
    : year;
  const parts = [
    `${authorPart}${title}[J]`,
    sourcePart,
    doi ? `DOI: ${doi}` : ""
  ].filter(Boolean);
  return `${parts.join(". ")}.`;
}

export function isChineseJournalArticle(article, journals = []) {
  const journalName = String(article?.journal || "").trim();
  const journal = (Array.isArray(journals) ? journals : []).find((item) => (
    String(item?.name || "").trim() === journalName
  ));
  const platform = String(journal?.platform || journal?.publisher || "").trim().toLowerCase();
  const language = String(journal?.language || "").trim().toLowerCase();
  return platform === "wanfang"
    || language === "zh"
    || language.startsWith("zh-")
    || String(article?.external_id || "").startsWith("wanfang:")
    || isChineseSourceText(article?.title)
    || isChineseSourceText(article?.abstract);
}
