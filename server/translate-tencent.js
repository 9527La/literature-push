import crypto from "node:crypto";
import { config } from "./config.js";
// The monthly ledger is shared with the Baidu provider; see translation-ledger.js.
import { addUsage, budgetStatus, currentMonth, ledgerPath, markExhausted } from "./translation-ledger.js";

/**
 * Tencent Cloud Machine Translation (TMT) provider.
 *
 * Kept in its own module because it carries something the other providers do not
 * need: a spending guard. Translation is billed per character once the monthly
 * free allowance (5,000,000 characters) is used up, and a misconfigured account
 * can keep calling and keep paying without ever failing loudly. So every request
 * is metered locally and refused before it leaves the machine.
 */

export const TENCENT_HOST = "tmt.tencentcloudapi.com";
export const TENCENT_ENDPOINT = `https://${TENCENT_HOST}`;
const TENCENT_SERVICE = "tmt";
const TENCENT_VERSION = "2018-03-21";
const TENCENT_ACTION = "TextTranslateBatch";
const TENCENT_CONTENT_TYPE = "application/json; charset=utf-8";
const REQUEST_TIMEOUT_MS = 30_000;
const RETRY_LIMIT = 1;

/**
 * The documented per-request ceiling for the batch endpoint has been quoted as
 * both 2000 and 6000 characters across API revisions, so we stay under the
 * tighter figure: 1800 characters and 10 texts per request are valid on every
 * revision, and the only cost is a few more requests.
 */
export const TENCENT_MAX_REQUEST_CHARS = 1_800;
export const TENCENT_MAX_BATCH_SIZE = 10;

/** An unknown source language is detected for free ("语种识别不计费"). */
const TENCENT_SOURCE_LANGUAGE = "auto";

const LEDGER_KEY = "tencent";

function monthlyLimit() {
  return config.tencentMonthlyCharBudget;
}

/** Characters already spent this calendar month, as reported by the API. */
export function tencentBudgetStatus(now = new Date()) {
  return budgetStatus(LEDGER_KEY, monthlyLimit(), now);
}

export function recordTencentUsage(characters) {
  addUsage(LEDGER_KEY, characters);
}

/** Force the month to "used up" after the API says the free allowance is gone. */
function markBudgetExhausted() {
  markExhausted(LEDGER_KEY, monthlyLimit());
}

export function tencentBudgetNotice() {
  const status = tencentBudgetStatus();
  return `腾讯云翻译本月额度已用尽（已记录 ${status.used} / 上限 ${status.limit} 字符）。`
    + "已停止调用，避免超出免费额度产生费用。";
}

function assertBudget(characters) {
  const status = tencentBudgetStatus();
  if (!status.limit) return;
  if (status.used + characters > status.limit) {
    throw new Error(`${tencentBudgetNotice()} 如需继续，请在 .env 调整 TENCENT_MONTHLY_CHAR_BUDGET（0 表示不限制）。`);
  }
}

function sha256Hex(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function hmacSha256(key, value) {
  return crypto.createHmac("sha256", key).update(value).digest();
}

/**
 * TC3-HMAC-SHA256. Two details differ from the Volcengine v4 scheme used
 * elsewhere in this codebase: the signing key is prefixed with "TC3", and the
 * credential scope carries no region.
 */
export function buildTencentAuthorization({
  secretId,
  secretKey,
  host = TENCENT_HOST,
  action = TENCENT_ACTION,
  payload,
  timestamp = Math.floor(Date.now() / 1000)
}) {
  if (!secretId || !secretKey) {
    throw new Error("腾讯云翻译需要 TENCENT_SECRET_ID 与 TENCENT_SECRET_KEY");
  }
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const canonicalHeaders = `content-type:${TENCENT_CONTENT_TYPE}\nhost:${host}\nx-tc-action:${action.toLowerCase()}\n`;
  const signedHeaders = "content-type;host;x-tc-action";
  const hashedPayload = sha256Hex(payload);
  const canonicalRequest = ["POST", "/", "", canonicalHeaders, signedHeaders, hashedPayload].join("\n");
  const credentialScope = `${date}/${TENCENT_SERVICE}/tc3_request`;
  const stringToSign = ["TC3-HMAC-SHA256", String(timestamp), credentialScope, sha256Hex(canonicalRequest)].join("\n");
  const secretDate = hmacSha256(`TC3${secretKey}`, date);
  const secretService = hmacSha256(secretDate, TENCENT_SERVICE);
  const secretSigning = hmacSha256(secretService, "tc3_request");
  const signature = crypto.createHmac("sha256", secretSigning).update(stringToSign).digest("hex");
  return `TC3-HMAC-SHA256 Credential=${secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

/**
 * Turn TMT error codes into something an administrator can act on. The three
 * money-adjacent codes are the reason this mapping exists.
 */
export function tencentErrorMessage(code, message) {
  const map = {
    "FailedOperation.NoFreeAmount": "本月免费额度已用完（500 万字符）。已停止调用以免产生费用。",
    "FailedOperation.ServiceIsolate": "腾讯云账号欠费停服，请先充值。",
    "FailedOperation.StopUsing": "腾讯云翻译账号已停服。",
    "FailedOperation.UserNotRegistered": "腾讯云机器翻译服务尚未开通，请先在控制台开通。",
    "LimitExceeded": "超出配额限制。",
    "InvalidParameter": "请求参数不合法（可能单次字符数超限）。",
    "AuthFailure.SignatureFailure": "签名校验失败，请检查 SecretId / SecretKey。",
    "AuthFailure.SecretIdNotFound": "SecretId 不存在，请检查 TENCENT_SECRET_ID。",
    "AuthFailure.TokenFailure": "凭证无效（临时令牌已过期？）。",
    "RequestLimitExceeded": "请求过于频繁，已超过每秒 5 次的限制。"
  };
  return map[code] || `腾讯云翻译返回 ${code}${message ? `：${message}` : ""}`;
}

function countCharacters(list) {
  return list.reduce((total, text) => total + [...String(text || "")].length, 0);
}

function isRetryableStatus(status) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

async function postTencent(body) {
  const payload = JSON.stringify(body);
  const timestamp = Math.floor(Date.now() / 1000);
  const authorization = buildTencentAuthorization({
    secretId: config.tencentSecretId,
    secretKey: config.tencentSecretKey,
    payload,
    timestamp
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(TENCENT_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: authorization,
        "Content-Type": TENCENT_CONTENT_TYPE,
        Host: TENCENT_HOST,
        "X-TC-Action": TENCENT_ACTION,
        "X-TC-Version": TENCENT_VERSION,
        "X-TC-Timestamp": String(timestamp),
        "X-TC-Region": config.tencentRegion
      },
      body: payload,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Translate a batch of texts. Returns translations in the same order, or fewer
 * entries if the service returned less than asked for.
 */
export async function requestTencentBatch(textList, targetLanguage = "zh") {
  const list = (Array.isArray(textList) ? textList : []).map((text) => String(text ?? ""));
  if (!list.length) return [];

  const estimated = countCharacters(list);
  assertBudget(estimated);

  const body = {
    Source: TENCENT_SOURCE_LANGUAGE,
    Target: targetLanguage === "zh" ? "zh" : targetLanguage,
    ProjectId: 0,
    SourceTextList: list
  };

  let lastError;
  for (let attempt = 0; attempt <= RETRY_LIMIT; attempt += 1) {
    try {
      const response = await postTencent(body);
      if (!response.ok && isRetryableStatus(response.status)) {
        lastError = new Error(`腾讯云翻译服务返回 ${response.status}`);
        if (attempt < RETRY_LIMIT) continue;
        throw lastError;
      }
      const data = await response.json().catch(() => null);
      const payload = data?.Response;
      if (!payload) {
        throw new Error(`腾讯云翻译返回无法解析的响应（HTTP ${response.status}）`);
      }
      if (payload.Error) {
        const { Code, Message } = payload.Error;
        // "No free amount" is sticky for the rest of the month: latch the ledger
        // so every later call short-circuits instead of touching the API again.
        if (Code === "FailedOperation.NoFreeAmount") markBudgetExhausted();
        throw new Error(tencentErrorMessage(Code, Message));
      }
      // The service reports the exact billed characters; trust it over our own
      // estimate, and never meter a failed call (失败不计费).
      recordTencentUsage(Number(payload.UsedAmount) || estimated);
      const translations = payload.TargetTextList;
      if (!Array.isArray(translations)) {
        throw new Error("腾讯云翻译未返回 TargetTextList");
      }
      return translations.map((text) => String(text ?? "").trim());
    } catch (error) {
      lastError = error;
      // Configuration and quota problems are not worth a retry.
      if (/需要 TENCENT_SECRET_ID|额度已用尽|尚未开通|欠费|SecretId|签名/.test(error.message)) throw error;
      if (attempt >= RETRY_LIMIT) throw error;
    }
  }
  throw lastError || new Error("腾讯云翻译请求失败");
}

export const internals = {
  buildTencentAuthorization,
  tencentErrorMessage,
  countCharacters,
  ledgerPath,
  currentMonth
};
