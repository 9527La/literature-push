#!/usr/bin/env node
/**
 * Apply AI direction-classification results to the articles table.
 *
 * Input: JSON array (or {results:[...]}) of
 *   { id, direction, secondary?, confidence?, reason? }
 * - `direction` must be a key from server/directions.js, else the row counts
 *   as invalid and is skipped (never guessed).
 * - rows whose direction_source is already 'manual' are never overwritten.
 * - all writes run in one transaction with bound parameters.
 *
 * Usage:
 *   node scripts/apply-directions.mjs --file <results.json> [--db <path>]
 */
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DIRECTIONS } from "../server/directions.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const KEY_SET = new Set(DIRECTIONS.map((d) => d.key));

function parseArgs(argv) {
  const args = { db: resolve(root, "data/literature.sqlite") };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === "--db") args.db = resolve(process.cwd(), argv[i += 1]);
    else if (argv[i] === "--file") args.file = resolve(process.cwd(), argv[i += 1]);
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  if (!args.file) throw new Error("--file <results.json> is required");
  return args;
}

function normalize(entry) {
  if (!entry || typeof entry !== "object") return null;
  const id = Number(entry.id);
  if (!Number.isInteger(id) || id <= 0) return null;
  const direction = String(entry.direction || "").trim();
  if (!KEY_SET.has(direction)) return null;
  const secondaryRaw = Array.isArray(entry.secondary) ? entry.secondary : [];
  const secondary = [...new Set(secondaryRaw.map((k) => String(k || "").trim()).filter((k) => KEY_SET.has(k) && k !== direction))].slice(0, 2);
  let confidence = Number(entry.confidence);
  if (!Number.isFinite(confidence)) confidence = 0.5;
  confidence = Math.min(1, Math.max(0, confidence));
  const reason = String(entry.reason || "").slice(0, 200);
  return { id, direction, secondary, confidence, reason };
}

function main() {
  const args = parseArgs(process.argv);
  const raw = JSON.parse(readFileSync(args.file, "utf8"));
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.results) ? raw.results : null;
  if (!list) throw new Error("Input must be a JSON array or {results:[...]}");

  const stats = { total: list.length, updated: 0, invalid: 0, missing: 0, skippedManual: 0 };
  const db = new DatabaseSync(args.db);
  try {
    const exists = db.prepare("SELECT direction_source FROM articles WHERE id = ?");
    const update = db.prepare(
      `UPDATE articles
          SET research_direction = ?, research_direction_secondary = ?, direction_confidence = ?,
              direction_source = 'ai', direction_reason = ?, classified_at = ?
        WHERE id = ? AND (direction_source IS NULL OR direction_source != 'manual')`
    );
    db.exec("BEGIN");
    try {
      for (const entry of list) {
        const row = normalize(entry);
        if (!row) { stats.invalid += 1; continue; }
        const current = exists.get(row.id);
        if (!current) { stats.missing += 1; continue; }
        if (current.direction_source === "manual") { stats.skippedManual += 1; continue; }
        const lowConfidence = row.confidence < 0.6;
        const reason = (lowConfidence ? "[待复核]" : "") + row.reason;
        update.run(
          row.direction,
          row.secondary.length ? row.secondary.join(",") : null,
          row.confidence,
          reason,
          new Date().toISOString(),
          row.id
        );
        stats.updated += 1;
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }

    const classified = db.prepare(
      "SELECT COUNT(*) AS n FROM articles WHERE research_direction IS NOT NULL"
    ).get().n;
    const total = db.prepare("SELECT COUNT(*) AS n FROM articles").get().n;
    const pendingReview = db.prepare(
      "SELECT COUNT(*) AS n FROM articles WHERE direction_reason LIKE '[待复核]%'"
    ).get().n;
    console.log(JSON.stringify({ ...stats, coverage: `${classified}/${total}`, pendingReview }, null, 1));
  } finally {
    db.close();
  }
}

main();
