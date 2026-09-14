/**
 * Background maintenance jobs for the administrator dashboard.
 *
 * Two things drove this module. First, "one batch of 50 per click" does not
 * survive contact with a 1400-article import: draining a backlog took dozens of
 * clicks. Second, doing that work inside the HTTP request means the browser has
 * to hold the connection open for many minutes with no visible progress.
 *
 * So a job runs detached from the request, one small batch at a time, and the
 * dashboard polls a state snapshot that carries enough to render a progress bar
 * with a remaining-time estimate. Batching stays exactly where it was — the
 * crawler and the translation provider both have hard per-request limits and
 * this module never bypasses them.
 */
import {
  countArticlesMissingAbstract,
  countArticlesMissingTranslation,
  countArticlesWithoutKeywords,
  createRefreshRun,
  finishRefreshRun,
  getMetadataGaps,
  listArticlesMissingTranslation,
  updateRefreshRunSummary
} from "./db.js";
import { UNLIMITED_ROUNDS, enrichAllMissingMetadata } from "./metadata-backfill.js";
import { enrichMissingAbstracts, enrichMissingKeywords, translateMissingArticles } from "./refresh.js";
import { translationBudgets } from "./translate.js";

/** Hard ceiling for a single unattended run; a second click continues. */
export const MAINTENANCE_MAX_DURATION_MS = 60 * 60 * 1_000;
/** Articles per translation round: small enough that progress and cancellation stay responsive. */
export const TRANSLATE_ROUND_SIZE = 20;
/** Rows sampled to estimate the character cost of the remaining queue. */
const QUOTA_SAMPLE_SIZE = 200;

export const MAINTENANCE_TASKS = {
  abstracts: { label: "补全摘要", kind: "metadata", stages: ["abstracts"], runType: "abstracts" },
  keywords: { label: "补全关键词", kind: "metadata", stages: ["keywords"], runType: "keywords" },
  metadata: { label: "补全摘要和关键词", kind: "metadata", stages: ["abstracts", "keywords"], runType: "metadata" },
  translate_title: { label: "翻译标题", kind: "translate", field: "title", runType: "translate_title" },
  translate_abstract: { label: "翻译摘要", kind: "translate", field: "abstract", runType: "translate_abstract" }
};

const STOP_REASONS = {
  "queue-drained": "已排空",
  "queue-empty": "没有可处理的条目",
  stalled: "连续多轮没有新进展，已停止",
  "no-progress": "本轮没有任何成功处理，已提前停止，避免反复消耗请求",
  budget: "本月翻译额度不足以翻完剩余的条目，已停在额度允许的篇数",
  "time-limit": "达到单次运行时长上限，可以再次点击继续",
  cancelled: "已手动停止",
  "round-limit": "达到轮次上限"
};

let job = null;
let stopRequested = false;

function nowMs() {
  return Date.now();
}

function clampCount(value) {
  const count = Number(value);
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
}

/** Per-field backlog for the requested task, as plain counts. */
function readBacklog(task) {
  if (task.kind === "translate") {
    return { translation: countArticlesMissingTranslation(task.field, "zh") };
  }
  const gaps = getMetadataGaps();
  const backlog = { abstracts: 0, keywords: 0 };
  for (const stage of task.stages) {
    if (stage === "abstracts") backlog.abstracts = clampCount(gaps.abstracts);
    if (stage === "keywords") backlog.keywords = clampCount(gaps.keywords);
  }
  return backlog;
}

function sumCounts(counts) {
  return Object.values(counts || {}).reduce((total, value) => total + clampCount(value), 0);
}

/**
 * Progress, throughput and remaining time from the numbers a job already has.
 * `etaSeconds` is null while there is not enough signal yet (no item finished),
 * which the UI renders as "计算中" rather than a fake number.
 */
export function computeProgress({ total, remaining, processed, elapsedMs }) {
  const safeTotal = clampCount(total);
  const safeRemaining = clampCount(remaining);
  const done = Math.max(0, Math.min(safeTotal, safeTotal - safeRemaining));
  const percent = safeTotal > 0
    ? Math.max(0, Math.min(100, (done / safeTotal) * 100))
    : (safeRemaining === 0 ? 100 : 0);
  const elapsed = Math.max(Number(elapsedMs) || 0, 0);
  const attempted = clampCount(processed);
  const ratePerMinute = elapsed > 0 && attempted > 0 ? (attempted / elapsed) * 60_000 : 0;
  let etaSeconds = 0;
  if (safeRemaining > 0) {
    etaSeconds = ratePerMinute > 0 ? Math.round((safeRemaining / ratePerMinute) * 60) : null;
  }
  return { done, percent, ratePerMinute, etaSeconds };
}

/**
 * Char-based sizing for a translation run. Tencent bills and refuses by
 * character count, so the honest way to answer "can I drain this queue?" is to
 * price the queue and compare it with the remaining monthly allowance — not to
 * ask the administrator to guess a batch size.
 */
export function planTranslationRun({ remainingCount, sampleChars = 0, sampleSize = 0, budget }) {
  const count = clampCount(remainingCount);
  const samples = clampCount(sampleSize);
  const avgCharsPerArticle = samples > 0 ? Math.max(1, Math.round(Number(sampleChars || 0) / samples)) : 0;
  const estimatedChars = avgCharsPerArticle * count;
  const budgetRemaining = clampCount(budget?.remaining);
  const budgetExhausted = Boolean(budget?.exhausted);
  // An untracked provider (no ceiling configured) cannot bound the run, and an
  // unpriceable queue has nothing to bound.
  const unlimited = Boolean(budget?.unlimited) || !avgCharsPerArticle;
  const affordableCount = budgetExhausted
    ? 0
    : (unlimited ? count : Math.floor(budgetRemaining / avgCharsPerArticle));
  return {
    avgCharsPerArticle,
    estimatedChars,
    affordableCount,
    plannedCount: Math.min(count, affordableCount),
    budgetLimited: affordableCount < count,
    budgetExhausted,
    budgetUnlimited: unlimited
  };
}

/**
 * Price the translation queue from a sample of the rows actually waiting, against
 * the whole chain's remaining allowance (tencent + baidu), because a request that
 * tencent cannot pay for is answered by baidu.
 */
function sampleTranslationQueue(task) {
  const budgets = translationBudgets();
  const remainingCount = countArticlesMissingTranslation(task.field, "zh");
  if (!remainingCount) {
    return { remainingCount: 0, sampleChars: 0, sampleSize: 0, budget: budgets.combined, budgets };
  }
  const rows = listArticlesMissingTranslation(task.field, "zh", Math.min(QUOTA_SAMPLE_SIZE, remainingCount));
  const sampleSize = rows.length;
  // Only the requested field is sent to the provider, so only it is priced.
  const sampleChars = rows.reduce((total, row) => total + String(row?.[task.field] || "").trim().length, 0);
  return { remainingCount, sampleChars, sampleSize, budget: budgets.combined, budgets };
}

function newJob(name) {
  const task = MAINTENANCE_TASKS[name];
  const backlog = readBacklog(task);
  const startedAtMs = nowMs();
  return {
    id: `${name}-${startedAtMs}`,
    task: name,
    label: task.label,
    kind: task.kind,
    field: task.field || "",
    stages: task.stages || [],
    runId: createRefreshRun({ taskType: task.runType }),
    status: "running",
    startedAt: new Date(startedAtMs).toISOString(),
    startedAtMs,
    updatedAt: new Date(startedAtMs).toISOString(),
    total: sumCounts(backlog),
    // Seeded from the starting backlog: leaving `remaining` undefined would make
    // the first snapshot report "100% done, 0 left" before any work happened.
    remaining: sumCounts(backlog),
    initialBacklog: backlog,
    remainingBacklog: backlog,
    lastPersistMs: 0,
    processed: 0,
    succeeded: 0,
    failed: 0,
    rounds: 0,
    units: { translatedUnits: 0, requests: 0 },
    plan: null,
    budget: task.kind === "translate" ? translationBudgets().combined : null,
    budgets: task.kind === "translate" ? translationBudgets() : null,
    stopReason: "",
    errors: []
  };
}

function currentRemaining(snapshot) {
  if (snapshot.kind === "translate") {
    return countArticlesMissingTranslation(snapshot.field, "zh");
  }
  const backlog = readBacklog(MAINTENANCE_TASKS[snapshot.task]);
  snapshot.remainingBacklog = backlog;
  return sumCounts(backlog);
}

/** Snapshot handed to the dashboard: raw counters plus derived progress. */
export function getMaintenanceState() {
  if (!job) return null;
  const elapsedMs = (job.finishedAtMs || nowMs()) - job.startedAtMs;
  const progress = computeProgress({
    total: job.total,
    remaining: job.remaining,
    processed: job.processed,
    elapsedMs
  });
  return {
    id: job.id,
    task: job.task,
    label: job.label,
    kind: job.kind,
    status: job.status,
    running: job.status === "running",
    startedAt: job.startedAt,
    updatedAt: job.updatedAt,
    finishedAt: job.finishedAt || null,
    total: job.total,
    processed: job.processed,
    succeeded: job.succeeded,
    failed: job.failed,
    rounds: job.rounds,
    remaining: job.remaining,
    remainingBacklog: { ...job.remainingBacklog },
    units: { ...job.units },
    plan: job.plan ? { ...job.plan } : null,
    budget: job.budget ? { ...job.budget } : null,
    budgets: job.budgets ? { ...job.budgets } : null,
    stopReason: job.stopReason,
    stopReasonLabel: STOP_REASONS[job.stopReason] || "",
    message: job.message || "",
    errors: job.errors.slice(0, 5),
    elapsedMs,
    ...progress
  };
}

export function requestMaintenanceStop() {
  if (!job || job.status !== "running") return { stopped: false, state: getMaintenanceState() };
  stopRequested = true;
  job.message = "已收到停止请求，正在结束当前这一小批…";
  return { stopped: true, state: getMaintenanceState() };
}

/** Fold one round of results into the job record. */
function absorb(job, patch) {
  job.processed += clampCount(patch.processed);
  job.succeeded += clampCount(patch.succeeded);
  job.failed += clampCount(patch.failed);
  job.rounds += 1;
  if (patch.units) {
    job.units.translatedUnits += clampCount(patch.units.translatedUnits);
    job.units.requests += clampCount(patch.units.requests);
  }
  for (const error of Array.isArray(patch.errors) ? patch.errors : []) {
    if (job.errors.length >= 20) break;
    job.errors.push(error);
  }
  job.remaining = clampCount(patch.remaining);
  job.updatedAt = new Date().toISOString();
  if (patch.budget) job.budget = patch.budget;
}

/**
 * The closing line. A metadata job reports each requested field separately —
 * "关键词成功 0 / 失败 2" is the truth when a keyword crawl only managed to bring
 * back abstracts, whereas a single combined "成功 2 · 失败 2" reads like a
 * contradiction.
 */
function finishMessage(job) {
  const parts = [`已处理 ${job.processed}`];
  if (job.kind === "translate") {
    parts.push(`成功 ${job.succeeded}`, `失败 ${job.failed}`);
    if (job.units.requests) parts.push(`API 请求 ${job.units.requests} 次`);
  } else {
    const stages = job.stages || [];
    if (stages.includes("abstracts")) {
      parts.push(`摘要成功 ${job.succeededAbstracts || 0} / 失败 ${job.failedAbstracts || 0}`);
    }
    if (stages.includes("keywords")) {
      parts.push(`关键词成功 ${job.succeededKeywords || 0} / 失败 ${job.failedKeywords || 0}`);
    }
  }
  parts.push(`剩余 ${job.remaining}`);
  const note = STOP_REASONS[job.stopReason] ? ` · ${STOP_REASONS[job.stopReason]}` : "";
  return `${job.label}结束 · ${parts.join(" · ")}${note}`;
}

function progressMessage(job) {
  const state = getMaintenanceState();
  const eta = state.etaSeconds === null || state.etaSeconds === undefined
    ? "剩余时间计算中"
    : `预计还需 ${formatDuration(state.etaSeconds)}`;
  return `${job.label}进行中 · 已处理 ${job.processed} · 已补全/翻译 ${job.succeeded} · 失败 ${job.failed} · 剩余 ${job.remaining} · ${eta}`;
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours > 0) return `${hours} 小时 ${minutes} 分`;
  if (minutes > 0) return `${minutes} 分 ${total % 60} 秒`;
  return `${total} 秒`;
}

/**
 * Persisting on every single article would put a sqlite write between two crawls
 * for no added value — the dashboard polls every two seconds anyway.
 */
function touchProgress(job, { force = false } = {}) {
  const timestamp = nowMs();
  if (!force && timestamp - (job.lastPersistMs || 0) < 1_500) return;
  job.lastPersistMs = timestamp;
  persistProgress(job);
}

/** Persist the in-flight numbers so the task ledger shows the same story. */
function persistProgress(job) {
  const payload = {
    message: progressMessage(job),
    remainingAbstractCount: job.remainingBacklog.abstracts || 0,
    remainingKeywordCount: job.remainingBacklog.keywords || 0
  };
  if (job.kind === "translate") {
    payload.translatedCount = job.succeeded;
    payload.remainingTranslationCount = job.remaining;
    payload.translationUnitCount = job.units.translatedUnits;
    payload.translationRequestCount = job.units.requests;
    if (job.field === "title") payload.translatedTitleCount = job.units.translatedUnits;
    else payload.translatedAbstractCount = job.units.translatedUnits;
  } else {
    const stages = job.stages || [];
    payload.abstractCount = stages.includes("abstracts") ? (job.succeededAbstracts || 0) : 0;
    payload.keywordCount = stages.includes("keywords") ? (job.succeededKeywords || 0) : 0;
    payload.failedAbstractCount = stages.includes("abstracts") ? (job.failedAbstracts || 0) : 0;
    payload.failedKeywordCount = stages.includes("keywords") ? (job.failedKeywords || 0) : 0;
  }
  updateRefreshRunSummary(job.runId, payload);
}

async function runMetadataJob(snapshot, task) {
  // Ticking per article is what makes the bar move during a round: a round is 50
  // crawls, which can take minutes, and a progress bar that jumps every three
  // minutes is not a progress bar.
  const tick = () => {
    snapshot.processed += 1;
    snapshot.updatedAt = new Date().toISOString();
    touchProgress(snapshot);
  };
  const result = await enrichAllMissingMetadata({
    enrichAbstracts: (options) => enrichMissingAbstracts({ ...options, shouldStop: () => stopRequested, onArticle: tick }),
    enrichKeywords: (options) => enrichMissingKeywords({ ...options, shouldStop: () => stopRequested, onArticle: tick }),
    getGaps: getMetadataGaps,
    stages: task.stages,
    maxRounds: UNLIMITED_ROUNDS,
    noProgressLimit: 2,
    maxDurationMs: MAINTENANCE_MAX_DURATION_MS,
    shouldStop: () => stopRequested,
    onProgress: ({ gaps, summary }) => {
      // The backfill summary is cumulative, so the counters are copied rather
      // than added up here. `processed` keeps whichever is larger: the per-article
      // ticks and the per-round totals describe the same work.
      snapshot.processed = Math.max(snapshot.processed, summary.processed);
      snapshot.rounds = summary.rounds;
      snapshot.succeededAbstracts = summary.enrichedAbstracts;
      snapshot.succeededKeywords = summary.enrichedKeywords;
      snapshot.succeeded = summary.enrichedAbstracts + summary.enrichedKeywords;
      snapshot.failed = summary.failedAbstracts + summary.failedKeywords;
      snapshot.failedAbstracts = summary.failedAbstracts;
      snapshot.failedKeywords = summary.failedKeywords;
      snapshot.remainingBacklog = { ...gaps };
      snapshot.remaining = sumCounts({
        abstracts: task.stages.includes("abstracts") ? gaps.abstracts : 0,
        keywords: task.stages.includes("keywords") ? gaps.keywords : 0
      });
      snapshot.updatedAt = new Date().toISOString();
      touchProgress(snapshot, { force: true });
    }
  });
  snapshot.processed = Math.max(snapshot.processed, result.processed);
  snapshot.succeeded = result.enrichedAbstracts + result.enrichedKeywords;
  snapshot.failed = result.failedAbstracts + result.failedKeywords;
  snapshot.succeededAbstracts = result.enrichedAbstracts;
  snapshot.succeededKeywords = result.enrichedKeywords;
  snapshot.failedAbstracts = result.failedAbstracts;
  snapshot.failedKeywords = result.failedKeywords;
  snapshot.rounds = result.rounds;
  snapshot.remainingBacklog = { ...result.remaining };
  snapshot.remaining = sumCounts({
    abstracts: task.stages.includes("abstracts") ? result.remaining.abstracts : 0,
    keywords: task.stages.includes("keywords") ? result.remaining.keywords : 0
  });
  return { stopReason: result.stoppedReason, complete: result.complete };
}

async function runTranslationJob(snapshot, task) {
  const sample = sampleTranslationQueue(task);
  snapshot.plan = planTranslationRun(sample);
  snapshot.budget = sample.budget;
  snapshot.budgets = sample.budgets;
  snapshot.total = sample.remainingCount;
  snapshot.remaining = sample.remainingCount;
  snapshot.remainingBacklog = { translation: sample.remainingCount };
  persistProgress(snapshot);

  if (!sample.remainingCount) return { stopReason: "queue-drained", complete: true };
  if (snapshot.plan.budgetExhausted) return { stopReason: "budget", complete: false };

  const plannedCount = snapshot.plan.plannedCount;
  for (let round = 0; round < UNLIMITED_ROUNDS; round += 1) {
    if (stopRequested) return { stopReason: "cancelled", complete: false };
    if (nowMs() - snapshot.startedAtMs >= MAINTENANCE_MAX_DURATION_MS) {
      return { stopReason: "time-limit", complete: false };
    }
    if (plannedCount > 0 && snapshot.succeeded >= plannedCount) {
      return { stopReason: "budget", complete: false };
    }
    // One small round at a time: the provider chunker inside splits this into
    // requests capped at 10 texts / 1800 characters, so the API limits are
    // never approached no matter how large the queue is.
    const batch = await translateMissingArticles(task.field, "zh", TRANSLATE_ROUND_SIZE, { maxBatches: 1 });
    absorb(snapshot, {
      processed: batch.processed,
      succeeded: batch.translated,
      failed: batch.failed,
      units: { translatedUnits: batch.translatedUnits, requests: batch.requests },
      errors: (batch.errors || []).slice(0, 2),
      remaining: countArticlesMissingTranslation(task.field, "zh"),
      budget: translationBudgets().combined
    });
    snapshot.budgets = translationBudgets();
    snapshot.remainingBacklog = { translation: snapshot.remaining };
    persistProgress(snapshot);

    if (!batch.processed) return { stopReason: "queue-drained", complete: true };
    if (!batch.translated) return { stopReason: "no-progress", complete: false };
    if (snapshot.remaining === 0) return { stopReason: "queue-drained", complete: true };
  }
  return { stopReason: "round-limit", complete: false };
}

async function runJob(snapshot) {
  const task = MAINTENANCE_TASKS[snapshot.task];
  try {
    const outcome = task.kind === "translate"
      ? await runTranslationJob(snapshot, task)
      : await runMetadataJob(snapshot, task);
    snapshot.stopReason = outcome.stopReason || (outcome.complete ? "queue-drained" : "");
    snapshot.status = snapshot.failed && !snapshot.succeeded
      ? "error"
      : (outcome.complete ? "success" : (snapshot.succeeded ? "partial" : "error"));
    if (snapshot.status === "partial" && snapshot.stopReason === "no-progress" && !snapshot.succeeded) {
      snapshot.status = "error";
    }
  } catch (error) {
    snapshot.status = "error";
    snapshot.errored = true;
    snapshot.stopReason = snapshot.stopReason || "error";
    snapshot.errors.push({ message: error.message });
    snapshot.message = `${snapshot.label}失败：${error.message}`;
  } finally {
    snapshot.finishedAtMs = nowMs();
    snapshot.finishedAt = new Date(snapshot.finishedAtMs).toISOString();
    snapshot.updatedAt = snapshot.finishedAt;
    // A thrown error already wrote its own message; everything else gets the
    // structured summary.
    if (!snapshot.errored) snapshot.message = finishMessage(snapshot);
    const status = snapshot.status;
    const finalMessage = snapshot.message;
    const stages = snapshot.stages || [];
    const tracksAbstracts = stages.includes("abstracts");
    const tracksKeywords = stages.includes("keywords");
    finishRefreshRun(snapshot.runId, {
      status,
      message: finalMessage,
      abstractCount: tracksAbstracts ? (snapshot.succeededAbstracts || 0) : 0,
      keywordCount: tracksKeywords ? (snapshot.succeededKeywords || 0) : 0,
      translatedCount: snapshot.kind === "translate" ? snapshot.succeeded : 0,
      failedAbstractCount: tracksAbstracts ? (snapshot.failedAbstracts || 0) : 0,
      failedKeywordCount: tracksKeywords ? (snapshot.failedKeywords || 0) : 0,
      failedTranslationCount: snapshot.kind === "translate" ? snapshot.failed : 0,
      translatedTitleCount: snapshot.field === "title" ? snapshot.units.translatedUnits : 0,
      translatedAbstractCount: snapshot.field === "abstract" ? snapshot.units.translatedUnits : 0,
      translationUnitCount: snapshot.units.translatedUnits,
      translationRequestCount: snapshot.units.requests,
      remainingAbstractCount: snapshot.remainingBacklog.abstracts || 0,
      remainingKeywordCount: snapshot.remainingBacklog.keywords || 0,
      remainingTranslationCount: snapshot.kind === "translate" ? snapshot.remaining : 0
    });
  }
}

/**
 * Start one maintenance job. A second click while a job is running is answered
 * with the running job's state instead of launching a competing crawl — two
 * overlapping keyword crawls fetch the same records twice.
 */
export function startMaintenance(name) {
  const task = MAINTENANCE_TASKS[name];
  if (!task) return { started: false, reason: "unknown-task", state: getMaintenanceState() };
  if (job && job.status === "running") {
    return { started: false, reason: "busy", state: getMaintenanceState() };
  }
  stopRequested = false;
  job = newJob(name);
  const snapshot = job;
  snapshot.message = `${snapshot.label}已开始，正在处理…`;
  persistProgress(snapshot);
  // Detached on purpose: the request returns immediately and the dashboard
  // polls `getMaintenanceState()`. Errors are captured inside runJob.
  void runJob(snapshot).catch((error) => {
    snapshot.status = "error";
    snapshot.message = `${snapshot.label}失败：${error.message}`;
  });
  return { started: true, state: getMaintenanceState() };
}

export const internals = {
  readBacklog,
  sumCounts,
  sampleTranslationQueue,
  formatDuration,
  STOP_REASONS
};
