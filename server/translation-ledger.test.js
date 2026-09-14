import test from "node:test";
import assert from "node:assert/strict";
import {
  addUsage,
  budgetStatus,
  combineBudgets,
  currentMonth,
  markExhausted,
  normalizeLimit,
  readLedger,
  writeLedger
} from "./translation-ledger.js";

/** Unique key per run so the assertions never read another run's numbers. */
function freshKey() {
  return `test-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
}

function dropKey(key) {
  const ledger = readLedger();
  delete ledger[key];
  writeLedger(ledger);
}

test("usage accumulates per provider and resets with the calendar month", () => {
  const key = freshKey();
  try {
    addUsage(key, 120);
    addUsage(key, 80);
    const status = budgetStatus(key, 1000);
    assert.equal(status.used, 200);
    assert.equal(status.limit, 1000);
    assert.equal(status.remaining, 800);
    assert.equal(status.exhausted, false);
    assert.equal(status.tracked, true);
    assert.equal(status.month, currentMonth());
    // A different month is a different bucket.
    assert.equal(budgetStatus(key, 1000, new Date("2030-01-15")).used, 0);
  } finally {
    dropKey(key);
  }
});

test("a month marked exhausted refuses further spending", () => {
  const key = freshKey();
  try {
    markExhausted(key, 500);
    const status = budgetStatus(key, 500);
    assert.equal(status.used, 500);
    assert.equal(status.remaining, 0);
    assert.equal(status.exhausted, true);
  } finally {
    dropKey(key);
  }
});

test("no ceiling means the provider is untracked rather than empty", () => {
  const key = freshKey();
  try {
    addUsage(key, 42);
    const status = budgetStatus(key, 0);
    assert.equal(status.used, 42);
    assert.equal(status.limit, 0);
    assert.equal(status.tracked, false);
    assert.equal(status.exhausted, false);
    assert.equal(normalizeLimit(status.limit), 0);
  } finally {
    dropKey(key);
  }
});

test("the chain's allowance is the sum of what its providers can still spend", () => {
  const combined = combineBudgets([
    { remaining: 300, exhausted: false, tracked: true },
    { remaining: 700, exhausted: false, tracked: true }
  ]);
  assert.equal(combined.remaining, 1000);
  assert.equal(combined.exhausted, false);
  assert.equal(combined.parts.length, 2);

  const spent = combineBudgets([
    { remaining: 0, exhausted: true, tracked: true },
    { remaining: 0, exhausted: true, tracked: true }
  ]);
  assert.equal(spent.exhausted, true);

  // One unbounded provider means the chain cannot be budget-limited at all.
  const unbounded = combineBudgets([
    { remaining: 0, exhausted: true, tracked: true },
    { remaining: 0, exhausted: false, tracked: false }
  ]);
  assert.equal(unbounded.unlimited, true);
  assert.equal(unbounded.exhausted, false);
});

test("an empty chain is neither exhausted nor unlimited", () => {
  const empty = combineBudgets([]);
  assert.equal(empty.exhausted, false);
  assert.equal(empty.unlimited, false);
  assert.equal(empty.remaining, 0);
});
