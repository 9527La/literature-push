// 远端只读：看 IEEE / 中文期刊的日期字段到底存了什么。
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const root = path.resolve(process.argv[2] || "E:\\SC\\文献推送");
const db = new DatabaseSync(path.join(root, "data", "literature.sqlite"), { readOnly: true });

console.log("=== articles 表结构 ===");
for (const col of db.prepare("PRAGMA table_info(articles)").all()) {
  console.log(`  ${col.name.padEnd(22)} ${col.type}`);
}

const since = new Date();
since.setDate(since.getDate() - 7);
const sinceDate = since.toISOString().slice(0, 10);
console.log(`\n窗口起点 ${sinceDate}`);

for (const journal of [
  "IEEE Transactions on Smart Grid",
  "IEEE Transactions on Power Systems",
  "中国电机工程学报",
  "电力系统自动化",
  "Applied Energy"
]) {
  const rows = db.prepare(`
    SELECT id, title, published_at, first_seen_at, fetched_at, doi, url
    FROM articles WHERE journal = ? ORDER BY id DESC LIMIT 4`).all(journal);
  console.log(`\n=== ${journal}（最新 4 条）===`);
  for (const row of rows) {
    console.log(`  #${row.id} published_at="${row.published_at}" first_seen="${row.first_seen_at}" fetched="${row.fetched_at}"`);
    console.log(`        doi=${row.doi}  url=${String(row.url || "").slice(0, 90)}`);
    console.log(`        title=${String(row.title || "").slice(0, 70)}`);
  }
  const inWindow = db.prepare(`
    SELECT COUNT(*) n FROM articles WHERE journal=? AND published_at IS NOT NULL AND published_at<>'' AND substr(published_at,1,10)>=?`).get(journal, sinceDate).n;
  const anyDate = db.prepare(`SELECT MIN(published_at) lo, MAX(published_at) hi, COUNT(*) n FROM articles WHERE journal=?`).get(journal);
  console.log(`  窗口内(出版日期) = ${inWindow}；全库 ${anyDate.n} 条，出版日期范围 ${anyDate.lo} ~ ${anyDate.hi}`);
}

console.log("\n=== 出版日期最新的 15 条（全库）===");
for (const row of db.prepare(`
  SELECT id, journal, published_at, first_seen_at FROM articles
  WHERE published_at IS NOT NULL AND published_at<>'' ORDER BY published_at DESC LIMIT 15`).all()) {
  console.log(`  ${row.published_at}  ${String(row.journal).slice(0, 44).padEnd(44)} #${row.id} first_seen=${row.first_seen_at}`);
}
db.close();
