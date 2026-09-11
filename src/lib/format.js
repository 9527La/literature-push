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
