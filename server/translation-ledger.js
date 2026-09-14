/**
 * Monthly character accounting shared by the paid translation providers.
 *
 * Neither Tencent's nor Baidu's text API answers "how much of this month's
 * allowance is left" — Baidu's console only refreshes usage every five minutes
 * and exposes no query endpoint at all — so the only trustworthy figure is one
 * this process counts itself: characters actually submitted, bucketed by
 * calendar month, in a file that survives restarts.
 *
 * The ledger is deliberately dumb JSON. Metering must never break translation,
 * so every failure path degrades to "no record" rather than throwing.
 */
import fs from "node:fs";
import path from "node:path";
import { resolveFromRoot } from "./paths.js";

const LEDGER_FILE = "data/translation-usage.json";

export function ledgerPath() {
  return resolveFromRoot(LEDGER_FILE);
}

export function currentMonth(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function readLedger() {
  try {
    const parsed = JSON.parse(fs.readFileSync(ledgerPath(), "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function writeLedger(ledger) {
  try {
    const file = ledgerPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
  } catch {
    // See the module comment: losing the ledger restarts the counter, which the
    // monthly ceiling still bounds.
  }
}

export function normalizeLimit(value) {
  const limit = Number(value);
  return Number.isFinite(limit) && limit > 0 ? limit : 0;
}

export function addUsage(provider, characters, now = new Date()) {
  const amount = Math.max(0, Math.round(Number(characters) || 0));
  if (!amount) return;
  const month = currentMonth(now);
  const ledger = readLedger();
  const bucket = ledger[provider] && typeof ledger[provider] === "object" ? ledger[provider] : {};
  bucket[month] = Number(bucket[month] || 0) + amount;
  ledger[provider] = bucket;
  writeLedger(ledger);
}

/** Force a month to "used up" after the provider refuses for quota reasons. */
export function markExhausted(provider, limit, now = new Date()) {
  const month = currentMonth(now);
  const ledger = readLedger();
  const bucket = ledger[provider] && typeof ledger[provider] === "object" ? ledger[provider] : {};
  bucket[month] = Math.max(Number(bucket[month] || 0), Number(limit) || 0);
  ledger[provider] = bucket;
  writeLedger(ledger);
}

export function budgetStatus(provider, limit, now = new Date()) {
  const month = currentMonth(now);
  const safeLimit = normalizeLimit(limit);
  const used = Number(readLedger()?.[provider]?.[month] || 0);
  return {
    month,
    used,
    limit: safeLimit,
    // `remaining` keeps the plain arithmetic even when no ceiling is configured
    // (0), so callers that predate the ledger see exactly what they used to.
    // "Is this provider bounded at all?" is answered by `tracked`.
    remaining: Math.max(0, safeLimit - used),
    exhausted: safeLimit > 0 && used >= safeLimit,
    tracked: safeLimit > 0
  };
}

/**
 * Sum of the allowances a provider chain can still spend. Translation falls
 * through the chain, so "can I drain this queue?" is answered by the total, not
 * by the first provider alone.
 */
export function combineBudgets(parts) {
  const list = (Array.isArray(parts) ? parts : []).filter(Boolean);
  const unbounded = list.some((part) => !part.tracked);
  const remaining = unbounded
    ? Infinity
    : list.reduce((total, part) => total + Math.max(0, Number(part.remaining) || 0), 0);
  return {
    remaining,
    unlimited: unbounded,
    exhausted: list.length > 0 && list.every((part) => part.exhausted),
    parts: list
  };
}
