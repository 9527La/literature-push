// 只读校验脚本：验证「统一日期口径」在真实数据上的正确性。
// 不修改任何源码，不写入数据库。所有路径使用绝对路径。
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, writeFileSync } from "node:fs";

const DB_PATH = "E:/Users/admin/文档/文献推送/data/literature.sqlite";
const OUT_PATH = "E:/Users/admin/文档/文献推送/artifacts/probe-display-date.txt";

// 与 server/db.js 完全一致的口径
function effectiveDateSql(alias = "a") {
  return `datetime(CASE
      WHEN datetime(${alias}.published_at) IS NULL THEN COALESCE(NULLIF(${alias}.first_seen_at, ''), ${alias}.fetched_at)
      WHEN datetime(${alias}.published_at) > datetime('now') THEN COALESCE(NULLIF(${alias}.first_seen_at, ''), ${alias}.fetched_at)
      ELSE ${alias}.published_at END)`;
}
function displayDateSql(alias = "a") { return `substr(${effectiveDateSql(alias)}, 1, 10)`; }

const db = new DatabaseSync(DB_PATH, { readOnly: true });

const lines = [];
const log = (s = "") => { lines.push(s); };

// ---------- 1. 总览 ----------
const total = db.prepare("SELECT COUNT(*) AS c FROM articles").get().c;
const nullPub = db.prepare("SELECT COUNT(*) AS c FROM articles WHERE published_at IS NULL OR published_at = ''").get().c;
const futurePub = db.prepare("SELECT COUNT(*) AS c FROM articles WHERE datetime(published_at) > datetime('now')").get().c;
const pastPub = db.prepare("SELECT COUNT(*) AS c FROM articles WHERE datetime(published_at) <= datetime('now')").get().c;

log("=== 1. 总览 ===");
log(`总篇数                 : ${total}`);
log(`published_at 为空      : ${nullPub}`);
log(`published_at > now(提前访问): ${futurePub}`);
log(`published_at <= now     : ${pastPub}`);
log(`校验(空+未来+过去)=总数 : ${nullPub + futurePub + pastPub === total ? "OK" : "MISMATCH!"}`);
log();

// ---------- 2. 不变量: display_date > 今天 必须为 0 ----------
const futureDisp = db.prepare(`SELECT COUNT(*) AS c FROM articles WHERE ${displayDateSql("articles")} > date('now')`).get().c;
log("=== 2. 不变量: display_date 不得超过今天 ===");
log(`display_date > 今天 的条数 : ${futureDisp}  (预期必须为 0)`);
if (futureDisp > 0) {
  log("!! 发现 BUG：以下 display_date 落在未来 (前 10 条)");
  const bad = db.prepare(`SELECT id, journal, published_at, first_seen_at, ${displayDateSql("articles")} AS display_date FROM articles WHERE ${displayDateSql("articles")} > date('now') ORDER BY display_date DESC LIMIT 10`).all();
  for (const r of bad) log(`  id=${r.id} | ${r.journal} | pub=${r.published_at} | first_seen=${r.first_seen_at} | display=${r.display_date}`);
}
log();

// ---------- 3. 按月分布(最近 8 个月, 按 display_date 归月) ----------
log("=== 3. 按月分布 (按 display_date 归月, 最近 8 个月) ===");
const now = new Date();
const monthKeys = [];
for (let i = 7; i >= 0; i--) {
  const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
  monthKeys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
}
for (const mk of monthKeys) {
  const c = db.prepare(`SELECT COUNT(*) AS c FROM articles WHERE substr(${displayDateSql("articles")}, 1, 7) = ?`).get(mk).c;
  log(`${mk} : ${c}`);
}
log();

// ---------- 4. 每期刊一行 ----------
log("=== 4. 每期刊统计 (journal / 总篇数 / pub_min / pub_max / disp_min / disp_max / 提前访问数) ===");
const perJ = db.prepare(`SELECT journal,
  COUNT(*) AS total,
  MIN(published_at) AS pub_min, MAX(published_at) AS pub_max,
  MIN(${displayDateSql("articles")}) AS disp_min, MAX(${displayDateSql("articles")}) AS disp_max,
  SUM(CASE WHEN datetime(published_at) > datetime('now') THEN 1 ELSE 0 END) AS advance_cnt
  FROM articles GROUP BY journal ORDER BY total DESC`).all();
for (const r of perJ) {
  log(`${r.journal} | 总=${r.total} | pub[${r.pub_min} ~ ${r.pub_max}] | disp[${r.disp_min} ~ ${r.disp_max}] | 提前访问=${r.advance_cnt}`);
}
log();

// ---------- 5. 抽查 15 条提前访问样本 ----------
log("=== 5. 提前访问样本 (published_at > now) 抽查 15 条 ===");
log("   预期: display_date == first_seen_at(若非空), 而非未来的 published_at");
const samp = db.prepare(`SELECT id, journal, published_at, first_seen_at, ${displayDateSql("articles")} AS display_date
  FROM articles WHERE datetime(published_at) > datetime('now') ORDER BY published_at DESC LIMIT 15`).all();
if (samp.length === 0) log("  (无提前访问样本)");
for (const r of samp) {
  const ok = (r.first_seen_at && r.first_seen_at !== "" && r.display_date === r.first_seen_at.slice(0, 10)) || (!r.first_seen_at || r.first_seen_at === "") ;
  log(`  id=${r.id} | pub=${r.published_at} | first_seen=${r.first_seen_at} | display=${r.display_date} ${ok ? "" : "<< 检查"}`);
}
log();

// ---------- 6. 错误口径 vs 正确口径: 最近 7 天命中数 ----------
const since = new Date(now); since.setDate(since.getDate() - 7);
const sinceDate = since.toISOString().slice(0, 10);
const todayDate = now.toISOString().slice(0, 10);
const titleExcl = `lower(title) NOT LIKE '%information%'
  AND lower(title) NOT LIKE '%table of contents%'
  AND lower(title) NOT LIKE '%blank page%'
  AND lower(title) NOT LIKE 'correction to%'
  AND lower(title) NOT LIKE '%publication information%'
  AND lower(title) NOT LIKE '%front cover%'
  AND lower(title) NOT LIKE '%back cover%'`;

// 错误: 直接用 published_at 筛选最近 7 天
const wrong = db.prepare(`SELECT COUNT(*) AS c FROM articles
  WHERE datetime(published_at) >= datetime('now','-7 days')
    AND datetime(published_at) <= datetime('now')
    AND ${titleExcl}`).get().c;
// 正确: 用统一的 display_date 筛选 [sinceDate, todayDate]
const right = db.prepare(`SELECT COUNT(*) AS c FROM articles
  WHERE ${displayDateSql("articles")} >= @sinceDate
    AND ${displayDateSql("articles")} <= @todayDate
    AND ${titleExcl}`).get({ sinceDate, todayDate }).c;

log("=== 6. 最近 7 天命中数: 错误口径(published_at) vs 正确口径(display_date) ===");
log(`窗口                : ${sinceDate} ~ ${todayDate}`);
log(`错误(直接 published_at): ${wrong}`);
log(`正确(display_date)    : ${right}`);
log(`差异                : ${right - wrong}  (正确口径多计入=${right - wrong > 0 ? right - wrong : 0} 篇, 多为提前访问论文按入库日落入窗口)`);

const out = lines.join("\n");
writeFileSync(OUT_PATH, out, "utf8");
console.log(out);
