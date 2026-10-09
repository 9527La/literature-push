// 一次性：导出各月报未归组文献的紧凑清单（id|title|keywords|对象），供会话归类。
// 用法：node scripts/dump-unresolved.mjs [reportId...]
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const db = new DatabaseSync("data/literature.sqlite", { readOnly: true });
const args = process.argv.slice(2).map(Number);

const rows = db.prepare(`
  SELECT id, direction, stats_json FROM ai_reports
  WHERE status = 'ready' AND kind = 'monthly' AND direction IS NOT NULL ORDER BY id
`).all();

for (const row of rows) {
  if (args.length && !args.includes(row.id)) continue;
  let fix;
  try {
    fix = JSON.parse(readFileSync(`data/cluster-fix/report-${row.id}.json`, "utf8"));
  } catch { continue; }
  if (!fix.unresolvedIds.length) continue;
  const briefById = fix.briefById;
  const selectArticle = db.prepare("SELECT title, keywords FROM articles WHERE id = ?");
  console.log(`===== REPORT ${row.id} (${row.direction}) =====`);
  for (const id of fix.unresolvedIds) {
    const article = selectArticle.get(id);
    const title = String(article?.title || "").replace(/\|/g, "/").slice(0, 110);
    const keywords = String(article?.keywords || "").replace(/\|/g, "/").slice(0, 80);
    const brief = briefById[id] || {};
    const object = String(brief.object || "").slice(0, 40);
    const finding = String(brief.finding || "").slice(0, 50);
    console.log(`${id}|${title}|${keywords}|${object}|${finding}`);
  }
}
