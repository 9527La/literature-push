import { getPassportToken, getUserToken } from "./storage.js";

// ── GET 短缓存（P8）────────────────────────────────────────────────────
// 文献详情 / 相关文献 / 关键词统计这类 GET 在反复打开弹窗、来回切换视图时
// 会被重复请求。给它们 60s TTL：命中缓存时弹窗即时渲染，弱网下尤其明显。
// 任何写操作（POST/PUT/PATCH/DELETE）都整体失效，已读/收藏/分组变更不会
// 读到旧状态。带 signal 的调用（列表请求的 20s 超时）不走缓存。
const GET_CACHE_TTL_MS = 60000;
const getCache = new Map();

export function clearGetCache() {
  getCache.clear();
}

async function parseResponse(response) {
  if (response.ok) return response.json();
  const text = await response.text();
  try {
    const data = JSON.parse(text);
    const error = new Error(data.error || text);
    error.status = response.status;
    error.payload = data;
    if (data.article) error.article = data.article;
    throw error;
  } catch (error) {
    if (error instanceof SyntaxError) {
      const looksLikeHtml = /<!doctype\s+html|<html\b|<head\b|<body\b|cf-error-details/i.test(text);
      throw new Error(looksLikeHtml ? `外部服务暂时不可用（${response.status}）` : (text.slice(0, 300) || `请求失败（${response.status}）`));
    }
    throw error;
  }
}

export function requestHeaders(hasBody = false) {
  const headers = {};
  if (hasBody) headers["Content-Type"] = "application/json";
  const passportToken = getPassportToken();
  if (passportToken) headers["X-Passport-Token"] = passportToken;
  const userToken = getUserToken();
  if (userToken) headers["X-User-Token"] = userToken;
  return headers;
}

export const api = {
  async get(path, { signal } = {}) {
    // 带 signal（列表超时控制）或缓存未命中 → 直连；命中 → 复用 60s 内的结果。
    if (signal) return parseResponse(await fetch(path, { headers: requestHeaders(), signal }));
    const hit = getCache.get(path);
    if (hit && Date.now() - hit.at < GET_CACHE_TTL_MS) return hit.value;
    const value = await parseResponse(await fetch(path, { headers: requestHeaders() }));
    getCache.set(path, { at: Date.now(), value });
    return value;
  },
  /**
   * `timeoutMs` 可选：不传则沿用浏览器默认（不超时）。
   * 生成摘要后发信这类请求必须给一个上限，否则网关掐断时页面会一直停在「发送中」。
   */
  async post(path, body, { timeoutMs } = {}) {
    clearGetCache();
    const controller = timeoutMs ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      return await parseResponse(await fetch(path, {
        method: "POST",
        headers: requestHeaders(Boolean(body)),
        body: body ? JSON.stringify(body) : undefined,
        signal: controller?.signal
      }));
    } catch (error) {
      if (controller?.signal.aborted) throw new Error(`请求超时（超过 ${Math.round(timeoutMs / 1000)} 秒），请稍后在收件箱确认是否已收到`);
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
    }
  },
  async put(path, body) {
    clearGetCache();
    return parseResponse(await fetch(path, {
      method: "PUT",
      headers: requestHeaders(true),
      body: JSON.stringify(body)
    }));
  },
  async patch(path, body) {
    clearGetCache();
    return parseResponse(await fetch(path, { method: "PATCH", headers: requestHeaders(true), body: JSON.stringify(body) }));
  },
  async delete(path) {
    clearGetCache();
    return parseResponse(await fetch(path, { method: "DELETE", headers: requestHeaders() }));
  },
  /** 研究方向统计（RUNBOOK-AI-JOBS.md 第 4 节 classify 管线的数据出口）。 */
  async getDirectionStats({ window, matrix } = {}) {
    const params = new URLSearchParams();
    if (window) params.set("window", String(window));
    if (matrix) params.set("matrix", "1");
    const suffix = params.toString() ? `?${params.toString()}` : "";
    return api.get(`/api/directions${suffix}`);
  },
  /** 管理员改判研究方向（置 direction_source='manual'，AI 分类永不覆盖）。 */
  async setArticleDirection(id, direction, secondary = []) {
    return api.post(`/api/admin/articles/${id}/direction`, { direction, secondary });
  }
};
