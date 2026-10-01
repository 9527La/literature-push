// 探测当前全站统计口径的实时数字与近 30 日窗口构成（与 /api/status 同源）。
// 用法：LITERATURE_DATA_DIR=<目录> node scripts/probe-first-public-status.mjs
import process from "node:process";
import { db, getUserStatus } from "../server/db.js";

const status = getUserStatus(null);
console.log(JSON.stringify({
  articleCount: status.articleCount,
  newArticleCount7d: status.newArticleCount7d,
  newArticleCount30d: status.newArticleCount30d,
  dateBasis: status.dateBasis,
  timezone: status.timezone
}, null, 2));

const inWindow = `is_non_research_title(title) = 0
  AND first_public_at >= date('now', '+8 hours', '-29 days')
  AND first_public_at <= date('now', '+8 hours')`;

const mix = db.prepare(`SELECT COALESCE(NULLIF(first_public_confidence, ''), 'X') AS grade, COUNT(*) AS count FROM articles WHERE ${inWindow} GROUP BY grade ORDER BY grade`).all();
console.log("近 30 日构成（按可信度）：", mix.map((row) => `${row.grade}=${row.count}`).join(" "));

const sources = db.prepare(`SELECT COALESCE(NULLIF(first_public_source, ''), 'X') AS source, COUNT(*) AS count FROM articles WHERE ${inWindow} GROUP BY source ORDER BY count DESC`).all();
console.log("近 30 日来源：", sources.map((row) => `${row.source}=${row.count}`).join(" "));

const days = db.prepare(`SELECT first_public_at AS d, COUNT(*) AS c FROM articles WHERE ${inWindow} GROUP BY d ORDER BY d DESC`).all();
console.log("近 30 日按日分布（新→旧）：");
for (const row of days) {
  console.log(`  ${row.d}  ${"#".repeat(Math.min(row.c, 50))} ${row.c}`);
}
