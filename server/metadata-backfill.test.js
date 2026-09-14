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

test("a single stage can be drained on its own", async () => {
  const gaps = { abstracts: 2, keywords: 4 };
  const calls = [];
  const result = await enrichAllMissingMetadata({
    stages: ["keywords"],
    getGaps: () => ({ ...gaps }),
    enrichAbstracts: async () => {
      calls.push("abstracts");
      return { processed: 1, enriched: 1, enrichedAbstracts: 1, errors: [] };
    },
    enrichKeywords: async () => {
      calls.push("keywords");
      gaps.keywords -= 1;
      return { processed: 1, enriched: 1, enrichedKeywords: 1, errors: [] };
    },
    maxRounds: 10
  });

  // The abstract stage is not requested at all, so its gap stays untouched and
  // does not keep the run alive.
  assert.deepEqual(calls, ["keywords", "keywords", "keywords", "keywords"]);
  assert.equal(result.enrichedKeywords, 4);
  assert.equal(result.enrichedAbstracts, 0);
  assert.deepEqual(result.stages, ["keywords"]);
  assert.equal(result.complete, true);
  assert.deepEqual(result.remaining, { abstracts: 2, keywords: 0 });
});

test("a stop request ends the run between batches and is reported", async () => {
  let calls = 0;
  let stop = false;
  const result = await enrichAllMissingMetadata({
    getGaps: () => ({ abstracts: 100, keywords: 0 }),
    enrichAbstracts: async () => {
      calls += 1;
      if (calls === 2) stop = true;
      return { processed: 1, enriched: 1, enrichedAbstracts: 1, attemptedIds: [calls], errors: [] };
    },
    enrichKeywords: async () => ({ processed: 0, enriched: 0, errors: [] }),
    maxRounds: 50,
    shouldStop: () => stop
  });

  assert.equal(calls, 2);
  assert.equal(result.stoppedReason, "cancelled");
  assert.equal(result.complete, false);
});

test("the wall-clock ceiling stops a run that would otherwise keep going", async () => {
  const result = await enrichAllMissingMetadata({
    getGaps: () => ({ abstracts: 500, keywords: 0 }),
    enrichAbstracts: async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { processed: 1, enriched: 1, enrichedAbstracts: 1, attemptedIds: [Math.random()], errors: [] };
    },
    enrichKeywords: async () => ({ processed: 0, enriched: 0, errors: [] }),
    maxRounds: 1000,
    maxDurationMs: 12
  });

  assert.equal(result.stoppedReason, "time-limit");
  assert.ok(result.rounds >= 1 && result.rounds < 500, `stopped after ${result.rounds} rounds`);
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
