import { config } from "./config.js";
import { sleep } from "./utils.js";

// Read the body inside the timeout; retry only transient failures, never 403/404.
export async function requestJson(url, options = {}, policy = {}) {
  const retries = policy.retries ?? 2;
  for (let attempt = 0; ; attempt += 1) {
    let delay = 0;
    try {
      const response = await fetch(url, { ...options, signal: AbortSignal.timeout(config.crawlerTimeoutMs) });
      if (response.ok === false) {
        const error = new Error(`Metadata source returned ${response.status}`);
        error.status = response.status;
        const retryAfter = response.headers?.get?.("retry-after");
        delay = /^\d+$/.test(retryAfter || "") ? Number(retryAfter) * 1000 : Math.max(0, Date.parse(retryAfter) - Date.now()) || 0;
        throw error;
      }
      return await response.json();
    } catch (error) {
      const transient = [408, 425, 429].includes(error.status) || error.status >= 500
        || ["TimeoutError", "AbortError", "TypeError"].includes(error.name);
      if (!transient || attempt >= retries) throw error;
      // Do not retry earlier than the provider's requested interval. Defer a
      // long rate-limit to the next job rather than occupying the worker.
      if (delay > 30000) throw error;
      await sleep(delay || (policy.retryDelayMs ?? 500) * (attempt + 1));
    }
  }
}

export function collectionLimits(options = {}) {
  const requested = Number(options.maxRecords ?? 50);
  const maxRecords = Number.isFinite(requested) ? Math.max(1, Math.min(10000, Math.floor(requested))) : 50;
  return { maxRecords, pageSize: Math.min(100, maxRecords), maxPages: Math.min(100, Math.max(1, Number(options.maxPages) || 100)) };
}
