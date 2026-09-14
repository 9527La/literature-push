import test from "node:test";
import assert from "node:assert/strict";
import { computeProgress, planTranslationRun, MAINTENANCE_TASKS } from "./maintenance.js";

test("progress reports done, percentage and a remaining-time estimate", () => {
  const progress = computeProgress({ total: 100, remaining: 40, processed: 30, elapsedMs: 60_000 });
  assert.equal(progress.done, 60);
  assert.equal(progress.percent, 60);
  assert.equal(progress.ratePerMinute, 30);
  // 40 records left at 30 per minute.
  assert.equal(progress.etaSeconds, 80);
});

test("progress never reports a negative or over-100% position", () => {
  const grown = computeProgress({ total: 10, remaining: 25, processed: 1, elapsedMs: 1_000 });
  assert.equal(grown.done, 0);
  assert.equal(grown.percent, 0);
  const overtaken = computeProgress({ total: 10, remaining: 0, processed: 30, elapsedMs: 1_000 });
  assert.equal(overtaken.done, 10);
  assert.equal(overtaken.percent, 100);
  assert.equal(overtaken.etaSeconds, 0);
});

test("remaining time stays unknown until the first item is processed", () => {
  const progress = computeProgress({ total: 50, remaining: 50, processed: 0, elapsedMs: 5_000 });
  assert.equal(progress.ratePerMinute, 0);
  assert.equal(progress.etaSeconds, null);
});

test("translation planning sizes the run to the remaining allowance", () => {
  const ample = planTranslationRun({
    remainingCount: 100,
    sampleChars: 200 * 10,
    sampleSize: 10,
    budget: { remaining: 4_000_000, exhausted: false }
  });
  assert.equal(ample.avgCharsPerArticle, 200);
  assert.equal(ample.estimatedChars, 20_000);
  assert.equal(ample.plannedCount, 100);
  assert.equal(ample.budgetLimited, false);

  // Only 25 articles' worth of characters are left in the month.
  const tight = planTranslationRun({
    remainingCount: 100,
    sampleChars: 200 * 10,
    sampleSize: 10,
    budget: { remaining: 5_000, exhausted: false }
  });
  assert.equal(tight.affordableCount, 25);
  assert.equal(tight.plannedCount, 25);
  assert.equal(tight.budgetLimited, true);
});

test("an exhausted allowance plans nothing to translate", () => {
  const plan = planTranslationRun({
    remainingCount: 100,
    sampleChars: 200 * 10,
    sampleSize: 10,
    budget: { remaining: 0, exhausted: true }
  });
  assert.equal(plan.affordableCount, 0);
  assert.equal(plan.plannedCount, 0);
  assert.equal(plan.budgetLimited, true);
});

test("an empty translation queue costs nothing and is never budget-limited", () => {
  const plan = planTranslationRun({ remainingCount: 0, sampleChars: 0, sampleSize: 0, budget: { remaining: 10, exhausted: false } });
  assert.equal(plan.estimatedChars, 0);
  assert.equal(plan.budgetLimited, false);
});

test("every maintenance task carries a label and a routing kind", () => {
  for (const [name, task] of Object.entries(MAINTENANCE_TASKS)) {
    assert.ok(task.label, `${name} needs a label`);
    assert.ok(["metadata", "translate"].includes(task.kind), `${name} needs a kind`);
    if (task.kind === "metadata") assert.ok(task.stages.length > 0, `${name} needs stages`);
    if (task.kind === "translate") assert.ok(["title", "abstract"].includes(task.field), `${name} needs a field`);
  }
});
