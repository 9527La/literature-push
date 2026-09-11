import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('favorite picker stores a selected and default group', async () => {
  const originalCwd = process.cwd();
  const workdir = mkdtempSync(path.join(tmpdir(), 'literature-favorites-'));
  let mod;
  process.chdir(workdir);
  try {
    mod = await import(`./db.js?favorite-test=${Date.now()}`);
    mod.db.prepare(`INSERT INTO articles (external_id,title,fetched_at,first_seen_at) VALUES ('test:1','Research article',datetime('now'),datetime('now'))`).run();
    const articleId = Number(mod.db.prepare("SELECT id FROM articles WHERE external_id='test:1'").get().id);
    const group = mod.createFavoriteGroup('user-1', '储能');
    const favorite = mod.toggleArticleFavoriteForUser('user-1', articleId, { groupId: group.id, setDefault: true });
    assert.equal(favorite.is_favorite, 1);
    assert.equal(favorite.group_id, group.id);
    assert.equal(mod.getDefaultFavoriteGroupId('user-1'), group.id);
    assert.equal(mod.getUserFavorites('user-1').defaultGroupId, group.id);
  } finally {
    try { mod?.db?.close(); } catch {}
    process.chdir(originalCwd);
    rmSync(workdir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test('new personal accounts receive a default favorite group', async () => {
  const originalCwd = process.cwd();
  const workdir = mkdtempSync(path.join(tmpdir(), 'literature-default-favorites-'));
  let mod;
  process.chdir(workdir);
  try {
    mod = await import(`./db.js?default-favorite-test=${Date.now()}`);
    const account = mod.createUserAccount({
      username: 'default-owner',
      passwordHash: 'hash',
      passwordSalt: 'salt',
      registeredIp: '10.10.10.10'
    });
    const userId = `account:${account.id}`;
    const favorites = mod.getUserFavorites(userId);
    const defaultGroup = favorites.groups.find((group) => group.name === '默认收藏夹');
    assert.ok(defaultGroup);
    assert.equal(favorites.defaultGroupId, defaultGroup.id);

    mod.db.prepare(`INSERT INTO articles (external_id,title,fetched_at,first_seen_at) VALUES ('default:1','Default article',datetime('now'),datetime('now'))`).run();
    const articleId = Number(mod.db.prepare("SELECT id FROM articles WHERE external_id='default:1'").get().id);
    const favorite = mod.toggleArticleFavoriteForUser(userId, articleId);
    assert.equal(favorite.group_id, defaultGroup.id);
    assert.equal(favorite.group_name, '默认收藏夹');
  } finally {
    try { mod?.db?.close(); } catch {}
    process.chdir(originalCwd);
    rmSync(workdir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});
