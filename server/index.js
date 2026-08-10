import express from "express";
import cors from "cors";
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
  getStatus,
  getTranslation,
  getKeywordStats,
  getKeywordCooccurrence,
  listArticles,
  saveTranslation,
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
  isUserAccountAdmin,
  hasUserAccountForIp,
  createUserAccount,
  getAdminOverview,
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
  deleteFeedbackComment
} from "./db.js";
import { createUserToken, getUserClaims, hashUserPassword, requireUser, verifyUserPassword } from "./user-auth.js";
import { crawlArticleDetails } from "./crawler.js";
import { translateArticle } from "./translate.js";
import { refreshArticles, rescheduleRefresh, scheduleRefresh, enrichMissingKeywords } from "./refresh.js";
import { generateWeeklyDigestMarkdown } from "./digest.js";
import { sendMarkdownDigestEmail } from "./mail.js";
import { calculatePushDays } from "./utils.js";
import { createArticlePreparationService } from "./prepare.js";

const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

app.use(cors({ origin: config.clientOrigin }));
app.use(express.json());

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const pagePrepareConcurrency = config.translationProvider === "baidu"
  || (config.translationProvider === "auto" && config.baiduTranslateAppId && config.baiduTranslateKey)
  ? 1
  : config.pagePrepareConcurrency;
const articlePreparation = createArticlePreparationService({
  getArticle,
  updateArticleDetails,
  crawlArticleDetails,
  getTranslation,
  saveTranslation,
  translateArticle
}, {
  concurrency: pagePrepareConcurrency,
  maxItems: config.pagePrepareMaxItems
});

app.get("/api/articles", (req, res) => {
  const userId = getPrincipalId(req);
  res.json(listArticles(req.query, userId));
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

app.post("/api/articles/:id/read", (req, res) => {
  const userId = getPrincipalId(req);
  const isRead = setArticleReadForUser(userId, Number(req.params.id));
  res.json({ ok: true, isRead: Boolean(isRead) });
});

app.post("/api/articles/:id/favorite", (req, res) => {
  const userId = getPrincipalId(req);
  const article = toggleArticleFavoriteForUser(userId, Number(req.params.id));
  if (!article) {
    res.status(404).json({ error: "Article not found" });
    return;
  }
  res.json(article);
});

app.get("/api/articles/:id/enrich", async (req, res) => {
  const article = getArticle(req.params.id);
  if (!article) {
    res.status(404).json({ error: "Article not found" });
    return;
  }

  // Return early if both abstract and keywords are already present
  if (article.abstract && article.keywords) {
    res.json(article);
    return;
  }

  try {
    const details = await crawlArticleDetails(article);
    res.json(updateArticleDetails(req.params.id, details));
  } catch (error) {
    res.status(502).json({ error: error.message, article });
  }
});

app.post("/api/articles/:id/translate", async (req, res) => {
  const targetLanguage = req.body?.targetLanguage || "zh";
  if (!["zh", "en"].includes(targetLanguage)) {
    res.status(400).json({ error: "targetLanguage must be zh or en" });
    return;
  }

  const article = getArticle(req.params.id);
  if (!article) {
    res.status(404).json({ error: "Article not found" });
    return;
  }

  const cached = getTranslation(req.params.id, targetLanguage);
  if (cached) {
    res.json(cached);
    return;
  }

  try {
    const translation = await translateArticle(article, targetLanguage);
    res.json(saveTranslation(req.params.id, targetLanguage, translation));
  } catch (error) {
    res.status(502).json({ error: error.message });
  }
});

app.post("/api/refresh", requireSiteAdmin, asyncHandler(async (req, res) => {
  const result = await refreshArticles();
  res.status(result.status === "error" ? 400 : 200).json(result);
}));

app.post("/api/enrich-keywords", requireSiteAdmin, async (req, res) => {
  try {
    const result = await enrichMissingKeywords();
    res.json({ status: "success", ...result });
  } catch (error) {
    res.status(500).json({ status: "error", message: error.message });
  }
});

app.get("/api/settings", (req, res) => {
  const userId = getPrincipalId(req);
  res.json(getUserSettings(userId));
});

app.put("/api/settings", (req, res) => {
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

app.post("/api/digests/weekly/email", asyncHandler(async (req, res) => {
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
app.post("/api/push/send", asyncHandler(async (req, res) => {
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
  return req.socket.remoteAddress?.replace("::ffff:", "") || "unknown";
}

function getPrincipalId(req) {
  const claims = getUserClaims(req);
  return claims ? `account:${claims.accountId}` : getClientIp(req);
}

function hasSiteAdminPermission(req) {
  const claims = getUserClaims(req);
  return Boolean(claims && isUserAccountAdmin(claims.accountId));
}

function requireSiteAdmin(req, res, next) {
  if (!hasSiteAdminPermission(req)) {
    res.status(403).json({ error: "需要最高管理员权限" });
    return;
  }
  next();
}

function buildAccountResponse(req) {
  const claims = getUserClaims(req);
  const ip = getClientIp(req);
  if (!claims) {
    return {
      ...getUserProfile(ip),
      authenticated: false,
      can_register: !hasUserAccountForIp(ip),
      username: "",
      role: "guest",
      is_admin: false
    };
  }
  const account = getUserAccountById(claims.accountId);
  if (!account) return { ...getUserProfile(ip), authenticated: false, can_register: !hasUserAccountForIp(ip), username: "", role: "guest", is_admin: false };
  return {
    ...getUserProfile(`account:${account.id}`),
    authenticated: true,
    can_register: false,
    username: account.username,
    role: account.role || "user",
    is_admin: account.role === "super_admin",
    preferences_updated_at: account.preferences_updated_at
  };
}

// ── User Identity ──
app.get("/api/me", (req, res) => {
  res.json({ userId: getPrincipalId(req), authenticated: Boolean(getUserClaims(req)), is_admin: hasSiteAdminPermission(req) });
});

app.get("/api/account", (req, res) => {
  res.json(buildAccountResponse(req));
});

app.put("/api/account", requireUser, (req, res) => {
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
  if (!Number.isInteger(enrollmentYear) || enrollmentYear < 1980 || enrollmentYear > new Date().getFullYear() + 1) {
    res.status(400).json({ error: "请输入有效的入学年份" });
    return;
  }
  if (!["硕士", "博士"].includes(degree)) {
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
  if (hasUserAccountForIp(ip)) {
    res.status(409).json({ error: "当前 IP 已注册过账户，每个 IP 只能注册一个账户" });
    return;
  }
  if (getUserAccountByUsername(username)) {
    res.status(409).json({ error: "该用户名已被使用" });
    return;
  }
  const credentials = hashUserPassword(password);
  try {
    const account = createUserAccount({ username, passwordHash: credentials.hash, passwordSalt: credentials.salt, registeredIp: ip });
    const token = createUserToken(account.id);
    res.status(201).json({
      token,
      account: {
        ...getUserProfile(`account:${account.id}`),
        authenticated: true,
        can_register: false,
        username: account.username,
        role: account.role || "user",
        is_admin: account.role === "super_admin",
        preferences_updated_at: account.preferences_updated_at
      }
    });
  } catch (error) {
    res.status(409).json({ error: error.message?.includes("registered_ip") ? "当前 IP 已注册过账户" : "用户名已被使用" });
  }
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
  res.json({ token: createUserToken(account.id), username: account.username, expiresInDays: config.userTokenTtlDays });
});

app.get("/api/auth/session", (req, res) => {
  res.json(buildAccountResponse(req));
});

app.put("/api/auth/preferences", requireUser, (req, res) => {
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

app.get("/api/auth/preferences", requireUser, (req, res) => {
  res.json(getRemotePreferences(req.userClaims.accountId));
});

// ── User Email ──
app.post("/api/user-email", (req, res) => {
  const userId = getPrincipalId(req);
  const email = String(req.body?.email || "").trim();
  if (!email || !email.includes("@")) {
    res.status(400).json({ error: "请输入有效的邮箱地址" });
    return;
  }
  res.json(setUserEmail(userId, email));
});

app.get("/api/user-email", (req, res) => {
  const userId = getPrincipalId(req);
  const record = getUserEmail(userId);
  res.json(record || { userId, email: "" });
});

app.get("/api/user-emails", requireSiteAdmin, (req, res) => {
  res.json(getAllUserEmails());
});

// ── Test Email (weekly digest to user) ──
app.post("/api/test-email", asyncHandler(async (req, res) => {
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
  res.json(listPublicFeedback(req.query.limit, getPrincipalId(req)));
});

app.post("/api/feedback", (req, res) => {
  const userId = getPrincipalId(req);
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
  const profile = getUserProfile(userId);
  const isAnonymous = !getUserClaims(req) || Boolean(req.body?.anonymous);
  res.status(201).json(addFeedback(userId, profile.email || "", content, isAnonymous));
});

app.post("/api/feedback/:id/comments", (req, res) => {
  const userId = getPrincipalId(req);
  if (getRecentFeedbackCommentCount(userId) >= 10) {
    res.status(429).json({ error: "每小时最多发布 10 条评论" });
    return;
  }
  const content = String(req.body?.content || "").trim();
  if (!content || content.length > 1000) {
    res.status(400).json({ error: "评论须为 1 至 1000 个字符" });
    return;
  }
  const isAnonymous = !getUserClaims(req) || Boolean(req.body?.anonymous);
  const comment = addFeedbackComment(req.params.id, userId, content, isAnonymous);
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

app.post("/api/feedback/:id/like", (req, res) => {
  const result = toggleFeedbackLike(req.params.id, getPrincipalId(req));
  if (!result) {
    res.status(404).json({ error: "讨论不存在" });
    return;
  }
  res.json(result);
});

app.post("/api/feedback/comments/:id/like", (req, res) => {
  const result = toggleFeedbackCommentLike(req.params.id, getPrincipalId(req));
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
  res.json(getAdminOverview());
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
  res.sendFile(path.resolve(__dirname, "../version.json"));
});

const distPath = path.resolve(__dirname, "../dist");
app.use(express.static(distPath));
app.use((req, res, next) => {
  if (req.path.startsWith("/api")) {
    next();
    return;
  }
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
