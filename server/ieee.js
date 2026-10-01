import fs from "node:fs";
import path from "node:path";
import { requestJson } from "./http.js";
import { config } from "./config.js";
import { matchesJournalFilter, sleep } from "./utils.js";
import { resolveDataDirectory } from "./paths.js";

const API_URL = "https://ieeexploreapi.ieee.org/api/v1/search/articles";

// 访问限制（IEEE Xplore API，Mashery 网关）：
// - 注册档的额度约为 200 次调用/天，单次最多返回 200 条记录；
//   具体数值以 developer.ieee.org 注册时展示的 Rate Limits 为准。
// - 网关不返回剩余额度响应头，只能本地记账：按 UTC 日切分，超限后当天不再发请求，
//   直接抛错让上层落到 Scopus / Crossref / 浏览器兜底。
// - 实测 max_records=1 时响应里没有 articles 字段（total_records 正常），因此页大小下限为 2。
const API_MAX_PAGE_SIZE = 200;
const API_MIN_PAGE_SIZE = 2;
const QUOTA_FILE = "ieee-quota.json";

const quota = { date: "", used: 0, loaded: false, path: "" };
let lane = Promise.resolve();
let lastRequestAt = 0;

// 日切分按 UTC：Mashery 的配额窗口以 UTC 午夜重置（北京时间 08:00）。
function utcDay(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

export class IeeeQuotaExceededError extends Error {
  constructor(message) {
    super(message);
    this.name = "IeeeQuotaExceededError";
    this.quotaExceeded = true;
  }
}

function quotaPath() {
  return path.join(resolveDataDirectory(), QUOTA_FILE);
}

function loadQuota() {
  const today = utcDay();
  const file = quotaPath();
  // 记账文件路径变了（测试里会指向临时目录）就必须重新读，不能复用上一份缓存。
  if (quota.loaded && quota.path === file && quota.date === today) return quota;
  quota.loaded = true;
  quota.path = file;
  quota.date = today;
  quota.used = 0;
  try {
    const raw = JSON.parse(fs.readFileSync(quotaPath(), "utf8"));
    if (raw && raw.date === today && Number.isFinite(Number(raw.used))) {
      quota.used = Math.max(0, Number(raw.used));
    }
  } catch {
    // 文件不存在或内容损坏都按 0 处理，首次请求后会重新写回。
  }
  return quota;
}

function persistQuota() {
  try {
    fs.mkdirSync(resolveDataDirectory(), { recursive: true });
    fs.writeFileSync(quotaPath(), JSON.stringify({ date: quota.date, used: quota.used }), "utf8");
  } catch {
    // 记账失败不应该让采集中断；最坏情况是重启后额度重新从 0 开始。
  }
}

export function ieeeQuotaSnapshot() {
  const state = loadQuota();
  const limit = config.ieeeDailyCallLimit;
  return {
    date: state.date,
    used: state.used,
    limit,
    remaining: Math.max(0, limit - state.used),
    configured: Boolean(config.ieeeApiKey) && config.ieeeEnabled
  };
}

function takeQuotaSlot() {
  const limit = config.ieeeDailyCallLimit;
  if (!Number.isFinite(limit) || limit <= 0) return;
  const state = loadQuota();
  if (state.used >= limit) {
    throw new IeeeQuotaExceededError(
      `IEEE Xplore API 当日额度已用尽（${state.used}/${limit} 次，UTC ${state.date}），本次请求已跳过`
    );
  }
  state.used += 1;
  persistQuota();
}

// 收到 429（或网关的配额提示）就把当天额度打满：继续发请求只会继续被拒。
function markQuotaExhausted() {
  const limit = config.ieeeDailyCallLimit;
  if (!Number.isFinite(limit) || limit <= 0) return;
  const state = loadQuota();
  state.used = Math.max(state.used, limit);
  persistQuota();
}

function runExclusive(task) {
  const result = lane.then(task, task);
  lane = result.then(() => undefined, () => undefined);
  return result;
}

async function requestOnce(url, policy) {
  takeQuotaSlot();
  const wait = lastRequestAt + config.ieeeRequestIntervalMs - Date.now();
  if (wait > 0) await sleep(wait);
  try {
    return await requestJson(url, {}, policy);
  } finally {
    lastRequestAt = Date.now();
  }
}

async function callIeeeApi(url) {
  return runExclusive(async () => {
    try {
      // IEEE 侧拒绝时重试没有意义，只保留一次重试用于网络抖动。
      return await requestOnce(url, { retries: 1, retryDelayMs: 2000 });
    } catch (error) {
      if (error?.status === 429) {
        markQuotaExhausted();
        throw error;
      }
      // 实测 Mashery 会偶发对一个新连接的首个请求返回 403，同一个 URL 立刻重试即成功。
      // 这里给一次机会，重试同样占用额度，不会偷偷多打。
      if (error?.status === 403) return requestOnce(url, { retries: 0 });
      throw error;
    }
  });
}

function pageLimits(options) {
  const requested = Number(options.maxRecords ?? 50);
  const maxRecords = Number.isFinite(requested) ? Math.max(1, Math.min(10000, Math.floor(requested))) : 50;
  const pageSize = Math.max(API_MIN_PAGE_SIZE, Math.min(API_MAX_PAGE_SIZE, maxRecords));
  const maxPages = Math.min(100, Math.max(1, Number(options.maxPages) || 100));
  return { maxRecords, pageSize, maxPages };
}

function formatDate(date) {
  return date.toISOString().slice(0, 10).replaceAll("-", "");
}

function normalizeAuthors(article) {
  if (Array.isArray(article.authors?.authors)) {
    return article.authors.authors.map((author) => author.full_name).filter(Boolean).join(", ");
  }
  if (Array.isArray(article.authors)) {
    return article.authors.map((author) => author.full_name || author.name || author).filter(Boolean).join(", ");
  }
  return "";
}

function normalizePublishedAt(article) {
  const value = String(article.publication_date || article.date || article.insert_date || article.year || "");
  if (/^\d{8}$/.test(value)) {
    return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6)}`;
  }
  return value;
}

// IEEE 的真实响应里 index_terms 是
// { ieee_terms: { terms: [...] }, author_terms: { terms: [...] }, dynamic_index_terms: { terms: [...] } }
// 其中 dynamic_index_terms 是机器生成的动态索引词（实测混进 "AC Voltage"、"Operating System"
// 这类噪声），按项目约定一律丢弃；作者关键词优先，其次 IEEE 关键词。
// 旧形状（{ "IEEE Author Keywords": [...] }）继续兼容。
const KEYWORD_GROUPS = [
  ["author_terms", "author keywords", "ieee author keywords"],
  ["ieee_terms", "ieee keywords", "ieee terms"]
];

function groupTerms(category) {
  if (Array.isArray(category)) return category;
  if (category && Array.isArray(category.terms)) return category.terms;
  return [];
}

function normalizeKeywords(article) {
  const indexTerms = article.index_terms;
  if (!indexTerms || typeof indexTerms !== "object") return "";
  const entries = new Map(
    Object.entries(indexTerms).map(([key, value]) => [String(key).toLowerCase(), groupTerms(value)])
  );
  for (const aliases of KEYWORD_GROUPS) {
    for (const alias of aliases) {
      const terms = entries.get(alias);
      if (!terms || !terms.length) continue;
      return [...new Set(terms.map((term) => String(term).trim()).filter(Boolean))].join("; ");
    }
  }
  return "";
}

export function normalizeArticle(article, fallbackJournal) {
  const doi = article.doi || article.DOI || "";
  const articleNumber = article.article_number || article.articleNumber || article.document_identifier || "";
  const externalId = doi || articleNumber || article.pdf_url || article.html_url || article.title;

  return {
    external_id: String(externalId),
    title: article.title || "Untitled",
    authors: normalizeAuthors(article),
    journal: article.publication_title || fallbackJournal,
    year: Number(article.publication_year || article.year || 0) || null,
    volume: article.volume || "",
    issue: article.issue || "",
    doi,
    abstract: article.abstract || "",
    url: article.html_url || article.pdf_url || (doi ? `https://doi.org/${doi}` : ""),
    published_at: normalizePublishedAt(article),
    fetched_at: new Date().toISOString(),
    keywords: normalizeKeywords(article)
  };
}

export async function fetchJournalArticles(journal, options = {}) {
  if (!config.ieeeEnabled) {
    throw new Error("IEEE is disabled");
  }
  if (!config.ieeeApiKey) {
    throw new Error("IEEE_API_KEY is not configured");
  }

  const lookbackDays = Number(options.lookbackDays || config.lookbackDays);
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - lookbackDays);

  const { maxRecords, pageSize, maxPages } = pageLimits(options);
  const params = new URLSearchParams({
    apikey: config.ieeeApiKey,
    format: "json",
    max_records: String(pageSize),
    start_record: "1",
    sort_order: "desc",
    sort_field: "article_number",
    publication_title: journal,
    start_date: formatDate(start),
    end_date: formatDate(end)
  });

  const records = [];
  for (let page = 0; page < maxPages; page += 1) {
    params.set("start_record", String(page * pageSize + 1));
    const data = await callIeeeApi(`${API_URL}?${params}`);
    const batch = Array.isArray(data.articles) ? data.articles : [];
    // The topical gate is applied here as well: IEEE Xplore is the primary
    // source for its own journals, so leaving it out would let everything the
    // Crossref/OpenAlex paths reject slip back in.
    records.push(...batch
      .map((article) => normalizeArticle(article, journal))
      .filter((article) => matchesJournalFilter(article, journal)));
    if (records.length >= maxRecords || batch.length < pageSize) break;
  }
  return records.slice(0, maxRecords);
}

export async function fetchIeeeArticleDetails(doi) {
  if (!config.ieeeEnabled) throw new Error("IEEE is disabled");
  if (!config.ieeeApiKey) throw new Error("IEEE_API_KEY is not configured");
  const normalizedDoi = String(doi || "").replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").trim();
  if (!normalizedDoi) return {};
  const params = new URLSearchParams({
    apikey: config.ieeeApiKey,
    format: "json",
    max_records: "25",
    start_record: "1",
    doi: normalizedDoi
  });
  const data = await callIeeeApi(`${API_URL}?${params}`);
  const articles = Array.isArray(data.articles) ? data.articles : [];
  const exact = articles.find((item) => String(item.doi || "").toLowerCase() === normalizedDoi.toLowerCase());
  return exact ? normalizeArticle(exact, "") : {};
}
