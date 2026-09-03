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
