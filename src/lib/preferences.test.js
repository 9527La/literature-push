import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeDisplayPreferences } from "./preferences.js";
import { DEFAULT_DISPLAY } from "./constants.js";

test("空快照返回默认显示偏好", () => {
  assert.deepEqual(normalizeDisplayPreferences(null), DEFAULT_DISPLAY);
});

test("旧版快照强制关闭中文摘要", () => {
  const legacy = normalizeDisplayPreferences({ displayPreferences: { translatedAbstract: true } });
  assert.equal(legacy.translatedAbstract, false);
});

test("新版快照保留用户显式选择", () => {
  const current = normalizeDisplayPreferences({
    displayPreferencesVersion: 2,
    displayPreferences: { translatedAbstract: true, authors: false }
  });
  assert.equal(current.translatedAbstract, true);
  assert.equal(current.authors, false);
  assert.equal(current.keywords, true);
});
