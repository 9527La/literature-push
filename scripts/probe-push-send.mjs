/**
 * 诊断「立即发送」按钮无反应。
 *
 * 分两步，全部只读或低风险：
 *   1. GET  /version.json、/api/status        —— 服务活着吗
 *   2. POST /api/digests/weekly               —— 只生成摘要（不发信），测生成耗时
 *   3. POST /api/push/send（需个人账户）       —— 完整链路；--account 传入后才会跑
 *
 * 用法：
 *   node scripts/probe-push-send.mjs http://192.168.31.233:4177
 *   node scripts/probe-push-send.mjs http://192.168.31.233:4177 --account
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
const withAccount = process.argv.includes("--account");

function readEnv(key, fallback = "") {
  try {
    const env = fs.readFileSync(new URL("../.env", import.meta.url), "utf8");
    const match = env.match(new RegExp(`^${key}\\s*=\\s*(.*)$`, "m"));
    if (match && match[1].trim()) return match[1].trim().replace(/^["']|["']$/g, "");
  } catch { /* ignore */ }
  return fallback;
}

const PASSPORT_CANDIDATES = [readEnv("ADMIN_PASSPORT"), readEnvPassport(), readEnv("USER_PASSPORT")].filter(Boolean);

async function timed(label, fn) {
  const started = Date.now();
  try {
    const result = await fn();
    console.log(`  ok   ${label}  ${Date.now() - started}ms`);
    return { ok: true, result, ms: Date.now() - started };
  } catch (error) {
    console.log(`  FAIL ${label}  ${Date.now() - started}ms  ${error.message}`);
    return { ok: false, error, ms: Date.now() - started };
  }
}

async function call(path, { method = "GET", token, body, userToken } = {}) {
  const headers = {};
  if (token) headers["X-Passport-Token"] = token;
  if (userToken) headers["X-User-Token"] = userToken;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15 * 60 * 1000)
  });
  const text = await response.text();
  let data = null;
  try { data = JSON.parse(text); } catch { data = text.slice(0, 300); }
  if (!response.ok) {
    const error = new Error(`${response.status} ${typeof data === "string" ? data : (data.error || "")}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

console.log(`目标：${base}`);
if (!withAccount) console.log(`通行证候选：${PASSPORT_CANDIDATES.map((p) => `${p[0]}***`).join(", ") || "(无)"}`);

await timed("GET /version.json", () => call("/version.json"));

let token = "";
for (const candidate of PASSPORT_CANDIDATES) {
  try {
    const result = await call("/api/gate/login", { method: "POST", body: { passport: candidate } });
    token = result.token;
    console.log(`  ok   通行证通过（候选首字母 ${candidate[0]}，角色 ${result.role}）`);
    break;
  } catch (error) {
    console.log(`  ..   通行证候选被拒：${error.message}`);
  }
}
if (!token) {
  console.error("通行证全部失败，后续步骤跳过。");
  process.exit(1);
}

await timed("GET /api/status", () => call("/api/status", { token }));

// 只生成摘要、不发信：这是「立即发送」里最慢的一段。
const digest = await timed("POST /api/digests/weekly（仅生成，不发信）", () => call("/api/digests/weekly", { method: "POST", token, body: {} }));
if (digest.ok) {
  const { count, filePath, range } = digest.result || {};
  console.log(`       count=${count} range=${range?.startDate}~${range?.endDate} file=${filePath}`);
}

if (!withAccount) {
  console.log("\n（未加 --account，跳过个人账户环节）");
  process.exit(0);
}

// ── 个人账户环节 ──
const username = `zzprobe${Date.now().toString().slice(-8)}`;
const password = `Probe-${Math.random().toString(36).slice(2)}-2026`;
console.log(`\n注册临时账户 ${username} …`);
const registered = await timed("POST /api/auth/register", () => call("/api/auth/register", { method: "POST", token, body: { username, password } }));
if (!registered.ok) process.exit(1);
let userToken = registered.result.token;
console.log(`       accountId=${registered.result.account?.id ?? registered.result.account?.accountId ?? "?"}`);

await timed("GET /api/account", () => call("/api/account", { token, userToken }));
await timed("GET /api/user-email", () => call("/api/user-email", { token, userToken }));

console.log("\n提示：以下步骤会真的尝试发一封信给 MAIL_TO。");
const target = readEnv("MAIL_TO");
if (!target) {
  console.log("  未读到 MAIL_TO，跳过 push/send");
  process.exit(0);
}
await timed(`POST /api/user-email（写入 ${target}）`, () => call("/api/user-email", { method: "POST", token, userToken, body: { email: target } }));

const push = await timed("POST /api/push/send（完整链路）", () => call("/api/push/send", { method: "POST", token, userToken }));
if (push.ok) console.log(`       sent=${push.result?.sent} count=${push.result?.count}`);
console.log(`\n临时账户：${username} / ${password}（记得去管理中心删掉）`);
