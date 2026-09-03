import assert from "node:assert/strict";
import test from "node:test";
import { createArticlePreparationService } from "./prepare.js";

async function waitForCompletion(service, jobId) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const job = service.get(jobId);
    if (job?.status === "complete") return job;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("preparation job did not complete");
}

test("batch preparation enriches articles and returns complete Chinese translations", async () => {
  const articles = new Map([
    [1, { id: 1, title: "Power system article", abstract: "", keywords: "" }],
    [2, { id: 2, title: "Grid article", abstract: "Existing abstract", keywords: "grid" }]
  ]);
  const translations = new Map();
  const service = createArticlePreparationService({
    getArticle: (id) => articles.get(Number(id)),
    updateArticleDetails: (id, details) => {
      const next = { ...articles.get(Number(id)), ...details };
      articles.set(Number(id), next);
      return next;
    },
    crawlArticleDetails: async () => ({ abstract: "Fetched abstract", keywords: "power" }),
    getTranslation: (id) => translations.get(Number(id)),
    saveTranslation: (id, _language, translation) => {
      const saved = { article_id: Number(id), target_language: "zh", ...translation };
      translations.set(Number(id), saved);
      return saved;
    },
    translateArticle: async (article) => ({
      title: `译题 ${article.id}`,
      abstract: `译文 ${article.abstract}`,
      keywords: `译词 ${article.keywords}`,
      provider: "test"
    })
  }, { concurrency: 2 });

  const started = service.start([1, 2, 2, "invalid"]);
  assert.equal(started.total, 2);
  const completed = await waitForCompletion(service, started.jobId);
  assert.equal(completed.status, "complete");
  assert.equal(completed.completed, 2);
  assert.equal(completed.enriched, 1);
  assert.equal(completed.translated, 2);
  assert.equal(completed.failed, 0);
  assert.equal(completed.results.find((item) => item.id === 1)?.abstract, "Fetched abstract");
  assert.equal(completed.results.find((item) => item.id === 2)?.translated_abstract, "译文 Existing abstract");
});

test("batch preparation preserves usable results when one stage fails", async () => {
  const article = { id: 3, title: "Title only", abstract: "", keywords: "" };
  const service = createArticlePreparationService({
    getArticle: () => article,
    updateArticleDetails: () => article,
    crawlArticleDetails: async () => { throw new Error("publisher blocked"); },
    getTranslation: () => null,
    saveTranslation: (_id, _language, translation) => ({ target_language: "zh", ...translation }),
    translateArticle: async () => ({ title: "中文标题", abstract: "", keywords: "", provider: "test" })
  });

  const completed = await waitForCompletion(service, service.start([3]).jobId);
  assert.equal(completed.completed, 1);
  assert.equal(completed.translated, 1);
  assert.equal(completed.failed, 1);
  assert.equal(completed.results[0].translated_title, "中文标题");
  assert.match(completed.errors[0].message, /publisher blocked/);
});

test("batch preparation reports a partial metadata response by field", async () => {
  const articles = new Map([[4, { id: 4, title: "Partial metadata", abstract: "", keywords: "" }]]);
  const service = createArticlePreparationService({
    getArticle: (id) => articles.get(Number(id)),
    updateArticleDetails: (id, details) => {
      const next = { ...articles.get(Number(id)), ...details };
      articles.set(Number(id), next);
      return next;
    },
    crawlArticleDetails: async () => ({ abstract: "Only the abstract was returned" }),
    ensureTranslation: async () => ({
      translated: true,
      translation: { title: "部分标题", abstract: "部分摘要" }
    })
  });

  const completed = await waitForCompletion(service, service.start([4]).jobId);
  assert.equal(completed.enriched, 1);
  assert.equal(completed.enrichedAbstract, 1);
  assert.equal(completed.enrichedKeywords, 0);
  assert.equal(completed.failedAbstract, 0);
  assert.equal(completed.failedKeywords, 1);
  assert.equal(completed.failed, 1);
  assert.match(completed.errors[0].message, /关键词补全/);
});
