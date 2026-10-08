import Taro from "@tarojs/taro";
import { BASE_URL } from "./config.js";
import { getPassportToken, getUserToken, silentRefresh } from "./session.js";

/**
 * 与网站 src/lib/api.js 同语义的传输层：
 * - 双 token 请求头（X-Passport-Token / X-User-Token）；
 * - CF 错误页 HTML → 「外部服务暂时不可用」；
 * - 列表类 20s 超时兜底；
 * - 401 时先尝试静默续登一次（用本地保存的凭据），失败才回登录页。
 */

const DEFAULT_TIMEOUT_MS = 20000;

function buildHeaders(hasBody) {
  const headers = {};
  if (hasBody) headers["Content-Type"] = "application/json";
  const passportToken = getPassportToken();
  if (passportToken) headers["X-Passport-Token"] = passportToken;
  const userToken = getUserToken();
  if (userToken) headers["X-User-Token"] = userToken;
  return headers;
}

function toError(status, bodyText) {
  let message = "";
  let payload = null;
  try {
    payload = JSON.parse(bodyText);
    message = payload?.error || "";
  } catch (error) {
    payload = null;
  }
  if (!message) {
    const looksLikeHtml = /<!doctype\s+html|<html\b|cf-error-details/i.test(String(bodyText || ""));
    message = looksLikeHtml
      ? `外部服务暂时不可用（${status}）`
      : String(bodyText || "").slice(0, 200) || `请求失败（${status}）`;
  }
  const error = new Error(message);
  error.status = status;
  error.payload = payload;
  return error;
}

function rawRequest(path, { method = "GET", data, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    Taro.request({
      url: `${BASE_URL}${path}`,
      method,
      data,
      header: buildHeaders(Boolean(data)),
      timeout: timeoutMs,
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data);
          return;
        }
        reject(toError(res.statusCode, typeof res.data === "string" ? res.data : JSON.stringify(res.data || {})));
      },
      fail: (err) => {
        const message = String(err?.errMsg || "");
        reject(new Error(message.includes("timeout") ? `请求超时（超过 ${Math.round(timeoutMs / 1000)} 秒），请稍后重试` : "网络请求失败，请检查网络后重试"));
      }
    });
  });
}

async function request(path, options) {
  try {
    return await rawRequest(path, options);
  } catch (error) {
    if (error.status === 401 && !options?.noRetry) {
      const refreshed = await silentRefresh().catch(() => false);
      if (refreshed) return rawRequest(path, options);
      Taro.reLaunch({ url: "/pages/login/index" });
    }
    throw error;
  }
}

export const api = {
  get: (path, options) => request(path, { ...options, method: "GET" }),
  post: (path, body, options) => request(path, { ...options, method: "POST", data: body }),
  put: (path, body, options) => request(path, { ...options, method: "PUT", data: body }),
  patch: (path, body, options) => request(path, { ...options, method: "PATCH", data: body }),
  delete: (path, options) => request(path, { ...options, method: "DELETE" })
};
