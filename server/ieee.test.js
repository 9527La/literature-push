import test from "node:test";
import assert from "node:assert/strict";
import { config } from "./config.js";
import { normalizeArticle } from "./ieee.js";
import { internals } from "./sources.js";
import { crawlArticleDetails, internals as crawlerInternals } from "./crawler.js";
import { internals as translateInternals } from "./translate.js";
import { internals as mailInternals } from "./mail.js";

test("normalizes IEEE metadata into an article record", () => {
  const article = normalizeArticle(
    {
      article_number: "12345",
      title: "Power System Test",
      publication_title: "IEEE Transactions on Power Systems",
      publication_year: "2026",
      publication_date: "20260601",
      doi: "10.1109/example",
      authors: { authors: [{ full_name: "Ada Chen" }, { full_name: "Bo Li" }] },
      html_url: "https://ieeexplore.ieee.org/document/12345"
    },
    "Fallback Journal"
  );

  assert.equal(article.external_id, "10.1109/example");
  assert.equal(article.authors, "Ada Chen, Bo Li");
  assert.equal(article.journal, "IEEE Transactions on Power Systems");
  assert.equal(article.published_at, "2026-06-01");
  assert.equal(article.year, 2026);
});

test("chunks long translation input", () => {
  const chunks = translateInternals.chunkText("A sentence. ".repeat(80), 120);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => chunk.length <= 120));
});

test("extracts fallback html metadata for crawler", () => {
  const html = `
    <meta name="citation_title" content="A Paper Title">
    <meta name="citation_abstract" content="A paper abstract.">
    <meta name="citation_doi" content="10.1109/example">
  `;
  const metadata = crawlerInternals.parseHtmlMetadata(html);
  assert.equal(metadata.title, "A Paper Title");
  assert.equal(metadata.abstract, "A paper abstract.");
  assert.equal(metadata.doi, "10.1109/example");
});

test("crawler reports missing requested metadata while preserving partial fields", async () => {
  const previousFetch = globalThis.fetch;
  const previousCrawlerEnabled = config.crawlerEnabled;
  config.crawlerEnabled = true;
  globalThis.fetch = async () => ({
    ok: true,
    url: "https://publisher.example/article",
    text: async () => '<meta name="citation_title" content="Partial title">'
  });

  try {
    await assert.rejects(
      crawlArticleDetails({
        id: 99,
        title: "Original title",
        url: "https://publisher.example/article",
        abstract: "",
        keywords: ""
      }),
      (error) => {
        assert.match(error.message, /摘要、关键词/);
        assert.equal(error.details.title, "Original title");
        return true;
      }
    );
  } finally {
    globalThis.fetch = previousFetch;
    config.crawlerEnabled = previousCrawlerEnabled;
  }
});

test("translation provider only requests the selected field", async () => {
  const previousFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return {
      ok: true,
      json: async () => ({ translatedText: "中文标题" })
    };
  };

  try {
    const result = await translateInternals.translateWithProvider(
      { title: "English title", abstract: "English abstract" },
      "zh",
      "libretranslate",
      ["title"]
    );
    assert.equal(result.title, "中文标题");
    assert.equal(result.abstract, "");
    assert.equal(calls.length, 1);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("Volcengine translation uses V4 signing and JSON request fields", async () => {
  const previousFetch = globalThis.fetch;
  const previousConfig = {
    volcengineAccessKeyId: config.volcengineAccessKeyId,
    volcengineSecretAccessKey: config.volcengineSecretAccessKey,
    volcengineEndpoint: config.volcengineEndpoint,
    volcengineRegion: config.volcengineRegion,
    volcengineService: config.volcengineService
  };
  const requests = [];
  Object.assign(config, {
    volcengineAccessKeyId: "AK_TEST",
    volcengineSecretAccessKey: "SK_TEST",
    volcengineEndpoint: "https://translate.volcengineapi.com",
    volcengineRegion: "cn-north-1",
    volcengineService: "translate"
  });
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), options });
    return {
      ok: true,
      json: async () => ({
        TranslationList: [{ Translation: "中文标题" }],
        ResponseMetadata: { Error: null }
      })
    };
  };

  try {
    const result = await translateInternals.translateWithProvider(
      { title: "English title", abstract: "English abstract" },
      "zh",
      "volcengine",
      ["title"]
    );
    assert.equal(result.title, "中文标题");
    assert.equal(result.abstract, "");
    assert.equal(requests.length, 1);
    assert.match(requests[0].url, /Action=TranslateText&Version=2020-06-01/);
    const payload = JSON.parse(requests[0].options.body);
    assert.deepEqual(payload.TextList, ["English title"]);
    assert.equal(payload.TargetLanguage, "zh");
    assert.equal(payload.SourceLanguage, "en");
    assert.match(requests[0].options.headers.Authorization, /^HMAC-SHA256 Credential=AK_TEST\/\d{8}\/cn-north-1\/translate\/request/);
    assert.equal(requests[0].options.headers["Content-Type"], "application/json");
  } finally {
    globalThis.fetch = previousFetch;
    Object.assign(config, previousConfig);
  }
});

test("batch translation packs multiple article fields and maps them by order", async () => {
  const previousFetch = globalThis.fetch;
  const previousConfig = {
    translationProvider: config.translationProvider,
    volcengineAccessKeyId: config.volcengineAccessKeyId,
    volcengineSecretAccessKey: config.volcengineSecretAccessKey,
    baiduTranslateAppId: config.baiduTranslateAppId,
    baiduTranslateKey: config.baiduTranslateKey
  };
  const requests = [];
  Object.assign(config, {
    translationProvider: "volcengine",
    volcengineAccessKeyId: "AK_TEST",
    volcengineSecretAccessKey: "SK_TEST",
    baiduTranslateAppId: "",
    baiduTranslateKey: ""
  });
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), options });
    const payload = JSON.parse(options.body);
    return {
      ok: true,
      json: async () => ({
        TranslationList: payload.TextList.map((text) => ({ Translation: `译文:${text}` })),
        ResponseMetadata: { Error: null }
      })
    };
  };

  try {
    const result = await translateInternals.translateArticles([
      { id: 101, title: "Title A", abstract: "Abstract A", keywords: "keyword A" },
      { id: 102, title: "Title B", abstract: "Abstract B", keywords: "keyword B" }
    ], "zh", ["title", "abstract", "keywords"]);
    assert.equal(result.requests, 1);
    assert.equal(result.translatedUnits, 4);
    assert.equal(result.failed.length, 0);
    assert.deepEqual(result.results.map((item) => `${item.articleId}:${item.field}`), [
      "101:title", "101:abstract", "102:title", "102:abstract"
    ]);
    assert.equal(JSON.parse(requests[0].options.body).TextList.length, 4);
    assert.equal(JSON.parse(requests[0].options.body).keywords, undefined);
  } finally {
    globalThis.fetch = previousFetch;
    Object.assign(config, previousConfig);
  }
});

test("batch translation falls back to Baidu with a provider-specific payload", async () => {
  const previousFetch = globalThis.fetch;
  const previousConfig = {
    translationProvider: config.translationProvider,
    volcengineAccessKeyId: config.volcengineAccessKeyId,
    volcengineSecretAccessKey: config.volcengineSecretAccessKey,
    baiduTranslateAppId: config.baiduTranslateAppId,
    baiduTranslateKey: config.baiduTranslateKey
  };
  const calls = [];
  Object.assign(config, {
    translationProvider: "auto",
    volcengineAccessKeyId: "AK_TEST",
    volcengineSecretAccessKey: "SK_TEST",
    baiduTranslateAppId: "BAIDU_TEST",
    baiduTranslateKey: "BAIDU_SECRET"
  });
  globalThis.fetch = async (url) => {
    const value = String(url);
    calls.push(value);
    if (value.includes("translate.volcengineapi.com")) {
      return { ok: false, status: 400, text: async () => "invalid request" };
    }
    return {
      ok: true,
      json: async () => ({
        trans_result: [{ dst: "百度标题" }, { dst: "百度摘要" }]
      })
    };
  };

  try {
    const result = await translateInternals.translateArticles([
      { id: 201, title: "English title", abstract: "English abstract" }
    ], "zh", ["title", "abstract"]);
    assert.equal(result.translatedUnits, 2);
    assert.equal(result.failed.length, 0);
    assert.ok(result.results.every((item) => item.provider === "baidu"));
    assert.equal(calls.filter((url) => url.includes("translate.volcengineapi.com")).length, 1);
    assert.equal(calls.filter((url) => url.includes("fanyi-api.baidu.com")).length, 1);
    const baiduUrl = calls.find((url) => url.includes("fanyi-api.baidu.com"));
    assert.match(decodeURIComponent(new URL(baiduUrl).searchParams.get("q")), /English title\nEnglish abstract/);
  } finally {
    globalThis.fetch = previousFetch;
    Object.assign(config, previousConfig);
  }
});

test("long batch text is chunked and reassembled without translating keywords", async () => {
  const previousFetch = globalThis.fetch;
  const previousConfig = {
    translationProvider: config.translationProvider,
    volcengineAccessKeyId: config.volcengineAccessKeyId,
    volcengineSecretAccessKey: config.volcengineSecretAccessKey
  };
  const batches = [];
  Object.assign(config, {
    translationProvider: "volcengine",
    volcengineAccessKeyId: "AK_TEST",
    volcengineSecretAccessKey: "SK_TEST"
  });
  globalThis.fetch = async (_url, options) => {
    const payload = JSON.parse(options.body);
    batches.push(payload.TextList);
    return {
      ok: true,
      json: async () => ({
        TranslationList: payload.TextList.map((text) => ({ Translation: `[${text.slice(0, 8)}]` })),
        ResponseMetadata: { Error: null }
      })
    };
  };

  try {
    const result = await translateInternals.translateArticles([
      { id: 301, title: "Short title", abstract: `${"Long sentence. ".repeat(400)}`, keywords: "never translate" }
    ], "zh", ["title", "abstract", "keywords"]);
    assert.equal(result.failed.length, 0);
    assert.equal(result.translatedUnits, 2);
    assert.ok(batches.length >= 2);
    assert.ok(batches.every((batch) => batch.length <= 16 && batch.reduce((sum, item) => sum + item.length, 0) <= 4800));
    assert.ok(result.results.find((item) => item.field === "abstract")?.translated.includes("]"));
    assert.equal(result.results.some((item) => item.field === "keywords"), false);
  } finally {
    globalThis.fetch = previousFetch;
    Object.assign(config, previousConfig);
  }
});

test("provider requests share one rate-limited lane across concurrent batches", async () => {
  const previousFetch = globalThis.fetch;
  const previousConfig = {
    translationProvider: config.translationProvider,
    volcengineAccessKeyId: config.volcengineAccessKeyId,
    volcengineSecretAccessKey: config.volcengineSecretAccessKey,
    volcengineRequestIntervalMs: config.volcengineRequestIntervalMs
  };
  const starts = [];
  Object.assign(config, {
    translationProvider: "volcengine",
    volcengineAccessKeyId: "AK_TEST",
    volcengineSecretAccessKey: "SK_TEST",
    volcengineRequestIntervalMs: 35
  });
  globalThis.fetch = async (_url, options) => {
    starts.push(Date.now());
    const payload = JSON.parse(options.body);
    return {
      ok: true,
      json: async () => ({
        TranslationList: payload.TextList.map((text) => ({ Translation: `译文:${text}` })),
        ResponseMetadata: { Error: null }
      })
    };
  };

  try {
    await Promise.all([
      translateInternals.translateArticles([{ id: 401, title: "Title A" }], "zh", ["title"]),
      translateInternals.translateArticles([{ id: 402, title: "Title B" }], "zh", ["title"])
    ]);
    assert.equal(starts.length, 2);
    const sorted = [...starts].sort((a, b) => a - b);
    assert.ok(sorted[1] - sorted[0] >= 30, `requests started ${sorted[1] - sorted[0]} ms apart`);
  } finally {
    globalThis.fetch = previousFetch;
    Object.assign(config, previousConfig);
  }
});

test("extracts meta content regardless of attribute order", () => {
  const html = `
    <meta content="Content-first title" property="og:title">
    <meta content="alpha" name="citation_keywords">
    <meta name="citation_keywords" content="beta">
  `;
  const metadata = crawlerInternals.parseHtmlMetadata(html);
  assert.equal(metadata.title, "Content-first title");
  assert.equal(metadata.keywords, "alpha; beta");
});

test("normalizes month-level crawler publication dates", () => {
  assert.equal(crawlerInternals.normalizePublicationDate("June 2026"), "2026-06-01");
  assert.equal(crawlerInternals.normalizePublicationDate("2026-06-03"), "2026-06-03");
});

test("extracts IEEE page metadata JSON", () => {
  const html = `
    <script>
      xplGlobal.document.metadata={"title":"Example","abstract":"A useful abstract.","doi":"10.1109/example"};
    </script>
  `;
  const metadata = crawlerInternals.parseIeeeMetadata(html);
  assert.equal(metadata.title, "Example");
  assert.equal(metadata.abstract, "A useful abstract.");
  assert.equal(metadata.doi, "10.1109/example");
});

test("crawler continues to a second DOI source when the first source is partial", async () => {
  const previousFetch = globalThis.fetch;
  const previousCrawlerEnabled = config.crawlerEnabled;
  const calls = [];
  config.crawlerEnabled = true;
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (calls.length === 1) {
      return {
        ok: true,
        json: async () => ({
          title: "Partial source title",
          doi: "10.1109/example",
          keywords: [{ display_name: "Power systems" }],
          abstract_inverted_index: null
        })
      };
    }
    if (calls.length === 2) {
      return {
        ok: true,
        json: async () => ({ message: { title: ["Crossref title"], DOI: "10.1109/example" } })
      };
    }
    return {
      ok: true,
      json: async () => ({
        title: "Semantic title",
        abstract: "Abstract supplied by Semantic Scholar",
        externalIds: { DOI: "10.1109/example" },
        authors: []
      })
    };
  };

  try {
    const details = await crawlArticleDetails({
      id: 1,
      title: "Original title",
      doi: "10.1109/example",
      url: "https://doi.org/10.1109/example",
      abstract: "",
      keywords: ""
    });
    assert.equal(details.keywords, "Power systems");
    assert.equal(details.abstract, "Abstract supplied by Semantic Scholar");
    assert.equal(calls.length, 3);
  } finally {
    globalThis.fetch = previousFetch;
    config.crawlerEnabled = previousCrawlerEnabled;
  }
});

test("normalizes Crossref metadata into an article record", () => {
  const article = internals.normalizeCrossrefItem(
    {
      DOI: "10.1109/TPWRS.2025.3639304",
      title: ["A Weighted Predict-and-Optimize Framework"],
      "container-title": ["IEEE Transactions on Power Systems"],
      published: { "date-parts": [[2026, 5]] },
      author: [{ given: "Ada", family: "Chen" }],
      URL: "https://doi.org/10.1109/tpwrs.2025.3639304"
    },
    { name: "IEEE Transactions on Power Systems", issns: ["1558-0679"] }
  );

  assert.equal(article.external_id, "doi:10.1109/tpwrs.2025.3639304");
  assert.equal(article.authors, "Ada Chen");
  assert.equal(article.published_at, "2026-05-01");
});

test("adds the generated Markdown file as a digest attachment", () => {
  const message = mailInternals.buildDigestMailOptions("data/digests/report.md", {
    recipients: ["reader@example.com"],
    fileName: "report.md"
  });
  assert.equal(message.to, "reader@example.com");
  assert.deepEqual(message.attachments, [{ filename: "report.md", path: "data/digests/report.md" }]);
});
