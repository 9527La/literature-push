import fs from "node:fs";
import path from "node:path";
import { DatabaseSync, backup } from "node:sqlite";
import { decodeEntities } from "../server/utils.js";
import { DEFAULT_JOURNALS } from "../server/journals.js";
import { fetchJournalArticles } from "../server/sources.js";
import { crawlArticleDetails } from "../server/crawler.js";

const repair = process.argv.includes("--repair-entities");
const live = process.argv.includes("--live");
const report = { createdAt: new Date().toISOString(), database: {}, sourceFiles: [], journals: [], repaired: 0 };
fs.mkdirSync("artifacts", { recursive: true });
const db = new DatabaseSync("data/literature.sqlite", { readOnly: !repair });
const fields = ["title", "authors", "journal", "abstract", "keywords"];
if (repair) {
  report.backup = `data/literature.before-entity-repair-${Date.now()}.sqlite`;
  await backup(db, report.backup);
  db.exec("BEGIN IMMEDIATE");
}
try {
  for (const table of ["articles", "translations"]) {
    const columns = fields.filter((field) => table === "articles" || !["authors", "journal"].includes(field));
    const rows = db.prepare(`SELECT rowid AS audit_rowid, * FROM ${table}`).all();
    const issues = [];
    for (const row of rows) {
      for (const field of columns) {
        const value = String(row[field] || "");
        const decoded = decodeEntities(value);
        if (decoded !== value) {
          issues.push({ id: row.id || row.article_id, field, type: "entity" });
          if (repair) {
            db.prepare(`UPDATE ${table} SET ${field} = ? WHERE rowid = ?`).run(decoded, row.audit_rowid);
            report.repaired += 1;
          }
        }
        if (/\uFFFD|Ã[\u0080-\u00BF]|Â[\u0080-\u00BF]|â€|ðŸ|锟斤拷/.test(value)) issues.push({ id: row.id || row.article_id, field, type: "suspect_encoding" });
      }
    }
    report.database[table] = { total: rows.length, missing: Object.fromEntries(columns.map((field) => [field, rows.filter((row) => !String(row[field] || "").trim()).length])), issues };
  }
  if (repair) db.exec("COMMIT");
} catch (error) {
  if (repair) db.exec("ROLLBACK");
  throw error;
} finally { db.close(); }

for (const directory of ["src", "server"]) {
  for (const name of fs.readdirSync(directory)) {
    if (!/\.(js|jsx|css)$/.test(name) || /test\.js$/.test(name)) continue;
    const file = path.join(directory, name);
    const bytes = fs.readFileSync(file);
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      if (text.includes("\uFFFD")) report.sourceFiles.push({ file, error: "Replacement character" });
    } catch { report.sourceFiles.push({ file, error: "Invalid UTF-8" }); }
  }
}

if (live) {
  // Bounded read-only probes: no article insertions, translation charges or mail.
  for (const journal of DEFAULT_JOURNALS) {
    const item = { journal: journal.name, platform: journal.platform, sourceDiagnostics: [], issnDiagnostics: [] };
    try {
      const articles = await fetchJournalArticles(journal, { maxRecords: 3, maxPages: 1,
        onDiagnostics: (value) => item.sourceDiagnostics.push(value),
        onIssnDiagnostics: (value) => item.issnDiagnostics.push(value) });
      item.count = articles.length;
      if (articles[0]) {
        item.sample = { title: articles[0].title, doi: articles[0].doi, url: articles[0].url };
        let details = articles[0];
        try { details = await crawlArticleDetails(details); }
        catch (error) { details = error.details || details; item.detailError = error.message; item.detailSources = error.sourceErrors || []; }
        item.missing = fields.filter((field) => !String(details[field] || "").trim());
      }
      item.status = item.count ? (item.missing?.length ? "partial" : "ok") : "empty";
    } catch (error) { item.status = "error"; item.error = error.message; }
    report.journals.push(item);
    fs.writeFileSync("artifacts/literature-audit.json", JSON.stringify(report, null, 2));
    console.log(`${item.status}: ${journal.name} (${item.count || 0})`);
  }
}
fs.writeFileSync("artifacts/literature-audit.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify({ totals: Object.fromEntries(Object.entries(report.database).map(([key, value]) => [key, { total: value.total, missing: value.missing, issues: value.issues.length }])), repaired: report.repaired, sourceFileIssues: report.sourceFiles.length }));
