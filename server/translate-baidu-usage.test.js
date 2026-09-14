import test from "node:test";
import assert from "node:assert/strict";
import { config } from "./config.js";
import {
  baiduBudgetNotice,
  baiduBudgetStatus,
  baiduErrorHint,
  baiduLastError,
  clearBaiduError,
  internals,
  noteBaiduError
} from "./translate-baidu-usage.js";

test("Baidu usage is metered against the configured ceiling", () => {
  const status = baiduBudgetStatus();
  assert.match(status.month, /^\d{4}-\d{2}$/);
  assert.equal(status.limit, Number(config.baiduMonthlyCharLimit));
  assert.ok(status.used >= 0);
  assert.equal(status.exhausted, status.limit > 0 && status.used >= status.limit);
});

test("the notice says the figure is local bookkeeping, not an official balance", () => {
  // Baidu has no quota endpoint, so the wording has to be honest about that.
  assert.match(baiduBudgetNotice(), /本地记账/);
  assert.match(baiduBudgetNotice(), /BAIDU_MONTHLY_CHAR_LIMIT/);
});

test("provider error codes turn into an actionable hint", () => {
  assert.equal(baiduErrorHint("Baidu Translate error 54004: 账户余额不足"), internals.BAIDU_ERROR_HINTS["54004"]);
  assert.match(baiduErrorHint("Baidu Translate error 54003: rate limited"), /1 QPS/);
  assert.equal(baiduErrorHint("Baidu Translate error 99999: mystery"), "");
  assert.equal(baiduErrorHint(""), "");
});

test("the last refusal is remembered for the dashboard and can be cleared", () => {
  clearBaiduError();
  assert.equal(baiduLastError(), null);
  const recorded = noteBaiduError("Baidu Translate error 54004: 账户余额不足");
  assert.equal(recorded.message, "Baidu Translate error 54004: 账户余额不足");
  assert.equal(baiduLastError().message, recorded.message);
  clearBaiduError();
  assert.equal(baiduLastError(), null);
});
