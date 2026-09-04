const DEFAULT_MAX_ROUNDS = 20;
const DEFAULT_NO_PROGRESS_LIMIT = 2;

function toCount(value) {
  const count = Number(value);
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
}

function emptySummary() {
  return {
    processed: 0,
    enrichedAbstracts: 0,
    enrichedKeywords: 0,
    failedAbstracts: 0,
    failedKeywords: 0,
    errors: [],
    rounds: 0,
    remaining: { abstracts: 0, keywords: 0 }
  };
}

function mergeResult(summary, result, stage) {
  const source = result || {};
  summary.processed += toCount(source.processed);
  summary.enrichedAbstracts += toCount(source.enrichedAbstracts)
    || (stage === "abstracts" ? toCount(source.enriched) : 0);
  summary.enrichedKeywords += toCount(source.enrichedKeywords)
    || (stage === "keywords" ? toCount(source.enriched) : 0);
  summary.failedAbstracts += toCount(source.failedAbstracts)
    || (stage === "abstracts" ? toCount(source.failed) : 0);
  summary.failedKeywords += toCount(source.failedKeywords)
    || (stage === "keywords" ? toCount(source.failed) : 0);

  for (const error of Array.isArray(source.errors) ? source.errors : []) {
    if (summary.errors.length >= 200) break;
    summary.errors.push({ stage, ...error });
  }
}

/**
 * Run the same metadata-repair path used by the administrator UI and future
 * scheduled jobs.  Each provider/crawler batch remains small, while this
 * coordinator keeps requesting the next missing records until the backlog is
 * empty or the source makes no progress for a bounded number of rounds.
 */
export async function enrichAllMissingMetadata({
  enrichAbstracts,
  enrichKeywords,
  getGaps,
  maxRounds = DEFAULT_MAX_ROUNDS,
  noProgressLimit = DEFAULT_NO_PROGRESS_LIMIT,
  onProgress
} = {}) {
  if (typeof enrichAbstracts !== "function" || typeof enrichKeywords !== "function" || typeof getGaps !== "function") {
    throw new Error("摘要和关键词补全服务未配置完整");
  }

  const summary = emptySummary();
  const roundLimit = Math.max(1, toCount(maxRounds) || DEFAULT_MAX_ROUNDS);
  const stalledLimit = Math.max(1, toCount(noProgressLimit) || DEFAULT_NO_PROGRESS_LIMIT);
  let gaps = { ...getGaps() };

  async function runStage(stage, fn, gapKey) {
    let stalled = 0;
    for (let round = 1; round <= roundLimit && toCount(gaps[gapKey]) > 0; round += 1) {
      const before = toCount(gaps[gapKey]);
      const result = await fn();
      summary.rounds += 1;
      mergeResult(summary, result, stage);
      gaps = { ...getGaps() };
      const after = toCount(gaps[gapKey]);
      if (after >= before) stalled += 1;
      else stalled = 0;
      if (typeof onProgress === "function") {
        await onProgress({ stage, round, result, gaps: { ...gaps }, summary: { ...summary } });
      }
      if (stalled >= stalledLimit) break;
    }
  }

  await runStage("abstracts", enrichAbstracts, "abstracts");
  const abstractGapBeforeKeywordStage = toCount(gaps.abstracts);
  await runStage("keywords", enrichKeywords, "keywords");

  // A keyword crawl can return an abstract as a side effect.  Give the
  // abstract stage one bounded follow-up pass so those records use the same
  // path without risking an endless retry loop.
  if (toCount(gaps.abstracts) > 0 && toCount(gaps.abstracts) < abstractGapBeforeKeywordStage) {
    await runStage("abstracts", enrichAbstracts, "abstracts");
  }

  summary.remaining = { ...getGaps() };
  return {
    ...summary,
    failed: summary.failedAbstracts + summary.failedKeywords,
    complete: toCount(summary.remaining.abstracts) === 0 && toCount(summary.remaining.keywords) === 0
  };
}

export const internals = { mergeResult, emptySummary };
