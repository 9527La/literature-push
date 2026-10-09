// 一次性：第三轮——补 266/267/270 归类 + 全部月报组名循环剥计数尾巴。
// 用法：node scripts/finalize-clusters-step3.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const db = new DatabaseSync("data/literature.sqlite");
const assigns = JSON.parse(readFileSync("scripts/cluster-assigns-3.json", "utf8"));
const stripCount = (name) => name.replace(/[（(][^）)]*篇[^）)]*[）)]/g, "").replace(/[（(]\s*[）)]/g, "").trim();

const rows = db.prepare(`
  SELECT id, direction, content_md, stats_json FROM ai_reports
  WHERE status = 'ready' AND kind = 'monthly' AND direction IS NOT NULL ORDER BY id
`).all();

const selectTitle = db.prepare("SELECT title FROM articles WHERE id = ?");

for (const row of rows) {
  const stats = JSON.parse(row.stats_json || "{}");
  const briefs = stats.paperBriefs || [];
  let mdLines = (row.content_md || "").replace(/\r\n/g, "\n").split("\n");

  let start = -1, end = mdLines.length;
  const groups = [];
  let current = null;
  for (let i = 0; i < mdLines.length; i++) {
    const line = mdLines[i];
    if (/^##\s+.*主题聚类/.test(line)) { start = i; continue; }
    if (start !== -1 && /^##\s+/.test(line)) { end = i; break; }
    const h3 = line.match(/^###\s+(.+)$/);
    if (h3 && start !== -1) { current = { name: stripCount(h3[1]), ids: [] }; groups.push(current); continue; }
    const review = line.match(/^[-*]\s*\[(\d{4,6})\]/);
    if (review && current) current.ids.push(Number(review[1]));
  }

  // 第三轮归类迁移（266/267/270）
  const assign = assigns[String(row.id)];
  if (assign) {
    for (const [targetName, ids] of Object.entries(assign)) {
      let target = groups.find((g) => g.name === targetName);
      if (!target) { target = { name: targetName, ids: [] }; groups.push(target); }
      for (const id of ids) {
        for (const group of groups) {
          if (group === target) continue;
          const index = group.ids.indexOf(id);
          if (index !== -1) group.ids.splice(index, 1);
        }
        if (!target.ids.includes(id)) target.ids.push(id);
      }
    }
  }

  const seen = new Set();
  for (const group of groups) {
    group.ids = group.ids.filter((id) => {
      if (!briefs.map((b) => b.id).includes(id)) return false;
      if (seen.has(id)) return false;
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
  console.log(JSON.stringify({ reportId: row.id, direction: row.direction, covered, briefs: briefs.length, groups: groups_out.map((g) => ({ name: g.name, ids: g.ids.length })) }));
}
