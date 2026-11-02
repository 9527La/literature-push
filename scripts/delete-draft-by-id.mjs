#!/usr/bin/env node
/**
 * delete-draft-by-id.mjs —— 一次性：按 media_id 删除草稿箱草稿（draft/delete）。
 * 用途：Vol.003 改标题后删除旧标题草稿（publish-wechat-draft 只按标题匹配删除）。
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const API = "https://api.weixin.qq.com";

function readEnv() {
  const path = resolve(root, ".env");
  const text = readFileSync(path, "utf8");
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 0) continue;
    env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
  return env;
}

const env = readEnv();
const mediaId = process.argv[2];
if (!mediaId) { console.error("用法: node scripts/delete-draft-by-id.mjs <media_id>"); process.exit(2); }

async function postJson(url, body) {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return r.json();
}

const tok = await postJson(`${API}/cgi-bin/stable_token`, { grant_type: "client_credential", appid: env.WECHAT_APPID, secret: env.WECHAT_SECRET });
if (!tok.access_token) { console.error("token 获取失败", tok.errcode, tok.errmsg); process.exit(1); }

const del = await postJson(`${API}/cgi-bin/draft/delete?access_token=${encodeURIComponent(tok.access_token)}`, { media_id: mediaId });
console.log(JSON.stringify(del));
if (del.errcode === 0) console.log("✓ 草稿已删除:", mediaId);
else { console.error("删除失败"); process.exit(1); }
