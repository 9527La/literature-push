// 一次性：第二轮归类——把「其他研究主题」残余移入正确主题组并移除该组。
// 用法：node scripts/finalize-clusters-step2.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const db = new DatabaseSync("data/literature.sqlite");
const assigns = JSON.parse(readFileSync("scripts/cluster-assigns-2.json", "utf8"));

const rows = db.prepare(`
  SELECT id, direction, content_md, stats_json FROM ai_reports
  WHERE status = 'ready' AND kind = 'monthly' AND direction IS NOT NULL ORDER BY id
`).all();

const selectTitle = db.prepare("SELECT title FROM articles WHERE id = ?");

for (const row of rows) {
  const assign = assigns[String(row.id)];
  if (!assign) continue;
  const stats = JSON.parse(row.stats_json || "{}");
  const briefs = stats.paperBriefs || [];
  const mdLines = (row.content_md || "").replace(/\r\n/g, "\n").split("\n");

  let start = -1, end = mdLines.length;
  const groups = [];
  let current = null;
  for (let i = 0; i < mdLines.length; i++) {
    const line = mdLines[i];
    if (/^##\s+.*主题聚类/.test(line)) { start = i; continue; }
    if (start !== -1 && /^##\s+/.test(line)) { end = i; break; }
    const h3 = line.match(/^###\s+(.+)$/);
    if (h3 && start !== -1) { current = { name: h3[1].trim(), ids: [] }; groups.push(current); continue; }
    const review = line.match(/^[-*]\s*\[(\d{4,6})\]/);
    if (review && current) current.ids.push(Number(review[1]));
  }

  // 迁移残余：从原组删除并追加到目标组
  const moved = [];
  for (const [targetName, ids] of Object.entries(assign)) {
    let target = groups.find((g) => g.name === targetName);
    if (!target) { target = { name: targetName, ids: [] }; groups.push(target); }
    for (const id of ids) {
      for (const group of groups) {
        if (group === target) continue;
        const index = group.ids.indexOf(id);
        if (index !== -1) group.ids.splice(index, 1);
      }
      if (!target.ids.includes(id)) { target.ids.push(id); moved.push(id); }
    }
  }
  // 校验无重复、全覆盖
  const seen = new Set();
  let dup = 0;
  for (const group of groups) {
    group.ids = group.ids.filter((id) => {
      if (seen.has(id)) { dup++; return false; }
      seen.add(id);
      return true;
    });
  }
  const covered = seen.size;
  const groups_out = groups.filter((g) => g.ids.length);

  const next = [...mdLines.slice(0, start), "## 主题聚类速评", ""];
  for (const group of groups_out) {
    next.push(`### ${group.name}`, "");
    for (const id of [...group.ids].sort((a, b) => a - b)) {
      next.push(`- [${id}] **${String(selectTitle.get(id)?.title || "").replace(/\|/g, "/")}**`);
    }
    next.push("");
  }
  const updated = [...next, ...mdLines.slice(end)].join("\n");
  db.prepare("UPDATE ai_reports SET content_md = ? WHERE id = ?").run(updated, row.id);
  console.log(JSON.stringify({ reportId: row.id, direction: row.direction, moved: moved.length, dup, covered, briefs: briefs.length, groups: groups_out.map((g) => ({ name: g.name, ids: g.ids.length })) }));
}
