#!/usr/bin/env node
/**
 * Push a rendered issue into the WeChat Official Account draft box
 * (DESIGN-WECHAT-MP-DAILY.md L1 tier / DESIGN-WECHAT-TRANS-COLUMN.md v4).
 *
 * Chain: stable_token → (cover cached as permanent material) → draft/add；
 * 单条模式：同名草稿已存在时 draft/update 原地更新（同日重跑不产生重复条目）。
 * 双图文模式（--extra）：头条=日报，次条=专题，**一次 draft/add 传 articles[2]**，
 *   粉丝端表现为「今天」下面两条（头条大图 + 次条右侧缩略图）。
 *   draft/update 只能替换指定 index 的单篇、无法追加，故双图文重跑时先 draft/delete 再 add。
 * Publishing (freepublish) is NOT attempted — personal-subscription accounts
 * lost that permission in 2025-07; a human taps "publish" in the assistant app.
 *
 * Requirements:
 *   - .env at repo root: WECHAT_APPID / WECHAT_SECRET (never committed)
 *   - the public account backend must whitelist the outbound IP
 *     (both local machine and the SC host share 121.248.206.12, fixed line)
 *   - issue JSON rendered first (wechat-render.mjs / wechat-topic-render.mjs + probe)
 *   - 专题正文的摘要图必须先经 upload-wechat-image.mjs 换成 mmbiz URL
 *
 * Usage:
 *   node scripts/publish-wechat-draft.mjs --in data/wechat-drafts/2026-10-08.json
 *   node scripts/publish-wechat-draft.mjs --in data/wechat-drafts/2026-10-29.json \
 *        --extra data/wechat-topics/2026-10-29-issue02.json
 */
import { readFileSync, existsSync, writeFileSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { renderCover } from "./make-wechat-cover.mjs";
import { COLUMN_NAME } from "./wechat-column.config.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const API = "https://api.weixin.qq.com";
const AUTHOR = "电研新视界";
const MAX_TITLE = 64;

function parseArgs(argv) {
  const args = { in: "", extra: "", cover: resolve(root, "assets/wechat-cover.png"), dryRun: false };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === "--in") args.in = resolve(process.cwd(), argv[i += 1]);
    else if (argv[i] === "--extra") args.extra = resolve(process.cwd(), argv[i += 1]);
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
    throw new Error(`${htmlPath} 缺少 WECHAT-ARTICLE 标记，请用对应渲染器重新渲染`);
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

/**
 * 封面上传为永久素材并缓存 thumb_media_id。
 * 缓存按 key 区分（日报=期号日，专题=vol），跨期自动重新生成 PNG 并上传，同 key 重跑复用。
 */
async function ensureThumb(token, { coverPath, cachePath, key, variant, date, title, vol, count }) {
  if (existsSync(cachePath)) {
    try {
      const cached = JSON.parse(readFileSync(cachePath, "utf8"));
      if (cached.key === key && cached.media_id) {
        console.log(`[publish-wechat-draft] 封面复用缓存 media_id=${cached.media_id}（${variant} ${key}）`);
        return cached.media_id;
      }
    } catch { /* 缓存损坏则重新生成上传 */ }
  }
  await renderCover(date, coverPath, { variant, title, vol, count });
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
  writeFileSync(cachePath, `${JSON.stringify({ key, variant, media_id: data.media_id, source: coverPath, size, uploadedAt: new Date().toISOString() }, null, 2)}\n`, "utf8");
  console.log(`[publish-wechat-draft] 封面（${variant} ${key}）已上传永久素材 media_id=${data.media_id}`);
  return data.media_id;
}

/** 查最近 20 条草稿中的同名草稿（按任意一篇的标题命中）；查询失败按“未找到”处理。 */
async function findDraftByTitle(token, title) {
  try {
    const data = await postJson(`${API}/cgi-bin/draft/batchget?access_token=${encodeURIComponent(token)}`, {
      offset: 0,
      count: 20,
      no_content: 1
    });
    if (data.errcode || !Array.isArray(data.item)) return null;
    const matches = [];
    for (const entry of data.item) {
      for (const article of entry.content?.news_item || []) {
        if (article.title === title) {
          matches.push({ mediaId: entry.media_id, updateTime: Number(entry.update_time) || 0 });
        }
      }
    }
    matches.sort((a, b) => b.updateTime - a.updateTime);
    return matches[0]?.mediaId || null;
  } catch {
    return null;
  }
}

function buildDailyArticle(issue, htmlPath, thumbMediaId) {
  const title = String(issue.title || "").trim();
  if (!title) {
    // §8.5.0 标题契约（2026-10-28 起）：title 必填且每期自拟，缺失直接失败（2026-10-29 起不再回退模板）
    fail("TITLE", "issue.title 缺失——禁止回退模板标题「电研新视界 日报｜日期」（平台会判定标题模板化并限流）；请在 issue JSON 补自拟 title（规则见 RUNBOOK §8.5.0）");
  }
  if (title.length > MAX_TITLE) fail("TITLE", `标题超 ${MAX_TITLE} 字：${title.length}`);
  return {
    title,
    author: AUTHOR,
    digest: String(issue.digest || "").slice(0, 120),
    content: articleContent(htmlPath),
    thumb_media_id: thumbMediaId,
    content_source_url: String(issue.siteUrl || "https://lhmktz.top"),
    need_open_comment: 0,
    only_fans_can_comment: 0
  };
}

function buildTopicArticle(issue, htmlPath, thumbMediaId) {
  const column = COLUMN_NAME;
  const title = `${column} Vol.${String(issue.vol || 1).padStart(3, "0")}｜${issue.topic || ""}`;
  if (title.length > MAX_TITLE) fail("TITLE", `专题标题超 ${MAX_TITLE} 字：${title.length}`);
  const content = articleContent(htmlPath);
  if (/src="data\/figures\//.test(content)) {
    fail("IMG", "专题正文仍含本地图片路径，先跑 scripts/upload-wechat-image.mjs 换成 mmbiz URL");
  }
  return {
    title,
    author: AUTHOR,
    digest: String(issue.digest || "").slice(0, 120),
    content,
    thumb_media_id: thumbMediaId,
    content_source_url: String(issue.siteUrl || "https://lhmktz.top"),
    need_open_comment: 0,
    only_fans_can_comment: 0
  };
}

async function main() {
  const args = parseArgs(process.argv);
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0") {
    console.warn("[publish-wechat-draft] ⚠ NODE_TLS_REJECT_UNAUTHORIZED=0：本次 HTTPS 请求不验证证书（会话环境注入，非 .env 配置）。生产环境建议 unset。");
  }
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
    console.error(`[publish-wechat-draft] ✗ 未找到渲染产物 ${htmlPath}——先跑渲染器 + 探针`);
    process.exit(2);
  }
  const issue = JSON.parse(readFileSync(issuePath, "utf8"));

  // 期稿类型：带 papers 数组的是专题期稿，否则按日报处理
  const isTopic = Array.isArray(issue.papers) && issue.papers.length > 0;
  const kind = isTopic ? "topic" : "daily";

  let extra = null;
  let extraHtml = "";
  if (args.extra) {
    if (isTopic) {
      console.error("[publish-wechat-draft] ✗ --extra 只能配日报使用（头条日报 + 次条专题）；专题单发请直接用 --in");
      process.exit(2);
    }
    extraHtml = args.extra.replace(/\.json$/i, ".html");
    if (!existsSync(args.extra) || !existsSync(extraHtml)) {
      console.error(`[publish-wechat-draft] ✗ --extra 需要成对的 .json 与 .html：${args.extra}`);
      process.exit(2);
    }
    extra = JSON.parse(readFileSync(args.extra, "utf8"));
  }

  const mainTitle = isTopic
    ? `${COLUMN_NAME} Vol.${String(issue.vol || 1).padStart(3, "0")}｜${issue.topic || ""}`
    : String(issue.title || "").trim();
  if (!isTopic && !mainTitle) {
    fail("TITLE", "issue.title 缺失——禁止回退模板标题「电研新视界 日报｜日期」（平台会判定标题模板化并限流）；请在 issue JSON 补自拟 title（规则见 RUNBOOK §8.5.0）");
  }
  if (!isTopic && issue.date && !mainTitle.endsWith(`【日报 ${issue.date}】`)) {
    fail("TITLE", `标题缺少日期后缀「【日报 ${issue.date}】」（§8.5.0 v16：内容钩子+【日报 日期】）`);
  }
  const topicTitle = extra
    ? `${COLUMN_NAME} Vol.${String(extra.vol || 1).padStart(3, "0")}｜${extra.topic || ""}`
    : "";

  console.log(`[publish-wechat-draft] 类型=${kind} 标题=${mainTitle}`);
  if (extra) console.log(`[publish-wechat-draft] 次条=${topicTitle}（${extra.papers?.length || 0} 篇）`);

  if (args.dryRun) {
    // dry-run 也要跑一遍组装，把标题长度、正文标记、图片域名等问题提前暴露
    const dryMain = isTopic
      ? buildTopicArticle(issue, htmlPath, "DRY_RUN_THUMB")
      : buildDailyArticle(issue, htmlPath, "DRY_RUN_THUMB");
    console.log(`  主条：正文 ${dryMain.content.length} 字符 · digest ${dryMain.digest.length} 字`);
    if (extra) {
      const dryTopic = buildTopicArticle(extra, extraHtml, "DRY_RUN_THUMB");
      console.log(`  次条：正文 ${dryTopic.content.length} 字符 · digest ${dryTopic.digest.length} 字`);
    }
    console.log("[publish-wechat-draft] --dry-run：参数与产物校验通过，未调用微信 API");
    return;
  }

  const token = await getAccessToken(appid, secret);

  const mainThumb = isTopic
    ? await ensureThumb(token, {
        coverPath: resolve(root, "assets", "wechat-cover-topic.png"),
        cachePath: resolve(root, "data", "wechat-drafts", "cover-thumb-topic.json"),
        key: `vol${issue.vol || 1}:${issue.topic || ""}`, variant: "topic", date: issue.date,
        title: issue.topic, vol: issue.vol, count: issue.papers.length
      })
    : await ensureThumb(token, {
        coverPath: args.cover,
        cachePath: resolve(root, "data", "wechat-drafts", "cover-thumb.json"),
        key: issue.date, variant: "daily", date: issue.date
      });

  const articles = [
    isTopic ? buildTopicArticle(issue, htmlPath, mainThumb) : buildDailyArticle(issue, htmlPath, mainThumb)
  ];

  if (extra) {
    const topicThumb = await ensureThumb(token, {
      coverPath: resolve(root, "assets", "wechat-cover-topic.png"),
      cachePath: resolve(root, "data", "wechat-drafts", "cover-thumb-topic.json"),
      key: `vol${extra.vol || 1}:${extra.topic || ""}`, variant: "topic", date: extra.date,
      title: extra.topic, vol: extra.vol, count: extra.papers?.length
    });
    articles.push(buildTopicArticle(extra, extraHtml, topicThumb));
  }

  const existingMediaId = await findDraftByTitle(token, mainTitle);

  if (!extra) {
    // 单条：保持原有原地更新语义（日报、专题都适用）
    if (existingMediaId) {
      const updated = await postJson(`${API}/cgi-bin/draft/update?access_token=${encodeURIComponent(token)}`, {
        media_id: existingMediaId,
        index: 0,
        articles: articles[0]
      });
      if (!updated.errcode) {
        console.log(`[publish-wechat-draft] ✓ 已原地更新同名草稿 media_id=${existingMediaId}`);
        console.log(`[publish-wechat-draft] 下一步：手机「订阅号助手」→ 预览 → 点发表${articles.length > 1 ? "（每天 1 次额度，两条一起发）" : "（群发每天 1 次；专题也可在后台点「发布」，不占额度）"}。`);
        return;
      }
      console.error(`[publish-wechat-draft] 同名草稿更新失败（errcode=${updated.errcode}），回退为新增草稿`);
    }
  } else if (existingMediaId) {
    // 双图文：draft/update 无法追加条目，先删同名草稿再重建
    const del = await postJson(`${API}/cgi-bin/draft/delete?access_token=${encodeURIComponent(token)}`, { media_id: existingMediaId });
    if (!del.errcode) {
      console.log(`[publish-wechat-draft] 已删除同名旧草稿 media_id=${existingMediaId}（双图文重跑，避免草稿箱重复）`);
    } else {
      console.error(`[publish-wechat-draft] 删除旧草稿失败（errcode=${del.errcode}），将新增一份，草稿箱可能出现重复条目`);
    }
  }

  const draft = await postJson(`${API}/cgi-bin/draft/add?access_token=${encodeURIComponent(token)}`, { articles });
  if (!draft.media_id) fail(draft.errcode || "?", `写入草稿箱失败：${draft.errmsg || "unknown"}`);
  console.log(`[publish-wechat-draft] ✓ 草稿已写入 media_id=${draft.media_id}（${articles.length} 条图文）`);
  console.log(`[publish-wechat-draft] 下一步：手机「订阅号助手」→ 预览 → 点发表${articles.length > 1 ? "（每天 1 次额度，两条一起发）" : "（群发每天 1 次；专题也可在后台点「发布」，不占额度）"}。`);
}

main();
