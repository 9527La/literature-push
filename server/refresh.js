import cron from "node-cron";
import { config, DEFAULT_JOURNALS } from "./config.js";
import {
  createRefreshRun,
  finishRefreshRun,
  getAllUserEmails,
  getSettings,
  getUserSettings,
  getMetadataGaps,
  insertArticles,
  countArticlesMissingAbstract,
  countArticlesMissingTranslation,
  countArticlesWithoutKeywords,
  listArticlesMissingAbstract,
  listArticlesMissingTranslation,
  listArticlesWithoutKeywords,
  listArticlesWithoutTranslation,
  updateArticleDetails,
  updateRefreshRunSummary
} from "./db.js";
import { fetchJournalArticles } from "./sources.js";
import { crawlArticleDetails } from "./crawler.js";
import { ensureTranslations } from "./translation-cache.js";
import { generateWeeklyDigestMarkdown } from "./digest.js";
import { sendMarkdownDigestEmail } from "./mail.js";
import { calculatePushDays, sleep } from "./utils.js";

const TRANSLATE_BATCH_LIMIT = 20;
const ENRICH_BATCH_LIMIT = 50;
const ENRICH_DELAY_MS = 500;

let isRefreshing = false;
let scheduledTask = null;
let weeklyDigestTask = null;
let pushTasks = [];

function journalsToCollect(settings) {
  return [...new Map([...DEFAULT_JOURNALS, ...(settings.journals || [])].map((journal) => [journal.name, journal])).values()];
}

function hasText(value) {
  return String(value || "").trim().length > 0;
}

function countMetadataAdditions(before, after) {
  return after.reduce((counts, article, index) => {
    const previous = before[index] || {};
    if (!hasText(previous.abstract)) {
      if (hasText(article.abstract)) counts.abstractCount += 1;
      else counts.failedAbstractCount += 1;
    }
    if (!hasText(previous.keywords)) {
      if (hasText(article.keywords)) counts.keywordCount += 1;
      else counts.failedKeywordCount += 1;
    }
    return counts;
  }, { abstractCount: 0, keywordCount: 0, failedAbstractCount: 0, failedKeywordCount: 0 });
}

function formatTaskMessage({
  addedCount = 0,
  abstractCount = 0,
  keywordCount = 0,
  translatedCount = 0,
  translatedTitleCount = 0,
  translatedAbstractCount = 0,
  translationUnitCount = 0,
  translationRequestCount = 0,
  failedArticleCount = 0,
  failedAbstractCount = 0,
  failedKeywordCount = 0,
  failedTranslationCount = 0,
  remainingAbstractCount = 0,
  remainingKeywordCount = 0,
  remainingTranslationCount = 0
}) {
  const additions = [
    `新增文献 ${Number(addedCount || 0)} 篇`,
    `补全摘要 ${Number(abstractCount || 0)} 篇`,
    `补全关键词 ${Number(keywordCount || 0)} 篇`,
    `新增翻译 ${Number(translatedCount || 0)} 篇`
  ];
  const failures = [
    `文献 ${Number(failedArticleCount || 0)}`,
    `摘要 ${Number(failedAbstractCount || 0)}`,
    `关键词 ${Number(failedKeywordCount || 0)}`,
    `翻译 ${Number(failedTranslationCount || 0)}`
  ];
  const fieldSummary = `标题 ${Number(translatedTitleCount || 0)} / 摘要 ${Number(translatedAbstractCount || 0)}`;
  return `${additions.join(" · ")} · 翻译单元 ${Number(translationUnitCount || 0)}（${fieldSummary}） · API 请求 ${Number(translationRequestCount || 0)} 次 · 失败：${failures.join(" / ")} · 待补全：摘要 ${Number(remainingAbstractCount || 0)} / 关键词 ${Number(remainingKeywordCount || 0)} · 待翻译 ${Number(remainingTranslationCount || 0)}`;
}

export async function refreshArticles() {
  if (isRefreshing) {
    return { addedCount: 0, status: "skipped", message: "Refresh already running", addedArticles: [] };
  }

  isRefreshing = true;
  const runId = createRefreshRun();
  const settings = getSettings();
  const journals = journalsToCollect(settings);
  const fetched = [];
  const errors = [];

  try {
    for (const journal of journals) {
      try {
        fetched.push(...await fetchJournalArticles(journal, { lookbackDays: config.lookbackDays }));
      } catch (error) {
        errors.push(`${journal.name}: ${error.message}`);
      }
    }
    if (!fetched.length && errors.length) throw new Error(errors.join("; "));

    const { addedCount, addedArticles } = insertArticles(fetched);
    const message = `Fetched ${fetched.length} records from ${journals.length - errors.length}/${journals.length} journals${errors.length ? `; ${errors.length} failed` : ""}`;
    finishRefreshRun(runId, {
      addedCount,
      status: "success",
      failedArticleCount: errors.length,
      message: `抓取完成：新增文献 ${addedCount} 篇，后台补全与翻译处理中…`
    });

    // Keep the HTTP refresh fast, but preserve the required order inside the
    // background pipeline: metadata first, translation second, local DB last.
    if (addedArticles.length) {
      void (async () => {
        const selected = addedArticles.slice(0, TRANSLATE_BATCH_LIMIT);
        const enrichment = await enrichArticles(selected);
        const enriched = enrichment.articles;
        const metadata = countMetadataAdditions(selected, enriched);
        const translationResult = await autoTranslateArticles(enriched);
        const remaining = getMetadataGaps();
        const remainingTranslationCount = countArticlesMissingTranslation(config.weeklyDigestTranslationLanguage || "zh");
        updateRefreshRunSummary(runId, {
          ...metadata,
          translatedCount: translationResult.translated,
          translatedTitleCount: translationResult.translatedTitleCount,
          translatedAbstractCount: translationResult.translatedAbstractCount,
          translationUnitCount: translationResult.translatedUnits,
          translationRequestCount: translationResult.requests,
          failedArticleCount: errors.length,
          failedTranslationCount: translationResult.failed,
          remainingAbstractCount: remaining.abstracts,
          remainingKeywordCount: remaining.keywords,
          remainingTranslationCount,
          message: formatTaskMessage({
            addedCount,
            ...metadata,
            translatedCount: translationResult.translated,
            translatedTitleCount: translationResult.translatedTitleCount,
            translatedAbstractCount: translationResult.translatedAbstractCount,
            translationUnitCount: translationResult.translatedUnits,
            translationRequestCount: translationResult.requests,
            failedArticleCount: errors.length,
            failedTranslationCount: translationResult.failed,
            remainingAbstractCount: remaining.abstracts,
            remainingKeywordCount: remaining.keywords,
            remainingTranslationCount
          })
        });
      })().catch((error) => {
        console.error("[post-process] failed:", error.message);
        updateRefreshRunSummary(runId, {
          message: `新增文献 ${addedCount} 篇 · 后台补全或翻译失败：${error.message}`
        });
      });
    } else {
      void (async () => {
        const abstractResult = await enrichMissingAbstracts();
        const keywordResult = await enrichMissingKeywords();
        const backlog = listArticlesWithoutTranslation(
          config.weeklyDigestTranslationLanguage || "zh",
          TRANSLATE_BATCH_LIMIT
        );
        const translationResult = await autoTranslateArticles(backlog);
        const remaining = getMetadataGaps();
        const remainingTranslationCount = countArticlesMissingTranslation(config.weeklyDigestTranslationLanguage || "zh");
        const abstractCount = (abstractResult.enrichedAbstracts ?? abstractResult.enriched ?? 0)
          + (keywordResult.enrichedAbstracts || 0);
        const keywordCount = (abstractResult.enrichedKeywords || 0)
          + (keywordResult.enrichedKeywords ?? keywordResult.enriched ?? 0);
        const failedAbstractCount = (abstractResult.failedAbstracts ?? abstractResult.failed ?? 0)
          + (keywordResult.failedAbstracts || 0);
        const failedKeywordCount = (abstractResult.failedKeywords || 0)
          + (keywordResult.failedKeywords ?? keywordResult.failed ?? 0);
        updateRefreshRunSummary(runId, {
          abstractCount,
          keywordCount,
          translatedCount: translationResult.translated,
          translatedTitleCount: translationResult.translatedTitleCount,
          translatedAbstractCount: translationResult.translatedAbstractCount,
          translationUnitCount: translationResult.translatedUnits,
          translationRequestCount: translationResult.requests,
          failedArticleCount: errors.length,
          failedAbstractCount,
          failedKeywordCount,
          failedTranslationCount: translationResult.failed,
          remainingAbstractCount: remaining.abstracts,
          remainingKeywordCount: remaining.keywords,
          remainingTranslationCount,
          message: formatTaskMessage({
            addedCount,
            abstractCount,
            keywordCount,
            translatedCount: translationResult.translated,
            translatedTitleCount: translationResult.translatedTitleCount,
            translatedAbstractCount: translationResult.translatedAbstractCount,
            translationUnitCount: translationResult.translatedUnits,
            translationRequestCount: translationResult.requests,
            failedArticleCount: errors.length,
            failedAbstractCount,
            failedKeywordCount,
            failedTranslationCount: translationResult.failed,
            remainingAbstractCount: remaining.abstracts,
            remainingKeywordCount: remaining.keywords,
            remainingTranslationCount
          })
        });
      })().catch((error) => {
        console.error("[post-process] backlog failed:", error.message);
        updateRefreshRunSummary(runId, {
          message: `新增文献 ${addedCount} 篇 · 后台补全或翻译失败：${error.message}`
        });
      });
    }

    return { addedCount, status: "success", message, addedArticles: addedArticles.slice(0, 20), sourceErrors: errors };
  } catch (error) {
    finishRefreshRun(runId, {
      addedCount: 0,
      status: "error",
      failedArticleCount: errors.length || 1,
      message: error.message
    });
    return { addedCount: 0, status: "error", message: error.message, addedArticles: [] };
  } finally {
    isRefreshing = false;
  }
}

function metadataFieldLabel(field) {
  return field === "abstract" ? "摘要" : "关键词";
}

async function enrichArticles(articles, fields = ["abstract", "keywords"]) {
  const requestedFields = [...new Set(fields.filter((field) => field === "abstract" || field === "keywords"))];
  const results = new Array(articles.length);
  const errors = [];
  for (const [index, article] of articles.entries()) {
    try {
      const details = await crawlArticleDetails(article, { fields: requestedFields });
      results[index] = updateArticleDetails(article.id, details) || article;
      console.log(`[enrich] #${article.id} metadata updated`);
    } catch (error) {
      // The crawler attaches any fields collected before the failure. Save
      // that partial result so one unavailable field does not discard a usable
      // abstract/keyword returned by another source.
      results[index] = error.details
        ? (updateArticleDetails(article.id, error.details) || article)
        : article;
      const missing = requestedFields.filter((field) => !hasText(results[index]?.[field]));
      errors.push({
        id: article.id,
        fields: missing,
        message: missing.length
          ? `${missing.map(metadataFieldLabel).join("、")}：${error.message}`
          : error.message
      });
      console.warn(`[enrich] #${article.id} failed: ${error.message}`);
    }
    await sleep(ENRICH_DELAY_MS);
  }
  return { articles: results, errors };
}

export async function enrichMissingKeywords() {
  const articles = listArticlesWithoutKeywords(ENRICH_BATCH_LIMIT);
  if (!articles.length) {
    return {
      processed: 0,
      enriched: 0,
      failed: 0,
      enrichedKeywords: 0,
      failedKeywords: 0,
      enrichedAbstracts: 0,
      failedAbstracts: 0,
      remaining: countArticlesWithoutKeywords(),
      errors: []
    };
  }
  const enrichment = await enrichArticles(articles, ["keywords"]);
  const results = enrichment.articles;
  const enrichedKeywords = results.filter((article, index) =>
    hasText(article.keywords) && !hasText(articles[index].keywords)
  ).length;
  const enrichedAbstracts = results.filter((article, index) =>
    hasText(article.abstract) && !hasText(articles[index].abstract)
  ).length;
  const failedKeywords = articles.length - enrichedKeywords;
  const failedAbstracts = results.filter((article, index) =>
    !hasText(articles[index].abstract) && !hasText(article.abstract)
  ).length;
  return {
    processed: articles.length,
    enriched: enrichedKeywords,
    failed: failedKeywords,
    enrichedKeywords,
    failedKeywords,
    enrichedAbstracts,
    failedAbstracts,
    remaining: countArticlesWithoutKeywords(),
    errors: enrichment.errors
  };
}

export async function enrichMissingAbstracts() {
  const articles = listArticlesMissingAbstract(ENRICH_BATCH_LIMIT);
  if (!articles.length) {
    return {
      processed: 0,
      enriched: 0,
      failed: 0,
      enrichedAbstracts: 0,
      failedAbstracts: 0,
      enrichedKeywords: 0,
      failedKeywords: 0,
      remaining: countArticlesMissingAbstract(),
      errors: []
    };
  }
  const enrichment = await enrichArticles(articles, ["abstract"]);
  const results = enrichment.articles;
  const enrichedAbstracts = results.filter((article, index) =>
    hasText(article.abstract) && !hasText(articles[index].abstract)
  ).length;
  const enrichedKeywords = results.filter((article, index) =>
    hasText(article.keywords) && !hasText(articles[index].keywords)
  ).length;
  const failedAbstracts = articles.length - enrichedAbstracts;
  const failedKeywords = results.filter((article, index) =>
    !hasText(articles[index].keywords) && !hasText(article.keywords)
  ).length;
  return {
    processed: articles.length,
    enriched: enrichedAbstracts,
    failed: failedAbstracts,
    enrichedAbstracts,
    failedAbstracts,
    enrichedKeywords,
    failedKeywords,
    remaining: countArticlesMissingAbstract(),
    errors: enrichment.errors
  };
}

// Translate one missing field at a time so the administrator can repair a
// backlog without re-translating fields that are already present. The
// translation table stores all fields in one row, therefore existing values
// are preserved when only the title or abstract is requested.
export async function translateMissingArticles(field, targetLanguage = "zh", limit = TRANSLATE_BATCH_LIMIT) {
  if (!['title', 'abstract'].includes(field)) {
    throw new Error("只支持标题或摘要翻译");
  }

  const articles = listArticlesMissingTranslation(field, targetLanguage, limit);
  const batch = await ensureTranslations(articles, targetLanguage, { fields: [field] });
  const translated = batch.translated || 0;
  const failed = batch.failed || 0;

  return {
    field,
    targetLanguage,
    processed: articles.length,
    translated,
    translatedTitleCount: field === "title" ? batch.translatedUnits || 0 : 0,
    translatedAbstractCount: field === "abstract" ? batch.translatedUnits || 0 : 0,
    failed,
    translatedUnits: batch.translatedUnits || 0,
    requests: batch.requests || 0,
    providers: batch.providers || [],
    errors: batch.errors || [],
    remaining: countArticlesMissingTranslation(field, targetLanguage)
  };
}

export async function autoTranslateArticles(articles) {
  const targetLanguage = config.weeklyDigestTranslationLanguage || "zh";
  const selected = (Array.isArray(articles) ? articles : []).filter((article) => article?.id);
  const batch = await ensureTranslations(selected, targetLanguage);
  for (const item of batch.results || []) {
    if (item.translated) console.log(`[translate] #${item.articleId} translated and saved (${item.fields.join(",")})`);
    if (item.error) console.warn(`[translate] #${item.articleId} failed: ${item.error}`);
  }
  return {
    translated: batch.translated || 0,
    failed: batch.failed || 0,
    translatedUnits: batch.translatedUnits || 0,
    translatedTitleCount: (batch.results || []).filter((item) => item.field === "title").length,
    translatedAbstractCount: (batch.results || []).filter((item) => item.field === "abstract").length,
    requests: batch.requests || 0,
    providers: batch.providers || [],
    errors: batch.errors || []
  };
}

async function createAndSendDigest(settings, recipients, days) {
  const digest = await generateWeeklyDigestMarkdown(settings, { days });
  if (!recipients?.length) return { ...digest, sent: false };
  const includeFile = settings.pushIncludeFile !== false;
  const sent = await sendMarkdownDigestEmail(digest.filePath, {
    subject: digest.subject,
    bodyMarkdown: digest.emailBodyMarkdown,
    recipients,
    filePath: includeFile ? digest.filePath : undefined,
    fileName: includeFile ? digest.filePath.split(/[\\/]/).pop() : undefined,
    attachFile: includeFile
  });
  return { ...digest, sent };
}

async function runPush() {
  console.log("[push] starting scheduled collection and delivery");
  await refreshArticles();
  const users = getAllUserEmails();
  const targets = users.length
    ? users.map((user) => ({ settings: getUserSettings(user.user_id), recipients: [user.email] }))
    : [{ settings: getSettings(), recipients: getSettings().emailRecipients }];
  for (const target of targets) {
    const days = calculatePushDays(target.settings.pushFrequency);
    const result = await createAndSendDigest(target.settings, target.recipients, days);
    console.log(`[push] ${result.sent ? "sent" : "not sent"} to ${target.recipients.join(", ")}; ${result.count} articles`);
  }
}

function safeCron(label, callback) {
  return async () => {
    try {
      await callback();
    } catch (error) {
      console.error(`[${label}] scheduled job failed:`, error);
    }
  };
}

export function scheduleRefresh() {
  const settings = getSettings();
  for (const task of [scheduledTask, weeklyDigestTask, ...pushTasks]) task?.stop();
  scheduledTask = weeklyDigestTask = null;
  pushTasks = [];
  const cronOptions = { timezone: "Asia/Shanghai" };

  if (cron.validate(settings.refreshCron)) {
    scheduledTask = cron.schedule(settings.refreshCron, safeCron("refresh", refreshArticles), cronOptions);
  }

  // The configurable push supersedes the legacy weekly job and avoids sending
  // two messages at the same time.
  const userTargets = getAllUserEmails()
    .map((user) => ({ user, settings: getUserSettings(user.user_id) }))
    .filter((target) => target.settings.pushEnabled && cron.validate(target.settings.pushCron));

  if (userTargets.length) {
    pushTasks = userTargets.map(({ user, settings: userSettings }) => cron.schedule(
      userSettings.pushCron,
      safeCron(`push:${user.user_id}`, async () => {
        await refreshArticles();
        const latest = getUserSettings(user.user_id);
        const days = calculatePushDays(latest.pushFrequency);
        await createAndSendDigest(latest, [user.email], days);
      }),
      cronOptions
    ));
  } else if (settings.pushEnabled && cron.validate(settings.pushCron)) {
    pushTasks = [cron.schedule(settings.pushCron, safeCron("push", runPush), cronOptions)];
  } else if (cron.validate(config.weeklyDigestCron)) {
    weeklyDigestTask = cron.schedule(config.weeklyDigestCron, safeCron("weekly", async () => {
      await refreshArticles();
      const latest = getSettings();
      await createAndSendDigest(latest, latest.emailRecipients, config.weeklyDigestDays);
    }), cronOptions);
  }
}

export function rescheduleRefresh() {
  scheduleRefresh();
}
