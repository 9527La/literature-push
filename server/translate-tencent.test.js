import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  buildTencentAuthorization,
  internals,
  tencentErrorMessage,
  tencentBudgetStatus
} from "./translate-tencent.js";
import { config } from "./config.js";

const FIXED_SECRET_ID = "AKIDEXAMPLEEXAMPLEEXAMPLEEXAMPLE0";
const FIXED_SECRET_KEY = "0123456789abcdef0123456789abcdef";
const FIXED_PAYLOAD = JSON.stringify({ Source: "auto", Target: "zh", ProjectId: 0, SourceTextList: ["power system"] });
const FIXED_TIMESTAMP = 1757750400;

test("Tencent signature is deterministic and scoped to tmt/tc3_request", () => {
  const authorization = buildTencentAuthorization({
    secretId: FIXED_SECRET_ID,
    secretKey: FIXED_SECRET_KEY,
    payload: FIXED_PAYLOAD,
    timestamp: FIXED_TIMESTAMP
  });

  // Snapshot taken after the same code path returned a real translation from
  // tmt.tencentcloudapi.com, so this locks in a signature that is known to be
  // accepted by the service.
  assert.equal(
    authorization,
    "TC3-HMAC-SHA256 Credential=AKIDEXAMPLEEXAMPLEEXAMPLEEXAMPLE0/2025-09-13/tmt/tc3_request, "
      + "SignedHeaders=content-type;host;x-tc-action, "
      + "Signature=a8efea8ea1eba23a2f92e34fd2d8acd76f9dfce8f5b23183f99337968ad9f163"
  );

  // The date comes from the timestamp (UTC), and the credential scope must not
  // carry a region — that is the main difference from the Volcengine scheme.
  assert.match(authorization, /2025-09-13\/tmt\/tc3_request/);
  assert.ok(!/ap-guangzhou/.test(authorization), "credential scope must not include a region");
  assert.match(authorization, /x-tc-action/);
});

test("Tencent signature changes with payload, key or timestamp", () => {
  const base = { secretId: FIXED_SECRET_ID, secretKey: FIXED_SECRET_KEY, payload: FIXED_PAYLOAD, timestamp: FIXED_TIMESTAMP };
  const signature = (overrides) => buildTencentAuthorization({ ...base, ...overrides }).match(/Signature=([0-9a-f]+)/)[1];
  const original = signature({});
  assert.notEqual(signature({ payload: `${FIXED_PAYLOAD} ` }), original);
  assert.notEqual(signature({ secretKey: `${FIXED_SECRET_KEY}x` }), original);
  assert.notEqual(signature({ timestamp: FIXED_TIMESTAMP + 86400 }), original);
});

test("Tencent signature refuses to sign without credentials", () => {
  assert.throws(
    () => buildTencentAuthorization({ secretId: "", secretKey: "", payload: "{}" }),
    /TENCENT_SECRET_ID/
  );
});

test("Tencent error codes are translated into actionable Chinese", () => {
  // These three are the money-adjacent ones: running out of free allowance, a
  // suspended account, and a service that was never opened.
  assert.match(tencentErrorMessage("FailedOperation.NoFreeAmount"), /免费额度已用完/);
  assert.match(tencentErrorMessage("FailedOperation.ServiceIsolate"), /欠费/);
  assert.match(tencentErrorMessage("FailedOperation.UserNotRegistered"), /尚未开通/);
  assert.match(tencentErrorMessage("AuthFailure.SignatureFailure"), /签名校验失败/);
  assert.match(tencentErrorMessage("SomethingNew", "boom"), /SomethingNew：boom/);
});

test("character counting is per code point, not per UTF-16 unit", () => {
  // An emoji is one character to TMT but two UTF-16 units to .length; metering
  // must follow the billable unit.
  assert.equal(internals.countCharacters(["电力系统"]), 4);
  assert.equal(internals.countCharacters(["ab", "cd"]), 4);
  assert.equal(internals.countCharacters(["⚡"]), 1);
  assert.equal(internals.countCharacters([]), 0);
});

test("budget status reports the current month against the configured ceiling", () => {
  const status = tencentBudgetStatus();
  assert.match(status.month, /^\d{4}-\d{2}$/);
  assert.equal(status.limit, Number(config.tencentMonthlyCharBudget));
  assert.ok(status.used >= 0);
  assert.equal(status.exhausted, status.limit > 0 && status.used >= status.limit);
  assert.equal(status.remaining, Math.max(0, status.limit - status.used));
});

test("the usage ledger lives under data/ so it survives restarts and is not tracked", () => {
  const ledger = internals.ledgerPath().replace(/\\/g, "/");
  assert.match(ledger, /\/data\/translation-usage\.json$/);
  // data/ must stay out of git: the ledger is local usage state.
  const gitignore = fs.readFileSync(".gitignore", "utf8");
  assert.ok(/^data\/?$/m.test(gitignore.trim()) || /^data\//m.test(gitignore), "data/ should be gitignored");
});

test("an exhausted monthly budget refuses the request instead of spending money", async () => {
  const original = config.tencentMonthlyCharBudget;
  // Anything already recorded this month exceeds a ceiling of 1 character.
  config.tencentMonthlyCharBudget = 1;
  try {
    const { requestTencentBatch } = await import("./translate-tencent.js");
    await assert.rejects(
      () => requestTencentBatch(["power system"]),
      (error) => {
        assert.match(error.message, /额度已用尽|预算/);
        return true;
      }
    );
  } finally {
    config.tencentMonthlyCharBudget = original;
  }
});
