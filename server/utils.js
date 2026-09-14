// Shared utility functions

export function decodeEntities(value) {
  return String(value ?? "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&(nbsp|apos|ndash|mdash|lsquo|rsquo|ldquo|rdquo|hellip|times|minus|micro|alpha|beta|gamma|Delta);/g,
      (_, name) => ({ nbsp: " ", apos: "'", ndash: "–", mdash: "—", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", hellip: "…", times: "×", minus: "−", micro: "µ", alpha: "α", beta: "β", gamma: "γ", Delta: "Δ" })[name])
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (raw, code) => {
      const point = /^x/i.test(code) ? parseInt(code.slice(1), 16) : Number(code);
      return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff)
        ? String.fromCodePoint(point) : raw;
    });
}

export function stripTags(value) {
  return decodeEntities(String(value || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

export function isUsableMetadataText(value) {
  const text = String(value || "").trim();
  if (!text) return false;
  return !/<!doctype\s+html|<html\b|<head\b|<body\b|cloudflare|bad gateway|error code\s*50\d|cf-error-details/i.test(text)
    && !/\uFFFD|\u951f\u65a4\u62f7/.test(text);
}

export function safeExternalError(error, fallback = "\u5916\u90e8\u6570\u636e\u6e90\u6682\u65f6\u4e0d\u53ef\u7528") {
  const message = String(error?.message || error || "").replace(/\s+/g, " ").trim();
  if (!message || /<!doctype\s+html|<html\b|<head\b|<body\b|cf-error-details/i.test(message)) return fallback;
  return message.slice(0, 300);
}

export function isNonResearchTitle(value) {
  return /^(corrigendum|correction|erratum)\s+to\b|^editorial board$/i.test(String(value || "").trim());
}

export function decodeBasicEntities(value) {
  return decodeEntities(value);
}

// Decode declared legacy encodings before text reaches JSON/SQLite. Never
// silently persist replacement characters produced by a wrong decoder.
export async function readResponseText(response) {
  if (!response.arrayBuffer) return response.text(); // lightweight test doubles
  const bytes = new Uint8Array(await response.arrayBuffer());
  const prefix = new TextDecoder("latin1").decode(bytes.slice(0, 2048));
  const contentType = response.headers?.get?.("content-type") || "";
  const charset = contentType.match(/charset\s*=\s*["']?([^\s;"']+)/i)?.[1]
    || prefix.match(/<\?xml[^>]*encoding=["']([^"']+)/i)?.[1]
    || prefix.match(/<meta[^>]*charset\s*=\s*["']?([^\s;"'/>]+)/i)?.[1]
    || "utf-8";
  return new TextDecoder(charset, { fatal: true }).decode(bytes);
}

export function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function escapeLike(value) {
  return String(value || "").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

// Chinese academic text commonly contains Latin abbreviations such as V2G,
// HVDC, OPF, and AI. Those abbreviations do not make the surrounding Chinese
// title or abstract an English translation candidate.
export function containsChineseText(value) {
  return /[\u3400-\u9fff]/u.test(String(value || ""));
}

export function calculatePushDays(frequency) {
  if (frequency === "daily") return 1;
  if (frequency === "monthly") return 30;
  return 7;
}

export const ELECTRICAL_FILTER_KEYWORDS = [
  "power grid", "power system", "electric", "electrical", "microgrid", "micro-grid",
  "distributed generation", "renewable energy", "solar", "photovoltaic", "wind",
  "energy storage", "battery", "EV", "electric vehicle", "V2G", "vehicle-to-grid",
  "smart grid", "demand response", "load forecasting", "power electronics",
  "inverter", "converter", "DC-DC", "AC-DC", "power quality", "voltage regulation",
  "frequency control", "grid", "transmission", "distribution", "substation",
  "protection", "relay", "fault", "power flow", "optimal power flow", "OPF",
  "unit commitment", "economic dispatch", "energy management", "EMS",
  "aggregation", "DER", "distributed energy resource", "VPP", "virtual power plant",
  "flexibility", "curtailment", "intermittency", "uncertainty",
  "demand side", "demand management", "peak shaving", "valley filling",
  "energy internet", "cyber-physical", "internet of things", "IoT",
  "machine learning", "deep learning", "reinforcement learning", "neural network",
  "optimization", "stochastic", "robust", "resilience",
  "carbon", "emission", "sustainability", "clean energy", "green energy",
  "hydrogen", "fuel cell", "power-to-X", "P2X",
  "electricity market", "energy market", "pricing", "tariff",
  "phasor", "PMU", "SCADA", "state estimation",
  "FACTS", "HVDC", "UHVDC", "AC-DC",
  "motor", "generator", "transformer", "induction",
  "control", "stability", "oscillation", "oscillat",
  "island", "off-grid", "standalone"
];

// Journals whose remit is wider than this site's electrical scope declare
// `filterKeywords`; an article survives when any of them appears in its title,
// abstract, or keywords. Every collection source must apply the same gate, so
// the IEEE adapter uses this too, not just the Crossref/OpenAlex paths.
export function matchesJournalFilter(article, journal) {
  const keywords = journal?.filterKeywords;
  if (!Array.isArray(keywords) || !keywords.length) return true;
  const text = [article?.title, article?.abstract, article?.keywords].filter(Boolean).join(" ").toLowerCase();
  if (!text) return false;
  return keywords.some((keyword) => text.includes(String(keyword).toLowerCase()));
}
