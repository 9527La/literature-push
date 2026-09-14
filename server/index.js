import express from "express";
import compression from "compression";
import cors from "cors";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cron from "node-cron";
import { config, DEFAULT_JOURNALS } from "./config.js";
import {
  getSettings,
  getUserSettings,
  updateUserSettings,
  getArticle,
  getArticleForUser,
  getStatus,
  getKeywordStats,
  getKeywordCooccurrence,
  listArticles,
  listArticlePage,
  setArticleRead,
  toggleArticleFavorite,
  setArticleReadForUser,
  toggleArticleFavoriteForUser,
  getUserStatus,
  updateArticleDetails,
  setUserEmail,
  getUserEmail,
  getAllUserEmails,
  getUserProfile,
  updateUserProfile,
  getUserAccountByUsername,
  getUserAccountById,
  getUserAccountCount,
  createUserAccount,
  createUserSession,
  getActiveUserSession,
  touchUserSession,
  revokeUserSession,
  deleteUserAccount,
  getUserFavorites,
  listFavoriteGroups,
  createFavoriteGroup,
  renameFavoriteGroup,
  deleteFavoriteGroup,
  updateUserFavorite,
  getDefaultFavoriteGroupId,
  setDefaultFavoriteGroupId,
  getAdminOverview,
  getMetadataGaps,
  countArticlesMissingTranslation,
  saveRemotePreferences,
  getRemotePreferences,
  getRecentFeedbackCount,
  getRecentFeedbackCommentCount,
  addFeedback,
  addFeedbackComment,
  listPublicFeedback,
  toggleFeedbackLike,
  toggleFeedbackCommentLike,
  replyFeedback,
  closeFeedback,
  deleteFeedback,
  deleteFeedbackComment,
  getDiscussionProfile,
  updateDiscussionProfile,
  createRefreshRun,
  finishRefreshRun,
  updateRefreshRunSummary
} from "./db.js";
import {
  createPassportToken,
  createUserToken,
  getPassportClaims,
  getUserClaims,
  hashUserPassword,
  verifyUserPassword
} from "./user-auth.js";
import { crawlArticleDetails } from "./crawler.js";
import { refreshArticles, rescheduleRefresh, scheduleRefresh, enrichMissingKeywords, enrichMissingAbstracts, enrichAllMissingMetadata, translateMissingArticles } from "./refresh.js";
import { probeTranslationProviders, translationBaiduBudget, translationBudgetNotice, translationProvidersInUse, translationTencentBudget } from "./translate.js";
import { generateWeeklyDigestMarkdown } from "./digest.js";
import { sendMarkdownDigestEmail } from "./mail.js";
import { calculatePushDays } from "./utils.js";
import { createArticlePreparationService } from "./prepare.js";
import { ensureTranslation, ensureTranslations } from "./translation-cache.js";
import { getMaintenanceState, requestMaintenanceStop, startMaintenance } from "./maintenance.js";

const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Cloudflare Tunnel connects to this service through the local loopback
// interface. Trust only loopback proxies so req.ip resolves the original
// client address without allowing direct LAN clients to spoof forwarding
// headers.
app.set("trust proxy", "loopback");

app.use(cors({ origin: config.clientOrigin }));
app.use(express.json());
app.use(compression({ threshold: 1024 }));

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const pagePrepareConcurrency = config.translationProvider === "baidu"
  || (config.translationProvider === "auto"
    && !(config.volcengineAccessKeyId && config.volcengineSecretAccessKey)
    && config.baiduTranslateAppId && config.baiduTranslateKey)
  ? 1
  : config.pagePrepareConcurrency;
const articlePreparation = createArticlePreparationService({
  getArticle,
  updateArticleDetails,
  crawlArticleDetails,
  ensureTranslation,
  ensureTranslations
}, {
  concurrency: pagePrepareConcurrency,
  maxItems: config.pagePrepareMaxItems
});

const publicApiPaths = new Set(["/gate/login", "/gate/session"]);
app.use("/api", (req, res, next) => {
  if (publicApiPaths.has(req.path)) {
    next();
    return;
  }
  requirePassport(req, res, next);
});

app.get("/api/articles", (req, res) => {
  const userId = getPrincipalId(req);
  const paged = req.query.limit !== undefined || req.query.offset !== undefined;
  res.json(paged ? listArticlePage(req.query, userId) : listArticles(req.query, userId));
});

app.post("/api/articles/prepare", (req, res) => {
  try {
    res.status(202).json(articlePreparation.start(req.body?.ids));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get("/api/articles/prepare/:jobId", (req, res) => {
  const job = articlePreparation.get(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: "批量补全任务不存在或已过期" });
    return;
  }
  res.json(job);
});

app.get("/api/articles/:id", (req, res) => {
  const article = getArticleForUser(req.params.id, getPrincipalId(req));
  if (!article) {
    res.status(404).json({ error: "Article not found" });
    return;
  }
  res.json(article);
});

app.post("/api/articles/:id/read", requireAccount, (req, res) => {
  const userId = getPrincipalId(req);
  const isRead = setArticleReadForUser(userId, Number(req.params.id));
  res.json({ ok: true, isRead: Boolean(isRead) });
});

app.post("/api/articles/:id/favorite", requireAccount, (req, res) => {
  const userId = getPrincipalId(req);
  try {
    const article = toggleArticleFavoriteForUser(userId, Number(req.params.id), {
      groupId: req.body?.groupId,
      setDefault: Boolean(req.body?.setDefault)
    });
    if (!article) {
      res.status(404).json({ error: "Article not found" });
      return;
    }
    res.json(article);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get("/api/favorites/options", requireAccount, (req, res) => {
  const userId = getPrincipalId(req);
  res.json({ groups: listFavoriteGroups(userId), defaultGroupId: getDefaultFavoriteGroupId(userId) });
});

app.put("/api/favorites/default-group", requireAccount, (req, res) => {
  try {
    const defaultGroupId = setDefaultFavoriteGroupId(getPrincipalId(req), req.body?.groupId);
    res.json({ defaultGroupId });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get("/api/favorites", requireAccount, (req, res) => {
  const group = req.query.group;
  res.json(getUserFavorites(getPrincipalId(req), group || "all"));
});

app.post("/api/favorites/groups", requireAccount, (req, res) => {
  try {
    const group = createFavoriteGroup(getPrincipalId(req), req.body?.name);
    res.status(201).json(group);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.patch("/api/favorites/groups/:id", requireAccount, (req, res) => {
  try {
    const group = renameFavoriteGroup(getPrincipalId(req), req.params.id, req.body?.name);
    if (!group) {
      res.status(404).json({ error: "收藏分组不存在" });
      return;
    }
    res.json(group);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.delete("/api/favorites/groups/:id", requireAccount, (req, res) => {
  try {
    if (!deleteFavoriteGroup(getPrincipalId(req), req.params.id)) {
      res.status(404).json({ error: "收藏分组不存在" });
      return;
    }
    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.put("/api/favorites/:articleId", requireAccount, (req, res) => {
  try {
    const favorite = updateUserFavorite(getPrincipalId(req), req.params.articleId, {
      groupId: req.body?.groupId,
      note: req.body?.note
    });
    if (!favorite) {
      res.status(404).json({ error: "该文献尚未收藏" });
      return;
    }
    res.json(favorite);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get("/api/articles/:id/enrich", async (req, res) => {
  const article = getArticle(req.params.id);
  if (!article) {
    res.status(404).json({ error: "Article not found" });
    return;
  }

  const requestedFields = String(req.query.fields || "abstract,keywords")
    .split(",")
    .map((field) => field.trim().toLowerCase())
    .filter((field) => field === "abstract" || field === "keywords");
  const missingFields = [...new Set(requestedFields.length ? requestedFields : ["abstract", "keywords"])]
    .filter((field) => !String(article[field] || "").trim());

  // Return early when the requested metadata is already cached. In
  // particular, an existing abstract must not trigger another crawler call
  // just because keywords are still missing.
  if (!missingFields.length) {
    res.json(getArticleForUser(req.params.id, getPrincipalId(req)));
    return;
  }

  try {
    const details = await crawlArticleDetails(article, { fields: missingFields });
    updateArticleDetails(req.params.id, details);
    res.json(getArticleForUser(req.params.id, getPrincipalId(req)));
  } catch (error) {
    const partial = error.details ? updateArticleDetails(req.params.id, error.details) : article;
    const responseArticle = getArticleForUser(req.params.id, getPrincipalId(req)) || partial;
    const hasPartialMetadata = missingFields.some((field) =>
      String(partial?.[field] || "").trim() && !String(article?.[field] || "").trim()
    );
    if (hasPartialMetadata) {
      res.json({ ...responseArticle, enrichment_error: error.message });
      return;
    }
    res.status(502).json({ error: error.message, article: responseArticle });
  }
});

app.post("/api/articles/:id/translate", async (req, res) => {
  const requestedTarget = String(req.body?.targetLanguage || "zh").trim().toLowerCase();
  if (requestedTarget !== "zh" && requestedTarget !== "zh-cn") {
    res.status(400).json({ error: "当前仅支持英文翻译为中文" });
    return;
  }
  const targetLanguage = "zh";

  const article = getArticle(req.params.id);
  if (!article) {
    res.status(404).json({ error: "Article not found" });
    return;
  }

  try {
    const result = await ensureTranslation(article, targetLanguage);
    res.json(result.translation || {});
  } catch (error) {
    res.status(502).json({ error: error.message });
  }
});

app.post("/api/refresh", requireSiteAdmin, asyncHandler(async (req, res) => {
  const result = await refreshArticles();
  res.status(result.status === "error" ? 400 : 200).json(result);
}));

app.post("/api/enrich-keywords", requireSiteAdmin, async (req, res) => {
  const runId = createRefreshRun({ taskType: "keywords" });
  try {
    const result = await enrichMissingKeywords();
    const gaps = getMetadataGaps();
    finishRefreshRun(runId, {
      status: result.failed ? (result.enriched ? "partial" : "error") : "success",
      abstractCount: result.enrichedAbstracts,
      keywordCount: result.enriched,
      failedAbstractCount: result.failedAbstracts,
      failedKeywordCount: result.failed,
      remainingAbstractCount: gaps.abstracts,
      remainingKeywordCount: gaps.keywords,
      message: `新增文献 0 篇 · 补全摘要 ${result.enrichedAbstracts || 0} 篇 · 补全关键词 ${result.enriched || 0} 篇 · 新增翻译 0 篇 · 失败：文献 0 / 摘要 ${result.failedAbstracts || 0} / 关键词 ${result.failed || 0} / 翻译 0 · 待补全：摘要 ${gaps.abstracts} 篇 / 关键词 ${gaps.keywords} 篇`
    });
    res.json({ status: result.failed ? (result.enriched ? "partial" : "error") : "success", ...result });
  } catch (error) {
    finishRefreshRun(runId, { status: "error", message: `补全关键词失败：${error.message}` });
    res.status(500).json({ status: "error", message: error.message });
  }
});

app.post("/api/enrich-abstracts", requireSiteAdmin, async (req, res) => {
  const runId = createRefreshRun({ taskType: "abstracts" });
  try {
    const result = await enrichMissingAbstracts();
    const gaps = getMetadataGaps();
    finishRefreshRun(runId, {
      status: result.failed ? (result.enriched ? "partial" : "error") : "success",
      abstractCount: result.enriched,
      keywordCount: result.enrichedKeywords,
      failedAbstractCount: result.failed,
      failedKeywordCount: result.failedKeywords,
      remainingAbstractCount: gaps.abstracts,
      remainingKeywordCount: gaps.keywords,
      message: `新增文献 0 篇 · 补全摘要 ${result.enriched || 0} 篇 · 补全关键词 ${result.enrichedKeywords || 0} 篇 · 新增翻译 0 篇 · 失败：文献 0 / 摘要 ${result.failed || 0} / 关键词 ${result.failedKeywords || 0} / 翻译 0 · 待补全：摘要 ${gaps.abstracts} 篇 / 关键词 ${gaps.keywords} 篇`
    });
    res.json({ status: result.failed ? (result.enriched ? "partial" : "error") : "success", ...result });
  } catch (error) {
    finishRefreshRun(runId, { status: "error", message: `补全摘要失败：${error.message}` });
    res.status(500).json({ status: "error", message: error.message });
  }
});

app.post("/api/enrich-metadata", requireSiteAdmin, asyncHandler(async (req, res) => {
  const runId = createRefreshRun({ taskType: "metadata" });
  const formatMessage = (summary, remaining, running = true) =>
    `摘要 +${summary.enrichedAbstracts || 0} · 关键词 +${summary.enrichedKeywords || 0} · `
    + `失败：摘要 ${summary.failedAbstracts || 0} / 关键词 ${summary.failedKeywords || 0} · `
    + `待补全：摘要 ${remaining.abstracts || 0} / 关键词 ${remaining.keywords || 0}`
    + (running ? " · 处理中" : "");
  const updateProgress = ({ summary, gaps }) => {
    updateRefreshRunSummary(runId, {
      abstractCount: summary.enrichedAbstracts,
      keywordCount: summary.enrichedKeywords,
      failedAbstractCount: summary.failedAbstracts,
      failedKeywordCount: summary.failedKeywords,
      remainingAbstractCount: gaps.abstracts,
      remainingKeywordCount: gaps.keywords,
      message: formatMessage(summary, gaps)
    });
  };

  try {
    const result = await enrichAllMissingMetadata({ onProgress: updateProgress });
    const status = result.complete
      ? "success"
      : (result.enrichedAbstracts || result.enrichedKeywords ? "partial" : "error");
    const message = formatMessage(result, result.remaining, false);
    finishRefreshRun(runId, {
      status,
      abstractCount: result.enrichedAbstracts,
      keywordCount: result.enrichedKeywords,
      failedAbstractCount: result.failedAbstracts,
      failedKeywordCount: result.failedKeywords,
      remainingAbstractCount: result.remaining.abstracts,
      remainingKeywordCount: result.remaining.keywords,
      message
    });
    res.json({ status, ...result, message });
  } catch (error) {
    finishRefreshRun(runId, { status: "error", message: `摘要和关键词补全失败：${error.message}` });
    throw error;
  }
}));

app.post("/api/admin/translate", requireSiteAdmin, asyncHandler(async (req, res) => {
  const field = String(req.body?.field || "").trim().toLowerCase();
  if (!["title", "abstract"].includes(field)) {
    res.status(400).json({ error: "只支持标题或摘要翻译" });
    return;
  }
  // `batchSize` is how many articles one round takes; `maxBatches` lets the
  // administrator drain a backlog in a single action instead of clicking the
  // same button over and over. The loop stops on its own when a round
  // translates nothing, so a broken provider cannot be hammered.
  const limit = Math.min(Math.max(Number(req.body?.batchSize ?? req.body?.limit) || 20, 1), 200);
  const maxBatches = Math.min(Math.max(Number(req.body?.maxBatches) || 1, 1), 40);
  const runId = createRefreshRun({ taskType: field === "title" ? "translate_title" : "translate_abstract" });
  try {
    const result = await translateMissingArticles(field, "zh", limit, { maxBatches });
    const gaps = getMetadataGaps();
    const remainingTranslationCount = countArticlesMissingTranslation(field, "zh");
    const stopNote = {
      "no-progress": "（本轮无成功翻译，已提前停止，避免重复消耗请求）",
      "queue-empty": "（已无待翻译条目）",
      "queue-drained": "（已排空）",
      "batch-limit": "（达到设定轮次上限）"
    }[result.stoppedReason] || "";
    finishRefreshRun(runId, {
      status: result.failed ? (result.translated ? "partial" : "error") : "success",
      translatedCount: result.translated,
      translatedTitleCount: result.translatedTitleCount,
      translatedAbstractCount: result.translatedAbstractCount,
      translationUnitCount: result.translatedUnits,
      translationRequestCount: result.requests,
      failedTranslationCount: result.failed,
      remainingAbstractCount: gaps.abstracts,
      remainingKeywordCount: gaps.keywords,
      remainingTranslationCount,
      message: `新增文献 0 篇 · 补全摘要 0 篇 · 补全关键词 0 篇 · 新增翻译 ${result.translated || 0} 篇 · 翻译单元 ${result.translatedUnits || 0} · API 请求 ${result.requests || 0} 次 · 批次 ${result.batches || 0} 轮${stopNote} · 失败：文献 0 / 摘要 0 / 关键词 0 / 翻译 ${result.failed || 0} · 待补全：摘要 ${gaps.abstracts} 篇 / 关键词 ${gaps.keywords} 篇 · 待翻译 ${remainingTranslationCount} 篇`
    });
    res.json({ status: result.failed ? (result.translated ? "partial" : "error") : "success", ...result });
  } catch (error) {
    finishRefreshRun(runId, { status: "error", message: `翻译${field === "title" ? "标题" : "摘要"}失败：${error.message}` });
    throw error;
  }
}));

/**
 * Which translation providers actually work right now, plus how much of the
 * paid-adjacent monthly allowance has been spent. Answering this before a batch
 * is the difference between "translating" and "spending requests on a dead key".
 */
app.get("/api/admin/translate/health", requireSiteAdmin, asyncHandler(async (req, res) => {
  const providers = await probeTranslationProviders("zh");
  res.json({
    providers,
    budget: translationTencentBudget(),
    baiduBudget: translationBaiduBudget(),
    notice: translationBudgetNotice(),
    order: translationProvidersInUse()
  });
}));

/**
 * One-click maintenance. The heavy loop runs detached from the request, so the
 * dashboard gets an immediate 202 with a snapshot it can poll — a drain of a few
 * thousand records would otherwise sit inside one HTTP response for an hour.
 */
app.post("/api/admin/maintenance", requireSiteAdmin, (req, res) => {
  const task = String(req.body?.task || "").trim();
  const result = startMaintenance(task);
  if (!result.started) {
    const unknown = result.reason === "unknown-task";
    res.status(unknown ? 400 : 409).json({
      ...result,
      error: unknown ? "不支持的任务类型" : "已有补全任务在运行，请等它结束或先停止"
    });
    return;
  }
  res.status(202).json(result);
});

app.get("/api/admin/maintenance", requireSiteAdmin, (req, res) => {
  res.json({ state: getMaintenanceState() });
});

app.post("/api/admin/maintenance/stop", requireSiteAdmin, (req, res) => {
  res.json(requestMaintenanceStop());
});

app.get("/api/settings", (req, res) => {
  const userId = getPrincipalId(req);
  res.json(getUserSettings(userId));
});

app.put("/api/settings", requireAccount, (req, res) => {
  const userId = getPrincipalId(req);
  const settings = updateUserSettings(userId, req.body);
  rescheduleRefresh();
  res.json(settings);
});

app.get("/api/journals", (req, res) => {
  res.json(DEFAULT_JOURNALS);
});

app.get("/api/keyword-stats", (req, res) => {
  res.json(getKeywordStats(req.query));
});

app.get("/api/keyword-cooccurrence", (req, res) => {
  res.json(getKeywordCooccurrence(req.query));
});

app.get("/api/status", (req, res) => {
  const userId = getPrincipalId(req);
  const status = getUserStatus(userId);
  res.json({
    ...status,
    hasApiKey: Boolean(config.ieeeApiKey),
    hasEmailConfig: Boolean(config.smtp.host && config.smtp.to && config.smtp.from),
    publicDataSources: config.publicDataSources,
    hasPublicDataSources: config.publicDataSources.length > 0
  });
});

app.post("/api/digests/weekly", asyncHandler(async (req, res) => {
  const result = await generateWeeklyDigestMarkdown(getSettings());
  res.json(result);
}));

app.post("/api/digests/weekly/email", requireAccount, asyncHandler(async (req, res) => {
  const settings = getSettings();
  const digest = await generateWeeklyDigestMarkdown(settings);
  const sent = await sendMarkdownDigestEmail(digest.filePath, {
    fileName: digest.filePath.split(/[\\/]/).pop(),
    subject: digest.subject,
    bodyMarkdown: digest.emailBodyMarkdown,
    recipients: settings.emailRecipients
  });
  const { emailBodyMarkdown, ...result } = digest;
  res.json({ ...result, sent });
}));

// New push endpoint
app.post("/api/push/send", requireAccount, asyncHandler(async (req, res) => {
  const userId = getPrincipalId(req);
  const userEmail = getUserEmail(userId);
  const settings = getUserSettings(userId);
  const recipients = userEmail?.email ? [userEmail.email] : settings.emailRecipients;
  if (!recipients?.length) {
    return res.status(400).json({ error: "请先配置收件人邮箱" });
  }
  
  const pushDays = calculatePushDays(settings.pushFrequency);
  const digest = await generateWeeklyDigestMarkdown(settings, { days: pushDays });
  
  const emailOptions = {
    subject: digest.subject,
    bodyMarkdown: digest.emailBodyMarkdown,
    recipients
  };
  
  if (settings.pushIncludeFile !== false) {
    emailOptions.filePath = digest.filePath;
    emailOptions.fileName = digest.filePath.split(/[\\/]/).pop();
  } else {
    emailOptions.attachFile = false;
  }
  
  const sent = await sendMarkdownDigestEmail(digest.filePath, emailOptions);
  const { emailBodyMarkdown, ...result } = digest;
  res.json({ ...result, sent });
}));

// ── Helper ──
function getClientIp(req) {
  return req.ip?.replace("::ffff:", "") || "unknown";
}

function getActivePassportClaims(req) {
  const claims = req.passportClaims || getPassportClaims(req);
  if (claims) req.passportClaims = claims;
  return claims;
}

function getActiveUserClaims(req) {
  const claims = getUserClaims(req);
  const session = claims && getActiveUserSession(claims.sessionId, claims.accountId);
  if (!claims || !session) return null;
  // Bind the bearer token to the IP that created the session. This prevents a
  // copied token from silently becoming a second active IP for the account.
  if (session.login_ip !== getClientIp(req)) return null;
  touchUserSession(claims.sessionId);
  return claims;
}

function requirePassport(req, res, next) {
  const claims = getActivePassportClaims(req);
  if (!claims) {
    res.status(401).json({ error: "请输入网页通行证" });
    return;
  }
  next();
}

function requireAccount(req, res, next) {
  const claims = req.userClaims || getActiveUserClaims(req);
  if (!claims) {
    res.status(401).json({ error: "请先登录个人账户" });
    return;
  }
  req.userClaims = claims;
  next();
}

function getPrincipalId(req) {
  const claims = req.userClaims || getActiveUserClaims(req);
  return claims ? `account:${claims.accountId}` : null;
}

function getDiscussionIdentity(req) {
  const claims = req.userClaims || getActiveUserClaims(req);
  if (!claims) return null;
  const userId = `account:${claims.accountId}`;
  const publicTag = crypto.createHmac("sha256", config.adminTokenSecret || "discussion-tag")
    .update(userId)
    .digest("hex")
    .slice(0, 8)
    .toUpperCase();
  return { userId, publicTag, profile: getDiscussionProfile(userId, publicTag) };
}

function hasSiteAdminPermission(req) {
  return getActivePassportClaims(req)?.role === "admin";
}

function requireSiteAdmin(req, res, next) {
  if (!hasSiteAdminPermission(req)) {
    res.status(403).json({ error: "需要最高管理员权限" });
    return;
  }
  next();
}

function safeEqualText(value, expected) {
  const actual = Buffer.from(String(value || ""));
  const target = Buffer.from(String(expected || ""));
  return actual.length === target.length && actual.length > 0 && crypto.timingSafeEqual(actual, target);
}

function issueAccountSession(account, ip, now = Date.now()) {
  const sessionId = crypto.randomUUID();
  const expiresAt = now + config.userTokenTtlDays * 24 * 60 * 60 * 1000;
  const session = createUserSession({
    sessionId,
    accountId: account.id,
    loginIp: ip,
    role: account.role || "user",
    expiresAt,
    now
  });
  if (!session.ok) return { ...session, sessionId, expiresAt };
  return {
    ok: true,
    token: createUserToken(account.id, sessionId, expiresAt, now),
    sessionId,
    expiresAt
  };
}

function buildAccountResponse(req) {
  const claims = getActiveUserClaims(req);
  const passport = getActivePassportClaims(req);
  if (!claims) {
    return {
      authenticated: false,
      can_register: getUserAccountCount() < config.maxPersonalAccounts,
      username: "",
      role: "guest",
      is_admin: passport?.role === "admin",
      passport_authenticated: Boolean(passport),
      passport_role: passport?.role || ""
    };
  }
  const account = getUserAccountById(claims.accountId);
  if (!account) return { authenticated: false, can_register: getUserAccountCount() < config.maxPersonalAccounts, username: "", role: "guest", is_admin: passport?.role === "admin", passport_authenticated: Boolean(passport), passport_role: passport?.role || "" };
  return {
    ...getUserProfile(`account:${account.id}`),
    authenticated: true,
    can_register: false,
    username: account.username,
    role: account.role || "user",
    is_admin: passport?.role === "admin",
    passport_authenticated: Boolean(passport),
    passport_role: passport?.role || "",
    preferences_updated_at: account.preferences_updated_at,
    session_ip: getActiveUserSession(claims.sessionId, claims.accountId)?.login_ip || ""
  };
}

// ── User Identity ──
app.get("/api/me", (req, res) => {
  res.json({
    userId: getPrincipalId(req),
    authenticated: Boolean(getActiveUserClaims(req)),
    is_admin: hasSiteAdminPermission(req),
    passport_role: getActivePassportClaims(req)?.role || ""
  });
});

app.get("/api/account", (req, res) => {
  res.json(buildAccountResponse(req));
});

app.put("/api/account", requireAccount, (req, res) => {
  const email = String(req.body?.email ?? "").trim();
  const name = String(req.body?.name ?? "").trim();
  const enrollmentYear = Number(req.body?.enrollment_year);
  const degree = String(req.body?.degree ?? "").trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({ error: "请输入有效的邮箱地址" });
    return;
  }
  if (name.length > 40) {
    res.status(400).json({ error: "姓名不能超过 40 个字符" });
    return;
  }
  if (req.body?.enrollment_year !== undefined && req.body?.enrollment_year !== "" && (!Number.isInteger(enrollmentYear) || enrollmentYear < 1980 || enrollmentYear > new Date().getFullYear() + 1)) {
    res.status(400).json({ error: "请输入有效的入学年份" });
    return;
  }
  if (degree && !["硕士", "博士"].includes(degree)) {
    res.status(400).json({ error: "学历只能选择硕士或博士" });
    return;
  }
  updateUserProfile(`account:${req.userClaims.accountId}`, {
    email,
    name,
    enrollment_year: enrollmentYear,
    degree
  });
  res.json(buildAccountResponse(req));
});

const userLoginAttempts = new Map();

app.post("/api/gate/login", (req, res) => {
  const passport = String(req.body?.passport || "");
  const role = safeEqualText(passport, config.adminPassport)
    ? "admin"
    : safeEqualText(passport, config.userPassport)
      ? "user"
      : "";
  if (!role) {
    res.status(401).json({ error: "网页通行证错误" });
    return;
  }
  const now = Date.now();
  const expiresAt = now + config.passportTokenTtlHours * 60 * 60 * 1000;
  res.json({
    token: createPassportToken(role, now),
    role,
    isAdmin: role === "admin",
    expiresAt: new Date(expiresAt).toISOString()
  });
});

app.get("/api/gate/session", (req, res) => {
  const passport = getActivePassportClaims(req);
  res.json({
    authenticated: Boolean(passport),
    role: passport?.role || "",
    isAdmin: passport?.role === "admin",
    expiresAt: passport ? new Date(Number(passport.exp)).toISOString() : null
  });
});

app.post("/api/auth/register", (req, res) => {
  const username = String(req.body?.username || "").trim();
  const password = String(req.body?.password || "");
  const ip = getClientIp(req);
  if (!/^[\p{L}\p{N}_-]{3,32}$/u.test(username)) {
    res.status(400).json({ error: "用户名须为 3 至 32 个字符，可使用文字、数字、下划线或短横线" });
    return;
  }
  if (password.length < 8 || password.length > 72) {
    res.status(400).json({ error: "密码长度须为 8 至 72 个字符" });
    return;
  }
  const credentials = hashUserPassword(password);
  let account;
  try {
    account = createUserAccount({ username, passwordHash: credentials.hash, passwordSalt: credentials.salt, registeredIp: ip });
  } catch (error) {
    const message = String(error.message || "");
    res.status(409).json({ error: message.includes("上限") ? message : "该用户名已被使用或账户无法创建" });
    return;
  }
  const session = issueAccountSession(account, ip);
  if (!session.ok) {
    deleteUserAccount(account.id);
    res.status(409).json({ error: session.reason === "active_ip_limit" ? "当前同时登录 IP 已达到 20 个上限" : "当前 IP 无法登录该账户" });
    return;
  }
  res.status(201).json({
    token: session.token,
    expiresAt: new Date(session.expiresAt).toISOString(),
    account: {
      ...getUserProfile(`account:${account.id}`),
      authenticated: true,
      can_register: false,
      username: account.username,
      role: "user",
      is_admin: hasSiteAdminPermission(req),
      passport_authenticated: true,
      passport_role: getActivePassportClaims(req)?.role || "user",
      preferences_updated_at: account.preferences_updated_at
    }
  });
});

app.post("/api/auth/login", (req, res) => {
  const username = String(req.body?.username || "").trim();
  const password = String(req.body?.password || "");
  const ip = getClientIp(req);
  const now = Date.now();
  const recent = (userLoginAttempts.get(ip) || []).filter((time) => now - time < 15 * 60 * 1000);
  if (recent.length >= 8) {
    res.status(429).json({ error: "登录尝试过多，请 15 分钟后再试" });
    return;
  }
  const account = getUserAccountByUsername(username);
  if (!account || !verifyUserPassword(password, account.password_salt, account.password_hash)) {
    userLoginAttempts.set(ip, [...recent, now]);
    res.status(401).json({ error: "用户名或密码错误" });
    return;
  }
  userLoginAttempts.delete(ip);
  const session = issueAccountSession(account, ip, now);
  if (!session.ok) {
    const error = session.reason === "active_ip_limit"
      ? "当前同时登录 IP 已达到 20 个上限"
      : "当前 IP 无法登录该个人账户";
    res.status(409).json({ error });
    return;
  }
  res.json({
    token: session.token,
    username: account.username,
    expiresAt: new Date(session.expiresAt).toISOString(),
    sessionLimit: 1
  });
});

app.get("/api/auth/session", (req, res) => {
  res.json(buildAccountResponse(req));
});

app.post("/api/auth/logout", requireAccount, (req, res) => {
  revokeUserSession(req.userClaims.sessionId);
  res.json({ ok: true });
});

app.put("/api/auth/preferences", requireAccount, (req, res) => {
  const preferences = req.body?.preferences;
  if (!preferences || typeof preferences !== "object" || Array.isArray(preferences)) {
    res.status(400).json({ error: "个性设置格式无效" });
    return;
  }
  if (JSON.stringify(preferences).length > 100000) {
    res.status(400).json({ error: "个性设置数据过大" });
    return;
  }
  res.json(saveRemotePreferences(req.userClaims.accountId, preferences));
});

app.get("/api/auth/preferences", requireAccount, (req, res) => {
  res.json(getRemotePreferences(req.userClaims.accountId));
});

// ── User Email ──
app.post("/api/user-email", requireAccount, (req, res) => {
  const userId = getPrincipalId(req);
  const email = String(req.body?.email || "").trim();
  if (!email || !email.includes("@")) {
    res.status(400).json({ error: "请输入有效的邮箱地址" });
    return;
  }
  res.json(setUserEmail(userId, email));
});

app.get("/api/user-email", requireAccount, (req, res) => {
  const userId = getPrincipalId(req);
  const record = getUserEmail(userId);
  res.json(record || { userId, email: "" });
});

app.get("/api/user-emails", requireSiteAdmin, (req, res) => {
  res.json(getAllUserEmails());
});

// ── Test Email (weekly digest to user) ──
app.post("/api/test-email", requireAccount, asyncHandler(async (req, res) => {
  const userId = getPrincipalId(req);
  const record = getUserEmail(userId);
  if (!record?.email) {
    res.status(400).json({ error: "请先填写邮箱地址" });
    return;
  }
  const settings = getUserSettings(userId);
  // For test email, use all subscribed journals without push filter
  const testSettings = { ...settings, pushFrequency: "weekly", pushJournalFilter: "" };
  const digest = await generateWeeklyDigestMarkdown(testSettings, {
    days: 7,
    limit: 20,
    maxItems: 5,
    requireComplete: true
  });
  const sent = await sendMarkdownDigestEmail(digest.filePath, {
    fileName: digest.filePath.split(/[\\/]/).pop(),
    subject: `测试`,
    bodyMarkdown: digest.emailBodyMarkdown,
    recipients: [record.email]
  });
  res.json({
    sent,
    email: record.email,
    count: digest.count,
    excludedIncompleteCount: digest.excludedIncompleteCount,
    omittedCompleteCount: digest.omittedCompleteCount
  });
}));

// ── Public Feedback ──
app.get("/api/feedback", (req, res) => {
  const identity = getDiscussionIdentity(req);
  res.json(listPublicFeedback(req.query.limit, identity?.userId || ""));
});

app.get("/api/feedback/profile", (req, res) => {
  const identity = getDiscussionIdentity(req);
  res.json(identity?.profile || { displayName: "", publicTag: "" });
});

app.put("/api/feedback/profile", requireAccount, (req, res) => {
  const identity = getDiscussionIdentity(req);
  const displayName = String(req.body?.displayName || "").trim();
  if (!displayName || displayName.length > 24) {
    res.status(400).json({ error: "发言名称须为 1 至 24 个字符" });
    return;
  }
  res.json(updateDiscussionProfile(identity.userId, identity.publicTag, displayName));
});

app.post("/api/feedback", requireAccount, (req, res) => {
  const { userId, profile } = getDiscussionIdentity(req);
  if (!profile.displayName) {
    res.status(400).json({ error: "请先设置发言名称" });
    return;
  }
  if (getRecentFeedbackCount(userId) >= 1) {
    res.status(429).json({ error: "每小时只能提交一次反馈" });
    return;
  }
  const content = String(req.body?.content || "").trim();
  if (!content) {
    res.status(400).json({ error: "反馈内容不能为空" });
    return;
  }
  if (content.length > 2000) {
    res.status(400).json({ error: "反馈内容不能超过 2000 个字符" });
    return;
  }
  res.status(201).json(addFeedback(userId, "", content, false));
});

app.post("/api/feedback/:id/comments", requireAccount, (req, res) => {
  const { userId, profile } = getDiscussionIdentity(req);
  if (!profile.displayName) {
    res.status(400).json({ error: "请先设置发言名称" });
    return;
  }
  if (getRecentFeedbackCommentCount(userId) >= 10) {
    res.status(429).json({ error: "每小时最多发布 10 条评论" });
    return;
  }
  const content = String(req.body?.content || "").trim();
  if (!content || content.length > 1000) {
    res.status(400).json({ error: "评论须为 1 至 1000 个字符" });
    return;
  }
  const comment = addFeedbackComment(req.params.id, userId, content, false);
  if (!comment) {
    res.status(404).json({ error: "讨论不存在" });
    return;
  }
  if (comment.closed) {
    res.status(409).json({ error: "话题已结束，不能继续评论" });
    return;
  }
  res.status(201).json(comment);
});

app.post("/api/feedback/:id/like", requireAccount, (req, res) => {
  const result = toggleFeedbackLike(req.params.id, getDiscussionIdentity(req).userId);
  if (!result) {
    res.status(404).json({ error: "讨论不存在" });
    return;
  }
  res.json(result);
});

app.post("/api/feedback/comments/:id/like", requireAccount, (req, res) => {
  const result = toggleFeedbackCommentLike(req.params.id, getDiscussionIdentity(req).userId);
  if (!result) {
    res.status(404).json({ error: "评论不存在" });
    return;
  }
  res.json(result);
});

app.get("/api/admin/session", (req, res) => {
  res.json({ isAdmin: hasSiteAdminPermission(req) });
});

app.get("/api/admin/overview", requireSiteAdmin, (req, res) => {
  // The remaining translation allowance ships with the overview so the admin
  // page shows it on load instead of only after running a probe. Reading it is a
  // local file lookup, so this costs nothing. The maintenance snapshot rides
  // along for the same reason: a reloaded dashboard can resume the progress bar
  // without waiting for its first poll.
  res.json({
    ...getAdminOverview(),
    translationBudget: translationTencentBudget(),
    baiduTranslationBudget: translationBaiduBudget(),
    translationProviders: translationProvidersInUse(),
    maintenance: getMaintenanceState()
  });
});

app.post("/api/admin/users", requireSiteAdmin, (req, res) => {
  const username = String(req.body?.username || "").trim();
  const password = String(req.body?.password || "");
  const name = String(req.body?.name || "").trim();
  const email = String(req.body?.email || "").trim();
  if (!/^[\p{L}\p{N}_-]{3,32}$/u.test(username)) {
    res.status(400).json({ error: "用户名须为 3 至 32 个字符，可使用文字、数字、下划线或短横线" });
    return;
  }
  if (password.length < 8 || password.length > 72) {
    res.status(400).json({ error: "密码长度须为 8 至 72 个字符" });
    return;
  }
  if (name.length > 40) {
    res.status(400).json({ error: "显示名称不能超过 40 个字符" });
    return;
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({ error: "请输入有效的邮箱地址" });
    return;
  }

  let account;
  try {
    const credentials = hashUserPassword(password);
    account = createUserAccount({
      username,
      passwordHash: credentials.hash,
      passwordSalt: credentials.salt,
      registeredIp: getClientIp(req)
    });
  } catch (error) {
    const message = String(error.message || "");
    res.status(409).json({ error: message.includes("上限") ? message : "该用户名已被使用或账户无法创建" });
    return;
  }

  if (name || email) updateUserProfile(`account:${account.id}`, { name, email });
  res.status(201).json({
    user: {
      ...getUserProfile(`account:${account.id}`),
      id: account.id,
      username: account.username,
      role: account.role || "user",
      created_at: account.created_at,
      updated_at: account.updated_at
    }
  });
});

app.delete("/api/admin/users/:id", requireSiteAdmin, (req, res) => {
  const account = getUserAccountById(req.params.id);
  if (!account) {
    res.status(404).json({ error: "用户不存在" });
    return;
  }
  if (account.role === "super_admin") {
    res.status(403).json({ error: "不能删除最高管理员账户" });
    return;
  }
  if (!deleteUserAccount(account.id)) {
    res.status(404).json({ error: "用户不存在" });
    return;
  }
  res.json({ ok: true, id: account.id });
});

app.post("/api/admin/feedback/:id/reply", requireSiteAdmin, (req, res) => {
  const reply = String(req.body?.reply || "").trim();
  if (!reply || reply.length > 2000) {
    res.status(400).json({ error: "管理员回复须为 1 至 2000 个字符" });
    return;
  }
  if (!replyFeedback(req.params.id, reply)) {
    res.status(404).json({ error: "反馈不存在" });
    return;
  }
  res.json({ ok: true });
});

app.post("/api/admin/feedback/:id/close", requireSiteAdmin, (req, res) => {
  if (!closeFeedback(req.params.id)) {
    res.status(404).json({ error: "话题不存在或已经结束" });
    return;
  }
  res.json({ ok: true });
});

app.delete("/api/admin/feedback/:id", requireSiteAdmin, (req, res) => {
  if (!deleteFeedback(req.params.id)) {
    res.status(404).json({ error: "反馈不存在" });
    return;
  }
  res.json({ ok: true });
});

app.delete("/api/admin/feedback/comments/:id", requireSiteAdmin, (req, res) => {
  if (!deleteFeedbackComment(req.params.id)) {
    res.status(404).json({ error: "评论不存在" });
    return;
  }
  res.json({ ok: true });
});

app.get("/version.json", (req, res) => {
  res.setHeader("Cache-Control", "no-cache");
  res.sendFile(path.resolve(__dirname, "../version.json"));
});

const distPath = path.resolve(__dirname, "../dist");
app.use(express.static(distPath, {
  maxAge: "1y",
  immutable: true,
  setHeaders(res, filePath) {
    if (filePath.endsWith("index.html") || filePath.endsWith("version.json")) {
      res.setHeader("Cache-Control", "no-cache");
    }
  }
}));
app.use((req, res, next) => {
  if (req.path.startsWith("/api")) {
    next();
    return;
  }
  res.setHeader("Cache-Control", "no-cache");
  res.sendFile(path.join(distPath, "index.html"));
});

scheduleRefresh();

app.listen(config.port, "0.0.0.0", () => {
  const nets = os.networkInterfaces();
  let lanIp = "127.0.0.1";
  for (const iface of Object.values(nets)) {
    for (const cfg of iface) {
      if (cfg.family === "IPv4" && !cfg.internal) { lanIp = cfg.address; break; }
    }
  }
  console.log(`电力文献服务器运行在 http://127.0.0.1:${config.port}`);
  console.log(`LAN access: http://${lanIp}:${config.port}`);
});
