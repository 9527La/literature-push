import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_JOURNALS } from "./config.js";
import { crawlArticleDetails } from "./crawler.js";
import { fetchWanfangArticleDetails, internals, parseWanfangDetailResponse, parseWanfangRss } from "./wanfang.js";

const JOURNAL = { name: "电力系统自动化", wanfangId: "dlxtzdh" };

function varint(value) {
  const bytes = [];
  let number = Number(value) || 0;
  while (number > 127) { bytes.push((number & 127) | 128); number >>>= 7; }
  bytes.push(number);
  return Uint8Array.from(bytes);
}

function concat(...arrays) {
  const output = new Uint8Array(arrays.reduce((sum, array) => sum + array.length, 0));
  let offset = 0;
  for (const array of arrays) { output.set(array, offset); offset += array.length; }
  return output;
}

function field(fieldNumber, value) {
  const bytes = new TextEncoder().encode(value);
  return concat(varint(fieldNumber * 8 + 2), varint(bytes.length), bytes);
}

function messageField(fieldNumber, payload) {
  return concat(varint(fieldNumber * 8 + 2), varint(payload.length), payload);
}

function grpcFrame(payload) {
  return concat(Uint8Array.from([0, (payload.length >>> 24) & 255, (payload.length >>> 16) & 255, (payload.length >>> 8) & 255, payload.length & 255]), payload);
}

function detailFixture() {
  const periodical = concat(
    field(1, "dwjs202608031"),
    field(2, "中文标题"),
    field(3, "张三"),
    field(3, "李四"),
    field(16, "关键词一"),
    field(16, "关键词二"),
    field(20, "中文摘要"),
    field(22, "dwjs"),
    field(28, "2026-08-03 00:00:00")
  );
  const resource = messageField(103, periodical);
  return grpcFrame(messageField(1, resource));
}

function detailFixtureWithDoiOnly() {
  const periodical = concat(
    field(1, "dwjs202608031"),
    field(2, "中文标题"),
    field(22, "dwjs"),
    field(41, "10.1234/example")
  );
  const resource = messageField(103, periodical);
  return grpcFrame(messageField(1, resource));
}

function detailFixtureWithoutMetadata() {
  const periodical = concat(
    field(1, "dlxtzdh202608031"),
    field(2, "中文标题"),
    field(22, "dlxtzdh")
  );
  const resource = messageField(103, periodical);
  return grpcFrame(messageField(1, resource));
}

test("parses Wanfang RSS CDATA, entities, article id, issue and date", () => {
  const xml = `<?xml version="1.0"?><rss><channel>
    <item>
      <title><![CDATA[跟网-构网混联系统 &amp; 参数优化]]></title>
      <description><![CDATA[摘要内容：含有 &lt;关键&gt; 信息。]]></description>
      <link>https://d.wanfangdata.cn/periodical/dlxtzdh202615017</link>
      <guid isPermaLink="true">https://d.wanfangdata.cn/periodical/dlxtzdh202615017</guid>
      <pubDate>Sun, 09 Aug 2026 16:00:00 GMT</pubDate>
    </item>
    <item><title><![CDATA[特约主编寄语]]></title><link>https://d.wanfangdata.cn/periodical/dlxtzdh202615001</link></item>
  </channel></rss>`;

  const [article] = parseWanfangRss(xml, JOURNAL);
  assert.equal(article.external_id, "wanfang:dlxtzdh202615017");
  assert.equal(article.title, "跟网-构网混联系统 & 参数优化");
  assert.equal(article.abstract, "摘要内容：含有 <关键> 信息。");
  assert.equal(article.journal, JOURNAL.name);
  assert.equal(article.year, 2026);
  assert.equal(article.issue, "15");
  assert.equal(article.published_at, "2026-08-10");
  assert.equal(article.url, "https://d.wanfangdata.com.cn/periodical/dlxtzdh202615017");
  assert.equal(parseWanfangRss(xml, JOURNAL, { maxRecords: 1 }).length, 1);
});

test("normalizes Wanfang links and fallback dates", () => {
  assert.equal(internals.normalizeArticleId("https://d.wanfangdata.cn/periodical/dlxtzdh202615017"), "dlxtzdh202615017");
  assert.equal(internals.normalizeArticleId("https://d.wanfangdata.cn/periodical/dlxtzdh202615017?foo=1"), "dlxtzdh202615017");
  assert.equal(internals.normalizePublishedAt("2026/8/9"), "2026-08-09");
  assert.deepEqual(internals.parseIssue("dlxtzdh202615017"), { year: 2026, issue: "15" });
});

test("decodes Wanfang gRPC-web detail metadata", () => {
  const detail = parseWanfangDetailResponse(detailFixture());
  assert.equal(detail.title, "中文标题");
  assert.equal(detail.authors, "张三, 李四");
  assert.equal(detail.abstract, "中文摘要");
  assert.equal(detail.keywords, "关键词一; 关键词二");
  assert.equal(detail.published_at, "2026-08-03");
  assert.equal(detail.periodical_id, "dwjs");
});

test("fetches Wanfang detail metadata and maps it to an article", async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = "";
  globalThis.fetch = async (url) => {
    requestedUrl = String(url);
    return new Response(detailFixture(), { status: 200, headers: { "content-type": "application/grpc-web+proto" } });
  };
  try {
    const details = await fetchWanfangArticleDetails({
      external_id: "wanfang:dwjs202608031",
      url: "https://d.wanfangdata.com.cn/periodical/dwjs202608031"
    });
    assert.match(requestedUrl, /Detail\.DetailService\/getDetailInFormation/);
    assert.equal(details.title, "中文标题");
    assert.equal(details.keywords, "关键词一; 关键词二");
    assert.equal(details.url, "https://d.wanfangdata.com.cn/periodical/dwjs202608031");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("crawler uses Wanfang detail metadata before generic HTML fallbacks", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return new Response(detailFixture(), { status: 200, headers: { "content-type": "application/grpc-web+proto" } });
  };
  try {
    const details = await crawlArticleDetails({
      external_id: "wanfang:dwjs202608031",
      title: "中文标题",
      abstract: "已有中文摘要",
      keywords: "",
      url: "https://d.wanfangdata.com.cn/periodical/dwjs202608031"
    }, { fields: ["keywords"] });
    assert.equal(details.authors, "张三, 李四");
    assert.equal(details.keywords, "关键词一; 关键词二");
    assert.equal(calls.length, 1);
    assert.match(calls[0], /Detail\.DetailService\/getDetailInFormation/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("crawler uses a DOI discovered by Wanfang to reach OpenAlex fallback", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (calls.length === 1) {
      return new Response(detailFixtureWithDoiOnly(), { status: 200, headers: { "content-type": "application/grpc-web+proto" } });
    }
    return {
      ok: true,
      json: async () => ({
        title: "中文标题",
        doi: "10.1234/example",
        abstract_inverted_index: { "OpenAlex": [0], "摘要": [1] },
        keywords: [{ display_name: "电网稳定性" }],
        authorships: [],
        biblio: {},
        primary_location: { source: { display_name: "Power System Technology" } }
      })
    };
  };
  try {
    const details = await crawlArticleDetails({
      external_id: "wanfang:dwjs202608031",
      title: "中文标题",
      abstract: "",
      keywords: "",
      url: "https://d.wanfangdata.com.cn/periodical/dwjs202608031"
    });
    assert.equal(details.doi, "10.1234/example");
    assert.equal(details.abstract, "OpenAlex 摘要");
    assert.equal(details.keywords, "电网稳定性");
    assert.equal(calls.length, 2);
    assert.match(calls[1], /api\.openalex\.org\/works/);
    assert.match(calls[1], /10\.1234%2Fexample/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("crawler uses an exact Chinese title and ISSN OpenAlex fallback when Wanfang has no DOI", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    const value = String(url);
    calls.push(value);
    if (value.includes("Detail.DetailService")) {
      return new Response(detailFixtureWithoutMetadata(), { status: 200, headers: { "content-type": "application/grpc-web+proto" } });
    }
    return {
      ok: true,
      json: async () => ({
        results: [
          {
            title: "Unrelated English record",
            primary_location: { source: { issn_l: "1000-1026", issn: ["1000-1026"] } }
          },
          {
            title: "中文标题",
            doi: "https://doi.org/10.1234/chinese",
            primary_location: {
              landing_page_url: "https://example.invalid/chinese",
              source: { display_name: "Automation of Electric Power Systems", issn_l: "1000-1026", issn: ["1000-1026"] }
            },
            abstract_inverted_index: { "OpenAlex": [0], "摘要": [1] },
            keywords: [{ display_name: "稳定性分析" }],
            authorships: [],
            biblio: {},
            publication_year: 2026,
            publication_date: "2026-08-03"
          }
        ]
      })
    };
  };
  try {
    const details = await crawlArticleDetails({
      external_id: "wanfang:dlxtzdh202608031",
      title: "中文标题",
      abstract: "",
      keywords: "",
      journal: "电力系统自动化",
      url: "https://d.wanfangdata.cn/periodical/dlxtzdh202608031"
    });
    assert.equal(details.abstract, "OpenAlex 摘要");
    assert.equal(details.keywords, "稳定性分析");
    assert.equal(details.doi, "10.1234/chinese");
    assert.equal(details.journal, "电力系统自动化");
    assert.equal(calls.length, 2);
    assert.match(calls[1], /api\.openalex\.org\/works/);
    assert.match(calls[1], /search=/);
    assert.match(calls[1], /primary_location\.source\.issn%3A1000-1026/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("all configured Chinese journals have a Wanfang source id", () => {
  const names = ["电力系统自动化", "中国电机工程学报", "电网技术", "电工技术学报", "高电压技术"];
  for (const name of names) {
    const journal = DEFAULT_JOURNALS.find((item) => item.name === name);
    assert.ok(journal?.wanfangId, `${name} should have a Wanfang id`);
  }
});
