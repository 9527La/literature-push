#!/usr/bin/env node
/**
 * Idempotent migration: adds the research-direction columns to `articles`.
 *
 * Run once on first deployment (and safe to re-run — existing columns are
 * detected and skipped). The main service code is untouched; classification
 * columns are owned by the AI-direction pipeline (see RUNBOOK-AI-DIRECTION.md).
 *
 * Usage:
 *   node scripts/migrate-directions.mjs [--db <path>]
 */
import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const COLUMNS = [
  ["research_direction", "TEXT"],
  ["research_direction_secondary", "TEXT"],
  ["direction_confidence", "REAL"],
  ["direction_source", "TEXT"],
  ["direction_reason", "TEXT"],
  ["classified_at", "TEXT"]
];

function parseArgs(argv) {
  const args = { db: resolve(root, "data/literature.sqlite") };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === "--db") args.db = resolve(process.cwd(), argv[i += 1]);
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv);
  const db = new DatabaseSync(args.db);
  try {
    const existing = new Set(db.prepare("PRAGMA table_info(articles)").all().map((column) => column.name));
    const added = [];
    for (const [name, type] of COLUMNS) {
      if (existing.has(name)) continue;
      db.exec(`ALTER TABLE articles ADD COLUMN ${name} ${type}`);
      added.push(name);
    }
    db.exec("CREATE INDEX IF NOT EXISTS idx_articles_direction ON articles(research_direction)");
    const total = db.prepare("SELECT COUNT(*) AS n FROM articles").get().n;
    const unclassified = db.prepare("SELECT COUNT(*) AS n FROM articles WHERE research_direction IS NULL").get().n;
    console.log(JSON.stringify({ db: args.db, added, columnsPresent: COLUMNS.every(([name]) => existing.has(name) || added.includes(name)), total, unclassified }, null, 1));
  } finally {
    db.close();
  }
}

main();
