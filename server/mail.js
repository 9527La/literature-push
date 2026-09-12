import nodemailer from "nodemailer";
import { config } from "./config.js";
import { escapeHtml } from "./utils.js";

let cachedTransporter = null;

/**
 * Shared visual language with the web app. Email clients ignore external CSS,
 * flexbox and SVG, so the shell is built from nested tables with inline styles and
 * the brand mark is reproduced with borders rather than an image.
 */
const BRAND = {
  accent: "#3157d5",
  ink: "#171b24",
  body: "#525a68",
  muted: "#7d8592",
  line: "#e3e7ee",
  page: "#f2f4f7",
  surface: "#ffffff",
  soft: "#f4f5f7",
  tint: "#eff3fa",
  tintInk: "#185fa5"
};

const FONT = "'Microsoft YaHei','PingFang SC',Arial,sans-serif";

function brandMarkCell(size = 28) {
  const arch = Math.round(size * 0.42);
  return `<td width="${size}" valign="middle" style="width:${size}px;padding-right:10px">
    <div style="width:${size}px;height:${size}px;border-radius:${Math.round(size * 0.26)}px;background:${BRAND.accent};text-align:center">
      <div style="display:inline-block;width:${arch}px;height:${arch}px;border:2px solid #ffffff;border-bottom:0;border-radius:1px 1px 0 0;margin-top:${Math.round(size * 0.24)}px"></div>
      <div style="width:${Math.round(size * 0.62)}px;height:2px;background:#ffffff;margin:2px auto 0"></div>
    </div>
  </td>`;
}

function renderInlineMarkdown(text) {
  return escapeHtml(text).replace(/\*\*([^*]+)\*\*/g, `<strong style="color:${BRAND.ink}">$1</strong>`);
}

/**
 * The digest body is a small, fixed markdown subset (#/##/### headings, "- "
 * bullets, "---" rules, **bold**). Converting it here beats shipping a `<pre>`
 * blob: the email becomes a readable brief instead of a wall of monospace.
 */
function renderMarkdownFragment(markdown) {
  const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let listOpen = false;
  const closeList = () => {
    if (listOpen) {
      out.push("</ul>");
      listOpen = false;
    }
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      closeList();
      continue;
    }
    if (/^-{3,}$/.test(line)) {
      closeList();
      out.push(`<hr style="border:0;border-top:1px solid ${BRAND.line};margin:20px 0" />`);
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      closeList();
      const level = heading[1].length;
      const size = level === 1 ? 20 : level === 2 ? 16 : 14;
      out.push(`<h${level} style="margin:${level === 1 ? "0 0 12px" : "22px 0 8px"};font-size:${size}px;font-weight:700;color:${BRAND.ink};line-height:1.4">${renderInlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }
    if (line.startsWith("- ")) {
      if (!listOpen) {
        out.push(`<ul style="margin:6px 0 12px;padding-left:20px;color:${BRAND.body}">`);
        listOpen = true;
      }
      out.push(`<li style="margin:0 0 4px;font-size:14px;line-height:1.7">${renderInlineMarkdown(line.slice(2))}</li>`);
      continue;
    }
    closeList();
    out.push(`<p style="margin:0 0 12px;font-size:14px;line-height:1.75;color:${BRAND.body}">${renderInlineMarkdown(line)}</p>`);
  }
  closeList();
  return out.join("\n");
}

function renderDigestEmailHtml(bodyMarkdown, options = {}) {
  const subject = options.subject || "电力文献周报";
  const stamp = new Date().toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
  return `<div style="margin:0;padding:24px 12px;background:${BRAND.page};font-family:${FONT}">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:760px;margin:0 auto;border-collapse:collapse">
    <tr>
      <td style="background:${BRAND.surface};border:1px solid ${BRAND.line};border-radius:12px 12px 0 0;padding:16px 22px">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr>
            ${brandMarkCell(28)}
            <td valign="middle">
              <div style="font-size:15px;font-weight:700;color:${BRAND.ink};line-height:1.3">电力文献</div>
              <div style="font-size:12px;color:${BRAND.muted};line-height:1.4">${escapeHtml(subject)}</div>
            </td>
            <td valign="middle" align="right" style="font-size:12px;color:${BRAND.muted};white-space:nowrap">${stamp}</td>
          </tr>
        </table>
      </td>
    </tr>
    <tr>
      <td style="background:${BRAND.surface};border-left:1px solid ${BRAND.line};border-right:1px solid ${BRAND.line};padding:22px">
        ${renderMarkdownFragment(bodyMarkdown)}
      </td>
    </tr>
    <tr>
      <td style="background:${BRAND.soft};border:1px solid ${BRAND.line};border-top:0;border-radius:0 0 12px 12px;padding:14px 22px;font-size:12px;line-height:1.7;color:${BRAND.muted}">
        由「电力文献」订阅系统自动发送，仅供课题组内部参考。引用前请回到原文页面核对标题、作者与出版信息。
      </td>
    </tr>
  </table>
</div>`;
}

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
    html: renderDigestEmailHtml(bodyMarkdown, options),
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
  const subject = `电力文献更新：${articles.length} 篇新文献`;
  const shown = articles.slice(0, 30);
  const body = shown.map((article, index) =>
    `${index + 1}. ${article.title}\n${article.journal || ""}\n${article.url || ""}`
  ).join("\n\n");
  const bodyMarkdown = shown.map((article, index) => [
    `### ${index + 1}. ${article.title}`,
    [article.journal, article.published_at].filter(Boolean).join(" · "),
    article.url || ""
  ].filter(Boolean).join("\n")).join("\n\n---\n\n");
  await getTransporter().sendMail({
    from: config.smtp.from,
    to: settings.emailRecipients?.length ? settings.emailRecipients.join(",") : config.smtp.to,
    subject,
    text: body,
    html: renderDigestEmailHtml(bodyMarkdown, { subject })
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

export const internals = { buildDigestMailOptions, renderDigestEmailHtml, renderMarkdownFragment };
