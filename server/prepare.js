import { randomUUID } from "node:crypto";
import { createTranslationCacheService } from "./translation-cache.js";

const DEFAULT_JOB_TTL_MS = 10 * 60 * 1000;

function hasText(value) {
  return String(value || "").trim().length > 0;
}

function normalizeIds(ids, maxItems) {
  return [...new Set((Array.isArray(ids) ? ids : [])
    .map((id) => Number(id))
    .filter((id) => Number.isInteger(id) && id > 0))]
    .slice(0, maxItems);
}

function publicJob(job) {
  return {
    jobId: job.id,
    status: job.status,
    total: job.total,
    completed: job.completed,
    enriched: job.enriched,
    enrichedAbstract: job.enrichedAbstract,
    enrichedKeywords: job.enrichedKeywords,
    translated: job.translated,
    failed: job.failed,
    failedAbstract: job.failedAbstract,
    failedKeywords: job.failedKeywords,
    results: [...job.results],
    errors: [...job.errors]
  };
}

export function createArticlePreparationService(dependencies, options = {}) {
  const {
    getArticle,
    updateArticleDetails,
    crawlArticleDetails,
    getTranslation,
    saveTranslation,
    translateArticle
  } = dependencies;
  const ensureTranslation = dependencies.ensureTranslation || createTranslationCacheService({
    getArticle,
    getTranslation,
    saveTranslation,
    translateArticle
  }).ensureTranslation;
  const concurrency = Math.max(1, Math.min(4, Number(options.concurrency || 2)));
  const maxItems = Math.max(1, Math.min(100, Number(options.maxItems || 50)));
  const maxJobs = Math.max(5, Math.min(200, Number(options.maxJobs || 50)));
  const jobTtlMs = Number(options.jobTtlMs || DEFAULT_JOB_TTL_MS);
  const jobs = new Map();
  const inFlightArticles = new Map();

  function cleanupJobs() {
    const cutoff = Date.now() - jobTtlMs;
    for (const [id, job] of jobs) {
      if (job.updatedAt < cutoff && job.status !== "running") jobs.delete(id);
    }
  }

  async function prepareArticle(id) {
    let article = getArticle(id);
    if (!article) throw new Error("文献不存在");

    const needsAbstract = !hasText(article.abstract);
    const needsKeywords = !hasText(article.keywords);
    let enriched = false;
    let enrichedAbstract = 0;
    let enrichedKeywords = 0;
    let failedAbstract = 0;
    let failedKeywords = 0;
    let translated = false;
    let translation = null;
    const stageErrors = [];

    if (needsAbstract || needsKeywords) {
      try {
        article = updateArticleDetails(id, await crawlArticleDetails(article));
      } catch (error) {
        if (needsAbstract) stageErrors.push(`摘要补全：${error.message}`);
        if (needsKeywords) stageErrors.push(`关键词补全：${error.message}`);
      }
      // A crawler can legitimately return only one field.  Check each
      // requested field independently so a successful abstract does not hide
      // a missing keyword (or vice versa).
      const abstractResolved = !needsAbstract || hasText(article.abstract);
      const keywordsResolved = !needsKeywords || hasText(article.keywords);
      enrichedAbstract = needsAbstract && abstractResolved ? 1 : 0;
      enrichedKeywords = needsKeywords && keywordsResolved ? 1 : 0;
      failedAbstract = needsAbstract && !abstractResolved ? 1 : 0;
      failedKeywords = needsKeywords && !keywordsResolved ? 1 : 0;
      enriched = Boolean(enrichedAbstract || enrichedKeywords);
      if (needsAbstract && !abstractResolved && !stageErrors.some((error) => error.startsWith("摘要补全："))) {
        stageErrors.push("摘要补全：公开来源未返回摘要");
      }
      if (needsKeywords && !keywordsResolved && !stageErrors.some((error) => error.startsWith("关键词补全："))) {
        stageErrors.push("关键词补全：公开来源未返回关键词");
      }
    }

    try {
      const translationResult = await ensureTranslation(article, "zh");
      translation = translationResult.translation;
      translated = Boolean(translationResult.translated);
    } catch (error) {
      stageErrors.push(`中文翻译：${error.message}`);
    }

    return {
      article: {
        ...article,
        translated_title: translation?.title || "",
        translated_abstract: translation?.abstract || ""
      },
      enriched,
      enrichedAbstract,
      enrichedKeywords,
      failedAbstract,
      failedKeywords,
      translated,
      error: stageErrors.join("；")
    };
  }

  function prepareArticleShared(id) {
    if (inFlightArticles.has(id)) return inFlightArticles.get(id);
    const task = prepareArticle(id).finally(() => inFlightArticles.delete(id));
    inFlightArticles.set(id, task);
    return task;
  }

  async function runJob(job, ids) {
    const queue = [...ids];
    const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      while (queue.length) {
        const id = queue.shift();
        try {
          const result = await prepareArticleShared(id);
          job.results.push(result.article);
          if (result.enriched) job.enriched += 1;
          job.enrichedAbstract += result.enrichedAbstract || 0;
          job.enrichedKeywords += result.enrichedKeywords || 0;
          job.failedAbstract += result.failedAbstract || 0;
          job.failedKeywords += result.failedKeywords || 0;
          if (result.translated) job.translated += 1;
          if (result.error) {
            job.failed += 1;
            job.errors.push({ id, message: result.error });
          }
        } catch (error) {
          job.failed += 1;
          job.errors.push({ id, message: error.message });
        } finally {
          job.completed += 1;
          job.updatedAt = Date.now();
        }
      }
    });

    await Promise.all(workers);
    job.status = "complete";
    job.updatedAt = Date.now();
  }

  function start(ids) {
    cleanupJobs();
    const normalizedIds = normalizeIds(ids, maxItems);
    if (!normalizedIds.length) throw new Error("请选择需要补全的文献");
    if (jobs.size >= maxJobs) {
      const completedJobs = [...jobs.values()]
        .filter((job) => job.status === "complete")
        .sort((a, b) => a.updatedAt - b.updatedAt);
      while (jobs.size >= maxJobs && completedJobs.length) jobs.delete(completedJobs.shift().id);
    }
    if (jobs.size >= maxJobs) throw new Error("批量补全任务较多，请稍后重试");

    const job = {
      id: randomUUID(),
      status: "running",
      total: normalizedIds.length,
      completed: 0,
      enriched: 0,
      enrichedAbstract: 0,
      enrichedKeywords: 0,
      translated: 0,
      failed: 0,
      failedAbstract: 0,
      failedKeywords: 0,
      results: [],
      errors: [],
      updatedAt: Date.now()
    };
    jobs.set(job.id, job);
    void runJob(job, normalizedIds).catch((error) => {
      job.status = "complete";
      job.failed = Math.max(job.failed, job.total - job.completed);
      job.errors.push({ id: null, message: error.message });
      job.updatedAt = Date.now();
    });
    return publicJob(job);
  }

  function get(jobId) {
    cleanupJobs();
    const job = jobs.get(jobId);
    return job ? publicJob(job) : null;
  }

  return { start, get };
}
