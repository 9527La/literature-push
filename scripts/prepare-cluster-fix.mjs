// 一次性修复脚本：为 9 月月度专报重建「全覆盖」主题聚类段。
// 流程：解析现有聚类组与 paperBriefs → 规则粗分（组名短语命中 title/keywords）
// → 规则无法判定的写入 data/cluster-fix/unresolved-<id>.json 交会话归类。
// 用法：node scripts/prepare-cluster-fix.mjs
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, writeFileSync } from "node:fs";

const db = new DatabaseSync("data/literature.sqlite", { readOnly: true });
mkdirSync("data/cluster-fix", { recursive: true });

const STOP_PHRASES = new Set(["技术", "系统", "应用", "方法", "研究", "其他", "综述", "特色", "新型", "装备", "评估", "工具", "场景", "运行", "分析"]);

function corePhrases(name) {
  const clean = name.replace(/[（(][^）)]*[）)]/g, "").trim();
  return clean
    .split(/[、，,;；/与和及]|以及/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2 && !STOP_PHRASES.has(s));
}

function normalizeTitle(text) {
  return String(text || "").toLowerCase().replace(/\s+/g, " ");
}

const rows = db.prepare(`
  SELECT id, kind, period_start, period_end, direction, content_md, stats_json
  FROM ai_reports WHERE status = 'ready' AND kind = 'monthly' AND direction IS NOT NULL
  ORDER BY id
`).all();

const summary = [];
for (const row of rows) {
  const md = row.content_md || "";
  // 只处理「聚类缺失」的 9 月报告：聚类 id 数 < briefs 数
  let stats = {};
  try { stats = JSON.parse(row.stats_json || "{}"); } catch { /* 忽略 */ }
  const briefs = stats.paperBriefs || [];
  if (!briefs.length) continue;

  // 现有聚类组（组名 + 已归组 id + 组内原始行文本）
  const clusters = [];
  let current = null;
  const otherLines = []; // 非聚类段原文（重建时原样保留）
  const mdLines = md.replace(/\r\n/g, "\n").split("\n");
  let inClusterSection = false;
  let clusterSectionStart = -1;
  let clusterSectionEnd = -1;
  for (let i = 0; i < mdLines.length; i++) {
    const line = mdLines[i];
    if (/^##\s+.*主题聚类/.test(line)) { inClusterSection = true; clusterSectionStart = i; continue; }
    if (inClusterSection && /^##\s+/.test(line)) { clusterSectionEnd = i; inClusterSection = false; }
    const h3 = line.match(/^###\s+(.+)$/);
    if (h3 && inClusterSection) {
      current = { name: h3[1].trim(), ids: [], lines: [] };
      clusters.push(current);
      continue;
    }
    const review = line.match(/^[-*]\s*\[(\d{4,6})\]\s*(.*)$/);
    if (review && current) { current.ids.push(Number(review[1])); current.lines.push(line); continue; }
    if (!inClusterSection) otherLines.push(line);
  }
  if (clusterSectionEnd === -1 && inClusterSection) clusterSectionEnd = mdLines.length;
  const clusteredIds = new Set(clusters.flatMap((c) => c.ids));
  const missing = briefs.filter((b) => !clusteredIds.has(b.id));
  if (!missing.length) continue; // 已全覆盖（7/8 月或 hv），跳过

  // paperBriefs 补 title/keywords（JOIN articles）
  const briefById = new Map();
  const selectArticle = db.prepare("SELECT title, keywords FROM articles WHERE id = ?");
  for (const b of briefs) {
    const article = selectArticle.get(b.id);
    briefById.set(b.id, { ...b, title: article?.title || "", keywords: article?.keywords || "" });
  }

  // 规则粗分：组名核心短语命中 title/keywords → 归组；多组命中取消歧；无命中 → unresolved
  const clusterPhrases = clusters.map((c) => ({ name: c.name, phrases: corePhrases(c.name) }));
  const assignments = {};
  for (const c of clusters) assignments[c.name] = [...c.ids];
  const unresolved = [];
  for (const brief of missing) {
    const hay = normalizeTitle(`${briefById.get(brief.id)?.title} ${briefById.get(brief.id)?.keywords}`);
    const hits = [];
    for (const cp of clusterPhrases) {
      const matched = cp.phrases.filter((p) => hay.includes(p.toLowerCase()));
      if (matched.length) hits.push({ name: cp.name, matched: matched.length, longest: Math.max(...matched.map((p) => p.length)) });
    }
    if (hits.length === 1) {
      assignments[hits[0].name].push(brief.id);
    } else if (hits.length > 1) {
      hits.sort((a, b) => b.matched - a.matched || b.longest - a.longest);
      if (hits[0].matched > hits[1].matched) assignments[hits[0].name].push(brief.id);
      else unresolved.push(brief.id);
    } else {
      unresolved.push(brief.id);
    }
  }

  writeFileSync(`data/cluster-fix/report-${row.id}.json`, JSON.stringify({
    reportId: row.id,
    direction: row.direction,
    period: `${row.period_start}~${row.period_end}`,
    clusters: clusterPhrases.map((cp) => ({ name: cp.name, phrases: cp.phrases, ids: assignments[cp.name] })),
    unresolvedIds: unresolved,
    briefById: Object.fromEntries([...briefById.entries()].map(([id, b]) => [id, { title: b.title, keywords: b.keywords, object: b.object, method: b.method, finding: b.finding }]))
  }, null, 1));

  summary.push({ reportId: row.id, direction: row.direction, briefs: briefs.length, clustered: clusteredIds.size, ruleAssigned: missing.length - unresolved.length, unresolved: unresolved.length });
}

console.log(JSON.stringify(summary, null, 1));
