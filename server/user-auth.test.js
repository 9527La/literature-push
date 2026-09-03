import assert from "node:assert/strict";
import test from "node:test";
import { config } from "./config.js";
import { createPassportToken, createUserToken, hashUserPassword, verifyPassportToken, verifyUserPassword, verifyUserToken } from "./user-auth.js";

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
    const expiresAt = now + 2 * 24 * 60 * 60 * 1000;
    const token = createUserToken(42, "test-session-00000042", expiresAt, now);
    assert.equal(verifyUserToken(token, now + 1000)?.accountId, 42);
    assert.equal(verifyUserToken(token, now + 1000)?.sessionId, "test-session-00000042");
    assert.equal(verifyUserToken(`${token}bad`, now + 1000), null);
    assert.equal(verifyUserToken(token, expiresAt + 1), null);
  } finally {
    config.adminTokenSecret = previousSecret;
    config.userTokenTtlDays = previousDays;
  }
});

test("creates role-scoped web passport tokens", () => {
  const previousSecret = config.adminTokenSecret;
  const previousTtl = config.passportTokenTtlHours;
  config.adminTokenSecret = "passport-test-secret";
  config.passportTokenTtlHours = 1;
  try {
    const now = Date.parse("2026-08-09T00:00:00Z");
    const adminToken = createPassportToken("admin", now);
    const userToken = createPassportToken("user", now);
    assert.equal(verifyPassportToken(adminToken, now + 1000)?.role, "admin");
    assert.equal(verifyPassportToken(userToken, now + 1000)?.role, "user");
    assert.equal(verifyPassportToken(adminToken, now + 3600001), null);
    assert.equal(verifyPassportToken(`${adminToken}bad`, now + 1000), null);
  } finally {
    config.adminTokenSecret = previousSecret;
    config.passportTokenTtlHours = previousTtl;
  }
});
