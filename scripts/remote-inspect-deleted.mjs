// 事故取证：对比「删除前快照」与「线上库」，确认被清理掉的到底是哪批记录。
//   snapshot = data/predelete-snapshot.sqlite（只复制了主库文件、不含 WAL，因此是删除前的状态）
//   live     = data/literature.sqlite（当前线上库）
// 只读打开，不做任何写入。
import { DatabaseSync } from "node:sqlite";

const DATA = "E:/SC/文献推送/data/";
const snapshot = new DatabaseSync(DATA + "predelete-snapshot.sqlite", { readOnly: true });
const live = new DatabaseSync(DATA + "literature.sqlite", { readOnly: true });

const journals = (db) =>
  db.prepare("SELECT journal, COUNT(*) AS c FROM articles GROUP BY journal ORDER BY c DESC").all();

const printJournals = (label, db) => {
  const rows = journals(db);
  const total = rows.reduce((sum, row) => sum + row.c, 0);
  console.log(`\n=== ${label} — 共 ${total} 篇 / ${rows.length} 个刊名 ===`);
  for (const row of rows) console.log(`  ${row.c}\t${row.journal}`);
};

printJournals("删除前快照", snapshot);
printJournals("线上库（现状）", live);

const SUSPECTS = [
  "Power System Technology",
  "Proceedings of the Institution of Civil Engineers - Energy"
];

for (const name of SUSPECTS) {
  console.log(`\n=== 快照里「${name}」的记录 ===`);
  const rows = snapshot
    .prepare("SELECT id, external_id, title, doi, published_at, first_seen_at, url FROM articles WHERE journal = ? ORDER BY id")
    .all(name);
  console.log(`条数 = ${rows.length}`);
  for (const row of rows.slice(0, 12)) {
    console.log(`  #${row.id} ext=${row.external_id} doi=${row.doi || "-"} pub=${row.published_at || "-"} seen=${row.first_seen_at}`);
    console.log(`      title=${String(row.title || "").slice(0, 90)}`);
    console.log(`      url=${String(row.url || "").slice(0, 90)}`);
  }
  if (rows.length > 12) console.log(`  … 其余 ${rows.length - 12} 条省略`);
  const liveCount = live.prepare("SELECT COUNT(*) AS c FROM articles WHERE journal = ?").get(name).c;
  console.log(`线上库同名记录 = ${liveCount}`);
}

// 快照里存在、线上库已消失的 id（即被一次性修复删掉的记录）
console.log("\n=== 快照有、线上库没有的 article id ===");
const snapIds = new Set(snapshot.prepare("SELECT id FROM articles").all().map((r) => r.id));
const liveIds = new Set(live.prepare("SELECT id FROM articles").all().map((r) => r.id));
const missing = [...snapIds].filter((id) => !liveIds.has(id));
console.log(`快照 ${snapIds.size} 篇，线上 ${liveIds.size} 篇，差集 ${missing.length} 篇`);
if (missing.length) {
  const rows = snapshot
    .prepare(`SELECT id, journal, external_id, substr(title,1,70) AS title FROM articles WHERE id IN (${missing.join(",")}) ORDER BY journal, id`)
    .all();
  const byJournal = {};
  for (const row of rows) byJournal[row.journal] = (byJournal[row.journal] || 0) + 1;
  console.log("按刊名统计：", JSON.stringify(byJournal, null, 0));
  for (const row of rows.slice(0, 40)) {
    console.log(`  #${row.id} [${row.journal}] ext=${row.external_id} ${row.title}`);
  }
}

snapshot.close();
live.close();
