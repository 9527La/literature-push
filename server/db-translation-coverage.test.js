import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("translation coverage excludes Chinese source text with Latin abbreviations", () => {
  const workingDirectory = mkdtempSync(path.join(tmpdir(), "literature-translation-coverage-"));
  const dbUrl = new URL("./db.js", import.meta.url).href;
  const script = `
    const { db, countArticlesMissingTranslation, listArticlesMissingTranslation, getAdminOverview, saveTranslation } = await import(${JSON.stringify(dbUrl)});
    const insert = db.prepare("INSERT INTO articles (external_id, title, abstract, fetched_at, first_seen_at) VALUES (?, ?, ?, datetime('now'), datetime('now'))");
    insert.run('zh', 'V2G 车网互动调度方法', '面向 HVDC 系统的稳定性分析');
    insert.run('en-complete', 'English title', 'English abstract');
    insert.run('en-missing', 'Another English title', 'Another English abstract');
    const complete = db.prepare("SELECT id FROM articles WHERE external_id = 'en-complete'").get();
    saveTranslation(complete.id, 'zh', { title: '英文标题译文', abstract: '英文摘要译文', provider: 'test' });
    if (countArticlesMissingTranslation('title', 'zh') !== 1) process.exit(2);
    if (countArticlesMissingTranslation('abstract', 'zh') !== 1) process.exit(3);
    const missing = listArticlesMissingTranslation('title', 'zh', 20);
    if (missing.length !== 1 || missing[0].external_id !== 'en-missing') process.exit(4);
    const overview = getAdminOverview();
    if (overview.coverage.translatedTitles !== 50 || overview.coverage.translatedAbstracts !== 50) process.exit(5);
    if (overview.coverageDetails.translatedTitles.missingCount !== 1 || overview.coverageDetails.translatedAbstracts.missingCount !== 1) process.exit(6);
  `;
  try {
    const result = spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
      cwd: workingDirectory,
      encoding: "utf8"
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally {
    rmSync(workingDirectory, { recursive: true, force: true });
  }
});
