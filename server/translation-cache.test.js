import assert from "node:assert/strict";
import test from "node:test";
import { createTranslationCacheService, getMissingTranslationFields, isTranslationComplete } from "./translation-cache.js";

test("translation cache requests only missing fields and reuses the saved row", async () => {
  const article = { id: 1, title: "English title", abstract: "English abstract", keywords: "power; grid" };
  let row = { article_id: 1, target_language: "zh", title: "已有标题", abstract: "", keywords: "", provider: "old" };
  const requests = [];
  const service = createTranslationCacheService({
    getArticle: () => article,
    getTranslation: () => row,
    saveTranslation: (_id, _language, value) => {
      row = { ...row, ...value };
      return row;
    },
    translateArticle: async (source) => {
      requests.push(source);
      return { title: "", abstract: "新摘要", keywords: "新关键词", provider: "test" };
    }
  });

  const first = await service.ensureTranslation(article, "zh");
  assert.equal(first.translated, true);
  assert.deepEqual(requests[0], { ...article, title: "", abstract: article.abstract, keywords: article.keywords });
  assert.equal(row.title, "已有标题");
  assert.equal(row.abstract, "新摘要");
  assert.equal(row.keywords, "新关键词");

  const second = await service.ensureTranslation(article, "zh");
  assert.equal(second.translated, false);
  assert.equal(requests.length, 1);
  assert.equal(isTranslationComplete(article, second.translation), true);
  assert.deepEqual(getMissingTranslationFields(article, second.translation), []);
});
test("concurrent requests for one article share one translation call", async () => {
  const article = { id: 2, title: "Concurrent title", abstract: "Concurrent abstract", keywords: "" };
  let row = null;
  let calls = 0;
  const service = createTranslationCacheService({
    getArticle: () => article,
    getTranslation: () => row,
    saveTranslation: (_id, _language, value) => {
      row = { article_id: 2, target_language: "zh", ...value };
      return row;
    },
    translateArticle: async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return { title: "并发标题", abstract: "并发摘要", keywords: "", provider: "test" };
    }
  });

  const [left, right] = await Promise.all([
    service.ensureTranslation(article, "zh"),
    service.ensureTranslation(article, "zh")
  ]);
  assert.equal(calls, 1);
  assert.equal(left.translation.title, "并发标题");
  assert.equal(right.translation.abstract, "并发摘要");
});
