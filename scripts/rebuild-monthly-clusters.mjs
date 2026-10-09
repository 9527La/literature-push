// 一次性修复：按归类映射重建 9 月月度专报的「主题聚类速评」段（全覆盖）。
// 用法：node scripts/rebuild-monthly-clusters.mjs
// 前置：scripts/prepare-cluster-fix.mjs 已生成 data/cluster-fix/report-<id>.json，
//       scripts/cluster-assigns.json 提供未归组文献的语义归类。
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const db = new DatabaseSync("data/literature.sqlite");
const assigns = JSON.parse(readFileSync("scripts/cluster-assigns.json", "utf8"));

const stripCount = (name) => name.replace(/[（(][^）]*篇[^）]*[）)]\s*$/, "").trim();
const rows = db.prepare(`
  SELECT id, direction, period_start, period_end, content_md, stats_json
  FROM ai_reports WHERE status = 'ready' AND kind = 'monthly' AND direction IS NOT NULL ORDER BY id
`).all();

const selectArticle = db.prepare("SELECT title FROM articles WHERE id = ?");
const summary = [];

for (const row of rows) {
  const assign = assigns[String(row.id)];
  if (!assign) continue; // 7/8 月或已全覆盖的报告不动

  const stats = JSON.parse(row.stats_json || "{}");
  const briefs = stats.paperBriefs || [];
  const mdLines = (row.content_md || "").replace(/\r\n/g, "\n").split("\n");

  // 定位聚类段与现有组（沿用组顺序；组名剥篇数尾巴）
  let clusterStart = -1;
  let clusterEnd = mdLines.length;
  const clusterOrder = [];
  const existingIds = new Map(); // 组名 -> [ids]（原 md 已归组的）
  let current = null;
  for (let i = 0; i < mdLines.length; i++) {
    const line = mdLines[i];
    if (/^##\s+.*主题聚类/.test(line)) { clusterStart = i; continue; }
    if (clusterStart !== -1 && /^##\s+/.test(line)) { clusterEnd = i; break; }
    const h3 = line.match(/^###\s+(.+)$/);
    if (h3 && clusterStart !== -1) {
      const name = stripCount(h3[1]);
      current = { name, ids: [] };
      existingIds.set(name, current.ids);
      clusterOrder.push(name);
      continue;
    }
    const review = line.match(/^[-*]\s*\[(\d{4,6})\]/);
    if (review && current) current.ids.push(Number(review[1]));
  }
  if (clusterStart === -1) { summary.push({ reportId: row.id, skipped: "no cluster section" }); continue; }

  // 合并归类：原 md 归组优先，再并入 assigns（去重）
  const merged = clusterOrder.map((name) => {
    const ids = [...new Set([...(existingIds.get(name) || []), ...(assign[name] || [])])];
    return { name, ids };
  });
  for (const [name, ids] of Object.entries(assign)) {
    if (!existingIds.has(name)) merged.push({ name, ids: [...new Set(ids)] });
  }

  // 全覆盖校验：briefs 每篇都必须被覆盖，遗漏进兜底组
  const covered = new Set(merged.flatMap((c) => c.ids));
  const orphans = briefs.filter((b) => !covered.has(b.id)).map((b) => b.id);
  if (orphans.length) merged.push({ name: "其他研究主题", ids: orphans });

  // 重建聚类段：组内按 id 升序，行内补标题（BriefCard 主要用 paperBriefs 渲染，行文本仅兜底）
  const clusterLines = ["## 主题聚类速评", ""];
  let total = 0;
  for (const cluster of merged) {
    if (!cluster.ids.length) continue;
    clusterLines.push(`### ${cluster.name}`, "");
    const sorted = [...cluster.ids].sort((a, b) => a - b);
    for (const id of sorted) {
      const title = String(selectArticle.get(id)?.title || "").replace(/\|/g, "/");
      clusterLines.push(`- [${id}] **${title}**`);
      total++;
    }
    clusterLines.push("");
  }

  const next = [...mdLines.slice(0, clusterStart), ...clusterLines, ...mdLines.slice(clusterEnd)].join("\n");
  db.prepare("UPDATE ai_reports SET content_md = ? WHERE id = ?").run(next, row.id);
  summary.push({
    reportId: row.id,
    direction: row.direction,
    briefs: briefs.length,
    before: [...existingIds.values()].reduce((s, ids) => s + ids.length, 0),
    after: total,
    orphans: orphans.length,
    clusters: merged.map((c) => ({ name: c.name, ids: c.ids.length }))
  });
}

console.log(JSON.stringify(summary, null, 1));
