import test from "node:test";
import assert from "node:assert/strict";
import { config } from "./config.js";
import { fetchJournalArticles } from "./sources.js";

const CHINESE_JOURNAL = {
  name: "电网技术",
  issns: ["1000-3673"],
  wanfangId: "dwjs"
};

const RSS = `<?xml version="1.0"?><rss><channel><item>
  <title><![CDATA[基于导纳降阶模型的并网变流器稳定性分析]]></title>
  <description><![CDATA[中文摘要]]></description>
  <link>https://d.wanfangdata.com.cn/periodical/dwjs202608031</link>
  <pubDate>Mon, 03 Aug 2026 16:00:00 GMT</pubDate>
</item></channel></rss>`;

test("Chinese journals use Wanfang first and do not call Crossref/OpenAlex on success", async () => {
  const originalFetch = globalThis.fetch;
  const originalSources = config.publicDataSources;
  const calls = [];
  config.publicDataSources = ["crossref", "openalex"];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return new Response(RSS, { status: 200, headers: { "content-type": "application/rss+xml" } });
  };
  try {
    const articles = await fetchJournalArticles(CHINESE_JOURNAL, { maxRecords: 5 });
    assert.equal(articles.length, 1);
    assert.equal(articles[0].external_id, "wanfang:dwjs202608031");
    assert.equal(calls.length, 1);
    assert.match(calls[0], /apps\.wanfangdata\.com\.cn\/perios\/rss\/dwjs/);
  } finally {
    globalThis.fetch = originalFetch;
    config.publicDataSources = originalSources;
  }
});

test("Crossref pages by offset, because cursor combined with sort is rejected", async () => {
  const originalFetch = globalThis.fetch;
  const originalSources = config.publicDataSources;
  const calls = [];
  config.publicDataSources = ["crossref"];
  const item = (n, title) => ({
    DOI: `10.1109/tte.2026.000${n}`,
    title: [title || `Transportation electrification study ${n}`],
    "container-title": ["IEEE Transactions on Transportation Electrification"],
    published: { "date-parts": [[2026, 8, 3]] },
    author: [{ given: "Ada", family: "Chen" }],
    URL: `https://doi.org/10.1109/tte.2026.000${n}`
  });
  let page = 0;
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    page += 1;
    // A full first page of which only one record is research, then a short
    // second page: forces two requests without tripping the maxRecords stop.
    const items = page === 1
      ? [item(1), item(2, "Editorial Board"), item(3, "Table of Contents"), item(4, "Front Cover")]
      : [item(5)];
    return new Response(JSON.stringify({ message: { items } }), { status: 200 });
  };
  try {
    const articles = await fetchJournalArticles(
      { name: "IEEE Transactions on Transportation Electrification", issns: ["2332-7782"] },
      { maxRecords: 4 }
    );
    assert.equal(calls.length, 2);
    assert.ok(calls.every((url) => !url.includes("cursor")), "cursor paging must be gone");
    assert.ok(calls.every((url) => url.includes("sort=published")), "the sort must survive");
    assert.match(calls[0], /offset=0(&|$)/);
    assert.match(calls[1], /offset=4(&|$)/);
    assert.deepEqual(articles.map((article) => article.external_id), [
      "doi:10.1109/tte.2026.0001", "doi:10.1109/tte.2026.0005"
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    config.publicDataSources = originalSources;
  }
});

test("OpenAlex is used only as a Chinese-record fallback after Wanfang fails", async () => {
  const originalFetch = globalThis.fetch;
  const originalSources = config.publicDataSources;
  const calls = [];
  config.publicDataSources = ["openalex"];
  globalThis.fetch = async (url) => {
    const text = String(url);
    calls.push(text);
    if (text.includes("apps.wanfangdata.com.cn")) return new Response("unavailable", { status: 503 });
    return new Response(JSON.stringify({ results: [
      {
        id: "https://openalex.org/W123",
        doi: "https://doi.org/10.1234/example",
        title: "基于公开数据的电网稳定性分析",
        publication_year: 2026,
        publication_date: "2026-08-03",
        primary_location: {
          landing_page_url: "https://example.invalid/paper",
          source: { display_name: "Power System Technology", issn_l: "1000-3673", issn: ["1000-3673"] }
        },
        abstract_inverted_index: { "电网": [0], "稳定性": [1] },
        authorships: [],
        keywords: [],
        concepts: [],
        primary_topic: null,
        biblio: {}
      },
      {
        id: "https://openalex.org/W124",
        title: "Unrelated English record",
        publication_year: 2026,
        publication_date: "2026-08-04",
        primary_location: {
          landing_page_url: "https://en.cnki.com.cn/Article_en/CJFDTOTAL-DWJS200908002.htm",
          source: { display_name: "Power System Technology", issn_l: "1000-3673", issn: ["1000-3673"] }
        },
        abstract_inverted_index: {},
        authorships: [],
        keywords: [],
        concepts: [],
        primary_topic: null,
        biblio: {}
      }
    ] }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const articles = await fetchJournalArticles(CHINESE_JOURNAL, { maxRecords: 5 });
    assert.equal(articles.length, 1);
    assert.equal(articles[0].title, "基于公开数据的电网稳定性分析");
    assert.equal(calls.length, 2);
    assert.match(calls[0], /apps\.wanfangdata\.com\.cn/);
    assert.match(calls[1], /api\.openalex\.org\/works/);
  } finally {
    globalThis.fetch = originalFetch;
    config.publicDataSources = originalSources;
  }
});

test("OpenAlex English records remain available when a Chinese journal has no Chinese titles", async () => {
  const originalFetch = globalThis.fetch;
  const originalSources = config.publicDataSources;
  const calls = [];
  config.publicDataSources = ["openalex"];
  globalThis.fetch = async (url) => {
    const text = String(url);
    calls.push(text);
    if (text.includes("apps.wanfangdata.com.cn")) return new Response("unavailable", { status: 503 });
    return new Response(JSON.stringify({ results: [
      {
        id: "https://openalex.org/W125",
        title: "Survey on Smart Grid Technology",
        publication_year: 2026,
        publication_date: "2026-08-03",
        primary_location: {
          landing_page_url: "https://en.cnki.com.cn/Article_en/CJFDTOTAL-DWJS200908002.htm",
          source: { display_name: "Power System Technology", issn_l: "1000-3673", issn: ["1000-3673"] }
        },
        abstract_inverted_index: {},
        authorships: [],
        keywords: [],
        concepts: [],
        primary_topic: null,
        biblio: {}
      },
      {
        id: "https://openalex.org/W126",
        title: "Zenodo contamination",
        doi: "https://doi.org/10.5281/zenodo.22203989",
        publication_year: 2026,
        publication_date: "2026-08-04",
        primary_location: {
          landing_page_url: "https://doi.org/10.5281/zenodo.22203989",
          source: { display_name: "Power System Technology", issn_l: "1000-3673", issn: ["1000-3673"] }
        },
        abstract_inverted_index: {},
        authorships: [],
        keywords: [],
        concepts: [],
        primary_topic: null,
        biblio: {}
      }
    ] }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const articles = await fetchJournalArticles(CHINESE_JOURNAL, { maxRecords: 5 });
    assert.equal(articles.length, 1);
    assert.equal(articles[0].title, "Survey on Smart Grid Technology");
    assert.equal(articles[0].journal, CHINESE_JOURNAL.name);
    assert.equal(calls.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
    config.publicDataSources = originalSources;
  }
});
