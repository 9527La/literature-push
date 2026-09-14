const DEFAULT_MAX_ROUNDS = 20;
const DEFAULT_NO_PROGRESS_LIMIT = 2;

// "One click, then walk away" runs have no round budget of their own: the loop
// stops when the backlog is empty or when a round stops producing, which is
// what actually proves there is nothing left to fetch. The round ceiling below
// only exists so a pathological source cannot spin forever.
export const UNLIMITED_ROUNDS = 1_000_000;
export const DEFAULT_MAX_DURATION_MS = 90 * 60 * 1_000;

const STAGE_KEYS = ["abstracts", "keywords"];

function toCount(value) {
  const count = Number(value);
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
}

function normalizeStages(stages) {
  const requested = Array.isArray(stages) && stages.length ? stages : STAGE_KEYS;
  const selected = STAGE_KEYS.filter((stage) => requested.includes(stage));
  return selected.length ? selected : [...STAGE_KEYS];
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
 * Run the metadata-repair path used by the administrator UI and scheduled jobs.
 * Each crawler/provider batch stays small; this coordinator keeps asking for the
 * next missing records until the backlog is empty, the source stops making
 * progress, the caller asks it to stop, or the wall-clock budget runs out.
 *
 * `stages` narrows the work to one field ("abstracts" / "keywords") so a single
 * click can drain just that column; both are run by default.
 */
export async function enrichAllMissingMetadata({
  enrichAbstracts,
  enrichKeywords,
  getGaps,
  stages,
  maxRounds = DEFAULT_MAX_ROUNDS,
  noProgressLimit = DEFAULT_NO_PROGRESS_LIMIT,
  maxDurationMs = DEFAULT_MAX_DURATION_MS,
  shouldStop = null,
  onProgress
} = {}) {
  if (typeof enrichAbstracts !== "function" || typeof enrichKeywords !== "function" || typeof getGaps !== "function") {
    throw new Error("摘要和关键词补全服务未配置完整");
  }

  const selectedStages = normalizeStages(stages);
  const summary = emptySummary();
  const roundLimit = Math.max(1, toCount(maxRounds) || DEFAULT_MAX_ROUNDS);
  const stalledLimit = Math.max(1, toCount(noProgressLimit) || DEFAULT_NO_PROGRESS_LIMIT);
  const durationLimit = Number(maxDurationMs) > 0 ? Number(maxDurationMs) : 0;
  const startedAt = Date.now();
  let stoppedReason = "";
  let gaps = { ...getGaps() };

  // Cancellation and the time ceiling are checked between batches, never in the
  // middle of one: a partly written batch would leave the run table confused.
  function haltReason() {
    if (typeof shouldStop === "function" && shouldStop()) return "cancelled";
    if (durationLimit && Date.now() - startedAt >= durationLimit) return "time-limit";
    return "";
  }

  async function runStage(stage, fn, gapKey) {
    let stalled = 0;
    const attempted = new Set();
    for (let round = 1; round <= roundLimit; round += 1) {
      if (toCount(gaps[gapKey]) <= 0) return;
      const stop = haltReason();
      if (stop) {
        stoppedReason = stoppedReason || stop;
        return;
      }
      const before = toCount(gaps[gapKey]);
      const result = await fn({ excludeIds: [...attempted] });
      const newIds = (result?.attemptedIds || []).filter((id) => !attempted.has(id));
      for (const id of newIds) attempted.add(id);
      summary.rounds += 1;
      mergeResult(summary, result, stage);
      gaps = { ...getGaps() };
      const after = toCount(gaps[gapKey]);
      if (after >= before && !newIds.length) stalled += 1;
      else stalled = 0;
      if (typeof onProgress === "function") {
        await onProgress({ stage, round, result, gaps: { ...gaps }, summary: { ...summary } });
      }
      if (result?.processed === 0) {
        stoppedReason = stoppedReason || "queue-empty";
        return;
      }
      if (stalled >= stalledLimit) {
        stoppedReason = stoppedReason || "stalled";
        return;
      }
    }
    stoppedReason = stoppedReason || "round-limit";
  }

  if (selectedStages.includes("abstracts")) {
    await runStage("abstracts", enrichAbstracts, "abstracts");
  }
  const abstractGapBeforeKeywordStage = toCount(gaps.abstracts);
  if (selectedStages.includes("keywords") && !stoppedReason) {
    await runStage("keywords", enrichKeywords, "keywords");
  }

  // A keyword crawl can return an abstract as a side effect.  Give the abstract
  // stage one bounded follow-up pass so those records use the same path without
  // risking an endless retry loop.
  if (
    selectedStages.includes("abstracts")
    && selectedStages.includes("keywords")
    && !stoppedReason
    && toCount(gaps.abstracts) > 0
    && toCount(gaps.abstracts) < abstractGapBeforeKeywordStage
  ) {
    await runStage("abstracts", enrichAbstracts, "abstracts");
  }

  summary.remaining = { ...getGaps() };
  const remainingKeys = selectedStages;
  return {
    ...summary,
    stages: selectedStages,
    stoppedReason,
    failed: summary.failedAbstracts + summary.failedKeywords,
    durationMs: Date.now() - startedAt,
    complete: remainingKeys.every((key) => toCount(summary.remaining[key]) === 0)
  };
}

export const internals = { mergeResult, emptySummary, normalizeStages };
