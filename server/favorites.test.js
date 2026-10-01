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
  process.env.LITERATURE_DATA_DIR = workdir;
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
    delete process.env.LITERATURE_DATA_DIR;
    process.chdir(originalCwd);
    rmSync(workdir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test('new personal accounts start without any auto-created favorite group', async () => {
  const originalCwd = process.cwd();
  const workdir = mkdtempSync(path.join(tmpdir(), 'literature-default-favorites-'));
  let mod;
  process.chdir(workdir);
  process.env.LITERATURE_DATA_DIR = workdir;
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
    // 分组只能由用户显式创建：新账户除了虚拟的「未分组」以外不该有任何分组。
    assert.deepEqual(favorites.groups.map((group) => group.name), ['未分组']);
    assert.equal(favorites.defaultGroupId, null);
    assert.equal(favorites.total, 0);

    mod.db.prepare(`INSERT INTO articles (external_id,title,fetched_at,first_seen_at) VALUES ('default:1','Default article',datetime('now'),datetime('now'))`).run();
    const articleId = Number(mod.db.prepare("SELECT id FROM articles WHERE external_id='default:1'").get().id);
    const favorite = mod.toggleArticleFavoriteForUser(userId, articleId);
    // 没有默认分组时，新收藏直接落在「未分组」，而不是凭空造一个分组出来。
    assert.equal(favorite.group_id, null);
    assert.equal(favorite.group_name, '');
    assert.equal(mod.getUserFavorites(userId).total, 1);
  } finally {
    try { mod?.db?.close(); } catch {}
    delete process.env.LITERATURE_DATA_DIR;
    process.chdir(originalCwd);
    rmSync(workdir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test('a deleted favorite group stays deleted and never resurrects', async () => {
  const originalCwd = process.cwd();
  const workdir = mkdtempSync(path.join(tmpdir(), 'literature-delete-favorites-'));
  let mod;
  process.chdir(workdir);
  process.env.LITERATURE_DATA_DIR = workdir;
  try {
    mod = await import(`./db.js?delete-favorite-test=${Date.now()}`);
    mod.db.prepare(`INSERT INTO articles (external_id,title,fetched_at,first_seen_at) VALUES ('del:1','Grouped article',datetime('now'),datetime('now'))`).run();
    const articleId = Number(mod.db.prepare("SELECT id FROM articles WHERE external_id='del:1'").get().id);
    const group = mod.createFavoriteGroup('user-9', '储能');
    mod.toggleArticleFavoriteForUser('user-9', articleId, { groupId: group.id, setDefault: true });
    assert.equal(mod.getDefaultFavoriteGroupId('user-9'), group.id);

    assert.equal(mod.deleteFavoriteGroup('user-9', group.id), true);
    // 反复读取也不该把删掉的分组建回来（旧实现会在这里复活它）。
    assert.equal(mod.listFavoriteGroups('user-9').some((item) => item.name === '储能'), false);
    assert.equal(mod.listFavoriteGroups('user-9').some((item) => item.name === '默认收藏夹'), false);
    assert.equal(mod.getDefaultFavoriteGroupId('user-9'), null);

    const favorites = mod.getUserFavorites('user-9');
    // 分组删掉后收藏本身要留在「未分组」，总数不变。
    assert.equal(favorites.total, 1);
    assert.equal(favorites.favorites[0].group_id, null);
    assert.equal(favorites.groups.find((item) => item.id === null).count, 1);
  } finally {
    try { mod?.db?.close(); } catch {}
    delete process.env.LITERATURE_DATA_DIR;
    process.chdir(originalCwd);
    rmSync(workdir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});
