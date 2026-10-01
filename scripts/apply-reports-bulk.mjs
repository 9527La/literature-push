#!/usr/bin/env node
/**
 * Bulk-apply a directory of direction-report JSONs: for each file, locate its
 * export batch (naming convention below), run the same validation/write path
 * as apply-report.mjs, and print one summary line per report.
 *
 * Batch naming conventions (see export-report-batch.mjs --out defaults):
 *   weekly direction batches : data\report-batch-d-<direction>.json
 *   monthly direction batches: data\report-batch-d-<month>-<direction>.json
 *
 * Usage:
 *   node scripts/apply-reports-bulk.mjs --dir <inbox-dir> [--db <path>]
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readdirSync } from "node:fs";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const args = { db: resolve(root, "data/literature.sqlite"), dir: "" };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === "--db") args.db = resolve(process.cwd(), argv[i += 1]);
    else if (argv[i] === "--dir") args.dir = resolve(process.cwd(), argv[i += 1]);
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  if (!args.dir) throw new Error("--dir <inbox-dir> is required");
  return args;
}

function batchFileFor(report) {
  const direction = report.direction;
  if (!direction) return null;
  if (report.kind === "weekly") return join(root, "data", `report-batch-d-${direction}.json`);
  const month = String(report.periodStart || "").slice(0, 7);
  return join(root, "data", `report-batch-d-${month}-${direction}.json`);
}

async function main() {
  const args = parseArgs(process.argv);
  const files = readdirSync(args.dir).filter((name) => name.endsWith(".json")).sort();
  if (!files.length) throw new Error(`no .json files in ${args.dir}`);
  let ok = 0;
  let failed = 0;
  for (const name of files) {
    const report = JSON.parse(readFileSync(join(args.dir, name), "utf8"));
    const batchFile = batchFileFor(report);
    if (!batchFile) {
      console.log(`SKIP ${name}: no direction`);
      continue;
    }
    try {
      const { stdout } = await execFileAsync(
        process.execPath,
        [join(root, "scripts", "apply-report.mjs"), "--export", batchFile, "--file", join(args.dir, name), "--db", args.db],
        { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 }
      );
      const line = stdout.split("\n").filter((l) => l.trim().startsWith('"updated"') || l.trim().startsWith('"invalid"') || l.trim().startsWith('"direction"')).join(" ");
      console.log(`OK   ${name} -> ${line.replace(/\s+/g, " ")}`);
      ok += 1;
    } catch (error) {
      const out = (error.stdout || "").replace(/\s+/g, " ").slice(0, 240);
      console.log(`FAIL ${name}: ${out || error.message}`);
      failed += 1;
    }
  }
  console.log(`bulk done: ok=${ok} failed=${failed}`);
  if (failed) process.exitCode = 1;
}

main();
