import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("keeps personal accounts, discussion identities, and session limits independent", () => {
  const workingDirectory = mkdtempSync(path.join(tmpdir(), "literature-push-test-"));
  const dbUrl = new URL("./db.js", import.meta.url).href;
  const script = `
    const dbModule = await import(${JSON.stringify(dbUrl)});
    const { db, updateUserProfile, getUserProfile, getAllUserEmails, saveTranslation, listArticles, addFeedback, addFeedbackComment, listPublicFeedback, toggleFeedbackLike, toggleFeedbackCommentLike, replyFeedback, closeFeedback, deleteFeedback, deleteFeedbackComment, createUserAccount, createUserSession, getActiveUserSession, revokeUserSession, getDiscussionProfile, updateDiscussionProfile, getAdminOverview, saveRemotePreferences, getRemotePreferences, updateUserSettings, getUserSettings, getUserAccountCount } = dbModule;
    db.prepare("INSERT INTO articles (external_id, title, fetched_at, first_seen_at) VALUES (?, ?, datetime('now'), datetime('now'))").run('test-article', 'English title');
    const article = db.prepare("SELECT id FROM articles WHERE external_id = 'test-article'").get();
    saveTranslation(article.id, 'zh', { title: '中文标题', abstract: '中文摘要', provider: 'test' });
    updateUserProfile('test-user', { email: '', name: '测试用户', enrollment_year: 2024, degree: '博士' });
    const profile = getUserProfile('test-user');
    if (profile.name !== '测试用户' || profile.enrollment_year !== 2024 || profile.degree !== '博士') process.exit(2);
    const listed = listArticles({}, 'test-user').find((item) => item.id === article.id);
    if (listed?.translated_title !== '中文标题' || listed?.translated_abstract !== '中文摘要') process.exit(3);
    updateDiscussionProfile('test-user', 'A1B2C3D4', '测试发言者');
    if (getDiscussionProfile('test-user', 'A1B2C3D4').displayName !== '测试发言者') process.exit(20);
    const created = addFeedback('test-user', 'private@example.com', '公开建议');
    const publicItem = listPublicFeedback().find((item) => item.id === created.id);
    if (!publicItem || publicItem.author_name !== '测试发言者' || publicItem.author_tag !== 'A1B2C3D4' || 'email' in publicItem || 'user_id' in publicItem) process.exit(4);
    if (!replyFeedback(created.id, '管理员回复')) process.exit(5);
    if (listPublicFeedback().find((item) => item.id === created.id)?.admin_reply !== '管理员回复') process.exit(6);
    const comment = addFeedbackComment(created.id, 'test-user', '补充评论');
    if (!comment) process.exit(13);
    const likedDiscussion = toggleFeedbackLike(created.id, 'test-user');
    const likedComment = toggleFeedbackCommentLike(comment.id, 'test-user');
    const discussed = listPublicFeedback(100, 'test-user').find((item) => item.id === created.id);
    if (!likedDiscussion?.liked || !likedComment?.liked || discussed?.like_count !== 1 || !discussed?.liked_by_me || discussed?.comment_count !== 1 || discussed?.comments?.[0]?.content !== '补充评论' || discussed.comments[0].like_count !== 1 || !discussed.comments[0].liked_by_me) process.exit(14);
    if (!deleteFeedbackComment(comment.id) || listPublicFeedback(100, 'test-user').find((item) => item.id === created.id)?.comment_count !== 0) process.exit(15);
    if (!closeFeedback(created.id)) process.exit(18);
    if (!addFeedbackComment(created.id, 'test-user', '不应写入')?.closed || !listPublicFeedback(100, 'test-user').find((item) => item.id === created.id)?.is_closed) process.exit(19);
    if (!deleteFeedback(created.id)) process.exit(7);
    const second = addFeedback('test-user', 'private@example.com', '第二条建议', true);
    const secondItem = listPublicFeedback().find((item) => item.id === second.id);
    if (secondItem?.author_name !== '测试发言者' || secondItem?.author_tag !== 'A1B2C3D4') process.exit(8);
    deleteFeedback(second.id);

    // Registration is independent from IP and starts with a blank profile.
    const account = createUserAccount({ username: 'tester', passwordHash: 'hash', passwordSalt: 'salt', registeredIp: '10.0.0.1' });
    const sameIpAccount = createUserAccount({ username: 'tester2', passwordHash: 'hash', passwordSalt: 'salt', registeredIp: '10.0.0.1' });
    if (!account || !sameIpAccount || getUserProfile('account:' + account.id).email !== '' || getAllUserEmails().some((item) => item.user_id === '10.0.0.1') || getUserAccountCount() !== 2) process.exit(9);
    saveRemotePreferences(account.id, { filters: { favorite: true } });
    if (getRemotePreferences(account.id)?.preferences?.filters?.favorite !== true) process.exit(10);
    updateUserSettings('user-a', { pushEnabled: true, pushFrequency: 'daily' });
    updateUserSettings('user-b', { pushEnabled: false, pushFrequency: 'weekly' });
    if (!getUserSettings('user-a').pushEnabled || getUserSettings('user-b').pushEnabled) process.exit(12);

    // A personal account can have several same-IP sessions; a new IP takes over.
    const accountWithSessions = createUserAccount({ username: 'session-owner', passwordHash: 'hash', passwordSalt: 'salt', registeredIp: '10.0.0.2' });
    const now = Date.parse('2026-08-10T00:00:00Z');
    const expiresAt = now + 86400000;
    if (!createUserSession({ sessionId: 'account-session-one', accountId: accountWithSessions.id, loginIp: '10.0.0.2', role: 'user', expiresAt, now }).ok) process.exit(21);
    if (!createUserSession({ sessionId: 'account-session-two', accountId: accountWithSessions.id, loginIp: '10.0.0.2', role: 'user', expiresAt, now: now + 1 }).ok) process.exit(22);
    if (!getActiveUserSession('account-session-one', accountWithSessions.id, now + 2)) process.exit(23);
    if (!createUserSession({ sessionId: 'account-session-takeover', accountId: accountWithSessions.id, loginIp: '10.0.0.3', role: 'user', expiresAt, now: now + 3 }).ok) process.exit(24);
    if (getActiveUserSession('account-session-one', accountWithSessions.id, now + 4) || getActiveUserSession('account-session-two', accountWithSessions.id, now + 4) || !getActiveUserSession('account-session-takeover', accountWithSessions.id, now + 4)) process.exit(25);
    if (!revokeUserSession('account-session-takeover', now + 5) || getActiveUserSession('account-session-takeover', accountWithSessions.id, now + 6)) process.exit(26);

    // Twenty different active IPs are allowed; the 21st is rejected. A second
    // account on an already-active IP does not consume another slot.
    for (let index = 0; index < 20; index += 1) {
      const sessionAccount = createUserAccount({ username: 'session-user-' + index, passwordHash: 'hash', passwordSalt: 'salt', registeredIp: '10.0.2.' + index });
      if (!createUserSession({ sessionId: 'user-session-' + String(index).padStart(4, '0'), accountId: sessionAccount.id, loginIp: '10.0.2.' + index, role: 'user', expiresAt, now: now + 10 + index }).ok) process.exit(27);
    }
    const sameIpSessionAccount = createUserAccount({ username: 'same-ip-session-user', passwordHash: 'hash', passwordSalt: 'salt', registeredIp: '10.0.3.1' });
    if (!createUserSession({ sessionId: 'same-ip-session', accountId: sameIpSessionAccount.id, loginIp: '10.0.2.0', role: 'user', expiresAt, now: now + 40 }).ok) process.exit(28);
    const overflowAccount = createUserAccount({ username: 'overflow-session-user', passwordHash: 'hash', passwordSalt: 'salt', registeredIp: '10.0.3.2' });
    if (createUserSession({ sessionId: 'overflow-session', accountId: overflowAccount.id, loginIp: '10.0.9.9', role: 'user', expiresAt, now: now + 41 }).reason !== 'active_ip_limit') process.exit(29);
    if (db.prepare("SELECT COUNT(DISTINCT login_ip) AS count FROM user_sessions WHERE revoked_at IS NULL AND expires_at > ?").get(now + 50).count !== 20) process.exit(30);
    for (let index = 0; index < 15; index += 1) createUserAccount({ username: 'capacity-user-' + index, passwordHash: 'hash', passwordSalt: 'salt', registeredIp: '10.0.4.' + index });
    let capacityRejected = false;
    try { createUserAccount({ username: 'capacity-overflow', passwordHash: 'hash', passwordSalt: 'salt', registeredIp: '10.0.5.1' }); } catch (error) { capacityRejected = String(error.message).includes('上限'); }
    if (!capacityRejected || getUserAccountCount() !== 40) process.exit(31);
    const overview = getAdminOverview();
    if (overview.counts.users !== 40 || overview.counts.articles !== 1 || typeof overview.coverage.abstracts !== 'number') process.exit(17);
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
