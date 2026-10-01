// 远端只读诊断：账户 / 邮箱 / 推送设置 / 会话 IP。
// 用法（远端）：<node> probe-remote-account.mjs
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const root = path.resolve(process.argv[2] || "E:\\SC\\文献推送");
const dbPath = path.join(root, "data", "literature.sqlite");
const db = new DatabaseSync(dbPath, { readOnly: true });

const safe = (label, fn) => {
  try { return fn(); } catch (error) { console.log(`  [跳过] ${label}: ${error.message}`); return null; }
};

console.log(`DB: ${dbPath}\n`);

console.log("=== user_accounts ===");
const accounts = safe("user_accounts", () => db.prepare(
  "SELECT * FROM user_accounts ORDER BY rowid"
).all()) || [];
for (const a of accounts) {
  const cols = Object.keys(a).filter((k) => /id|username|created|ip|last/i.test(k));
  console.log("  " + cols.map((k) => `${k}=${a[k]}`).join("  "));
}

console.log("\n=== user_emails ===");
const emails = safe("user_emails", () => db.prepare(
  "SELECT user_id, email, name, created_at, updated_at FROM user_emails"
).all()) || [];
if (!emails.length) console.log("  (空)");
for (const e of emails) console.log(`  ${e.user_id}  ${e.email}  updated=${e.updated_at}`);

console.log("\n=== settings（站点级 push* 行）===");
const globalRows = safe("settings", () => db.prepare("SELECT key, value FROM settings").all()) || [];
for (const row of globalRows.filter((r) => /push|email|refresh/i.test(r.key))) {
  console.log(`  ${row.key} = ${String(row.value).slice(0, 120)}`);
}

console.log("\n=== user_settings（含 push* 行）===");
const userSettingRows = safe("user_settings", () => db.prepare(
  "SELECT user_id, key, value FROM user_settings WHERE key LIKE 'push%' OR key LIKE '%email%' ORDER BY user_id, key"
).all()) || [];
if (!userSettingRows.length) console.log("  (空：没有任何用户改过推送设置)");
for (const row of userSettingRows) console.log(`  ${row.user_id}  ${row.key} = ${String(row.value).slice(0, 100)}`);

console.log("\n=== user_sessions（最近 12 条）===");
const sessions = safe("user_sessions", () => db.prepare(
  "SELECT * FROM user_sessions ORDER BY rowid DESC LIMIT 12"
).all()) || [];
for (const s of sessions) {
  console.log("  " + Object.entries(s).map(([k, v]) => `${k}=${String(v).slice(0, 30)}`).join("  "));
}

console.log("\n=== 最近生成的 digest 文件 ===");
const digestDir = path.join(root, "data", "digests");
for (const name of safe("readdir", () => fs.readdirSync(digestDir)) || []) {
  const full = path.join(digestDir, name);
  const stat = fs.statSync(full);
  if (stat.size > 50 * 1024) {
    const head = fs.readFileSync(full, "utf8").split("\n").slice(0, 7).join(" | ");
    console.log(`  ${name}  ${stat.size}B  mtime=${stat.mtime.toISOString()}`);
    console.log(`      ${head.slice(0, 240)}`);
  }
}
db.close();
