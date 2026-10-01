// 只读探针：检查推送账户配置 + 摘要窗口计数，确认日期口径改动没有把周报掏空
import { DatabaseSync } from "node:sqlite";
import path from "node:path";

const DB = "E:/Users/admin/文档/文献推送/data/literature.sqlite";
const db = new DatabaseSync(DB, { readOnly: true });

const q = (sql, ...args) => db.prepare(sql).all(...args);

const displayDateSql = (alias = "a") => `substr(datetime(CASE
    WHEN datetime(${alias}.published_at) IS NULL THEN COALESCE(NULLIF(${alias}.first_seen_at,''), ${alias}.fetched_at)
    WHEN datetime(${alias}.published_at) > datetime('now') THEN COALESCE(NULLIF(${alias}.first_seen_at,''), ${alias}.fetched_at)
    ELSE ${alias}.published_at END),1,10)`;

console.log("=== user_emails 表结构 ===");
console.log(q("PRAGMA table_info(user_emails)").map((c) => c.name).join(", "));

console.log("\n=== user_emails 全部行 ===");
const rows = q("SELECT * FROM user_emails");
for (const r of rows) {
  console.log(JSON.stringify(r, null, 0));
}

console.log("\n=== 各 account 的推送设置 ===");
try {
  const us = q("SELECT * FROM user_settings");
  const keys = new Set();
  for (const r of us) keys.add(r.key);
  console.log("setting keys:", [...keys].join(", "));
  for (const r of us) {
    if (/push|journal|frequen|digest|mail/i.test(r.key)) console.log(`${r.key} = ${r.value}`);
  }
} catch (e) {
  console.log("user_settings 读取失败:", e.message);
}

console.log("\n=== 摘要窗口计数（无过滤 / 按 account:1 与 account:3 的期刊过滤） ===");
for (const days of [7, 30]) {
  const byDisplay = q(
    `SELECT COUNT(*) AS c FROM articles a WHERE ${displayDateSql("a")} >= date('now', ?) AND ${displayDateSql("a")} <= date('now')`,
    `-${days} day`
  )[0].c;
  const byPublished = q(
    `SELECT COUNT(*) AS c FROM articles a WHERE substr(a.published_at,1,10) >= date('now', ?) AND substr(a.published_at,1,10) <= date('now')`,
    `-${days} day`
  )[0].c;
  console.log(`最近 ${days} 天  全库: display_date=${byDisplay}  published_at=${byPublished}`);
}

console.log("\n=== 各刊最近 30 天（display_date）===");
for (const r of q(
  `SELECT journal, COUNT(*) AS c FROM articles a WHERE ${displayDateSql("a")} >= date('now','-30 day') AND ${displayDateSql("a")} <= date('now') GROUP BY journal ORDER BY c DESC`
)) {
  console.log(`  ${r.journal} : ${r.c}`);
}

console.log("\n=== 被 pushJournalFilter 锁定的期刊在库里的情况 ===");
for (const name of ["IEEE Transactions on Smart Grid"]) {
  const r = q(
    `SELECT COUNT(*) AS total, MAX(${displayDateSql("a")}) AS max_display, MAX(a.published_at) AS max_pub FROM articles a WHERE a.journal = ?`,
    name
  )[0];
  console.log(`${name}: total=${r.total} max_display=${r.max_display} max_published=${r.max_pub}`);
}

db.close();
