import nodemailer from "nodemailer";
import { config } from "./config.js";
import { escapeHtml } from "./utils.js";

let cachedTransporter = null;

function getTransporter() {
  if (!cachedTransporter) {
    cachedTransporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: { user: config.smtp.user, pass: config.smtp.pass }
    });
  }
  return cachedTransporter;
}

export function canSendEmail(settings = {}) {
  const recipients = settings.emailRecipients?.length ? settings.emailRecipients.join(",") : config.smtp.to;
  return Boolean(config.smtp.host && recipients && config.smtp.from && config.smtp.user && config.smtp.pass);
}

function buildDigestMailOptions(filePath, options = {}) {
  const recipients = options.recipients?.length ? options.recipients.join(",") : config.smtp.to;
  const bodyMarkdown = options.bodyMarkdown || "# 电力文献周报\n\n完整文献周报见附件。";
  const attachmentPath = options.attachFile === false ? "" : (options.filePath || filePath || "");
  return {
    from: config.smtp.from,
    to: recipients,
    subject: options.subject || "电力文献周报",
    text: bodyMarkdown,
    html: `<div style="font-family:Arial,'Microsoft YaHei',sans-serif;line-height:1.6;max-width:900px;margin:0 auto;padding:20px"><pre style="white-space:pre-wrap;background:#f6f8fa;padding:16px;border:1px solid #ddd;border-radius:6px;font-size:13px">${escapeHtml(bodyMarkdown)}</pre></div>`,
    attachments: attachmentPath
      ? [{ filename: options.fileName || attachmentPath.split(/[\\/]/).pop(), path: attachmentPath }]
      : []
  };
}

export async function sendMarkdownDigestEmail(filePath, options = {}) {
  if (!canSendEmail({ emailRecipients: options.recipients })) return false;
  await getTransporter().sendMail(buildDigestMailOptions(filePath, options));
  return true;
}

export async function sendNewArticlesEmail(articles, settings = {}) {
  if (!articles.length || !canSendEmail(settings)) return false;
  const body = articles.slice(0, 30).map((article, index) =>
    `${index + 1}. ${article.title}\n${article.journal || ""}\n${article.url || ""}`
  ).join("\n\n");
  await getTransporter().sendMail({
    from: config.smtp.from,
    to: settings.emailRecipients?.length ? settings.emailRecipients.join(",") : config.smtp.to,
    subject: `电力文献更新：${articles.length} 篇新文献`,
    text: body
  });
  return true;
}

export async function sendWeeklyDigestEmail(items, settings = {}, options = {}) {
  if (!items.length || !canSendEmail(settings)) return false;
  const body = items.map(({ article, translation }, index) => [
    `${index + 1}. ${article.title}`,
    translation?.title || "",
    article.journal || "",
    article.abstract || "暂无摘要",
    translation?.abstract || "",
    article.url || ""
  ].filter(Boolean).join("\n")).join("\n\n---\n\n");
  return sendMarkdownDigestEmail("", {
    subject: `电力文献周报：${items.length} 篇新论文`,
    bodyMarkdown: body,
    recipients: settings.emailRecipients,
    attachFile: false,
    ...options
  });
}

export const internals = { buildDigestMailOptions };
