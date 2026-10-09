// 一次性探针：检查月度专报的聚类覆盖与 paperBriefs 规模。
// 用法：node scripts/inspect-monthly-clusters.mjs
import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync("data/literature.sqlite", { readOnly: true });
const rows = db.prepare(`
  SELECT id, kind, period_start, period_end, direction, content_md, stats_json
  FROM ai_reports WHERE status = 'ready' ORDER BY id
`).all();

for (const row of rows) {
  const isMonthlyDirection = row.kind === "monthly" && row.direction;
  if (!isMonthlyDirection) {
    console.log(JSON.stringify({ id: row.id, kind: row.kind, period: row.period_start, direction: row.direction, monthly: null }));
    continue;
  }
  const md = row.content_md || "";
  const clusters = [];
  let current = null;
  for (const line of md.replace(/\r\n/g, "\n").split("\n")) {
    const h3 = line.match(/^###\s+(.+)$/);
    if (h3) {
      current = { name: h3[1].trim(), ids: [] };
      clusters.push(current);
      continue;
    }
    const review = line.match(/^[-*]\s*\[(\d{4,6})\]/);
    if (review && current) current.ids.push(Number(review[1]));
  }
  let briefs = [];
  try {
    const stats = JSON.parse(row.stats_json || "{}");
    briefs = stats.paperBriefs || [];
  } catch { /* 忽略 */ }
  const clusteredIds = new Set(clusters.flatMap((c) => c.ids));
  const missing = briefs.filter((b) => !clusteredIds.has(b.id));
  console.log(JSON.stringify({
    id: row.id,
    kind: row.kind,
    period: `${row.period_start}~${row.period_end}`,
    direction: row.direction,
    clusters: clusters.map((c) => ({ name: c.name, ids: c.ids.length })),
    clusteredUnique: clusteredIds.size,
    briefsTotal: briefs.length,
    missingCount: missing.length,
    missingSample: missing.slice(0, 5).map((b) => ({ id: b.id, title: (b.title || "").slice(0, 40) }))
  }));
}
