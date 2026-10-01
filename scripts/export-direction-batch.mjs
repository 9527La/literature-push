#!/usr/bin/env node
/**
 * Export a batch of unclassified articles for AI direction classification.
 *
 * Used by the WorkBuddy scheduled task (see RUNBOOK-AI-DIRECTION.md): the
 * remote runner executes this on the deployment host, the resulting JSON is
 * pulled back, classified by the agent, and applied with
 * `apply-directions.mjs`. Rows classified as `manual` always carry a
 * direction, so `research_direction IS NULL` is the only gap filter needed.
 *
 * Usage:
 *   node scripts/export-direction-batch.mjs [--db <path>] [--limit 400] [--out <path>]
 */
import { DatabaseSync } from "node:sqlite";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const args = { db: resolve(root, "data/literature.sqlite"), limit: 400, out: resolve(root, "data/direction-batch.json") };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === "--db") args.db = resolve(process.cwd(), argv[i += 1]);
    else if (argv[i] === "--limit") args.limit = Number(argv[i += 1]);
    else if (argv[i] === "--out") args.out = resolve(process.cwd(), argv[i += 1]);
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  if (!Number.isFinite(args.limit) || args.limit < 1) throw new Error("--limit must be a positive number");
  args.limit = Math.min(Math.floor(args.limit), 500);
  return args;
}

const abstractClip = 600;

function main() {
  const args = parseArgs(process.argv);
  const db = new DatabaseSync(args.db, { readOnly: true });
  try {
    const remaining = db.prepare("SELECT COUNT(*) AS n FROM articles WHERE research_direction IS NULL").get().n;
    const rows = db.prepare(
      `SELECT id, title, keywords, abstract
         FROM articles
        WHERE research_direction IS NULL
        ORDER BY id DESC
        LIMIT ?`
    ).all(args.limit);

    const articles = rows.map((row) => ({
      id: row.id,
      title: row.title || "",
      keywords: row.keywords || "",
      abstract: (row.abstract || "").slice(0, abstractClip)
    }));

    const payload = { exportedAt: new Date().toISOString(), remaining, count: articles.length, articles };
    mkdirSync(dirname(args.out), { recursive: true });
    writeFileSync(args.out, JSON.stringify(payload, null, 1), "utf8");
    const withAbstract = articles.filter((a) => a.abstract.length > 100).length;
    console.log(`exported=${articles.length} remaining_before=${remaining} with_abstract=${withAbstract} out=${args.out}`);
  } finally {
    db.close();
  }
}

main();
