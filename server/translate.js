import { config } from "./config.js";
import crypto from "node:crypto";
import { containsChineseText, sleep } from "./utils.js";
import {
  TENCENT_MAX_BATCH_SIZE,
  TENCENT_MAX_REQUEST_CHARS,
  requestTencentBatch,
  tencentBudgetNotice,
  tencentBudgetStatus
} from "./translate-tencent.js";
import {
  baiduBudgetNotice,
  baiduBudgetStatus,
  baiduErrorHint,
  baiduLastError,
  clearBaiduError,
  markBaiduExhausted,
  noteBaiduError,
  recordBaiduUsage
} from "./translate-baidu-usage.js";
import { combineBudgets } from "./translation-ledger.js";

const TRANSLATION_TIMEOUT_MS = 30_000;
const TRANSLATION_RETRY_LIMIT = 1;
const TRANSLATION_RETRY_DELAY_MS = 1_000;
const TRANSLATION_FIELD_DELAY_MS = 750;
const TRANSLATABLE_FIELDS = ["title", "abstract"];
const VOLCENGINE_HOST = "translate.volcengineapi.com";
const VOLCENGINE_PATH = "/";
const VOLCENGINE_ACTION = "TranslateText";
const VOLCENGINE_VERSION = "2020-06-01";
const VOLCENGINE_CONTENT_TYPE = "application/json";
const VOLCENGINE_MAX_TEXT_LENGTH = 4_500;
const VOLCENGINE_MAX_BATCH_LENGTH = 4_800;
const VOLCENGINE_MAX_BATCH_SIZE = 16;
const DEFAULT_PROVIDER_REQUEST_INTERVALS = {
  volcengine: 250,
  baidu: 125,
  // Tencent TMT allows 5 requests per second by default.
  tencent: 250
};
const providerQueues = new Map();
const providerLastRequestAt = new Map();

function hasText(value) {
  return String(value || "").trim().length > 0;
}

function isChineseSource(value) {
  const text = String(value || "").trim();
  return Boolean(text) && containsChineseText(text);
}

function normalizeChineseTargetLanguage(targetLanguage) {
  const value = String(targetLanguage || "zh").trim().toLowerCase();
  if (value !== "zh" && value !== "zh-cn") throw new Error("当前仅支持英文翻译为中文");
  return "zh";
}

function encodeRFC3986(value) {
  return encodeURIComponent(String(value ?? "")).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

function normalizeVolcengineQuery(query = {}) {
  const entries = Object.entries(query).flatMap(([key, value]) =>
    Array.isArray(value) ? value.map((item) => [key, item]) : [[key, value]]
  );
  return entries
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, value]) => `${encodeRFC3986(key)}=${encodeRFC3986(value)}`)
    .join("&");
}

function formatVolcengineDate(date = new Date()) {
  const value = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(value.getTime())) throw new Error("火山引擎签名时间无效");
  return value.toISOString().replace(/\.\d{3}Z$/, "Z").replace(/[-:]/g, "");
}

function sha256Hex(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function hmacSha256(key, value) {
  return crypto.createHmac("sha256", key).update(value).digest();
}

function buildVolcengineSignature({
  method = "POST",
  path = VOLCENGINE_PATH,
  query = {},
  headers = {},
  body = "",
  accessKeyId,
  secretAccessKey,
  region = "cn-north-1",
  service = "translate",
  date = new Date()
}) {
  if (!accessKeyId || !secretAccessKey) {
    throw new Error("Volcengine Translate requires VOLCENGINE_ACCESS_KEY_ID and VOLCENGINE_SECRET_ACCESS_KEY");
  }

  const bodyText = Buffer.isBuffer(body) ? body : String(body || "");
  const payloadHash = sha256Hex(bodyText);
  const normalizedHeaders = new Map(
    Object.entries(headers).map(([name, value]) => [name.toLowerCase(), String(value ?? "").trim()])
  );
  normalizedHeaders.set("x-date", normalizedHeaders.get("x-date") || formatVolcengineDate(date));
  normalizedHeaders.set("x-content-sha256", payloadHash);

  const signedHeaderNames = ["content-type", "host", "x-content-sha256", "x-date"];
  const canonicalHeaders = signedHeaderNames.map((name) => {
    const value = normalizedHeaders.get(name);
    if (!value) throw new Error(`Volcengine Translate signing requires ${name} header`);
    return `${name}:${value}`;
  }).join("\n");
  const signedHeaders = signedHeaderNames.join(";");
  const queryString = normalizeVolcengineQuery(query);
  const canonicalRequest = [
    String(method).toUpperCase(),
    path || VOLCENGINE_PATH,
    queryString,
    canonicalHeaders,
    "",
    signedHeaders,
    payloadHash
  ].join("\n");
  const xDate = normalizedHeaders.get("x-date");
  const shortDate = xDate.slice(0, 8);
  const credentialScope = `${shortDate}/${region}/${service}/request`;
  const stringToSign = [
    "HMAC-SHA256",
    xDate,
    credentialScope,
    sha256Hex(canonicalRequest)
  ].join("\n");
  const signingKey = hmacSha256(
    hmacSha256(
      hmacSha256(secretAccessKey, shortDate),
      region
    ),
    service
  );
  const finalKey = hmacSha256(signingKey, "request");
  const signature = crypto.createHmac("sha256", finalKey).update(stringToSign).digest("hex");
  const authorization = `HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    authorization,
    payloadHash,
    xDate,
    signedHeaders,
    queryString,
    canonicalRequest
  };
}

function getVolcengineEndpoint() {
  const endpoint = new URL(config.volcengineEndpoint || `https://${VOLCENGINE_HOST}`);
  const path = endpoint.pathname && endpoint.pathname !== "/"
    ? `${endpoint.pathname.replace(/\/+$/, "")}/`
    : VOLCENGINE_PATH;
  return {
    origin: `${endpoint.protocol}//${endpoint.host}`,
    host: endpoint.host || VOLCENGINE_HOST,
    path
  };
}

function volcengineTargetLanguage(targetLanguage) {
  return String(targetLanguage || "zh").toLowerCase().startsWith("zh") ? "zh" : "en";
}

function volcengineSourceLanguage(text, targetLanguage) {
  const source = /[\u4e00-\u9fff]/.test(text) ? "zh" : "en";
  return source === volcengineTargetLanguage(targetLanguage) ? "" : source;
}

function volcengineBatches(chunks) {
  const batches = [];
  let current = [];
  let length = 0;
  for (const chunk of chunks) {
    if (current.length && (current.length >= VOLCENGINE_MAX_BATCH_SIZE || length + chunk.length > VOLCENGINE_MAX_BATCH_LENGTH)) {
      batches.push(current);
      current = [];
      length = 0;
    }
    current.push(chunk);
    length += chunk.length;
  }
  if (current.length) batches.push(current);
  return batches;
}

function normalizeFields(fields) {
  const requested = Array.isArray(fields) && fields.length ? fields : TRANSLATABLE_FIELDS;
  return [...new Set(requested.filter((field) => TRANSLATABLE_FIELDS.includes(field)))];
}

function retryDelay(response, attempt) {
  const retryAfter = Number(response.headers?.get?.("retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.min(5_000, retryAfter * 1_000);
  }
  return TRANSLATION_RETRY_DELAY_MS * (attempt + 1);
}

function isRetryableStatus(status) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function canonicalProvider(provider) {
  return provider === "volc" ? "volcengine" : String(provider || "").trim().toLowerCase();
}

function providerRequestInterval(provider) {
  const key = canonicalProvider(provider);
  const configured = key === "volcengine"
    ? config.volcengineRequestIntervalMs
    : key === "baidu"
      ? config.baiduTranslateRequestIntervalMs
      : key === "tencent"
        ? config.tencentRequestIntervalMs
        : DEFAULT_PROVIDER_REQUEST_INTERVALS[key];
  const value = Number(configured);
  return Number.isFinite(value) && value >= 0
    ? value
    : Number(DEFAULT_PROVIDER_REQUEST_INTERVALS[key] || 0);
}

/**
 * Serialize requests for one provider across all callers in this process.
 * This is intentionally outside translateArticles: page preparation, admin
 * jobs and digest generation can all run at the same time, and each must use
 * the same rate-limited lane.  A failed request still releases the lane.
 */
function enqueueProviderRequest(provider, request) {
  const key = canonicalProvider(provider);
  const previous = providerQueues.get(key) || Promise.resolve();
  const queued = previous.catch(() => {}).then(async () => {
    const interval = providerRequestInterval(key);
    const lastStartedAt = providerLastRequestAt.get(key) || 0;
    const waitMs = Math.max(0, interval - (Date.now() - lastStartedAt));
    if (waitMs > 0) await sleep(waitMs);
    providerLastRequestAt.set(key, Date.now());
    return request();
  });
  // Keep the queue alive after a rejection so a failed provider request does
  // not poison subsequent requests.
  providerQueues.set(key, queued.catch(() => {}));
  return queued;
}

async function fetchTranslationResponse(url, options = {}, label = "Translation service") {
  let lastError;
  for (let attempt = 0; attempt <= TRANSLATION_RETRY_LIMIT; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TRANSLATION_TIMEOUT_MS);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      if (response.ok) return response;
      const body = await response.text().catch(() => "");
      const compactBody = body.replace(/\s+/g, " ").trim();
      const retryable = isRetryableStatus(response.status)
        && !(response.status === 429 && /quota|all available free translations|used all/i.test(compactBody));
      lastError = new Error(`${label} returned ${response.status}${compactBody ? `: ${compactBody.slice(0, 180)}` : ""}`);
      lastError.status = response.status;
      lastError.retryable = retryable;
      if (!retryable || attempt >= TRANSLATION_RETRY_LIMIT) throw lastError;
      await sleep(retryDelay(response, attempt));
    } catch (error) {
      if (error === lastError && error.status && !error.retryable) throw error;
      lastError = error.name === "AbortError" ? new Error(`${label} 请求超时`) : error;
      if (attempt >= TRANSLATION_RETRY_LIMIT) throw lastError;
      await sleep(TRANSLATION_RETRY_DELAY_MS * (attempt + 1));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError || new Error(`${label} 请求失败`);
}

async function requestVolcengineBatchUnthrottled(textList, targetLanguage) {
  if (!config.volcengineAccessKeyId || !config.volcengineSecretAccessKey) {
    throw new Error("Volcengine Translate requires VOLCENGINE_ACCESS_KEY_ID and VOLCENGINE_SECRET_ACCESS_KEY");
  }
  const endpoint = getVolcengineEndpoint();
  const requestPayload = {
    TargetLanguage: volcengineTargetLanguage(targetLanguage),
    TextList: textList
  };
  const sourceLanguage = volcengineSourceLanguage(textList.join("\n"), targetLanguage);
  if (sourceLanguage) requestPayload.SourceLanguage = sourceLanguage;
  const body = JSON.stringify(requestPayload);
  const query = {
    Action: VOLCENGINE_ACTION,
    Version: VOLCENGINE_VERSION
  };
  const signature = buildVolcengineSignature({
    method: "POST",
    path: endpoint.path,
    query,
    headers: {
      host: endpoint.host,
      "content-type": VOLCENGINE_CONTENT_TYPE
    },
    body,
    accessKeyId: config.volcengineAccessKeyId,
    secretAccessKey: config.volcengineSecretAccessKey,
    region: config.volcengineRegion,
    service: config.volcengineService
  });
  const response = await fetchTranslationResponse(
    `${endpoint.origin}${endpoint.path}?${signature.queryString}`,
    {
      method: "POST",
      headers: {
        Host: endpoint.host,
        "Content-Type": VOLCENGINE_CONTENT_TYPE,
        "X-Date": signature.xDate,
        "X-Content-Sha256": signature.payloadHash,
        Authorization: signature.authorization
      },
      body
    },
    "Volcengine Translate"
  );
  const data = await response.json();
  const apiError = data?.ResponseMetadata?.Error;
  if (apiError) {
    const code = apiError.Code || apiError.code || "unknown";
    const message = apiError.Message || apiError.message || "unknown error";
    throw new Error(`Volcengine Translate error ${code}: ${message}`);
  }
  const list = data?.TranslationList;
  if (!Array.isArray(list)) throw new Error("Volcengine Translate 未返回翻译结果");
  return list.slice(0, textList.length).map((item) => String(item?.Translation || "").trim());
}

async function requestVolcengineBatch(textList, targetLanguage) {
  return enqueueProviderRequest("volcengine", () =>
    requestVolcengineBatchUnthrottled(textList, targetLanguage)
  );
}

async function translateVolcengineText(text, targetLanguage) {
  if (!text) return "";
  const translated = [];
  const chunks = chunkText(text, VOLCENGINE_MAX_TEXT_LENGTH);
  for (const batch of volcengineBatches(chunks)) {
    const batchTranslations = await requestVolcengineBatch(batch, targetLanguage);
    if (batchTranslations.length < batch.length || batchTranslations.some((item) => !hasText(item))) {
      throw new Error("Volcengine Translate 未返回完整翻译结果");
    }
    translated.push(...batchTranslations);
  }
  return translated.join(volcengineTargetLanguage(targetLanguage) === "zh" ? "" : " ");
}

function inferSourceLanguage(text, targetLanguage) {
  if (targetLanguage === "en") return "auto";
  return /[\u4e00-\u9fff]/.test(text) ? "zh" : "en";
}

async function translateLibreText(text, targetLanguage) {
  if (!text) return "";

  const body = new URLSearchParams({
    q: text,
    source: inferSourceLanguage(text, targetLanguage),
    target: targetLanguage,
    format: "text"
  });

  if (config.libreTranslateApiKey) {
    body.set("api_key", config.libreTranslateApiKey);
  }

  const response = await fetchTranslationResponse(`${config.libreTranslateUrl}/translate`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  }, "LibreTranslate");

  const data = await response.json();
  const translated = Array.isArray(data.translatedText) ? data.translatedText.join("\n") : data.translatedText || "";
  if (!hasText(translated)) throw new Error(data.error || "LibreTranslate 未返回翻译");
  return translated;
}

function myMemoryTarget(targetLanguage) {
  return targetLanguage === "zh" ? "zh-CN" : "en";
}

function myMemorySource(text, targetLanguage) {
  if (targetLanguage === "en") return /[\u4e00-\u9fff]/.test(text) ? "zh-CN" : "en";
  return /[\u4e00-\u9fff]/.test(text) ? "zh-CN" : "en";
}

function chunkText(text, maxLength = 420) {
  const source = String(text || "").trim();
  if (!source) return [];

  const sentences = source.match(/[^.!?。！？]+[.!?。！？]*/g) || [source];
  const chunks = [];
  let current = "";

  for (const sentence of sentences) {
    if ((current + sentence).length <= maxLength) {
      current += sentence;
      continue;
    }
    if (current) chunks.push(current.trim());
    if (sentence.length <= maxLength) {
      current = sentence;
    } else {
      for (let index = 0; index < sentence.length; index += maxLength) {
        chunks.push(sentence.slice(index, index + maxLength).trim());
      }
      current = "";
    }
  }

  if (current) chunks.push(current.trim());
  return chunks;
}

async function translateMyMemoryChunk(text, targetLanguage) {
  const params = new URLSearchParams({
    q: text,
    langpair: `${myMemorySource(text, targetLanguage)}|${myMemoryTarget(targetLanguage)}`
  });
  if (config.myMemoryEmail) {
    params.set("de", config.myMemoryEmail);
  }

  const response = await fetchTranslationResponse(`https://api.mymemory.translated.net/get?${params.toString()}`, {}, "MyMemory");

  const data = await response.json();
  const translated = data.responseData?.translatedText || "";
  if (!hasText(translated)) {
    throw new Error(data.responseDetails || "MyMemory returned no translation");
  }
  return translated;
}

async function translateMyMemoryText(text, targetLanguage) {
  const chunks = chunkText(text);
  const translated = [];
  for (const chunk of chunks) {
    translated.push(await translateMyMemoryChunk(chunk, targetLanguage));
  }
  return translated.join(" ");
}

function baiduTarget(targetLanguage) {
  return targetLanguage === "zh" ? "zh" : "en";
}

function baiduSource(text, targetLanguage) {
  if (targetLanguage === "en") return /[\u4e00-\u9fff]/.test(text) ? "zh" : "en";
  return /[\u4e00-\u9fff]/.test(text) ? "zh" : "en";
}

async function translateBaiduText(text, targetLanguage) {
  if (!text) return "";
  if (!config.baiduTranslateAppId || !config.baiduTranslateKey) {
    throw new Error("Baidu Translate requires BAIDU_TRANSLATE_APPID and BAIDU_TRANSLATE_KEY");
  }

  const chunks = chunkText(text, 1200);
  const translated = [];
  for (const [index, chunk] of chunks.entries()) {
    if (index > 0) {
      await sleep(1100);
    }
    const salt = String(Date.now() + Math.floor(Math.random() * 100000));
    const sign = crypto
      .createHash("md5")
      .update(`${config.baiduTranslateAppId}${chunk}${salt}${config.baiduTranslateKey}`)
      .digest("hex");
    const params = new URLSearchParams({
      q: chunk,
      from: baiduSource(chunk, targetLanguage),
      to: baiduTarget(targetLanguage),
      appid: config.baiduTranslateAppId,
      salt,
      sign
    });

    const response = await fetchTranslationResponse(`https://fanyi-api.baidu.com/api/trans/vip/translate?${params.toString()}`, {}, "Baidu Translate");

    const data = await response.json();
    if (data.error_code) {
      throw new Error(`Baidu Translate error ${data.error_code}: ${data.error_msg || "unknown error"}`);
    }

    translated.push((data.trans_result || []).map((item) => item.dst).join("\n"));
  }
  return translated.join(" ");
}

function providerChunkLength(provider) {
  if (provider === "tencent") return TENCENT_MAX_REQUEST_CHARS;
  if (provider === "volcengine" || provider === "volc") return VOLCENGINE_MAX_TEXT_LENGTH;
  if (provider === "baidu") return 1_200;
  return 420;
}

function createProviderChunkUnits(units, provider) {
  const maxLength = providerChunkLength(provider);
  return units.flatMap((unit) => {
    const chunks = chunkText(unit.text, maxLength);
    return chunks.map((text, chunkIndex) => ({
      ...unit,
      text,
      chunkIndex,
      chunkCount: chunks.length
    }));
  });
}

function splitTranslationUnitBatches(units, {
  maxChars,
  maxItems = Number.POSITIVE_INFINITY,
  separatorLength = 0,
  groupBy
}) {
  const batches = [];
  let current = [];
  let length = 0;
  let currentGroup;
  for (const unit of units) {
    const group = groupBy ? groupBy(unit) : undefined;
    const nextLength = length + unit.text.length + (current.length ? separatorLength : 0);
    if (current.length && (
      current.length >= maxItems
      || nextLength > maxChars
      || (groupBy && group !== currentGroup)
    )) {
      batches.push(current);
      current = [];
      length = 0;
    }
    if (!current.length) currentGroup = group;
    current.push(unit);
    length += unit.text.length + (current.length > 1 ? separatorLength : 0);
  }
  if (current.length) batches.push(current);
  return batches;
}

function sourceLanguageForBaiduBatch(batch, targetLanguage) {
  return baiduSource(batch.map((unit) => unit.text).join("\n"), targetLanguage);
}

/**
 * Baidu bills the *source* text and counts every code point — Chinese characters,
 * letters, spaces, punctuation and markup alike — so `String.length` (UTF-16
 * units) would undercount anything outside the BMP.
 */
function countBaiduCharacters(text) {
  return [...String(text || "")].length;
}

/**
 * Same spending guard as Tencent's: once the monthly free allowance is gone the
 * account is billed 49 元/百万字符, and Baidu offers no quota endpoint to check
 * against. So the run stops at the locally configured ceiling instead of
 * discovering the overage on the next invoice.
 */
function assertBaiduBudget(characters) {
  const status = baiduBudgetStatus();
  if (!status.limit) return;
  if (status.used + characters > status.limit) {
    throw new Error(`${baiduBudgetNotice()} 本次请求需要 ${characters} 字符。`);
  }
}

async function requestBaiduBatchUnthrottled(textList, targetLanguage, sourceLanguage) {
  if (!config.baiduTranslateAppId || !config.baiduTranslateKey) {
    throw new Error("Baidu Translate requires BAIDU_TRANSLATE_APPID and BAIDU_TRANSLATE_KEY");
  }
  const q = textList.join("\n");
  const characters = countBaiduCharacters(q);
  assertBaiduBudget(characters);
  const salt = String(Date.now() + Math.floor(Math.random() * 100000));
  const sign = crypto
    .createHash("md5")
    .update(`${config.baiduTranslateAppId}${q}${salt}${config.baiduTranslateKey}`)
    .digest("hex");
  const params = new URLSearchParams({
    q,
    from: sourceLanguage || baiduSource(q, targetLanguage),
    to: baiduTarget(targetLanguage),
    appid: config.baiduTranslateAppId,
    salt,
    sign
  });
  const response = await fetchTranslationResponse(
    `https://fanyi-api.baidu.com/api/trans/vip/translate?${params.toString()}`,
    {},
    "Baidu Translate"
  );
  const data = await response.json();
  if (data.error_code) {
    const message = `Baidu Translate error ${data.error_code}: ${data.error_msg || "unknown error"}`;
    // Keep the reason for the dashboard: unlike a quota figure, Baidu does tell
    // us exactly why a call was refused.
    noteBaiduError(message);
    // 54004 is "账户余额不足". Retrying the remaining batches would only
    // rediscover the same fact, so mark the month spent and let the chain stop.
    if (String(data.error_code) === "54004") markBaiduExhausted();
    throw new Error(message);
  }
  recordBaiduUsage(characters);
  clearBaiduError();
  return Array.isArray(data.trans_result)
    ? data.trans_result.map((item) => String(item?.dst || "").trim())
    : [];
}

async function requestBaiduBatch(textList, targetLanguage, sourceLanguage) {
  return enqueueProviderRequest("baidu", () =>
    requestBaiduBatchUnthrottled(textList, targetLanguage, sourceLanguage)
  );
}

function mapBaiduBatchTranslations(translations, batch) {
  if (translations.length === batch.length) return translations;
  if (translations.length === 1 && batch.length > 1) {
    const split = translations[0].split(/\r?\n/).map((item) => item.trim());
    if (split.length === batch.length) return split;
  }
  return translations.slice(0, batch.length);
}

const SUPPORTED_PROVIDERS = ["tencent", "volcengine", "baidu", "libretranslate", "mymemory"];

/**
 * Does this provider have what it needs to be attempted? A keyed provider without
 * credentials is not a fallback, it is a guaranteed failure that still costs a
 * request, so it never enters the automatic chain.
 */
function providerHasCredentials(provider) {
  if (provider === "tencent") return Boolean(config.tencentSecretId && config.tencentSecretKey);
  if (provider === "baidu") return Boolean(config.baiduTranslateAppId && config.baiduTranslateKey);
  if (provider === "volcengine") return Boolean(config.volcengineAccessKeyId && config.volcengineSecretAccessKey);
  return true;
}

/**
 * The automatic chain is the configured `TRANSLATION_PROVIDERS` list (tencent,
 * baidu by default), filtered to providers that actually have credentials.
 *
 * Volcengine, LibreTranslate and MyMemory are switched off: Volcengine's
 * temporary token is dead, and the two keyless endpoints issue one request per
 * chunk — with up to 20 doomed requests per batch whenever the chain fell
 * through. They remain reachable through an explicit TRANSLATION_PROVIDER, and
 * keyless is still the last resort when no credential at all is configured, so
 * the feature degrades instead of silently doing nothing.
 */
function translationProviderList() {
  const configuredProvider = String(config.translationProvider || "auto").trim().toLowerCase();
  const configuredChain = (Array.isArray(config.translationProviders) ? config.translationProviders : [])
    .map(canonicalProvider);
  if (configuredProvider === "auto") {
    const chain = configuredChain.filter((provider) => providerHasCredentials(provider));
    return chain.length ? chain : ["libretranslate", "mymemory"];
  }
  if (configuredProvider === "keyless") return ["libretranslate", "mymemory"];
  if (SUPPORTED_PROVIDERS.includes(configuredProvider)) return [configuredProvider];
  throw new Error(`Unsupported translation provider: ${configuredProvider}`);
}

function setChunkResult(groups, chunkUnit, value) {
  if (!hasText(value)) return;
  const group = groups.get(chunkUnit.key);
  if (group) group.values.set(chunkUnit.chunkIndex, String(value).trim());
}

function addProviderError(errors, provider, units, error) {
  const message = error?.message || String(error || "请求失败");
  for (const unit of units) {
    errors.push({ key: unit.key, provider, message });
  }
}

async function translateChunkUnitsWithProvider(units, targetLanguage, provider) {
  const chunkUnits = createProviderChunkUnits(units, provider);
  const chunkCounts = new Map(chunkUnits.map((unit) => [unit.key, unit.chunkCount]));
  const groups = new Map(units.map((unit) => [unit.key, {
    unit: { ...unit, chunkCount: chunkCounts.get(unit.key) || 0 },
    values: new Map()
  }]));
  const errors = [];
  let requests = 0;

  if (provider === "tencent") {
    const batches = splitTranslationUnitBatches(chunkUnits, {
      maxChars: TENCENT_MAX_REQUEST_CHARS,
      maxItems: TENCENT_MAX_BATCH_SIZE,
      // TargetTextList is positional, so the separator only has to stay out of
      // the way: none is inserted.
      separatorLength: 0
    });
    for (const batch of batches) {
      requests += 1;
      try {
        const translations = await requestTencentBatch(batch.map((unit) => unit.text), targetLanguage);
        translations.forEach((value, index) => setChunkResult(groups, batch[index], value));
        if (translations.length < batch.length) {
          addProviderError(errors, provider, batch.slice(translations.length), new Error("未返回完整翻译结果"));
        }
      } catch (error) {
        addProviderError(errors, provider, batch, error);
        // A quota, credential or configuration problem repeats verbatim for
        // every remaining batch; stop after the first so an exhausted budget
        // cannot burn one request per batch to learn the same fact.
        if (/额度已用尽|尚未开通|欠费|停服|SecretId|SecretKey|签名/.test(error.message)) break;
      }
    }
  } else if (provider === "volcengine" || provider === "volc") {
    const batches = splitTranslationUnitBatches(chunkUnits, {
      maxChars: VOLCENGINE_MAX_BATCH_LENGTH,
      maxItems: VOLCENGINE_MAX_BATCH_SIZE,
      // A single request must not mix source languages.  This matters when a
      // legacy record already contains a Chinese title while its abstract is
      // still English.
      groupBy: (unit) => volcengineSourceLanguage(unit.text, targetLanguage) || "same"
    });
    for (const batch of batches) {
      requests += 1;
      try {
        const translations = await requestVolcengineBatch(batch.map((unit) => unit.text), targetLanguage);
        translations.forEach((value, index) => setChunkResult(groups, batch[index], value));
        if (translations.length < batch.length) {
          addProviderError(errors, provider, batch.slice(translations.length), new Error("未返回完整翻译结果"));
        }
      } catch (error) {
        addProviderError(errors, provider, batch, error);
      }
    }
  } else if (provider === "baidu") {
    const batches = splitTranslationUnitBatches(chunkUnits, {
      maxChars: 4_500,
      separatorLength: 1,
      groupBy: (unit) => baiduSource(unit.text, targetLanguage)
    });
    for (const batch of batches) {
      requests += 1;
      try {
        const sourceLanguage = sourceLanguageForBaiduBatch(batch, targetLanguage);
        const translations = mapBaiduBatchTranslations(
          await requestBaiduBatch(batch.map((unit) => unit.text), targetLanguage, sourceLanguage),
          batch
        );
        translations.forEach((value, index) => setChunkResult(groups, batch[index], value));
        if (translations.length < batch.length) {
          addProviderError(errors, provider, batch.slice(translations.length), new Error("未返回完整翻译结果"));
        }
      } catch (error) {
        addProviderError(errors, provider, batch, error);
      }
    }
  } else {
    const translateText = provider === "mymemory" ? translateMyMemoryText : translateLibreText;
    for (const chunkUnit of chunkUnits) {
      requests += 1;
      try {
        setChunkResult(groups, chunkUnit, await translateText(chunkUnit.text, targetLanguage));
      } catch (error) {
        addProviderError(errors, provider, [chunkUnit], error);
      }
    }
  }

  const results = new Map();
  for (const [key, group] of groups) {
    if (group.values.size !== group.unit.chunkCount) continue;
    const value = [...Array(group.unit.chunkCount).keys()]
      .map((index) => group.values.get(index))
      .join(volcengineTargetLanguage(targetLanguage) === "zh" ? "" : " ");
    if (hasText(value)) results.set(key, value);
  }
  return { results, errors, requests };
}

/**
 * Translate multiple article fields through provider-specific batches. The
 * returned results are field-level so callers can save each value without
 * overwriting an already cached title or abstract.
 */
export async function translateArticles(articles, targetLanguage = "zh", fields = TRANSLATABLE_FIELDS) {
  targetLanguage = normalizeChineseTargetLanguage(targetLanguage);
  const requestedFields = normalizeFields(fields);
  const logicalUnits = [];
  for (const [index, article] of (Array.isArray(articles) ? articles : []).entries()) {
    const articleId = article?.id ?? `item-${index}`;
    for (const field of requestedFields) {
      if (!hasText(article?.[field])) continue;
      if (isChineseSource(article[field])) continue;
      logicalUnits.push({
        key: `${articleId}:${field}`,
        articleId,
        field,
        text: String(article[field])
      });
    }
  }
  if (!logicalUnits.length) {
    return {
      results: [],
      failed: [],
      errors: [],
      translatedUnits: 0,
      translatedArticles: 0,
      requests: 0,
      providers: []
    };
  }

  const pending = new Map(logicalUnits.map((unit) => [unit.key, unit]));
  const results = new Map();
  const errorsByKey = new Map();
  const providers = [];
  let requests = 0;
  for (const provider of translationProviderList()) {
    if (!pending.size) break;
    let attempt;
    try {
      attempt = await translateChunkUnitsWithProvider([...pending.values()], targetLanguage, provider);
    } catch (error) {
      providers.push({ provider, requests: 0, error: error.message });
      for (const unit of pending.values()) errorsByKey.set(unit.key, `${provider}：${error.message}`);
      continue;
    }
    requests += attempt.requests;
    providers.push({ provider, requests: attempt.requests, failed: attempt.errors.length });
    for (const error of attempt.errors) {
      const previous = errorsByKey.get(error.key);
      errorsByKey.set(error.key, previous ? `${previous}；${error.provider}：${error.message}` : `${error.provider}：${error.message}`);
    }
    for (const [key, text] of attempt.results) {
      const unit = pending.get(key);
      if (!unit) continue;
      results.set(key, { ...unit, translated: text, provider });
      pending.delete(key);
    }
  }

  const resultItems = logicalUnits
    .filter((unit) => results.has(unit.key))
    .map((unit) => results.get(unit.key));
  const failed = [...pending.values()].map((unit) => ({
    ...unit,
    message: errorsByKey.get(unit.key) || "翻译服务未返回有效译文"
  }));
  return {
    results: resultItems,
    failed,
    errors: failed.map((item) => ({ id: item.articleId, field: item.field, message: item.message })),
    translatedUnits: resultItems.length,
    translatedArticles: new Set(resultItems.map((item) => item.articleId)).size,
    requests,
    providers
  };
}

async function translateWithProvider(article, targetLanguage, provider, fields = TRANSLATABLE_FIELDS) {
  const translateText =
    provider === "volcengine" || provider === "volc"
      ? translateVolcengineText
      : provider === "baidu"
      ? translateBaiduText
      : provider === "mymemory"
        ? translateMyMemoryText
        : translateLibreText;
  const result = { title: "", abstract: "", provider };
  const errors = [];
  const requested = normalizeFields(fields).filter((field) => hasText(article[field]) && !isChineseSource(article[field]));
  for (const [index, field] of requested.entries()) {
    try {
      const translated = await translateText(article[field], targetLanguage);
      if (!hasText(translated)) throw new Error("服务未返回有效译文");
      result[field] = translated;
    } catch (error) {
      errors.push(`${field === "title" ? "标题" : "摘要"}：${error.message}`);
    }
    if (index < requested.length - 1) await sleep(TRANSLATION_FIELD_DELAY_MS);
  }
  if (errors.length) result.errors = errors;
  if (!requested.some((field) => hasText(result[field]))) {
    const error = new Error(errors.join("；") || "没有可翻译内容");
    error.partial = result;
    throw error;
  }
  return result;
}

export async function translateArticle(article, targetLanguage, fields = TRANSLATABLE_FIELDS) {
  targetLanguage = normalizeChineseTargetLanguage(targetLanguage);
  const requested = normalizeFields(fields).filter((field) => hasText(article?.[field]) && !isChineseSource(article[field]));
  if (!requested.length) throw new Error("没有可翻译的标题或摘要");
  const input = { ...(article || {}), id: article?.id ?? "single" };
  const batch = await translateArticles([input], targetLanguage, requested);
  const result = { title: "", abstract: "", provider: "" };
  for (const item of batch.results) {
    if (requested.includes(item.field)) {
      result[item.field] = item.translated;
      result.provider = item.provider || result.provider;
    }
  }
  if (batch.failed.length) {
    result.errors = batch.failed.map((item) => `${item.field === "title" ? "标题" : "摘要"}：${item.message}`);
  }
  if (!requested.some((field) => hasText(result[field]))) {
    throw new Error(`翻译服务不可用：${batch.failed.map((item) => item.message).join("；") || "未返回有效译文"}`);
  }
  return result;
}

/**
 * One tiny translation per configured provider, so an administrator can see
 * which credentials actually work before running a large batch. Costs a handful
 * of characters; every call is metered by the provider module itself.
 */
export async function probeTranslationProviders(targetLanguage = "zh") {
  const providers = translationProviderList();
  const results = [];
  for (const provider of providers) {
    const unit = { key: "probe:title", articleId: "probe", field: "title", text: "power system" };
    try {
      const attempt = await translateChunkUnitsWithProvider([unit], targetLanguage, provider);
      const sample = attempt.results.get(unit.key) || "";
      results.push({
        provider: canonicalProvider(provider),
        ok: hasText(sample),
        sample: String(sample).slice(0, 40),
        requests: attempt.requests,
        error: attempt.errors[0]?.message || ""
      });
    } catch (error) {
      results.push({ provider: canonicalProvider(provider), ok: false, sample: "", requests: 0, error: error.message });
    }
  }
  return results;
}

export function translationProvidersInUse() {
  return translationProviderList().map(canonicalProvider);
}

export function translationTencentBudget() {
  return tencentBudgetStatus();
}

/**
 * Baidu is metered locally (it exposes no quota endpoint), so the status carries
 * the caveat and the provider's own last refusal — the balance error is the real
 * signal that the account needs attention.
 */
export function translationBaiduBudget() {
  const status = baiduBudgetStatus();
  const lastError = baiduLastError();
  return {
    ...status,
    notice: baiduBudgetNotice(),
    lastError,
    lastErrorHint: lastError ? baiduErrorHint(lastError.message) : ""
  };
}

/**
 * What the chain as a whole can still spend. Translation falls through
 * tencent → baidu, so "will this queue fit?" is answered by the total, and a run
 * is only budget-limited when every provider in the chain is spent.
 */
export function translationBudgets() {
  return {
    tencent: translationTencentBudget(),
    baidu: translationBaiduBudget(),
    combined: combineBudgets([tencentBudgetStatus(), baiduBudgetStatus()])
  };
}

export function translationBudgetNotice() {
  return tencentBudgetNotice();
}

export const internals = {
  chunkText,
  normalizeFields,
  translateWithProvider,
  translateArticles,
  normalizeVolcengineQuery,
  formatVolcengineDate,
  buildVolcengineSignature
};
