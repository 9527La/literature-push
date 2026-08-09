import assert from "node:assert/strict";
import test from "node:test";
import { config } from "./config.js";
import { createAdminToken, passwordMatches, verifyAdminToken } from "./admin.js";

test("creates, verifies and expires administrator tokens", () => {
  const previousSecret = config.adminTokenSecret;
  const previousTtl = config.adminTokenTtlHours;
  config.adminTokenSecret = "test-only-secret";
  config.adminTokenTtlHours = 1;
  try {
    const now = Date.parse("2026-08-09T00:00:00Z");
    const token = createAdminToken(now);
    assert.equal(verifyAdminToken(token, now + 1000), true);
    assert.equal(verifyAdminToken(`${token}tampered`, now + 1000), false);
    assert.equal(verifyAdminToken(token, now + 60 * 60 * 1000 + 1), false);
  } finally {
    config.adminTokenSecret = previousSecret;
    config.adminTokenTtlHours = previousTtl;
  }
});

test("compares administrator passwords without accepting partial values", () => {
  assert.equal(passwordMatches("correct horse", "correct horse"), true);
  assert.equal(passwordMatches("correct", "correct horse"), false);
  assert.equal(passwordMatches("wrong horse", "correct horse"), false);
});
