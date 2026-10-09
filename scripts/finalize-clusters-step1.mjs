// 一次性：跨组去重 + 导出「其他研究主题」残余清单（供第二轮归类）。
// 用法：node scripts/finalize-clusters-step1.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync, writeFileSync } from "node:fs";

const db = new DatabaseSync("data/literature.sqlite");
const assigns = JSON.parse(readFileSync("scripts/cluster-assigns.json", "utf8"));
const stripCount = (name) => name.replace(/[（(][^）]*篇[^）]*[）)]\s*$/, "").trim();

const rows = db.prepare(`
  SELECT id, direction, content_md, stats_json FROM ai_reports
  WHERE status = 'ready' AND kind = 'monthly' AND direction IS NOT NULL ORDER BY id
`).all();

const selectTitle = db.prepare("SELECT title FROM articles WHERE id = ?");
const report = [];

for (const row of rows) {
  if (!assigns[String(row.id)]) continue;
  const stats = JSON.parse(row.stats_json || "{}");
  const briefs = stats.paperBriefs || [];
  const briefIds = new Set(briefs.map((b) => b.id));
  const mdLines = (row.content_md || "").replace(/\r\n/g, "\n").split("\n");

  // 解析聚类段
  let start = -1, end = mdLines.length;
  const groups = [];
  let current = null;
  for (let i = 0; i < mdLines.length; i++) {
    const line = mdLines[i];
    if (/^##\s+.*主题聚类/.test(line)) { start = i; continue; }
    if (start !== -1 && /^##\s+/.test(line)) { end = i; break; }
    const h3 = line.match(/^###\s+(.+)$/);
    if (h3 && start !== -1) {
      current = { name: stripCount(h3[1]).trim(), ids: [] };
      groups.push(current);
      continue;
    }
    const review = line.match(/^[-*]\s*\[(\d{4,6})\]/);
    if (review && current) current.ids.push(Number(review[1]));
  }

  // 跨组去重：文献只保留首次出现的组；非法 id（不在 briefs）直接丢弃
  const seen = new Set();
  const other = groups.find((g) => g.name === "其他研究主题");
  const before = groups.map((g) => ({ name: g.name, ids: g.ids.length }));
  for (const group of groups) {
    group.ids = group.ids.filter((id) => {
      if (!briefIds.has(id)) return false;      // 不属于本报告批次 → 丢弃
      if (seen.has(id)) return false;           // 跨组重复 → 丢弃
      seen.add(id);
      return true;
    });
  }

  // 「其他研究主题」残余导出（第二轮归类后移除该组）
  const leftover = other ? other.ids.filter((id) => seen.has(id)) : [];

  const next = [...mdLines.slice(0, start), "## 主题聚类速评", ""];
  let total = 0;
  for (const group of groups) {
    if (!group.ids.length) continue;
    next.push(`### ${group.name}`, "");
    for (const id of [...group.ids].sort((a, b) => a - b)) {
      next.push(`- [${id}] **${String(selectTitle.get(id)?.title || "").replace(/\|/g, "/")}**`);
      total++;
    }
    next.push("");
  }
  const updated = [...next, ...mdLines.slice(end)].join("\n");
  db.prepare("UPDATE ai_reports SET content_md = ? WHERE id = ?").run(updated, row.id);
  report.push({
    reportId: row.id,
    direction: row.direction,
    before: before,
    after: groups.filter((g) => g.ids.length).map((g) => ({ name: g.name, ids: g.ids.length })),
    total,
    briefs: briefs.length,
    leftover: leftover.map((id) => ({ id, title: String(selectTitle.get(id)?.title || "").slice(0, 70) }))
  });
}

writeFileSync("data/cluster-fix/finalize-report.json", JSON.stringify(report, null, 1));
console.log(JSON.stringify(report.map(({ reportId, direction, total, briefs, leftover }) => ({ reportId, direction, total, briefs, leftoverCount: leftover.length, leftover })), null, 1));
