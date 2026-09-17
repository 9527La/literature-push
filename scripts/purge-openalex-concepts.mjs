#!/usr/bin/env node
// 清理被 OpenAlex concepts 机器标签污染的关键词。
//
// 背景：OpenAlex 的 works 接口在 keywords 为空时会回落返回 concepts（按 score 降序的
// 学科标签，形如 "Control theory (sociology)"）。这些标签被当成关键词写进了库，
// 而它们既不是作者关键词也不是 IEEE/出版社关键词。
//
// 判定：把关键词按 ; 拆项后，用 OpenAlex 全量 concepts 词表（65021 条）逐项比对，
// 命中率 >= 0.6 且总项数 <= 12（或命中率 >= 0.9）即判定整条为机器生成，整条清空。
// 真实的 IEEE 关键词列表通常有 13-25 项、命中率约 0.2，不会被误伤。
//
// 用法：
//   node scripts/purge-openalex-concepts.mjs            # 预演，只出报告
//   node scripts/purge-openalex-concepts.mjs --apply    # 真正写库（先生成回滚文件）
//   node scripts/purge-openalex-concepts.mjs --rollback data/keyword-rollback-<ts>.json
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vocabPath = path.join(root, "artifacts", "openalex-concepts.json");
const dbPath = path.join(root, "data", "literature.sqlite");

const argv = process.argv.slice(2);
const apply = argv.includes("--apply");
const rollbackIndex = argv.indexOf("--rollback");
const rollbackFile = rollbackIndex >= 0 ? path.resolve(argv[rollbackIndex + 1]) : "";

if (!fs.existsSync(dbPath)) {
  console.error(`找不到数据库：${dbPath}`);
  process.exit(1);
}

const db = new DatabaseSync(dbPath);
db.function("is_non_research_title", { deterministic: true }, (value) => (
  /^(table of contents|front cover|back cover|editorial|blank page)/i.test(String(value || "").trim()) ? 1 : 0
));

// ---- 回滚模式 ----
if (rollbackFile) {
  if (!fs.existsSync(rollbackFile)) {
    console.error(`找不到回滚文件：${rollbackFile}`);
    process.exit(1);
  }
  const entries = JSON.parse(fs.readFileSync(rollbackFile, "utf8"));
  const update = db.prepare("UPDATE articles SET keywords = ? WHERE id = ?");
  let restored = 0;
  db.exec("BEGIN");
  for (const entry of entries) {
    update.run(entry.keywords, entry.id);
    restored += 1;
  }
  db.exec("COMMIT");
  console.log(`已回滚 ${restored} 条关键词（来源 ${rollbackFile}）`);
  process.exit(0);
}

if (!fs.existsSync(vocabPath)) {
  console.error(`找不到 OpenAlex concepts 词表：${vocabPath}`);
  console.error("先运行：node artifacts/fetch-openalex-concepts.mjs");
  process.exit(1);
}

const vocabulary = new Set(
  JSON.parse(fs.readFileSync(vocabPath, "utf8")).map((name) => String(name).toLowerCase())
);

const splitTerms = (value) => String(value || "").split(/[;；]/).map((term) => term.trim()).filter(Boolean);
const isConceptTerm = (term) => vocabulary.has(String(term).toLowerCase());

// 命中率高 + 项数少 = OpenAlex 概念串；真实作者/IEEE 关键词列表项数多、命中率低。
function isPolluted(terms) {
  if (!terms.length) return false;
  const hits = terms.filter(isConceptTerm).length;
  const ratio = hits / terms.length;
  if (ratio >= 0.9) return true;
  return ratio >= 0.6 && terms.length <= 12;
}

const rows = db.prepare(`
  SELECT id, journal, keywords
  FROM articles
  WHERE length(trim(coalesce(keywords, ''))) > 0
    AND is_non_research_title(title) = 0
  ORDER BY id
`).all();

const affected = [];
const byJournal = new Map();
let scanned = 0;
for (const row of rows) {
  scanned += 1;
  const terms = splitTerms(row.keywords);
  if (!isPolluted(terms)) continue;
  affected.push({ id: row.id, keywords: row.keywords });
  const bucket = byJournal.get(row.journal) || 0;
  byJournal.set(row.journal, bucket + 1);
}

console.log(`扫描有关键词的文章：${scanned}`);
console.log(`判定为 OpenAlex 机器标签：${affected.length}（${((affected.length / scanned) * 100).toFixed(1)}%）`);
console.log("\n按期刊：");
for (const [journal, count] of [...byJournal.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(count).padStart(5)}  ${journal}`);
}
console.log("\n样本：");
for (const entry of affected.slice(0, 5)) {
  console.log(`  #${entry.id}  ${entry.keywords.slice(0, 140)}`);
}

if (!apply) {
  console.log("\n（预演结束，未写库。加 --apply 执行清理。）");
  process.exit(0);
}

// 先留回滚文件，再改库。
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const rollbackPath = path.join(root, "data", `keyword-rollback-${stamp}.json`);
fs.writeFileSync(rollbackPath, JSON.stringify(affected, null, 2), "utf8");

const updateArticle = db.prepare("UPDATE articles SET keywords = '' WHERE id = ?");
const updateTranslation = db.prepare("UPDATE translations SET keywords = '' WHERE article_id = ? AND length(trim(coalesce(keywords, ''))) > 0");
db.exec("BEGIN");
let clearedTranslations = 0;
for (const entry of affected) {
  updateArticle.run(entry.id);
  clearedTranslations += updateTranslation.run(entry.id).changes;
}
db.exec("COMMIT");

console.log(`\n已清空 ${affected.length} 条文章关键词，同步清空 ${clearedTranslations} 条译文关键词。`);
console.log(`回滚文件：${rollbackPath}`);
console.log("回滚：node scripts/purge-openalex-concepts.mjs --rollback <该文件>");
