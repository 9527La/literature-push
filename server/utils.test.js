import test from "node:test";
import assert from "node:assert/strict";
import { matchesJournalFilter } from "./utils.js";
import { DEFAULT_JOURNAL_BY_NAME } from "./journals.js";

const gated = DEFAULT_JOURNAL_BY_NAME.get("IEEE Transactions on Industrial Informatics");

test("journals without filterKeywords let every article through", () => {
  const journal = DEFAULT_JOURNAL_BY_NAME.get("IEEE Transactions on Power Systems");
  assert.equal(journal.filterKeywords, undefined);
  assert.equal(matchesJournalFilter({ title: "Anything at all" }, journal), true);
  assert.equal(matchesJournalFilter({ title: "" }, journal), true);
});

test("a gated journal drops articles outside the electrical scope", () => {
  assert.ok(Array.isArray(gated?.filterKeywords));
  assert.equal(matchesJournalFilter({ title: "Task scheduling in cloud manufacturing with graph attention networks" }, gated), false);
  assert.equal(matchesJournalFilter({ title: "Federated learning for industrial fault diagnosis" }, gated), true);
  assert.equal(matchesJournalFilter({ title: "A survey", abstract: "EV charging scheduling" }, gated), true);
});

test("a gated journal drops text-free records rather than guessing", () => {
  assert.equal(matchesJournalFilter({ title: "", abstract: "", keywords: "" }, gated), false);
});

test("matchesJournalFilter tolerates missing article or journal payloads", () => {
  assert.equal(matchesJournalFilter(undefined, undefined), true);
  assert.equal(matchesJournalFilter({ title: "x" }, {}), true);
});
