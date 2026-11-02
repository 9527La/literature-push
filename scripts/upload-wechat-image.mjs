#!/usr/bin/env node
/**
 * upload-wechat-image.mjs —— 把期稿里的本地摘要图上传到微信素材库，回写 mmbiz URL
 * （DESIGN-WECHAT-TRANS-COLUMN.md v4 · 专题正文必须先过这一步才能进草稿箱）
 *
 * 背景：微信正文只认素材库域名的图（mmbiz.qpic.cn）。期稿 JSON 里 figure.path 是
 * 本地 data/figures/<id>.png，直接渲染进 HTML 后在手机上会显示白框。
 * 本脚本调 media/uploadimg 上传，拿到 url 后**原地回写**期稿 JSON，再重新渲染 HTML。
 *
 * 缓存：按文件 sha256 命中，同一张图不重复上传（跨期重跑零成本）。
 *
 * 用法：
 *   node scripts/upload-wechat-image.mjs --in data/wechat-topics/2026-10-28-issue02.json [--dry-run]
 * 之后重渲染：
 *   node scripts/wechat-topic-render.mjs --in <同一 json>
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const API = "https://api.weixin.qq.com";

function parseArgs(argv) {
  const a = {
    in: "", dryRun: false,
    cache: resolve(root, "data", "wechat-topics", "img-cache.json")
  };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === "--in") a.in = resolve(process.cwd(), argv[i += 1]);
    else if (argv[i] === "--cache") a.cache = resolve(process.cwd(), argv[i += 1]);
    else if (argv[i] === "--dry-run") a.dryRun = true;
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  if (!a.in) throw new Error("--in <issue.json> is required");
  return a;
}

function readEnv() {
  const path = resolve(root, ".env");
  if (!existsSync(path)) return new Map();
  const map = new Map();
  for (const line of String(readFileSync(path, "utf8")).split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq > 0) map.set(t.slice(0, eq).trim(), t.slice(eq + 1).trim().replace(/^["']|["']$/g, ""));
  }
  return map;
}

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

async function getToken(appid, secret) {
  const res = await fetch(`${API}/cgi-bin/stable_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ grant_type: "client_credential", appid, secret })
  });
  const data = await res.json();
  if (!data.access_token) {
    console.error(`[upload-img] ✗ 获取 access_token 失败：errcode=${data.errcode} ${data.errmsg || ""}`);
    if (data.errcode === 40164) console.error("  IP 不在白名单：公众平台「设置与开发 → 基本配置 → IP白名单」");
    process.exit(1);
  }
  return data.access_token;
}

/** media/uploadimg：正文内图片，返回可用于 <img src> 的 URL。 */
async function uploadImage(token, buf, filename) {
  const form = new FormData();
  form.append("media", new Blob([buf], { type: "image/png" }), filename);
  const res = await fetch(`${API}/cgi-bin/media/uploadimg?access_token=${encodeURIComponent(token)}`, {
    method: "POST",
    body: form
  });
  const data = await res.json();
  if (!data.url) {
    console.error(`[upload-img] ✗ 上传失败 ${filename}：errcode=${data.errcode} ${data.errmsg || ""}`);
    return null;
  }
  return String(data.url).replace(/^http:\/\//i, "https://");
}

async function main() {
  const args = parseArgs(process.argv);
  if (!existsSync(args.in)) {
    console.error(`[upload-img] ✗ 找不到期稿：${args.in}`);
    process.exit(2);
  }
  const issue = JSON.parse(readFileSync(args.in, "utf8"));
  const papers = Array.isArray(issue.papers) ? issue.papers : [];

  const targets = [];
  for (const [i, p] of papers.entries()) {
    const src = p.figure?.path || "";
    if (!src) continue;
    if (/^https:\/\/mmbiz\.qpic\.cn\//.test(src)) continue;
    const abs = resolve(root, src);
    if (!existsSync(abs)) {
      console.error(`[upload-img] ✗ papers[${i}] 图片不存在：${src}`);
      continue;
    }
    targets.push({ i, p, abs, src });
  }

  if (!targets.length) {
    console.log("[upload-img] 无需上传：所有配图已是 mmbiz URL 或未配图");
    return;
  }

  let cache = {};
  if (existsSync(args.cache)) {
    try { cache = JSON.parse(readFileSync(args.cache, "utf8")); } catch { cache = {}; }
  }

  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0") {
    console.warn("[upload-img] ⚠ NODE_TLS_REJECT_UNAUTHORIZED=0：本次 HTTPS 请求不验证证书（会话环境注入，非 .env 配置）。生产环境建议 unset。");
  }
  const env = readEnv();
  const appid = env.get("WECHAT_APPID") || "";
  const secret = env.get("WECHAT_SECRET") || "";
  if (!args.dryRun && (!appid || !secret)) {
    console.error("[upload-img] ✗ .env 缺少 WECHAT_APPID / WECHAT_SECRET");
    process.exit(2);
  }

  const token = args.dryRun ? null : await getToken(appid, secret);
  let uploaded = 0, reused = 0, failed = 0;

  for (const t of targets) {
    const buf = readFileSync(t.abs);
    const hash = sha256(buf);
    if (cache[hash]?.url) {
      t.p.figure.path = cache[hash].url;
      reused += 1;
      console.log(`[upload-img] 复用缓存 papers[${t.i}] -> ${cache[hash].url}`);
      continue;
    }
    if (args.dryRun) {
      console.log(`[upload-img] --dry-run 待上传 papers[${t.i}] ${t.src} (${(buf.length / 1024).toFixed(1)} KB)`);
      continue;
    }
    const url = await uploadImage(token, buf, `${t.p.id || t.i}.png`);
    if (!url) { failed += 1; continue; }
    cache[hash] = { url, file: t.src, uploadedAt: new Date().toISOString() };
    t.p.figure.path = url;
    uploaded += 1;
    console.log(`[upload-img] 上传 papers[${t.i}] ${t.src} -> ${url}`);
  }

  if (!args.dryRun) {
    mkdirSync(dirname(args.cache), { recursive: true });
    writeFileSync(args.cache, `${JSON.stringify(cache, null, 1)}\n`, "utf8");
    writeFileSync(args.in, `${JSON.stringify(issue, null, 1)}\n`, "utf8");
  }

  console.log(`[upload-img] 完成：上传 ${uploaded} · 复用 ${reused} · 失败 ${failed}`);
  if (uploaded || reused) {
    console.log(`[upload-img] 期稿已回写 → 重新渲染：node scripts/wechat-topic-render.mjs --in ${args.in}`);
  }
  if (failed) process.exit(1);
}

main();
