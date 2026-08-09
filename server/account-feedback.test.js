import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("persists account preferences, joins translated titles and hides feedback identity", () => {
  const workingDirectory = mkdtempSync(path.join(tmpdir(), "literature-push-test-"));
  const dbUrl = new URL("./db.js", import.meta.url).href;
  const script = `
    const dbModule = await import(${JSON.stringify(dbUrl)});
    const { db, updateUserProfile, getUserProfile, saveTranslation, listArticles, addFeedback, listPublicFeedback, replyFeedback, deleteFeedback } = dbModule;
    db.prepare(\"INSERT INTO articles (external_id, title, fetched_at, first_seen_at) VALUES (?, ?, datetime('now'), datetime('now'))\").run('test-article', 'English title');
    const article = db.prepare(\"SELECT id FROM articles WHERE external_id = 'test-article'\").get();
    saveTranslation(article.id, 'zh', { title: '中文标题', abstract: '中文摘要', provider: 'test' });
    updateUserProfile('test-user', { email: '', name: '测试用户', grade: '博士二年级', show_bilingual_titles: false });
    const profile = getUserProfile('test-user');
    if (profile.name !== '测试用户' || profile.grade !== '博士二年级' || profile.show_bilingual_titles !== false) process.exit(2);
    const listed = listArticles({}, 'test-user').find((item) => item.id === article.id);
    if (listed?.translated_title !== '中文标题') process.exit(3);
    const created = addFeedback('test-user', 'private@example.com', '公开建议');
    const publicItem = listPublicFeedback().find((item) => item.id === created.id);
    if (!publicItem || publicItem.author_name !== '测试用户' || 'email' in publicItem || 'user_id' in publicItem) process.exit(4);
    if (!replyFeedback(created.id, '管理员回复')) process.exit(5);
    if (listPublicFeedback().find((item) => item.id === created.id)?.admin_reply !== '管理员回复') process.exit(6);
    if (!deleteFeedback(created.id)) process.exit(7);
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
