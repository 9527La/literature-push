#!/usr/bin/env node
/** 校验 7 份总览报告的「值得注意」节已带 [id] 锚点（读库只读）。 */
import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const db = new DatabaseSync(resolve(root, "data", "literature.sqlite"), { readOnly: true });
const rows = db.prepare(`
  SELECT kind, period_start, period_end, content_md, stats_json
  FROM ai_reports WHERE direction IS NULL AND status = 'ready'
  ORDER BY kind, period_start
`).all();
let allOk = true;
for (const row of rows) {
  const ids = JSON.parse(row.stats_json || "{}").highlightIds || [];
  const lines = row.content_md.split("\n");
  const start = lines.findIndex((l) => /^##\s/.test(l) && l.includes("值得注意"));
  const pickIds = [];
  if (start !== -1) {
    for (let i = start + 1; i < lines.length; i += 1) {
      if (/^##\s/.test(lines[i])) break;
      const m = lines[i].match(/^[-*]\s*\[(\d{4,6})\]/);
      if (m) pickIds.push(Number(m[1]));
    }
  }
  const ok = JSON.stringify(pickIds) === JSON.stringify(ids);
  if (!ok) allOk = false;
  console.log(`${ok ? "OK " : "BAD"} ${row.kind} ${row.period_start}~${row.period_end} picks=[${pickIds.join(",")}] expected=[${ids.join(",")}]`);
}
console.log(allOk ? "OVERVIEW REFRESH VERIFIED" : "REFRESH INCOMPLETE");
db.close();
