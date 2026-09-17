import test from "node:test";
import assert from "node:assert/strict";
import { config } from "./config.js";
import { crawlArticleDetails, internals } from "./crawler.js";

// OpenAlex 的 concepts 是自动打的学科标签（"Control theory (sociology)" 这种），
// 历史上被当成关键词写库，污染了 2000 多条记录。宁可留空也不能再写回去。
test("normalizeOpenAlexDetail never falls back to concepts or primary_topic", () => {
  assert.equal(
    internals.normalizeOpenAlexDetail({
      doi: "https://doi.org/10.1234/example",
      title: "A Paper",
      keywords: [],
      concepts: [{ display_name: "Control theory (sociology)", score: 0.9 }],
      primary_topic: { display_name: "Phase Change Materials Research" }
    }).keywords,
    ""
  );
  assert.equal(
    internals.normalizeOpenAlexDetail({
      keywords: [{ display_name: "作者关键词" }],
      concepts: [{ display_name: "Control theory (sociology)", score: 0.9 }]
    }).keywords,
    "作者关键词"
  );
});

// 统一浏览器兜底：API 与纯 HTTP 全挂之后才走，且只补缺失字段。
test("crawlArticleDetails falls through to the unified browser fallback", async () => {
  const originalFetch = globalThis.fetch;
  const originalInterval = config.webFallbackRequestIntervalMs;
  const originalIeeeKey = config.ieeeApiKey;
  config.webFallbackRequestIntervalMs = 0;
  config.ieeeApiKey = "";
  globalThis.fetch = async () => new Response("unavailable", { status: 503 });
  const html = `<html><head>
    <meta name="citation_title" content="A Weighted Predict-and-Optimize Framework">
    <meta name="citation_abstract" content="The complete abstract recovered by rendering the page in a real browser.">
  </head><body>${"<p>filler</p>".repeat(300)}</body></html>`;
  const chromium = {
    launch: async () => ({
      newPage: async () => ({
        setDefaultTimeout: () => {},
        url: () => "https://ieeexplore.ieee.org/document/1234567",
        goto: async () => ({ ok: true }),
        waitForLoadState: async () => {},
        waitForFunction: async () => {},
        content: async () => html,
        close: async () => {}
      }),
      close: async () => {}
    })
  };
  try {
    const details = await crawlArticleDetails(
      {
        title: "A Weighted Predict-and-Optimize Framework",
        doi: "10.1109/TPWRS.2026.1234567",
        url: "https://ieeexplore.ieee.org/document/1234567",
        abstract: "",
        keywords: ""
      },
      { fields: ["abstract"], webFallbackExecutablePath: "C:/fake/msedge.exe", webFallbackChromium: chromium }
    );
    assert.equal(details.abstract, "The complete abstract recovered by rendering the page in a real browser.");
  } finally {
    globalThis.fetch = originalFetch;
    config.webFallbackRequestIntervalMs = originalInterval;
    config.ieeeApiKey = originalIeeeKey;
  }
});

// OpenAlex 自 2026-02 起要求所有请求带 API key，并改为按日额度计费。没有 key 时
// 会落到一个极小的匿名共享额度上，额度一空接口立刻返回 429「Insufficient budget」，
// 这正是关键词/摘要补全整批失败的根因之一。
test("applyOpenAlexAuth sends the API key when configured", () => {
  const originalKey = config.openAlexApiKey;
  const originalMailto = config.crossrefMailto;
  try {
    config.openAlexApiKey = "oa-secret";
    config.crossrefMailto = "ops@example.com";
    const params = internals.applyOpenAlexAuth(new URLSearchParams());
    assert.equal(params.get("api_key"), "oa-secret");
    assert.equal(params.get("mailto"), "ops@example.com");
  } finally {
    config.openAlexApiKey = originalKey;
    config.crossrefMailto = originalMailto;
  }
});

test("applyOpenAlexAuth keeps mailto as the keyless courtesy identifier", () => {
  const originalKey = config.openAlexApiKey;
  const originalMailto = config.crossrefMailto;
  try {
    config.openAlexApiKey = "";
    config.crossrefMailto = "ops@example.com";
    const params = internals.applyOpenAlexAuth(new URLSearchParams());
    assert.equal(params.get("api_key"), null);
    assert.equal(params.get("mailto"), "ops@example.com");
  } finally {
    config.openAlexApiKey = originalKey;
    config.crossrefMailto = originalMailto;
  }
});

test("applyOpenAlexAuth adds nothing when neither a key nor a mailto exists", () => {
  const originalKey = config.openAlexApiKey;
  const originalMailto = config.crossrefMailto;
  try {
    config.openAlexApiKey = "";
    config.crossrefMailto = "";
    const params = internals.applyOpenAlexAuth(new URLSearchParams());
    assert.equal(params.toString(), "");
  } finally {
    config.openAlexApiKey = originalKey;
    config.crossrefMailto = originalMailto;
  }
});
