import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";
import { getTranslation, listRecentArticlesForDigest, saveTranslation, updateArticleDetails } from "./db.js";
import { crawlArticleDetails } from "./crawler.js";
import { translateArticle } from "./translate.js";

async function prepareArticle(article, targetLanguage, options = {}) {
  let enrichedArticle = article;
  if (options.enrich && (!article.abstract || !article.keywords)) {
    try {
      enrichedArticle = updateArticleDetails(article.id, await crawlArticleDetails(article));
    } catch (error) {
      console.warn(`[digest] metadata enrichment failed for #${article.id}: ${error.message}`);
    }
  }

  let translation = getTranslation(enrichedArticle.id, targetLanguage);
  let newlyTranslated = false;
  if (!translation && options.translate && options.canTranslateMissing?.()) {
    try {
      translation = saveTranslation(
        enrichedArticle.id,
        targetLanguage,
        await translateArticle(enrichedArticle, targetLanguage)
      );
      newlyTranslated = true;
    } catch (error) {
      console.warn(`[digest] translation failed for #${article.id}: ${error.message}`);
    }
  }
  return { article: enrichedArticle, translation, newlyTranslated };
}

function formatDate(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function digestRange(days = config.weeklyDigestDays) {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - Number(days || 7));
  return { startDate: formatDate(start), endDate: formatDate(end) };
}

function normalizeMarkdown(value, fallback = "暂无") {
  return String(value || fallback).replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function frequencyLabel(frequency) {
  return { daily: "日报", weekly: "周报", monthly: "月报" }[frequency] || "周报";
}

function articleMarkdown({ article, translation }, index, options, compact = false) {
  const translatedTitle = options.includeTranslation && translation?.title
    ? `\n\n**中文标题：** ${normalizeMarkdown(translation.title)}`
    : "";
  const keywords = options.includeKeywords && article.keywords ? `\n- 关键词：${article.keywords}` : "";
  const translatedKeywords = options.includeKeywords && options.includeTranslation && translation?.keywords
    ? `\n- 中文关键词：${translation.keywords}`
    : "";
  const link = article.url ? `\n- 原文链接：${article.url}` : "";
  const abstract = options.includeAbstract && article.abstract
    ? compact
      ? `\n- 摘要：${article.abstract.slice(0, 300)}${article.abstract.length > 300 ? "…" : ""}`
      : `\n\n### Abstract / 摘要\n\n${normalizeMarkdown(article.abstract)}`
    : "";
  const translatedAbstract = !compact && options.includeAbstract && options.includeTranslation && translation?.abstract
    ? `\n\n### 中文摘要\n\n${normalizeMarkdown(translation.abstract)}`
    : "";
  return `## ${index + 1}. ${normalizeMarkdown(article.title)}${translatedTitle}

- 期刊：${normalizeMarkdown(article.journal)}
- 发布日期：${normalizeMarkdown(article.published_at)}
- 首次收集：${normalizeMarkdown(article.first_seen_at)}
- DOI：${normalizeMarkdown(article.doi)}${keywords}${translatedKeywords}${link}${abstract}${translatedAbstract}`;
}

function renderDocument(items, options = {}, compact = false) {
  const range = options.range || digestRange();
  const label = options.frequencyLabel || "周报";
  const journalScope = options.journals?.length
    ? options.journals.map((journal) => journal.name).join("、")
    : "全部已订阅期刊";
  const body = items.length
    ? items.map((item, index) => articleMarkdown(item, index, options, compact)).join("\n\n---\n\n")
    : "本周期未发现符合条件的新论文。";
  return `# 电力文献${label} ${range.startDate} 至 ${range.endDate}

- 生成时间：${new Date().toLocaleString("zh-CN", { hour12: false })}
- 收集范围：本周期出版或首次收集的论文
- 期刊范围：${journalScope}
- 文献数量：${items.length}

${body}
`;
}

function renderDigestMarkdown(items, options = {}) {
  return renderDocument(items, options, false);
}

function renderEmailBodyMarkdown(items, options = {}) {
  return renderDocument(items, options, true);
}

export async function generateWeeklyDigestMarkdown(settings = {}, options = {}) {
  const days = options.days ?? config.weeklyDigestDays;
  const limit = options.limit ?? config.weeklyDigestLimit;
  const journals = Array.isArray(settings.journals) ? settings.journals : [];
  const requestedNames = String(settings.pushJournalFilter || "").split(",").map((name) => name.trim()).filter(Boolean);
  const matchedJournals = requestedNames.length ? journals.filter((journal) => requestedNames.includes(journal.name)) : journals;
  // A renamed or deleted filter must not silently produce an empty email.
  const filteredJournals = requestedNames.length && matchedJournals.length === 0 ? journals : matchedJournals;
  const articles = listRecentArticlesForDigest(days, limit, filteredJournals);

  let translationAttempts = 0;
  const maxNewTranslations = Math.max(0, config.weeklyDigestTranslateMissingLimit);
  const canTranslateMissing = () => {
    if (translationAttempts >= maxNewTranslations) return false;
    translationAttempts += 1;
    return true;
  };
  const includeTranslation = settings.pushIncludeTranslation !== false;
  const items = [];
  for (const article of articles) {
    items.push(await prepareArticle(article, config.weeklyDigestTranslationLanguage, {
      enrich: true,
      translate: includeTranslation,
      canTranslateMissing
    }));
  }

  const digestDir = path.resolve(config.weeklyDigestDir);
  await fs.mkdir(digestDir, { recursive: true });
  const range = digestRange(days);
  const frequency = settings.pushFrequency || "weekly";
  const renderOptions = {
    targetLanguage: config.weeklyDigestTranslationLanguage,
    range,
    journals: filteredJournals,
    includeAbstract: settings.pushIncludeAbstract !== false,
    includeKeywords: settings.pushIncludeKeywords !== false,
    includeTranslation,
    frequencyLabel: frequencyLabel(frequency)
  };
  const filePath = path.join(digestDir, `ieee-power-${frequency}-${range.startDate}_to_${range.endDate}.md`);
  await fs.writeFile(filePath, renderDigestMarkdown(items, renderOptions), "utf8");

  return {
    filePath,
    subject: `IEEE 电力文献${frequencyLabel(frequency)} ${range.startDate} 至 ${range.endDate}`,
    range,
    emailBodyMarkdown: renderEmailBodyMarkdown(items, renderOptions),
    count: items.length,
    translatedCount: items.filter((item) => item.translation).length,
    missingTranslationCount: items.filter((item) => !item.translation).length,
    newlyTranslatedCount: items.filter((item) => item.newlyTranslated).length,
    translationAttemptCount: translationAttempts
  };
}

export const internals = { renderDigestMarkdown, renderEmailBodyMarkdown, digestRange, prepareArticle };
