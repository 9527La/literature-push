import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";
import { getTranslation, listRecentArticlesForDigest, updateArticleDetails, getLatestReadyReport } from "./db.js";
import { isDirectionKey } from "./directions.js";
import { crawlArticleDetails } from "./crawler.js";
import { ensureTranslation, isTranslationComplete } from "./translation-cache.js";
import { resolveFromRoot } from "./paths.js";
import { businessWindow } from "./date/normalize.js";
import { SOURCE_OFFICIAL_PUBLICATION } from "./date/constants.js";

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
  const translationIncomplete = !isTranslationComplete(enrichedArticle, translation);
  if (translationIncomplete && options.translate && options.canTranslateMissing?.()) {
    try {
      const result = await ensureTranslation(enrichedArticle, targetLanguage);
      translation = result.translation;
      newlyTranslated = Boolean(result.translated);
    } catch (error) {
      console.warn(`[digest] translation failed for #${article.id}: ${error.message}`);
    }
  }
  return { article: enrichedArticle, translation, newlyTranslated };
}

// 窗口标题与 SQL 查询必须同源：都走 server/date 的「近 N 日」窗口（北京时间
// 今天 + 向前 N-1 个自然日）。以前这里用 toISOString()（UTC）切日，北京时间
// 0—8 点生成的周报标题会比实际查询窗口偏移一天。
function digestRange(days = config.weeklyDigestDays) {
  return businessWindow(Number(days || 7));
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
  const link = article.url ? `\n- 原文链接：${article.url}` : "";
  const abstract = options.includeAbstract && article.abstract
    ? compact
      ? `\n- 摘要：${normalizeMarkdown(article.abstract)}`
      : `\n\n### Abstract / 摘要\n\n${normalizeMarkdown(article.abstract)}`
    : "";
  const translatedAbstract = !compact && options.includeAbstract && options.includeTranslation && translation?.abstract
    ? `\n\n### 中文摘要\n\n${normalizeMarkdown(translation.abstract)}`
    : "";
  return `## ${index + 1}. ${normalizeMarkdown(article.title)}${translatedTitle}

- 期刊：${normalizeMarkdown(article.journal)}
- ${isOfficialPublicationDate(article) ? "出版日期" : "首次公开"}：${normalizeMarkdown(article.display_date || article.published_at)}
- DOI：${normalizeMarkdown(article.doi)}${keywords}${link}${abstract}${translatedAbstract}`;
}

/**
 * 邮件里的日期标签：主日期 = first_public_at（首次公开）。来源标记为正式出版
 * （B 级）时标签写「出版日期」；来源是 Online First / Available online / 网络
 * 首发或兜底时写「首次公开」。老数据没有来源标记时按「display_date 与
 * published_at 是否同日」近似判断。
 */
function isOfficialPublicationDate(article) {
  if (article.first_public_source) return article.first_public_source === SOURCE_OFFICIAL_PUBLICATION;
  return Boolean(article.display_date) && article.display_date === String(article.published_at || "").slice(0, 10);
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
  // AI 研究速览（PLAN-AI-REPORTS.md）：仅进邮件正文、置顶于文献列表之前；
  // 文件附件保持纯文献列表。段落由 generateWeeklyDigestMarkdown 预渲染好传入。
  const aiSection = options.aiSection ? `${options.aiSection}\n\n---\n\n` : "";
  return `# 电力文献${label} ${range.startDate} 至 ${range.endDate}

- 生成时间：${new Date().toLocaleString("zh-CN", { hour12: false })}
- 收集范围：按论文首次公开日期（first_public_at）落在本周期内的论文；Online First / Available online / 网络首发按首发日计，历史补录不计入
- 期刊范围：${journalScope}
- 文献数量：${items.length}

${aiSection}${body}
`;
}

function renderDigestMarkdown(items, options = {}) {
  return renderDocument(items, options, false);
}

// ── AI 研究速览（PLAN-AI-REPORTS.md）───────────────────────────────────────
// 报告来自 ai_reports 表（WorkBuddy 智能体离线生成、apply-report.mjs 写库），
// 这里只读渲染：推送频率映射报告类型，找不到当期报告时降级最近一期并标注。
// 同步链路零 LLM、零联网调用。

/** 推送频率 → 报告类型：weekly→周报；monthly→月报；daily→周报（拍板决策 3）。 */
function aiReportKindForFrequency(frequency) {
  return frequency === "monthly" ? "monthly" : "weekly";
}

/**
 * 判断报告是否「过期」（非当期）：weekly 以窗口起始日对齐；monthly 以报告
 * 期末是否覆盖推送窗口起点判定（推送窗口是滚动的 30 日，自然月报告不可能
 * 与窗口起点相等，只能看是否被窗口覆盖）。
 */
function isStaleAiReport(report, kind, range) {
  if (!report) return false;
  if (kind === "weekly") return report.period_start !== range.startDate;
  return String(report.period_end || "") < String(range.startDate);
}

/** 邮件 AI 段落：去报告自身 H1（避免与邮件标题双一级标题），期数进段标题；
 *  同时剥离论文速评行首的 [id] 引用标记（站内用作点击锚点，邮件中无意义）。 */
function renderAiReportSection(report, { stale = false } = {}) {
  if (!report?.content_md) return "";
  const body = normalizeMarkdown(report.content_md)
    .replace(/^#[^\n]*\n+/, "")
    .replace(/^([-*])\s*\[\d{4,6}\]\s*/gm, "$1 ")
    .trim();
  if (!body) return "";
  const staleMark = stale ? "·最近一期" : "";
  return `## AI 研究速览（${report.period_start} ~ ${report.period_end} 期${staleMark}）\n\n${body}`;
}

/**
 * 读取推送应置顶的 AI 报告。返回 null 表示不加段落（开关关闭 / 库内无 ready
 * 报告的冷启动），邮件正文与既有格式逐字节一致。
 */
function selectAiReport(settings, range) {
  if (settings.pushIncludeAiReport === false) return { report: null, stale: false };
  const kind = aiReportKindForFrequency(settings.pushFrequency || "weekly");
  const report = getLatestReadyReport(kind);
  if (!report) return { report: null, stale: false };
  return { report, stale: isStaleAiReport(report, kind, range), kind };
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
  // 推送方向过滤（PLAN-AI-REPORTS.md M3）：空串/全非法 key = 全部方向；
  // key 清洗已在 settings 写入侧做过，这里再过一遍白名单兜底。
  const pushDirections = String(settings.pushDirectionFilter || "")
    .split(",").map((key) => key.trim()).filter(isDirectionKey);
  const articles = listRecentArticlesForDigest(days, limit, filteredJournals, pushDirections);

  let translationAttempts = 0;
  const maxNewTranslations = Math.max(0, config.weeklyDigestTranslateMissingLimit);
  const canTranslateMissing = () => {
    if (translationAttempts >= maxNewTranslations) return false;
    translationAttempts += 1;
    return true;
  };
  let enrichmentAttempts = 0;
  const maxEnrichments = Math.max(0, config.weeklyDigestEnrichMissingLimit);
  // 默认**不做**实时联网富化：一次摘要要对窗口内每篇缺元数据的文章发起真实抓取，
  // 单篇 5–30 秒、上限 50 篇，足以让一次「立即发送」跑满两分钟并被网关 100 秒掐断。
  // 缺摘要/关键词的文章会被下面的 requireComplete 过滤掉，元数据该由后台补全作业负责。
  const allowEnrich = options.allowEnrich === true;
  const canEnrichMissing = (article) => {
    if (!allowEnrich) return false;
    if (article.abstract && article.keywords) return false;
    if (enrichmentAttempts >= maxEnrichments) return false;
    enrichmentAttempts += 1;
    return true;
  };
  const includeTranslation = settings.pushIncludeTranslation !== false;
  const preparedItems = [];
  for (const article of articles) {
    preparedItems.push(await prepareArticle(article, config.weeklyDigestTranslationLanguage, {
      enrich: canEnrichMissing(article),
      translate: includeTranslation,
      canTranslateMissing
    }));
  }
  const requireComplete = options.requireComplete !== false;
  const eligibleItems = requireComplete
    ? preparedItems.filter(({ article, translation }) =>
        Boolean(article.abstract && (!includeTranslation || isTranslationComplete(article, translation)))
      )
    : preparedItems;
  const excludedIncompleteCount = preparedItems.length - eligibleItems.length;
  const maxItems = Number(options.maxItems || 0);
  const items = maxItems > 0 ? eligibleItems.slice(0, maxItems) : eligibleItems;
  const omittedCompleteCount = eligibleItems.length - items.length;

  const digestDir = path.isAbsolute(config.weeklyDigestDir)
    ? config.weeklyDigestDir
    : resolveFromRoot(config.weeklyDigestDir);
  await fs.mkdir(digestDir, { recursive: true });
  const range = digestRange(days);
  const frequency = settings.pushFrequency || "weekly";
  const { report: aiReport, stale: aiReportStale, kind: aiReportKind } = selectAiReport(settings, range);
  const renderOptions = {
    targetLanguage: config.weeklyDigestTranslationLanguage,
    range,
    journals: filteredJournals,
    includeAbstract: settings.pushIncludeAbstract !== false,
    includeKeywords: settings.pushIncludeKeywords !== false,
    includeTranslation,
    frequencyLabel: frequencyLabel(frequency),
    // AI 段落只进邮件正文（renderEmailBodyMarkdown 与 renderDigestMarkdown 共用
    // renderDocument，但文件渲染路径不传 aiSection）。
    aiSection: renderAiReportSection(aiReport, { stale: aiReportStale })
  };
  const filePath = path.join(digestDir, `ieee-power-${frequency}-${range.startDate}_to_${range.endDate}.md`);
  // 文件附件保持纯文献列表：AI 段落只进邮件正文，这里剥掉 aiSection。
  await fs.writeFile(filePath, renderDigestMarkdown(items, { ...renderOptions, aiSection: "" }), "utf8");

  return {
    filePath,
    subject: `IEEE 电力文献${frequencyLabel(frequency)} ${range.startDate} 至 ${range.endDate}`,
    range,
    emailBodyMarkdown: renderEmailBodyMarkdown(items, renderOptions),
    count: items.length,
    translatedCount: items.filter((item) => item.translation).length,
    missingTranslationCount: items.filter((item) => !item.translation).length,
    excludedIncompleteCount,
    omittedCompleteCount,
    newlyTranslatedCount: items.filter((item) => item.newlyTranslated).length,
    translationAttemptCount: translationAttempts,
    enrichmentAttemptCount: enrichmentAttempts,
    aiReport: aiReport
      ? { kind: aiReportKind, periodStart: aiReport.period_start, periodEnd: aiReport.period_end, stale: aiReportStale }
      : null,
    pushDirections
  };
}

export const internals = {
  renderDigestMarkdown, renderEmailBodyMarkdown, digestRange, prepareArticle,
  aiReportKindForFrequency, isStaleAiReport, renderAiReportSection, selectAiReport
};
