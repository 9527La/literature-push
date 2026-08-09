import assert from "node:assert/strict";
import test from "node:test";
import { config } from "./config.js";
import { createUserToken, hashUserPassword, verifyUserPassword, verifyUserToken } from "./user-auth.js";

test("hashes user passwords with salt and verifies exact passwords", () => {
  const first = hashUserPassword("secure password 123");
  const second = hashUserPassword("secure password 123");
  assert.notEqual(first.salt, second.salt);
  assert.notEqual(first.hash, second.hash);
  assert.equal(verifyUserPassword("secure password 123", first.salt, first.hash), true);
  assert.equal(verifyUserPassword("wrong password", first.salt, first.hash), false);
});

test("creates expiring user session tokens", () => {
  const previousSecret = config.adminTokenSecret;
  const previousDays = config.userTokenTtlDays;
  config.adminTokenSecret = "user-session-test-secret";
  config.userTokenTtlDays = 2;
  try {
    const now = Date.parse("2026-08-09T00:00:00Z");
    const token = createUserToken(42, now);
    assert.equal(verifyUserToken(token, now + 1000)?.accountId, 42);
    assert.equal(verifyUserToken(`${token}bad`, now + 1000), null);
    assert.equal(verifyUserToken(token, now + 2 * 24 * 60 * 60 * 1000 + 1), null);
  } finally {
    config.adminTokenSecret = previousSecret;
    config.userTokenTtlDays = previousDays;
  }
});
