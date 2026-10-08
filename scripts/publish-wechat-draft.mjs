#!/usr/bin/env node
/**
 * Push a rendered daily issue into the WeChat Official Account draft box
 * (DESIGN-WECHAT-MP-DAILY.md L1 tier, M4 acceptance).
 *
 * Chain: stable_token → (cover cached as permanent material) → draft/add.
 * Publishing (freepublish) is NOT attempted — personal-subscription accounts
 * lost that permission in 2025-07; a human taps "publish" in the assistant app.
 *
 * Requirements:
 *   - .env at repo root: WECHAT_APPID / WECHAT_SECRET (never committed)
 *   - the public account backend must whitelist the outbound IP
 *     (both local machine and the SC host share 121.248.206.12, fixed line)
 *   - the issue JSON must be rendered first (wechat-render.mjs + probe)
 *
 * Usage:
 *   node scripts/publish-wechat-draft.mjs --in data/wechat-drafts/2026-10-08.json
 */
import { readFileSync, existsSync, writeFileSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { renderCover } from "./make-wechat-cover.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const API = "https://api.weixin.qq.com";

function parseArgs(argv) {
  const args = { in: "", cover: resolve(root, "assets/wechat-cover.png"), dryRun: false };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === "--in") args.in = resolve(process.cwd(), argv[i += 1]);
    else if (argv[i] === "--cover") args.cover = resolve(process.cwd(), argv[i += 1]);
    else if (argv[i] === "--dry-run") args.dryRun = true;
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  if (!args.in) throw new Error("--in <issue.json> is required");
  return args;
}

/** 极简 .env 解析（KEY=VALUE，# 注释；与 server 侧 readEnv* 同约定：文件必须存在）。 */
function readEnv() {
  const path = resolve(root, ".env");
  const map = new Map();
  for (const line of String(readFileSync(path, "utf8")).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq > 0) map.set(trimmed.slice(0, eq).trim(), trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, ""));
  }
  return map;
}

/** 提取 WECHAT-ARTICLE 标记之间的正文（draft/add 的 content 只接受正文片段）。 */
function articleContent(htmlPath) {
  const html = String(readFileSync(htmlPath, "utf8"));
  const start = html.indexOf("<!-- WECHAT-ARTICLE-START -->");
  const end = html.indexOf("<!-- WECHAT-ARTICLE-END -->");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`${htmlPath} 缺少 WECHAT-ARTICLE 标记，请用 scripts/wechat-render.mjs 重新渲染`);
  }
  return html.slice(start + "<!-- WECHAT-ARTICLE-START -->".length, end).trim();
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return response.json();
}

function fail(code, message) {
  console.error(`[publish-wechat-draft] ✗ ${message}（errcode=${code}）`);
  if (code === 48001) {
    console.error("  该账号无此接口权限（个人/未认证主体受限）。草稿 API 不可用时按 SOP 回退 L0 网页端粘贴发布。");
  } else if (code === 40001 || code === 40013 || code === 40125) {
    console.error("  AppID/AppSecret 不正确，或 AppSecret 已被重置——请到公众平台「设置与开发 → 基本配置」核对。");
  } else if (code === 40164) {
    console.error(`  IP 不在白名单：请到公众平台「设置与开发 → 基本配置 → IP白名单」加入出口 IP（当前宽带出口 121.248.206.12）。`);
  } else if (code === 42001) {
    console.error("  access_token 过期（瞬时），重跑本脚本即可。");
  }
  process.exit(1);
}

async function getAccessToken(appid, secret) {
  const data = await postJson(`${API}/cgi-bin/stable_token`, {
    grant_type: "client_credential",
    appid,
    secret
  });
  if (!data.access_token) fail(data.errcode || "?", `获取 access_token 失败：${data.errmsg || "unknown"}`);
  return data.access_token;
}

/** 封面上传为永久素材并缓存 thumb_media_id。封面含当日日期（PLAN-DAILY-UPGRADE）→
 *  每期不同：缓存键 = 期号日，跨期自动重新生成 PNG 并上传；同日重跑复用，不重复上传。 */
async function ensureThumb(token, coverPath, issueDate) {
  const cachePath = resolve(dirname(coverPath), "..", "data", "wechat-drafts", "cover-thumb.json");
  if (existsSync(cachePath)) {
    try {
      const cached = JSON.parse(readFileSync(cachePath, "utf8"));
      if (cached.date === issueDate && cached.media_id) {
        console.log(`[publish-wechat-draft] 封面复用缓存 media_id=${cached.media_id}（date=${issueDate}）`);
        return cached.media_id;
      }
    } catch { /* 缓存损坏则重新生成上传 */ }
  }
  await renderCover(issueDate, coverPath);
  const buf = readFileSync(coverPath);
  const size = statSync(coverPath).size;
  const form = new FormData();
  form.append("media", new Blob([buf], { type: "image/png" }), "cover.png");
  const response = await fetch(`${API}/cgi-bin/material/add_material?access_token=${encodeURIComponent(token)}&type=image`, {
    method: "POST",
    body: form
  });
  const data = await response.json();
  if (!data.media_id) fail(data.errcode || "?", `上传封面永久素材失败：${data.errmsg || "unknown"}`);
  writeFileSync(cachePath, `${JSON.stringify({ media_id: data.media_id, date: issueDate, source: coverPath, size, uploadedAt: new Date().toISOString() }, null, 2)}\n`, "utf8");
  console.log(`[publish-wechat-draft] 封面（${issueDate}）已上传永久素材 media_id=${data.media_id}（缓存于 ${cachePath}）`);
  return data.media_id;
}

async function main() {
  const args = parseArgs(process.argv);
  const env = readEnv();
  const appid = env.get("WECHAT_APPID") || "";
  const secret = env.get("WECHAT_SECRET") || "";
  if (!appid || !secret) {
    console.error("[publish-wechat-draft] ✗ .env 缺少 WECHAT_APPID / WECHAT_SECRET（公众平台「设置与开发 → 基本配置」获取，勿提交进 git）");
    process.exit(2);
  }

  const issuePath = args.in;
  const htmlPath = issuePath.replace(/\.json$/i, ".html");
  if (!existsSync(htmlPath)) {
    console.error(`[publish-wechat-draft] ✗ 未找到渲染产物 ${htmlPath}——先跑 wechat-render.mjs + probe-wechat-html.mjs`);
    process.exit(2);
  }
  const issue = JSON.parse(readFileSync(issuePath, "utf8"));
  const title = `电研新视界 日报｜${issue.date}`;
  if (title.length > 64) fail("TITLE", `标题超 64 字：${title.length}`);
  const content = articleContent(htmlPath);
  const digest = String(issue.digest || "").slice(0, 120);

  console.log(`[publish-wechat-draft] issue=${issue.date} title=${title} digest=${digest.length}字 content=${content.length}字符`);
  if (args.dryRun) {
    console.log("[publish-wechat-draft] --dry-run：校验通过，未调用微信 API");
    return;
  }

  const token = await getAccessToken(appid, secret);
  const thumbMediaId = await ensureThumb(token, args.cover, issue.date);

  const draft = await postJson(`${API}/cgi-bin/draft/add?access_token=${encodeURIComponent(token)}`, {
    articles: [{
      title,
      author: "电研新视界",
      digest,
      content,
      thumb_media_id: thumbMediaId,
      content_source_url: String(issue.siteUrl || "https://lhmktz.top"),
      need_open_comment: 0,
      only_fans_can_comment: 0
    }]
  });
  if (!draft.media_id) fail(draft.errcode || "?", `写入草稿箱失败：${draft.errmsg || "unknown"}`);
  console.log(`[publish-wechat-draft] ✓ 草稿已写入 media_id=${draft.media_id}`);
  console.log("[publish-wechat-draft] 下一步：手机「订阅号助手」App 或公众平台后台「草稿箱」→ 预览到手机确认 → 点发表（每天 1 次额度）。");
}

main();
