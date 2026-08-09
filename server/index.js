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
  getRecentFeedbackCount,
  addFeedback,
  listPublicFeedback,
  replyFeedback,
  deleteFeedback
} from "./db.js";
import { createAdminToken, passwordMatches, requireAdmin, verifyAdminToken } from "./admin.js";
import { crawlArticleDetails } from "./crawler.js";
import { translateArticle } from "./translate.js";
import { refreshArticles, rescheduleRefresh, scheduleRefresh, enrichMissingKeywords } from "./refresh.js";
import { generateWeeklyDigestMarkdown } from "./digest.js";
import { sendMarkdownDigestEmail } from "./mail.js";
import { calculatePushDays } from "./utils.js";

const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

app.use(cors({ origin: config.clientOrigin }));
app.use(express.json());

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

app.get("/api/articles", (req, res) => {
  const userId = getClientIp(req);
  res.json(listArticles(req.query, userId));
});

app.post("/api/articles/:id/read", (req, res) => {
  const userId = getClientIp(req);
  const isRead = setArticleReadForUser(userId, Number(req.params.id));
  res.json({ ok: true, isRead: Boolean(isRead) });
});

app.post("/api/articles/:id/favorite", (req, res) => {
  const userId = getClientIp(req);
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

app.post("/api/refresh", asyncHandler(async (req, res) => {
  const result = await refreshArticles();
  res.status(result.status === "error" ? 400 : 200).json(result);
}));

app.post("/api/enrich-keywords", async (req, res) => {
  try {
    const result = await enrichMissingKeywords();
    res.json({ status: "success", ...result });
  } catch (error) {
    res.status(500).json({ status: "error", message: error.message });
  }
});

app.get("/api/settings", (req, res) => {
  const userId = getClientIp(req);
  res.json(getUserSettings(userId));
});

app.put("/api/settings", (req, res) => {
  const userId = getClientIp(req);
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
  const userId = getClientIp(req);
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
  const userId = getClientIp(req);
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
  return req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket.remoteAddress?.replace("::ffff:", "") || "unknown";
}

// ── User Identity ──
app.get("/api/me", (req, res) => {
  res.json({ userId: getClientIp(req) });
});

app.get("/api/account", (req, res) => {
  res.json(getUserProfile(getClientIp(req)));
});

app.put("/api/account", (req, res) => {
  const email = String(req.body?.email ?? "").trim();
  const name = String(req.body?.name ?? "").trim();
  const grade = String(req.body?.grade ?? "").trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({ error: "请输入有效的邮箱地址" });
    return;
  }
  if (name.length > 40 || grade.length > 40) {
    res.status(400).json({ error: "姓名和年级均不能超过 40 个字符" });
    return;
  }
  res.json(updateUserProfile(getClientIp(req), {
    email,
    name,
    grade,
    show_bilingual_titles: req.body?.show_bilingual_titles
  }));
});

// ── User Email ──
app.post("/api/user-email", (req, res) => {
  const userId = getClientIp(req);
  const email = String(req.body?.email || "").trim();
  if (!email || !email.includes("@")) {
    res.status(400).json({ error: "请输入有效的邮箱地址" });
    return;
  }
  res.json(setUserEmail(userId, email));
});

app.get("/api/user-email", (req, res) => {
  const userId = getClientIp(req);
  const record = getUserEmail(userId);
  res.json(record || { userId, email: "" });
});

app.get("/api/user-emails", requireAdmin, (req, res) => {
  res.json(getAllUserEmails());
});

// ── Test Email (weekly digest to user) ──
app.post("/api/test-email", asyncHandler(async (req, res) => {
  const userId = getClientIp(req);
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
  res.json(listPublicFeedback(req.query.limit));
});

app.post("/api/feedback", (req, res) => {
  const userId = getClientIp(req);
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
  res.status(201).json(addFeedback(userId, profile.email || "", content));
});

const adminLoginAttempts = new Map();

app.post("/api/admin/login", (req, res) => {
  if (!config.adminPassword || !config.adminTokenSecret) {
    res.status(503).json({ error: "管理员密码尚未配置" });
    return;
  }
  const clientId = getClientIp(req);
  const now = Date.now();
  const recent = (adminLoginAttempts.get(clientId) || []).filter((time) => now - time < 15 * 60 * 1000);
  if (recent.length >= 5) {
    res.status(429).json({ error: "登录尝试过多，请 15 分钟后再试" });
    return;
  }
  if (!passwordMatches(req.body?.password)) {
    adminLoginAttempts.set(clientId, [...recent, now]);
    res.status(401).json({ error: "管理员密码错误" });
    return;
  }
  adminLoginAttempts.delete(clientId);
  res.json({ token: createAdminToken(), expiresInHours: config.adminTokenTtlHours });
});

app.get("/api/admin/session", (req, res) => {
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  res.json({ isAdmin: verifyAdminToken(token) });
});

app.post("/api/admin/feedback/:id/reply", requireAdmin, (req, res) => {
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

app.delete("/api/admin/feedback/:id", requireAdmin, (req, res) => {
  if (!deleteFeedback(req.params.id)) {
    res.status(404).json({ error: "反馈不存在" });
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
