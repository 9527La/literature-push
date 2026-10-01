// 只读：列出不在期刊目录内的文献，便于定位采集来源与字符串污染。
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { projectRoot } from "../server/paths.js";
import { DEFAULT_JOURNALS } from "../server/journals.js";

const dbPath = process.argv[2] || path.join(projectRoot, "data", "literature.sqlite");
const db = new DatabaseSync(dbPath, { readOnly: true });
const catalog = DEFAULT_JOURNALS.map((journal) => journal.name);
const placeholders = catalog.map(() => "?").join(", ");

const rows = db.prepare(`
  SELECT id, external_id, journal, doi, url, published_at, first_seen_at, fetched_at, substr(title, 1, 70) AS title
  FROM articles
  WHERE COALESCE(TRIM(journal), '') NOT IN (${placeholders})
  ORDER BY journal, id
`).all(...catalog);

console.log(`非目录文献 ${rows.length} 条：`);
for (const row of rows) {
  console.log(`\n  #${row.id}  journal="${row.journal}"`);
  console.log(`     title      ${row.title}`);
  console.log(`     external   ${row.external_id || "-"}`);
  console.log(`     doi        ${row.doi || "-"}`);
  console.log(`     url        ${String(row.url || "-").slice(0, 110)}`);
  console.log(`     published  ${row.published_at}  first_seen=${row.first_seen_at || "-"}  fetched=${row.fetched_at || "-"}`);
}

console.log("\n含 HTML 实体（&amp; 等）的 journal 值：");
for (const row of db.prepare(`SELECT DISTINCT journal FROM articles WHERE journal LIKE '%&%;%' OR journal LIKE '%&amp;%' OR journal LIKE '%&#%';`).all()) {
  console.log(`  ${row.journal}`);
}
db.close();
