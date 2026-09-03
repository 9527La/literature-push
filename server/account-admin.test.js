import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("deleting a personal account removes its sessions and private data", () => {
  const workingDirectory = mkdtempSync(path.join(tmpdir(), "literature-push-admin-test-"));
  const dbUrl = new URL("./db.js", import.meta.url).href;
  const script = `
    const dbModule = await import(${JSON.stringify(dbUrl)});
    const {
      db, createUserAccount, createUserSession, deleteUserAccount,
      updateUserProfile, updateDiscussionProfile, addFeedback, addFeedbackComment,
      saveRemotePreferences, updateUserSettings, getUserAccountById
    } = dbModule;
    const account = createUserAccount({ username: 'to-delete', passwordHash: 'hash', passwordSalt: 'salt', registeredIp: '10.10.0.1' });
    const userId = 'account:' + account.id;
    updateUserProfile(userId, { name: '待删除用户', email: 'delete@example.com' });
    updateDiscussionProfile(userId, 'DELETEME', '待删除用户');
    const feedback = addFeedback(userId, 'delete@example.com', '应随账户清理');
    addFeedbackComment(feedback.id, userId, '评论也应清理');
    saveRemotePreferences(account.id, { filters: { favorite: true } });
    updateUserSettings(userId, { pushEnabled: true });
    createUserSession({ sessionId: 'delete-session-00000001', accountId: account.id, loginIp: '10.10.0.1', role: 'user', expiresAt: Date.now() + 86400000 });
    db.prepare("INSERT INTO articles (external_id, title, fetched_at, first_seen_at) VALUES (?, ?, datetime('now'), datetime('now'))").run('delete-test-article', '删除测试文献');
    db.prepare('INSERT INTO user_interactions (user_id, article_id) VALUES (?, ?)').run(userId, 1);
    if (!deleteUserAccount(account.id)) process.exit(2);
    if (getUserAccountById(account.id)) process.exit(3);
    for (const [table, column] of [
      ['user_sessions', 'account_id'], ['user_emails', 'user_id'], ['discussion_profiles', 'user_id'],
      ['feedback', 'user_id'], ['feedback_comments', 'user_id'], ['user_interactions', 'user_id'],
      ['user_settings', 'user_id']
    ]) {
      const value = column === 'account_id' ? account.id : userId;
      if (db.prepare('SELECT 1 FROM ' + table + ' WHERE ' + column + ' = ? LIMIT 1').get(value)) process.exit(4);
    }
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
