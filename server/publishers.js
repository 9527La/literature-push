import { DEFAULT_JOURNAL_BY_NAME } from "./journals.js";
import { decodeEntities, isNonResearchTitle } from "./utils.js";

// Platform describes the technical adapter, not necessarily the journal owner.
// `html` 之前的所有条目都是 API；`html` 表示「改用纯 HTTP 抓落地页」。
// 两者都失败后由 server/web-fallback.js 的统一浏览器兜底接管（含 Semantic
// Scholar 检索页），所以这里不再单独挂 semanticScholarWeb —— 避免同一篇文章
// 起两次浏览器、还按两套节流各跑一遍。
export const PLATFORM_PROFILES = Object.freeze({
  ieee: { collection: ["ieee", "crossref", "openalex"], details: ["ieee", "scopus", "openalex", "crossref", "semanticScholar", "html"], mode: "merge" },
  elsevier: { collection: ["crossref", "openalex"], details: ["elsevier", "scopus", "openalex", "crossref", "semanticScholar", "html"], mode: "merge" },
  wanfang: { collection: ["wanfang", "openalex"], details: ["wanfang", "openalexTitle", "openalex", "crossref", "semanticScholar", "html"], mode: "fallback" },
  generic: { collection: ["crossref", "openalex"], details: ["scopus", "openalex", "crossref", "semanticScholar", "html"], mode: "merge" }
});

export function resolveJournal(journal = {}) {
  if (typeof journal === "string") journal = { name: journal };
  const name = decodeEntities(journal.name || "").trim();
  const preset = DEFAULT_JOURNAL_BY_NAME.get(name) || {};
  const merged = { ...preset, ...journal, name };
  const platform = merged.platform || (merged.wanfangId ? "wanfang" : merged.publisher) || "generic";
  if (!PLATFORM_PROFILES[platform]) throw new Error(`Unsupported journal platform: ${platform}`);
  return { ...merged, platform, issns: [...new Set((merged.issns || []).map((issn) => String(issn).trim().toUpperCase()).filter(Boolean))] };
}

export function validateJournal(journal) {
  const value = resolveJournal(journal);
  if (!value.name) throw new Error("Journal name is required");
  if (value.issns.some((issn) => !/^\d{4}-\d{3}[\dX]$/.test(issn))) throw new Error(`Invalid ISSN for ${value.name}`);
  if (value.platform === "wanfang" && !value.wanfangId) throw new Error(`Wanfang source id is required for ${value.name}`);
  if (value.platform !== "wanfang" && !value.issns.length) throw new Error(`ISSN is required for ${value.name}`);
  return value;
}

export function articlePlatform(article) {
  const journal = DEFAULT_JOURNAL_BY_NAME.get(decodeEntities(article.journal || ""));
  const doi = String(article.doi || "").replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").toLowerCase();
  let host = "";
  try { host = new URL(article.url).hostname.toLowerCase(); } catch { /* optional URL */ }
  const onHost = (domain) => host === domain || host.endsWith(`.${domain}`);
  if (String(article.external_id || "").startsWith("wanfang:") || onHost("wanfangdata.com.cn")) return "wanfang";
  if (doi.startsWith("10.1016/") || onHost("sciencedirect.com") || onHost("elsevier.com")) return "elsevier";
  if (doi.startsWith("10.1109/") || onHost("ieee.org")) return "ieee";
  return resolveJournal(journal || { name: article.journal }).platform;
}

// Dependency injection keeps source routing independently testable. Source
// failures are observable even when another source returns a usable batch.
export async function collectJournal(journal, options, { config, adapters, dedupe }) {
  journal = validateJournal(journal);
  const profile = PLATFORM_PROFILES[journal.platform];
  const batches = [];
  const diagnostics = [];
  for (const source of profile.collection) {
    if (source !== "wanfang" && !config.publicDataSources.includes(source)) continue;
    if (source === "ieee" && !config.ieeeApiKey) continue;
    // OpenAlex 无 key 时每次调用都是 429，默认整体关闭（见 config.openAlexEnabled）。
    if (source === "openalex" && config.openAlexEnabled === false) continue;
    try {
      const articles = await adapters[source](journal, options);
      diagnostics.push({ source, status: articles.length ? "success" : "empty", count: articles.length });
      batches.push(...articles);
      if (profile.mode === "fallback" && articles.length) break;
    } catch (error) {
      diagnostics.push({ source, status: "error", message: error.message });
    }
  }
  const articles = dedupe(batches).filter((article) => !isNonResearchTitle(article.title));
  if (typeof options.onDiagnostics === "function") options.onDiagnostics({ journal: journal.name, platform: journal.platform, sources: diagnostics });
  if (!articles.length && (profile.mode === "fallback" || diagnostics.some((item) => item.status === "error") || !diagnostics.length)) {
    const error = new Error(diagnostics.map((item) => item.message || `${item.source} returned no verified records for ${journal.name}`).join("; ") || `No enabled sources for ${journal.name}`);
    error.diagnostics = diagnostics;
    throw error;
  }
  return articles;
}
