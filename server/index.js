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
  getRecentFeedbackCount,
  addFeedback
} from "./db.js";
import { crawlArticleDetails } from "./crawler.js";
import { translateArticle } from "./translate.js";
import { refreshArticles, rescheduleRefresh, scheduleRefresh, enrichMissingKeywords } from "./refresh.js";
import { generateWeeklyDigestMarkdown } from "./digest.js";
import { sendMarkdownDigestEmail } from "./mail.js";
import { escapeHtml, calculatePushDays } from "./utils.js";

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

app.get("/api/user-emails", (req, res) => {
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
  const testSettings = { ...settings, pushJournalFilter: "" };
  const digest = await generateWeeklyDigestMarkdown(testSettings, { days: 7, limit: 1 });
  const sent = await sendMarkdownDigestEmail(digest.filePath, {
    fileName: digest.filePath.split(/[\\/]/).pop(),
    subject: `测试`,
    bodyMarkdown: digest.emailBodyMarkdown,
    recipients: [record.email]
  });
  res.json({ sent, email: record.email });
}));

// ── Feedback ──
app.post("/api/feedback", async (req, res) => {
  const userId = getClientIp(req);
  const record = getUserEmail(userId);
  if (!record?.email) {
    res.status(400).json({ error: "请先填写周报接收邮箱" });
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
  const fb = addFeedback(userId, record.email, content);
  // Send feedback email to admin
  try {
    const { createTransporter } = await import("./mail.js");
    // inline: use nodemailer directly
    const nodemailer = await import("nodemailer");
    const { config: cfg } = await import("./config.js");
    if (cfg.smtp.host && cfg.smtp.from && cfg.smtp.user && cfg.smtp.pass) {
      const transporter = nodemailer.default.createTransport({
        host: cfg.smtp.host,
        port: cfg.smtp.port,
        secure: cfg.smtp.secure,
        auth: { user: cfg.smtp.user, pass: cfg.smtp.pass }
      });
      await transporter.sendMail({
        from: cfg.smtp.from,
        to: cfg.smtp.to || cfg.smtp.from,
        subject: `【意见反馈】来自 ${escapeHtml(record.email)}`,
        html: `<div style="font-family:Arial,sans-serif;line-height:1.6;">
          <h3>用户反馈</h3>
          <p><strong>邮箱：</strong>${escapeHtml(record.email)}</p>
          <p><strong>IP：</strong>${escapeHtml(userId)}</p>
          <p><strong>时间：</strong>${escapeHtml(new Date().toLocaleString("zh-CN"))}</p>
          <hr/>
          <p>${escapeHtml(content).replace(/\n/g, "<br/>")}</p>
        </div>`
      });
    }
  } catch (emailErr) {
    console.error("[feedback] email failed:", emailErr.message);
  }
  res.json(fb);
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
