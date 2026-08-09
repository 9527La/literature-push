import cron from "node-cron";
import { config, DEFAULT_JOURNALS } from "./config.js";
import {
  createRefreshRun,
  finishRefreshRun,
  getAllUserEmails,
  getSettings,
  getTranslation,
  getUserSettings,
  insertArticles,
  listArticlesMissingMetadata,
  listArticlesWithoutTranslation,
  saveTranslation,
  updateArticleDetails
} from "./db.js";
import { fetchJournalArticles } from "./sources.js";
import { crawlArticleDetails } from "./crawler.js";
import { translateArticle } from "./translate.js";
import { generateWeeklyDigestMarkdown } from "./digest.js";
import { sendMarkdownDigestEmail } from "./mail.js";
import { calculatePushDays, sleep } from "./utils.js";

const TRANSLATE_DELAY_MS = 1000;
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
    finishRefreshRun(runId, { addedCount, status: "success", message });

    // Keep the HTTP refresh fast, but preserve the required order inside the
    // background pipeline: metadata first, translation second, local DB last.
    if (addedArticles.length) {
      void (async () => {
        const enriched = await enrichArticles(addedArticles.slice(0, TRANSLATE_BATCH_LIMIT));
        await autoTranslateArticles(enriched);
      })().catch((error) => console.error("[post-process] failed:", error.message));
    } else {
      void (async () => {
        await enrichMissingKeywords();
        const backlog = listArticlesWithoutTranslation(
          config.weeklyDigestTranslationLanguage || "zh",
          TRANSLATE_BATCH_LIMIT
        );
        await autoTranslateArticles(backlog);
      })().catch((error) => console.error("[post-process] backlog failed:", error.message));
    }

    return { addedCount, status: "success", message, addedArticles: addedArticles.slice(0, 20), sourceErrors: errors };
  } catch (error) {
    finishRefreshRun(runId, { addedCount: 0, status: "error", message: error.message });
    return { addedCount: 0, status: "error", message: error.message, addedArticles: [] };
  } finally {
    isRefreshing = false;
  }
}

async function enrichArticles(articles) {
  const results = [];
  for (const article of articles) {
    try {
      const details = await crawlArticleDetails(article);
      results.push(updateArticleDetails(article.id, details));
      console.log(`[enrich] #${article.id} metadata updated`);
    } catch (error) {
      results.push(article);
      console.warn(`[enrich] #${article.id} failed: ${error.message}`);
    }
    await sleep(ENRICH_DELAY_MS);
  }
  return results;
}

export async function enrichMissingKeywords() {
  const articles = listArticlesMissingMetadata(ENRICH_BATCH_LIMIT);
  if (!articles.length) return { enriched: 0, failed: 0 };
  const results = await enrichArticles(articles);
  const enriched = results.filter((article, index) =>
    String(article.abstract || "") !== String(articles[index].abstract || "") ||
    String(article.keywords || "") !== String(articles[index].keywords || "")
  ).length;
  return { enriched, failed: articles.length - enriched };
}

export async function autoTranslateArticles(articles) {
  const targetLanguage = config.weeklyDigestTranslationLanguage || "zh";
  let translated = 0;
  let failed = 0;
  for (const article of articles) {
    if (!article.id || getTranslation(article.id, targetLanguage)) continue;
    try {
      saveTranslation(article.id, targetLanguage, await translateArticle(article, targetLanguage));
      translated += 1;
      console.log(`[translate] #${article.id} translated and saved`);
    } catch (error) {
      failed += 1;
      console.warn(`[translate] #${article.id} failed: ${error.message}`);
    }
    await sleep(TRANSLATE_DELAY_MS);
  }
  return { translated, failed };
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
