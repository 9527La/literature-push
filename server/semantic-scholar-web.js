import fs from "node:fs";
import { chromium } from "playwright-core";
import { config } from "./config.js";
import { decodeEntities, isUsableMetadataText, sleep, stripTags } from "./utils.js";

const DEFAULT_INTERVAL_MS = 12000;
let crawlQueue = Promise.resolve();
let lastStartedAt = 0;

export function normalizeSemanticScholarTitle(value) {
  return decodeEntities(stripTags(value || ""))
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "");
}

export function extractSemanticScholarAbstract(cardText) {
  const text = String(cardText || "").replace(/\r/g, "");
  const marker = text.match(/(?:^|\n)Abstract\s*\n/i);
  if (!marker) return "";
  let abstract = text.slice(marker.index + marker[0].length);
  const endings = [
    /\n(?:Collapse|Hide truncated text)\b/i,
    /\n\d+\s+citations?\b/i,
    /\nIEEE\b/i,
    /\nSave\b/i,
    /\nCite\b/i
  ];
  let end = abstract.length;
  for (const pattern of endings) {
    const match = abstract.match(pattern);
    if (match && match.index < end) end = match.index;
  }
  abstract = decodeEntities(stripTags(abstract.slice(0, end))).replace(/\s+/g, " ").trim();
  return isUsableMetadataText(abstract) && abstract.length >= 120 ? abstract : "";
}

function metadataText(value) {
  if (typeof value === "string") return decodeEntities(stripTags(value)).replace(/\s+/g, " ").trim();
  if (value && typeof value === "object") return metadataText(value.text || value.value || value.name || "");
  return "";
}

export function findExactSemanticScholarRecord(payload, expectedTitle) {
  const expected = normalizeSemanticScholarTitle(expectedTitle);
  const seen = new Set();
  const stack = [payload];
  while (stack.length) {
    const value = stack.pop();
    if (!value || typeof value !== "object" || seen.has(value)) continue;
    seen.add(value);
    const title = metadataText(value.title);
    const abstract = metadataText(value.abstract);
    if (title && normalizeSemanticScholarTitle(title) === expected && abstract.length >= 120 && isUsableMetadataText(abstract)) {
      return {
        title,
        abstract,
        url: metadataText(value.url) || metadataText(value.paperUrl) || metadataText(value.paper?.url)
      };
    }
    if (Array.isArray(value)) stack.push(...value);
    else stack.push(...Object.values(value));
  }
  return null;
}

function browserExecutablePath() {
  const configured = String(config.semanticScholarBrowserExecutable || "").trim();
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
  const value = Number(config.semanticScholarWebRequestIntervalMs);
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_INTERVAL_MS;
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

export async function fetchSemanticScholarWebDetails(article, options = {}) {
  if (!config.semanticScholarWebFallbackEnabled) return {};
  const title = String(article?.title || "").trim();
  if (!title) return {};

  return enqueue(async () => {
    const executablePath = options.executablePath || browserExecutablePath();
    if (!executablePath) throw new Error("Semantic Scholar 网页兜底未找到可用的 Edge/Chrome 浏览器");

    const browser = await (options.chromium || chromium).launch({
      executablePath,
      headless: true,
      args: ["--no-first-run", "--disable-background-networking", "--disable-extensions"]
    });
    try {
      const page = await browser.newPage({
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        locale: "en-US"
      });
      page.setDefaultTimeout(config.semanticScholarWebTimeoutMs);
      const searchUrl = `https://www.semanticscholar.org/search?q=${encodeURIComponent(title)}`;
      const responsePromise = page.waitForResponse(
        (response) => response.url().includes("/api/1/search") && response.status() === 200,
        { timeout: config.semanticScholarWebTimeoutMs }
      ).catch(() => null);
      await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: config.semanticScholarWebTimeoutMs });

      // Prefer the JSON response used by the public search page. This avoids
      // depending on button labels when Semantic Scholar changes its layout.
      const searchResponse = await responsePromise;
      if (searchResponse) {
        const record = findExactSemanticScholarRecord(await searchResponse.json(), title);
        if (record) return record;
      }

      await page.waitForFunction(
        (expected) => [...document.querySelectorAll('a[href*="/paper/"]')]
          .some((link) => link.textContent.normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "") === expected),
        normalizeSemanticScholarTitle(title),
        { timeout: config.semanticScholarWebTimeoutMs }
      );

      const link = await findExactPaperLink(page, title);
      if (!link) throw new Error("Semantic Scholar 网页结果未找到完全一致的标题");
      const href = await link.getAttribute("href");
      const card = link.locator('xpath=ancestor::div[.//button[contains(@aria-label,"Expand truncated text")]][1]');
      if (!await card.count()) throw new Error("Semantic Scholar 网页结果缺少可展开摘要");
      await card.getByRole("button", { name: "Expand truncated text" }).click();
      await card.getByRole("button", { name: /Hide truncated text|Collapse/i }).waitFor();
      const abstract = extractSemanticScholarAbstract(await card.innerText());
      if (!abstract) throw new Error("Semantic Scholar 网页未返回可用的完整摘要");

      return {
        title,
        abstract,
        url: href ? new URL(href, "https://www.semanticscholar.org").href : ""
      };
    } finally {
      await browser.close();
    }
  });
}

export const internals = {
  browserExecutablePath,
  findExactPaperLink,
  intervalMs
};
