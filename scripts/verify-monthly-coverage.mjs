// 最终校验：全部月度专报聚类必须覆盖 paperBriefs 全部文献。通过 exit 0，否则 exit 1。
// 用法：node scripts/verify-monthly-coverage.mjs
import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync("data/literature.sqlite", { readOnly: true });
const rows = db.prepare(`
  SELECT id, direction, content_md, stats_json FROM ai_reports
  WHERE status = 'ready' AND kind = 'monthly' AND direction IS NOT NULL ORDER BY id
`).all();

let failures = 0;
const lines = [];
for (const row of rows) {
  const clusters = [];
  let current = null;
  for (const line of (row.content_md || "").split("\n")) {
    const h3 = line.match(/^###\s+(.+)$/);
    if (h3) { current = { name: h3[1].trim(), ids: [] }; clusters.push(current); continue; }
    const review = line.match(/^[-*]\s*\[(\d{4,6})\]/);
    if (review && current) current.ids.push(Number(review[1]));
  }
  let briefs = [];
  try { briefs = (JSON.parse(row.stats_json || "{}").paperBriefs || []).map((b) => b.id); } catch { /* 忽略 */ }
  const clustered = clusters.flatMap((c) => c.ids);
  const clusteredSet = new Set(clustered);
  const dup = clustered.length - clusteredSet.size;
  const missing = briefs.filter((id) => !clusteredSet.has(id));
  const hasCountSuffix = clusters.some((c) => /[（(][^）]*篇[^）]*[）)]\s*$/.test(c.name));
  const ok = missing.length === 0 && dup === 0 && !hasCountSuffix && clustered.length === briefs.length;
  if (!ok) failures++;
  lines.push(`${row.id} ${row.direction}: clustered=${clustered.length} briefs=${briefs.length} dup=${dup} missing=${missing.length} countSuffix=${hasCountSuffix} -> ${ok ? "OK" : "FAIL"}`);
}
console.log(lines.join("\n"));
console.log(failures === 0 ? "ALL MONTHLY REPORTS FULLY COVERED" : `${failures} REPORT(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
