export function formatDate(value) {
  if (!value) return "未知日期";
  if (/^\d{8}$/.test(value)) return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6)}`;
  return String(value).slice(0, 10);
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
