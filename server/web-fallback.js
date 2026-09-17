// 统一浏览器兜底流程。
//
// 触发条件：DOI 类 API（Elsevier / Scopus / IEEE / Crossref / Semantic Scholar）
// 与纯 HTTP 抓取出版社落地页全部失败后，才会走到这里。
//
// 固定流程（所有站点共用，改站点只改 WEB_FALLBACK_SITES 顺序）：
//   1. 选站：按配置顺序取候选站点，站点自己声明能否处理这篇文章；
//   2. 节流：全局串行 + 请求间隔，绝不对同一站点并发打；
//   3. 取页：真实浏览器（Edge/Chrome headless）渲染，绕开纯 HTTP 遇到的
//      Cloudflare / JS 挑战页；
//   4. 解析：统一走 html-metadata.js 的 extractPageMetadata
//      （JSON-LD → 出版社专用 → citation_* / og 通用 meta），
//      保证与纯 HTTP 路径对同一个页面的解析结果一致；
//   5. 校验：标题归一化后完全一致（或 DOI 一致）才认，避免抓到错文章；
//   6. 合并：只补缺失字段，已拿到的字段不覆盖。
//
// 新增兜底站点只要往 SITES 里加一项 { id, label, url, collect }，不用动流程。
import fs from "node:fs";
import { chromium } from "playwright-core";
import { config } from "./config.js";
import { isUsableMetadataText, sleep, stripTags } from "./utils.js";
import { extractPageMetadata } from "./html-metadata.js";
import {
  extractSemanticScholarAbstract,
  findExactSemanticScholarRecord,
  normalizeSemanticScholarTitle
} from "./semantic-scholar-web.js";

const DEFAULT_INTERVAL_MS = 12000;
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

let crawlQueue = Promise.resolve();
let lastStartedAt = 0;

// 批量补全文献时每篇都新起一个浏览器太贵（冷启动 1–3 秒 × 上千篇）。
// 生产路径复用同一个浏览器实例，每次只开新标签页；空闲一段时间后自动关闭，
// 避免长期占着一个 Edge/Chrome 进程。测试注入的 chromium 不走共享，保持确定性。
const SHARED_BROWSER_IDLE_MS = 5 * 60 * 1000;
let sharedBrowser = null;
let sharedBrowserPath = "";
let idleTimer = null;

function clearIdleTimer() {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
}

function scheduleIdleClose() {
  clearIdleTimer();
  idleTimer = setTimeout(() => {
    idleTimer = null;
    const browser = sharedBrowser;
    sharedBrowser = null;
    sharedBrowserPath = "";
    browser?.close().catch(() => {});
  }, SHARED_BROWSER_IDLE_MS);
  idleTimer.unref?.();
}

export async function closeSharedBrowser() {
  clearIdleTimer();
  const browser = sharedBrowser;
  sharedBrowser = null;
  sharedBrowserPath = "";
  if (browser) await browser.close().catch(() => {});
}

async function acquireBrowser(options) {
  const executablePath = options.executablePath || browserExecutablePath();
  if (!executablePath) throw new Error("统一兜底未找到可用的 Edge/Chrome 浏览器");

  // 注入实现（测试/排障）不走共享，避免不同 chromium 实现互相串味。
  if (options.chromium) {
    return {
      browser: await options.chromium.launch({
        executablePath,
        headless: true,
        args: ["--no-first-run", "--disable-background-networking", "--disable-extensions"]
      }),
      owned: true
    };
  }

  if (sharedBrowser && sharedBrowser.isConnected() && sharedBrowserPath === executablePath) {
    clearIdleTimer();
    return { browser: sharedBrowser, owned: false };
  }
  await closeSharedBrowser();
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ["--no-first-run", "--disable-background-networking", "--disable-extensions"]
  });
  sharedBrowser = browser;
  sharedBrowserPath = executablePath;
  return { browser, owned: false };
}

export function normalizeMatchTitle(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "");
}

export function titlesMatch(a, b) {
  const left = normalizeMatchTitle(a);
  const right = normalizeMatchTitle(b);
  return Boolean(left) && left === right;
}

function stripDoiPrefix(value) {
  return String(value || "").replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").replace(/^doi:/i, "").trim();
}

function normalizeDoi(value) {
  return stripDoiPrefix(value).toLowerCase();
}

export function browserExecutablePath() {
  const configured = String(config.webFallbackBrowserExecutable || "").trim();
  if (configured) return configured;
  const candidates = process.platform === "win32"
    ? [
        "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
        "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
      ]
    : ["/usr/bin/microsoft-edge", "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
  return candidates.find((candidate) => fs.existsSync(candidate)) || "";
}

function intervalMs() {
  const value = Number(config.webFallbackRequestIntervalMs);
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_INTERVAL_MS;
}

function timeoutMs() {
  const value = Number(config.webFallbackTimeoutMs);
  return Number.isFinite(value) && value > 0 ? value : 30000;
}

function enqueue(task) {
  const run = crawlQueue.catch(() => {}).then(async () => {
    const waitMs = Math.max(0, intervalMs() - (Date.now() - lastStartedAt));
    if (waitMs) await sleep(waitMs);
    lastStartedAt = Date.now();
    return task();
  });
  crawlQueue = run.catch(() => {});
  return run;
}

function cleanText(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return isUsableMetadataText(text) ? text : "";
}

// 只有标题或 DOI 对得上才认这条记录——爬虫最容易犯的错就是抓到同刊的另一篇文章。
function recordMatchesArticle(record, article) {
  if (!record || typeof record !== "object") return false;
  const title = cleanText(record.title);
  if (title && titlesMatch(title, article?.title)) return true;
  const doi = normalizeDoi(record.doi);
  const expectedDoi = normalizeDoi(article?.doi);
  return Boolean(doi) && doi === expectedDoi;
}

function landingPageUrl(article) {
  // DOI 解析大小写不敏感，但保留原始写法，避免落地页地址与原库记录不一致。
  const doi = stripDoiPrefix(article?.doi);
  if (doi) return `https://doi.org/${doi}`;
  const url = String(article?.url || "").trim();
  return /^https?:\/\//i.test(url) ? url : "";
}

async function collectLandingPage(page, article) {
  const url = landingPageUrl(article);
  if (!url) throw new Error("文章没有 DOI 或落地页地址");

  const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs() });
  if (response && response.ok === false) throw new Error(`落地页返回 ${response.status()}`);
  // 元数据一到手就走，不死等 networkidle：IEEE Xplore 这类重页面光等空闲就要 8 秒，
  // 而 xplGlobal 里的内容通常在 2–4 秒就位。等不到再退回空闲等待。
  const metadataReady = typeof page.waitForFunction === "function"
    ? await page
      .waitForFunction(() => Boolean(window.xplGlobal?.document?.metadata?.title), null, { timeout: Math.min(15000, timeoutMs()) })
      .then(() => true)
      .catch(() => false)
    : false;
  if (!metadataReady) {
    await page.waitForLoadState("networkidle", { timeout: Math.min(8000, timeoutMs()) }).catch(() => {});
  }
  const html = await page.content();
  if (!html || html.length < 2000) throw new Error(`落地页只有 ${html.length} 字节，疑似挑战页`);

  const host = (() => { try { return new URL(page.url()).hostname.toLowerCase(); } catch { return ""; } })();
  const record = extractPageMetadata(html, { elsevier: host.endsWith("sciencedirect.com") });
  if (!recordMatchesArticle(record, article)) {
    throw new Error(`落地页标题不匹配（页面：${String(record.title || "").slice(0, 60)}）`);
  }
  return record;
}

async function findExactPaperLink(page, title) {
  const expected = normalizeSemanticScholarTitle(title);
  const links = page.locator('a[href*="/paper/"]');
  const count = await links.count();
  for (let index = 0; index < count; index += 1) {
    const link = links.nth(index);
    if (normalizeSemanticScholarTitle(await link.innerText()) === expected) return link;
  }
  return null;
}

async function collectSemanticScholar(page, article) {
  const title = String(article?.title || "").trim();
  if (!title) throw new Error("文章缺少标题，无法检索");

  const searchUrl = `https://www.semanticscholar.org/search?q=${encodeURIComponent(title)}`;
  const responsePromise = page.waitForResponse(
    (response) => response.url().includes("/api/1/search") && response.status() === 200,
    { timeout: timeoutMs() }
  ).catch(() => null);
  await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs() });

  // 优先用搜索页自己的 JSON 接口，不依赖按钮文案。
  const searchResponse = await responsePromise;
  if (searchResponse) {
    const record = findExactSemanticScholarRecord(await searchResponse.json(), title);
    if (record) return record;
  }

  await page.waitForFunction(
    (expected) => [...document.querySelectorAll('a[href*="/paper/"]')]
      .some((link) => link.textContent.normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "") === expected),
    normalizeSemanticScholarTitle(title),
    { timeout: timeoutMs() }
  );

  const link = await findExactPaperLink(page, title);
  if (!link) throw new Error("Semantic Scholar 结果未找到完全一致的标题");
  const href = await link.getAttribute("href");
  const card = link.locator('xpath=ancestor::div[.//button[contains(@aria-label,"Expand truncated text")]][1]');
  if (!await card.count()) throw new Error("Semantic Scholar 结果缺少可展开摘要");
  await card.getByRole("button", { name: "Expand truncated text" }).click();
  await card.getByRole("button", { name: /Hide truncated text|Collapse/i }).waitFor();
  const abstract = extractSemanticScholarAbstract(await card.innerText());
  if (!abstract) throw new Error("Semantic Scholar 未返回可用的完整摘要");

  return {
    title,
    abstract,
    url: href ? new URL(href, "https://www.semanticscholar.org").href : ""
  };
}

// 站点注册表：加站点只改这里。
export const SITES = {
  landingPage: { id: "landingPage", label: "出版社落地页", collect: collectLandingPage },
  semanticScholar: { id: "semanticScholar", label: "Semantic Scholar 检索页", collect: collectSemanticScholar }
};

function resolveSites() {
  const requested = Array.isArray(config.webFallbackSites) ? config.webFallbackSites : [];
  const resolved = requested.map((id) => SITES[id]).filter(Boolean);
  return resolved.length ? resolved : Object.values(SITES);
}

function pickFields(record) {
  const picked = {};
  for (const key of ["title", "authors", "journal", "abstract", "keywords", "doi", "url", "year", "volume", "issue", "published_at"]) {
    const value = typeof record?.[key] === "string" ? cleanText(record[key]) : record?.[key];
    if (value === "" || value === null || value === undefined || value === 0) continue;
    picked[key] = value;
  }
  return picked;
}

// 统一入口。返回 {} 表示兜底也没拿到东西，调用方照常报错，不会因此静默成功。
export async function fetchWebFallbackDetails(article, options = {}) {
  if (config.webFallbackEnabled === false) return {};
  const title = String(article?.title || "").trim();
  if (!title) return {};

  const sites = resolveSites().filter((site) => (options.sites ? options.sites.includes(site.id) : true));
  if (!sites.length) return {};

  return enqueue(async () => {
    let handle = await acquireBrowser(options);
    const diagnostics = [];
    let merged = {};
    let page = null;
    try {
      // 共享浏览器偶尔会崩；崩掉就重开一个再试一次，不让单篇失败拖垮整批。
      page = await handle.browser.newPage({ userAgent: USER_AGENT, locale: "en-US" })
        .catch(async (error) => {
          if (handle.owned) throw error;
          await closeSharedBrowser();
          handle = await acquireBrowser(options);
          return handle.browser.newPage({ userAgent: USER_AGENT, locale: "en-US" });
        });
      page.setDefaultTimeout(timeoutMs());
      for (const site of sites) {
        try {
          const record = await site.collect(page, article);
          if (!recordMatchesArticle(record, article)) {
            diagnostics.push({ source: site.id, status: "mismatch" });
            continue;
          }
          merged = { ...merged, ...pickFields(record) };
          diagnostics.push({ source: site.id, status: "success" });
          if (options.isComplete?.(merged)) break;
        } catch (error) {
          diagnostics.push({ source: site.id, status: "error", message: error?.message || String(error) });
        }
      }
    } finally {
      if (typeof page?.close === "function") await page.close().catch(() => {});
      if (handle.owned) await handle.browser.close().catch(() => {});
      else scheduleIdleClose();
    }
    if (typeof options.onDiagnostics === "function") options.onDiagnostics(diagnostics);
    return merged;
  });
}

export const internals = {
  browserExecutablePath,
  findExactPaperLink,
  intervalMs,
  recordMatchesArticle,
  landingPageUrl,
  pickFields,
  stripTags
};
