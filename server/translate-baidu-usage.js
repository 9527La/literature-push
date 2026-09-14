/**
 * Baidu Translate allowance accounting.
 *
 * Baidu exposes no quota endpoint: the open API answers only translate calls,
 * and the console's usage figure lags by five minutes and is refreshed by a
 * human. So the number shown in the dashboard is this process's own monthly
 * tally of submitted characters against a configured ceiling — labelled as an
 * estimate rather than dressed up as an official balance.
 *
 * The one thing the API does tell us is *why* a call failed (54004 balance,
 * 54003 rate, 58002 service off), so the last such error is kept for display:
 * that is the real signal when the account runs dry.
 */
import { config } from "./config.js";
import { addUsage, budgetStatus, markExhausted } from "./translation-ledger.js";

const LEDGER_KEY = "baidu";

/** Error codes that mean "stop calling and tell the operator", with the fix. */
const BAIDU_ERROR_HINTS = {
  "52003": "APPID 未授权或服务未开通",
  "54003": "访问频率受限（标准版只有 1 QPS，认证后可到 10 QPS）",
  "54004": "账户余额不足，需要充值",
  "54005": "长文本请求过于频繁",
  "58000": "客户端 IP 非法，检查开发者信息里的服务器 IP 白名单",
  "58001": "译文语言方向不支持",
  "58002": "服务当前已关闭，需在管理控制台重新开启",
  "58003": "该 IP 当日被封禁（同一 IP 当日使用多个 APPID 会触发）",
  "90107": "认证未通过或未生效"
};

let lastError = null;

export function baiduBudgetStatus(now = new Date()) {
  return budgetStatus(LEDGER_KEY, config.baiduMonthlyCharLimit, now);
}

export function recordBaiduUsage(characters, now = new Date()) {
  addUsage(LEDGER_KEY, characters, now);
}

export function markBaiduExhausted(now = new Date()) {
  markExhausted(LEDGER_KEY, config.baiduMonthlyCharLimit, now);
}

export function noteBaiduError(message) {
  lastError = { message: String(message || ""), at: new Date().toISOString() };
  return lastError;
}

export function clearBaiduError() {
  lastError = null;
}

export function baiduLastError() {
  return lastError;
}

/** Turn the provider's raw error text into something actionable. */
export function baiduErrorHint(message) {
  const match = String(message || "").match(/\b(\d{5})\b/);
  if (!match) return "";
  return BAIDU_ERROR_HINTS[match[1]] || "";
}

export function baiduBudgetNotice() {
  const status = baiduBudgetStatus();
  if (!status.limit) {
    return `百度翻译已使用 ${status.used} 字符（未设置上限，仅统计）。`;
  }
  return `百度翻译本月按本地记账已用 ${status.used} / 上限 ${status.limit} 字符。`
    + "百度没有提供额度查询接口，这里是本系统自己的计数，可在 .env 用 BAIDU_MONTHLY_CHAR_LIMIT 调整上限（0 表示不限制）。";
}

export const internals = { BAIDU_ERROR_HINTS };
