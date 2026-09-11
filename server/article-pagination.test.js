import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("article pages return compact previews while detail responses keep full metadata", () => {
  const workingDirectory = mkdtempSync(path.join(tmpdir(), "literature-article-page-test-"));
  const dbUrl = new URL("./db.js", import.meta.url).href;
  const script = `
    const { db, listArticlePage, getArticleForUser, saveTranslation } = await import(${JSON.stringify(dbUrl)});
    const insert = db.prepare("INSERT INTO articles (external_id, title, abstract, fetched_at, first_seen_at) VALUES (?, ?, ?, datetime('now'), datetime('now'))");
    const longAbstract = 'A'.repeat(600);
    insert.run('page-1', 'Page one', longAbstract);
    insert.run('page-2', 'Page two', longAbstract);
    insert.run('page-3', 'Page three', longAbstract);
    const article = db.prepare("SELECT id FROM articles WHERE external_id = 'page-1'").get();
    saveTranslation(article.id, 'zh', { title: '第一页', abstract: '中文摘要', provider: 'test' });

    const first = listArticlePage({ limit: '2', offset: '0' }, null);
    const second = listArticlePage({ limit: '2', offset: '2' }, null);
    if (first.articles.length !== 2 || !first.hasMore || first.total !== 3) process.exit(2);
    if (second.articles.length !== 1 || second.hasMore || second.total !== 3) process.exit(3);
    if (first.articles.some((item) => item.abstract.length > 320 || 'fetched_at' in item)) process.exit(4);

    const detail = getArticleForUser(article.id, null);
    if (detail.abstract.length !== 600 || detail.translated_title !== '第一页' || detail.translated_abstract !== '中文摘要') process.exit(5);
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
