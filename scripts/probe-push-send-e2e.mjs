/**
 * 复现「立即发送」的完整链路并计时。
 *
 * 步骤（全部针对线上服务）：
 *   1. 通行证登录
 *   2. 注册一个临时个人账户
 *   3. PUT /api/settings —— 复制主账户(account:1)的推送设置：
 *      pushEnabled=true / pushFrequency=weekly / pushJournalFilter="" / 摘要+关键词+翻译+附件全开
 *   4. POST /api/user-email   —— 写一个不可投递的探针邮箱（避免打扰真实收件箱）
 *   5. POST /api/push/send    —— 与页面上点「立即发送」完全相同的请求，计时
 *   6. 打印结果里的 enrichmentAttemptCount / translationAttemptCount / count
 *
 * 用法：node scripts/probe-push-send-e2e.mjs http://192.168.31.233:4177
 *      node scripts/probe-push-send-e2e.mjs http://192.168.31.233:4177 --keep   # 不删临时账户
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

const base = (process.argv[2] || "http://192.168.31.233:4177").replace(/\/$/, "");
const keep = process.argv.includes("--keep");
const probeEmail = "probe-nonexistent@example.com";

const env = (() => {
  try {
    return Object.fromEntries(fs.readFileSync(new URL("../.env", import.meta.url), "utf8")
      .split(/\r?\n/).filter((line) => line.includes("=") && !line.trim().startsWith("#"))
      .map((line) => [line.slice(0, line.indexOf("=")).trim(), line.slice(line.indexOf("=") + 1).trim()]));
  } catch { return {}; }
})();

async function call(path, { method = "GET", token, body, userToken } = {}) {
  const headers = {};
  if (token) headers["X-Passport-Token"] = token;
  if (userToken) headers["X-User-Token"] = userToken;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(`${base}${path}`, {
    method, headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30 * 60 * 1000)
  });
  const text = await response.text();
  let data = null;
  try { data = JSON.parse(text); } catch { data = text.slice(0, 200); }
  if (!response.ok) throw Object.assign(new Error(`${response.status} ${typeof data === "string" ? data : data.error}`), { status: response.status });
  return data;
}

const gate = await call("/api/gate/login", { method: "POST", body: { passport: env.ADMIN_PASSPORT || readEnvPassport() } });
const token = gate.token;
console.log(`通行证 OK（role=${gate.role}）`);

const username = `zzprobe${Date.now().toString().slice(-8)}`;
const password = `Probe-${Math.random().toString(36).slice(2)}-2026`;
const registered = await call("/api/auth/register", { method: "POST", token, body: { username, password } });
const userToken = registered.token;
// 注册响应里的账户对象来自 getUserProfile，只有 `user_id`（形如 account:5），没有数字 id。
const accountId = String(registered.account?.user_id || "").replace(/^account:/, "") || null;
console.log(`临时账户 #${accountId || "?"} ${username} / ${password}`);

const settings = await call("/api/settings", { token, userToken });
console.log(`默认设置：pushEnabled=${settings.pushEnabled} frequency=${settings.pushFrequency} filter="${settings.pushJournalFilter}" days=${settings.pushDays}`);

await call("/api/settings", {
  method: "PUT", token, userToken,
  body: {
    pushEnabled: true,
    pushFrequency: "weekly",
    pushCron: "0 8 * * 1",
    pushDays: 7,
    pushIncludeFile: true,
    pushIncludeAbstract: true,
    pushIncludeKeywords: true,
    pushIncludeTranslation: true,
    pushJournalFilter: ""
  }
});
const after = await call("/api/settings", { token, userToken });
console.log(`改后设置：pushEnabled=${after.pushEnabled} frequency=${after.pushFrequency} filter="${after.pushJournalFilter}" 期刊数=${after.journals?.length}`);

await call("/api/user-email", { method: "POST", token, userToken, body: { email: probeEmail } });
console.log(`收件人写成探针地址 ${probeEmail}`);

console.log("\n>>> POST /api/push/send 开始（与页面点「立即发送」同一个请求）");
const started = Date.now();
let result = null;
try {
  result = await call("/api/push/send", { method: "POST", token, userToken });
  console.log(`<<< 完成，耗时 ${((Date.now() - started) / 1000).toFixed(1)}s`);
  console.log(`    sent=${result.sent} count=${result.count} 富化次数=${result.enrichmentAttemptCount} 翻译次数=${result.translationAttemptCount}`);
  console.log(`    被完整性过滤掉=${result.excludedIncompleteCount} 超上限省略=${result.omittedCompleteCount}`);
} catch (error) {
  console.log(`<<< 失败，耗时 ${((Date.now() - started) / 1000).toFixed(1)}s：${error.message}`);
}

if (!keep && accountId) {
  await call(`/api/admin/users/${accountId}`, { method: "DELETE", token });
  console.log(`\n已删除临时账户 #${accountId}`);
} else {
  console.log(`\n临时账户保留：#${accountId} ${username} / ${password}`);
}
