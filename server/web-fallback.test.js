import assert from "node:assert/strict";
import test from "node:test";
import { config } from "./config.js";
import {
  fetchWebFallbackDetails,
  internals,
  normalizeMatchTitle,
  titlesMatch
} from "./web-fallback.js";

const ARTICLE = {
  title: "A Weighted Predict-and-Optimize Framework",
  doi: "10.1109/TPWRS.2026.1234567",
  url: "https://ieeexplore.ieee.org/document/1234567"
};

function pageHtml(title, {
  abstract = "This is the complete publisher abstract returned after the challenge page is solved.",
  keywords = "Optimization; Power systems",
  doi = "10.1109/TPWRS.2026.1234567"
} = {}) {
  return `<!DOCTYPE html><html><head>
    <meta name="citation_title" content="${title}">
    ${doi ? `<meta name="citation_doi" content="${doi}">` : ""}
    <meta name="citation_abstract" content="${abstract}">
    <meta name="citation_keywords" content="${keywords}">
  </head><body><p>rendered</p><!-- ${"filler".repeat(400)} --></body></html>`;
}

function stubChromium(html, urls = []) {
  return {
    launch: async () => ({
      newPage: async () => ({
        setDefaultTimeout: () => {},
        url: () => "https://ieeexplore.ieee.org/document/1234567",
        goto: async (url) => { urls.push(String(url)); return { ok: true }; },
        waitForLoadState: async () => {},
        waitForFunction: async () => {},
        content: async () => html,
        close: async () => {}
      }),
      close: async () => {}
    })
  };
}

test("normalizes titles so punctuation and case never break matching", () => {
  assert.equal(
    normalizeMatchTitle("Indirect Predictive Power-Control: Grid Following"),
    normalizeMatchTitle("indirect predictive power control grid-following")
  );
  assert.ok(titlesMatch("A Weighted Predict-and-Optimize Framework", "a weighted predict and optimize framework"));
  assert.ok(!titlesMatch("A Weighted Predict-and-Optimize Framework", "Another Paper"));
});

test("a record is accepted only when the title or DOI matches", () => {
  assert.ok(internals.recordMatchesArticle({ title: ARTICLE.title }, ARTICLE));
  assert.ok(internals.recordMatchesArticle({ doi: "https://doi.org/10.1109/tpwrs.2026.1234567" }, ARTICLE));
  assert.ok(!internals.recordMatchesArticle({ title: "Another Paper", doi: "10.1000/other" }, ARTICLE));
  assert.ok(!internals.recordMatchesArticle({}, ARTICLE));
});

test("landing page falls back to the DOI resolver when no URL is known", () => {
  assert.equal(internals.landingPageUrl({ doi: "https://doi.org/10.1109/x" }), "https://doi.org/10.1109/x");
  assert.equal(internals.landingPageUrl({ url: "https://example.invalid/a" }), "https://example.invalid/a");
  assert.equal(internals.landingPageUrl({}), "");
});

test("disabled fallback returns nothing and never launches a browser", async () => {
  const original = config.webFallbackEnabled;
  config.webFallbackEnabled = false;
  let launched = 0;
  try {
    const result = await fetchWebFallbackDetails(ARTICLE, {
      executablePath: "C:/fake/msedge.exe",
      chromium: { launch: async () => { launched += 1; throw new Error("must not launch"); } }
    });
    assert.deepEqual(result, {});
    assert.equal(launched, 0);
  } finally {
    config.webFallbackEnabled = original;
  }
});

test("unified fallback renders the landing page and only fills missing fields", async () => {
  const originalInterval = config.webFallbackRequestIntervalMs;
  config.webFallbackRequestIntervalMs = 0;
  const urls = [];
  try {
    const result = await fetchWebFallbackDetails(ARTICLE, {
      executablePath: "C:/fake/msedge.exe",
      chromium: stubChromium(pageHtml(ARTICLE.title), urls)
    });
    assert.equal(result.abstract, "This is the complete publisher abstract returned after the challenge page is solved.");
    assert.equal(result.keywords, "Optimization; Power systems");
    assert.match(urls[0], /^https:\/\/doi\.org\/10\.1109\/TPWRS\.2026\.1234567$/);
  } finally {
    config.webFallbackRequestIntervalMs = originalInterval;
  }
});

test("a landing page for a different paper is rejected", async () => {
  const originalInterval = config.webFallbackRequestIntervalMs;
  config.webFallbackRequestIntervalMs = 0;
  try {
    const result = await fetchWebFallbackDetails(ARTICLE, {
      executablePath: "C:/fake/msedge.exe",
      chromium: stubChromium(pageHtml("Completely Different Title", { doi: "" }))
    });
    assert.deepEqual(result, {});
  } finally {
    config.webFallbackRequestIntervalMs = originalInterval;
  }
});
