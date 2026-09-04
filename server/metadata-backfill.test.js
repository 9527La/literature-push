import test from "node:test";
import assert from "node:assert/strict";
import { enrichAllMissingMetadata } from "./metadata-backfill.js";

test("metadata backfill reuses the field pipelines until both gaps are empty", async () => {
  const gaps = { abstracts: 3, keywords: 2 };
  const calls = [];
  const result = await enrichAllMissingMetadata({
    getGaps: () => ({ ...gaps }),
    enrichAbstracts: async () => {
      calls.push("abstracts");
      gaps.abstracts -= 1;
      return { processed: 1, enriched: 1, failed: 0, enrichedAbstracts: 1, failedAbstracts: 0, errors: [] };
    },
    enrichKeywords: async () => {
      calls.push("keywords");
      gaps.keywords -= 1;
      return { processed: 1, enriched: 1, failed: 0, enrichedKeywords: 1, failedKeywords: 0, errors: [] };
    },
    maxRounds: 5,
    noProgressLimit: 2
  });

  assert.equal(result.complete, true);
  assert.deepEqual(result.remaining, { abstracts: 0, keywords: 0 });
  assert.equal(result.enrichedAbstracts, 3);
  assert.equal(result.enrichedKeywords, 2);
  assert.deepEqual(calls, ["abstracts", "abstracts", "abstracts", "keywords", "keywords"]);
});

test("metadata backfill stops a permanently failing source after bounded retries", async () => {
  let abstractCalls = 0;
  const result = await enrichAllMissingMetadata({
    getGaps: () => ({ abstracts: 1, keywords: 0 }),
    enrichAbstracts: async () => {
      abstractCalls += 1;
      return {
        processed: 1,
        enriched: 0,
        failed: 1,
        enrichedAbstracts: 0,
        failedAbstracts: 1,
        errors: [{ id: 99, message: "公开来源无摘要" }]
      };
    },
    enrichKeywords: async () => ({ processed: 0, enriched: 0, failed: 0, errors: [] }),
    maxRounds: 10,
    noProgressLimit: 2
  });

  assert.equal(abstractCalls, 2);
  assert.equal(result.complete, false);
  assert.equal(result.failedAbstracts, 2);
  assert.equal(result.errors.length, 2);
  assert.deepEqual(result.remaining, { abstracts: 1, keywords: 0 });
});
