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
    const { db, updateUserProfile, getUserProfile, getAllUserEmails, saveTranslation, listArticles, addFeedback, addFeedbackComment, listPublicFeedback, toggleFeedbackLike, toggleFeedbackCommentLike, replyFeedback, deleteFeedback, deleteFeedbackComment, createUserAccount, saveRemotePreferences, getRemotePreferences, updateUserSettings, getUserSettings } = dbModule;
    db.prepare(\"INSERT INTO articles (external_id, title, fetched_at, first_seen_at) VALUES (?, ?, datetime('now'), datetime('now'))\").run('test-article', 'English title');
    const article = db.prepare(\"SELECT id FROM articles WHERE external_id = 'test-article'\").get();
    saveTranslation(article.id, 'zh', { title: '中文标题', abstract: '中文摘要', provider: 'test' });
    updateUserProfile('test-user', { email: '', name: '测试用户', enrollment_year: 2024, degree: '博士' });
    const profile = getUserProfile('test-user');
    if (profile.name !== '测试用户' || profile.enrollment_year !== 2024 || profile.degree !== '博士') process.exit(2);
    const listed = listArticles({}, 'test-user').find((item) => item.id === article.id);
    if (listed?.translated_title !== '中文标题' || listed?.translated_abstract !== '中文摘要') process.exit(3);
    const created = addFeedback('test-user', 'private@example.com', '公开建议');
    const publicItem = listPublicFeedback().find((item) => item.id === created.id);
    if (!publicItem || publicItem.author_name !== '测试用户' || publicItem.author_grade !== '2024级 博士' || 'email' in publicItem || 'user_id' in publicItem) process.exit(4);
    if (!replyFeedback(created.id, '管理员回复')) process.exit(5);
    if (listPublicFeedback().find((item) => item.id === created.id)?.admin_reply !== '管理员回复') process.exit(6);
    const comment = addFeedbackComment(created.id, 'test-user', '补充评论');
    if (!comment) process.exit(13);
    const likedDiscussion = toggleFeedbackLike(created.id, 'test-user');
    const likedComment = toggleFeedbackCommentLike(comment.id, 'test-user');
    const discussed = listPublicFeedback(100, 'test-user').find((item) => item.id === created.id);
    if (!likedDiscussion?.liked || !likedComment?.liked || discussed?.like_count !== 1 || !discussed?.liked_by_me || discussed?.comment_count !== 1 || discussed?.comments?.[0]?.content !== '补充评论' || discussed.comments[0].like_count !== 1 || !discussed.comments[0].liked_by_me) process.exit(14);
    if (!deleteFeedbackComment(comment.id) || listPublicFeedback(100, 'test-user').find((item) => item.id === created.id)?.comment_count !== 0) process.exit(15);
    if (!deleteFeedback(created.id)) process.exit(7);
    const anonymous = addFeedback('test-user', 'private@example.com', '匿名建议', true);
    const anonymousItem = listPublicFeedback().find((item) => item.id === anonymous.id);
    if (anonymousItem?.author_name !== '匿名用户' || anonymousItem?.author_grade !== '') process.exit(8);
    deleteFeedback(anonymous.id);
    updateUserProfile('10.0.0.1', { email: 'migrate@example.com', name: '待迁移用户', enrollment_year: 2022, degree: '硕士' });
    const account = createUserAccount({ username: 'tester', passwordHash: 'hash', passwordSalt: 'salt', registeredIp: '10.0.0.1' });
    if (getUserProfile('account:' + account.id).email !== 'migrate@example.com' || getAllUserEmails().some((item) => item.user_id === '10.0.0.1')) process.exit(9);
    saveRemotePreferences(account.id, { filters: { favorite: true } });
    if (getRemotePreferences(account.id)?.preferences?.filters?.favorite !== true) process.exit(10);
    let duplicateIpRejected = false;
    try { createUserAccount({ username: 'tester2', passwordHash: 'hash', passwordSalt: 'salt', registeredIp: '10.0.0.1' }); } catch { duplicateIpRejected = true; }
    if (!duplicateIpRejected) process.exit(11);
    updateUserSettings('user-a', { pushEnabled: true, pushFrequency: 'daily' });
    updateUserSettings('user-b', { pushEnabled: false, pushFrequency: 'weekly' });
    if (!getUserSettings('user-a').pushEnabled || getUserSettings('user-b').pushEnabled) process.exit(12);
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
