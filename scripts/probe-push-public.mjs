/**
 * 用已注册的临时账户，走公网域名再跑一次 POST /api/push/send，
 * 看 Cloudflare 是否在 ~100s 处把它掐断（524）。最后删除临时账户。
 *
 * 用法：node scripts/probe-push-public.mjs <username> <password>
 */

import fs from "node:fs";

function readEnvPassport() {
  try {
    const env = fs.readFileSync(".env", "utf8");
    const m = env.match(/^ADMIN_PASSPORT\s*=\s*(.*)$/m);
    if (m && m[1].trim()) return m[1].trim().replace(/^["']|["']$/g, "");
  } catch { /* .env is required; see README deployment section */ }
  console.error("通行证缺失：请在仓库根目录 .env 配置 ADMIN_PASSPORT（代码中不允许硬编码通行证）");
  process.exit(2);
}
const DOMAIN = "https://lhmktz.top";
const LAN = "http://192.168.31.233:4177";
const [username, password] = process.argv.slice(2);

async function raw(url, { method = "GET", headers = {}, body } = {}) {
  const started = Date.now();
  try {
    const response = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json", ...headers } : headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20 * 60 * 1000)
    });
    const text = await response.text();
    return { status: response.status, ms: Date.now() - started, text };
  } catch (error) {
    return { status: 0, ms: Date.now() - started, text: `[fetch 异常] ${error.message}` };
  }
}

const gate = await raw(`${DOMAIN}/api/gate/login`, { method: "POST", body: { passport: readEnvPassport() } });
if (gate.status !== 200) { console.log(`通行证失败：${gate.status} ${gate.text.slice(0, 200)}`); process.exit(1); }
const token = JSON.parse(gate.text).token;

const login = await raw(`${DOMAIN}/api/auth/login`, { method: "POST", headers: { "X-Passport-Token": token }, body: { username, password } });
console.log(`登录（公网）：${login.status} ${login.ms}ms`);
if (login.status !== 200) { console.log(login.text.slice(0, 300)); process.exit(1); }
const userToken = JSON.parse(login.text).token;

const headers = { "X-Passport-Token": token, "X-User-Token": userToken };
const account = await raw(`${DOMAIN}/api/account`, { headers });
console.log(`GET /api/account（公网）：${account.status} ${account.ms}ms`);
const accountData = JSON.parse(account.text);
console.log(`  字段：${Object.keys(accountData).join(", ")}`);
console.log(`  id=${accountData.id} user_id=${accountData.user_id} username=${accountData.username}`);

console.log("\n>>> 公网 POST /api/push/send（与页面点击完全相同，只换了域名）");
const push = await raw(`${DOMAIN}/api/push/send`, { method: "POST", headers });
console.log(`<<< status=${push.status} 耗时=${(push.ms / 1000).toFixed(1)}s`);
console.log(`   响应体开头：${push.text.slice(0, 240)}`);

// `/api/account` 返回的是 getUserProfile 的形态：只有 `user_id`（account:5），没有数字 id。
const id = String(accountData.user_id || "").replace(/^account:/, "");
if (id) {
  const del = await raw(`${LAN}/api/admin/users/${id}`, { method: "DELETE", headers: { "X-Passport-Token": token } });
  console.log(`\n清理临时账户 #${id}：status=${del.status}`);
} else {
  console.log("\n未取到账户 id，临时账户需手工删除");
}
