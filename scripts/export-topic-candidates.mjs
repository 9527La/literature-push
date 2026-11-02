#!/usr/bin/env node
/**
 * export-topic-candidates.mjs —— 导出专题选题候选池 + 主题簇（DESIGN-WECHAT-TRANS-COLUMN.md v5）
 *
 * v5 变更（2026-10-28）：
 *   · 时间窗可关闭：--days 0 表示全库，不再限定近一个月
 *   · 新增 --cluster：按标题自动聚出主题簇，供会话先粗筛再读摘要细选
 *     （全库 3000+ 篇标题一次读不完，先看簇摘要，再按 id 回查）
 *
 * 口径要点：
 *   · 时间窗按 first_seen_at（入库时间），不用 first_public_at（TSE 有系统性偏差）
 *   · 不按 deep_analysis 过滤：缺创新点的文章照样进池，制作阶段再补
 *   · 默认排除 5 个方向（用户指定）+ other（未分类）
 *
 * 用法：
 *   node scripts/export-topic-candidates.mjs --days 0 --limit 5000 --cluster
 *   node scripts/export-topic-candidates.mjs --days 30 --limit 400
 *
 * 输出：
 *   data/topic-candidates.json         全量（含摘要，按 id 回查用）
 *   data/topic-candidates-compact.json 标题级（通读用）
 *   data/topic-clusters.json           主题簇（--cluster 时）
 */
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_EXCLUDE = ["protection", "stability", "power-electronics", "storage", "power-quality"];

const STOP = new Set(("the and for with based using via from into under over between among toward towards " +
  "a an of in on to by as at is are be its their this that these those we our " +
  "new novel approach method framework model models scheme strategy algorithm analysis study " +
  "case considering consideration optimal optimization improved enhanced efficient " +
  "review survey perspective overview challenges opportunities").split(" "));

/** 领域泛词对：命中就丢弃——它们描述的是学科而非问题，圈进来的是一整个方向而不是一个专题。 */
const STOP_BIGRAM = new Set([
  "power system", "power systems", "distribution network", "distribution networks",
  "distribution system", "distribution systems", "smart grid", "smart grids",
  "electric vehicle", "electric vehicles", "renewable energy", "energy system",
  "energy systems", "power grid", "power grids", "micro grid", "microgrids",
  "integrated energy", "energy management", "power flow", "load forecasting",
  "machine learning", "deep learning", "reinforcement learning", "artificial intelligence",
  "neural network", "neural networks", "real time", "case study", "large scale"
]);

/** 单复数归一：长度 > 4 的词去掉词尾 s，避免 "network"/"networks" 拆成两簇。 */
const norm = (w) => (w.length > 4 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);

function parseArgs(argv) {
  const a = {
    days: 30, limit: 500, exclude: DEFAULT_EXCLUDE.slice(), cluster: false, clusterLimit: 60,
    db: path.join(root, "data", "literature.sqlite"),
    out: path.join(root, "data", "topic-candidates.json"),
    abstractChars: 260
  };
  for (let i = 2; i < argv.length; i += 1) {
    const k = argv[i], v = argv[i + 1];
    if (k === "--days") { a.days = Number(v); i += 1; }
    else if (k === "--limit") { a.limit = Number(v); i += 1; }
    else if (k === "--exclude") { a.exclude = String(v).split(",").map((s) => s.trim()).filter(Boolean); i += 1; }
    else if (k === "--db") { a.db = v; i += 1; }
    else if (k === "--out") { a.out = v; i += 1; }
    else if (k === "--abstract-chars") { a.abstractChars = Number(v); i += 1; }
    else if (k === "--cluster") { a.cluster = true; }
    else if (k === "--cluster-limit") { a.clusterLimit = Number(v); i += 1; }
    else throw new Error(`Unknown argument: ${k}`);
  }
  return a;
}

function daysAgoYmd(days) {
  const now = new Date(Date.now() + 8 * 3600 * 1000);
  now.setUTCDate(now.getUTCDate() - days);
  return now.toISOString().slice(0, 10);
}

/** 标题 → 主题词。英文取 unigram+bigram，中文取 2-gram（bigram 更具体，优先当簇名）。 */
function terms(title) {
  const t = String(title || "").toLowerCase();
  const en = (t.match(/[a-z][a-z-]{2,}/g) || []).filter((w) => !STOP.has(w)).map(norm);
  const bigrams = [];
  for (let i = 0; i + 1 < en.length; i += 1) {
    const bg = `${en[i]} ${en[i + 1]}`;
    if (!STOP_BIGRAM.has(bg)) bigrams.push(bg);
  }
  const grams = [];
  for (const seg of (t.match(/[\u4e00-\u9fa5]{2,}/g) || [])) {
    for (let i = 0; i + 1 < seg.length; i += 1) grams.push(seg.slice(i, i + 2));
  }
  return { bigrams: [...new Set(bigrams)], unigrams: [...new Set(en)], grams: [...new Set(grams)] };
}

const JOURNAL_SHORT = (j) => {
  const m = String(j || "").match(/Transactions on ([A-Za-z ]+)/);
  if (m) return "T" + m[1].split(" ").filter(Boolean).map((w) => w[0]).join("").toUpperCase();
  if (/^Energy$/.test(j)) return "Energy";
  if (/^Applied Energy$/.test(j)) return "AE";
  if (/^Renewable Energy$/.test(j)) return "RE";
  return String(j || "").slice(0, 12);
};

/** 按标题主题词聚簇：词频过滤 → 集合构建 → 高重叠去重 → 按篇数与 Trans 占比排序。 */
function buildClusters(articles, limit) {
  const index = new Map(); // term -> Set(articleIdx)
  const push = (term, i) => {
    if (!index.has(term)) index.set(term, new Set());
    index.get(term).add(i);
  };

  articles.forEach((a, i) => {
    const { bigrams, unigrams, grams } = terms(a.title);
    bigrams.forEach((t) => push(t, i));
    grams.forEach((t) => push(t, i));
    unigrams.forEach((t) => push(t, i));
  });

  const isTrans = (a) => /Transactions/.test(a.journal || "");

  // 候选簇：bigram/中文 2-gram 命中 ≥3 篇；unigram 要求 ≥5 篇且不作为首选
  const candidates = [];
  for (const [term, set] of index) {
    const isGram = term.includes(" ") || /[\u4e00-\u9fa5]/.test(term);
    const minCount = isGram ? 3 : 5;
    if (set.size < minCount || set.size > 25) continue;
    const idxs = [...set];
    const trans = idxs.filter((i) => isTrans(articles[i])).length;
    candidates.push({
      term, idxs, ids: idxs.map((i) => articles[i].id),
      count: idxs.length, trans, transRatio: trans / idxs.length, isGram
    });
  }

  // 优先 bigram/中文，其次 unigram；同类型按 (Trans 数, 篇数) 降序
  candidates.sort((x, y) => (y.isGram - x.isGram) || (y.trans - x.trans) || (y.count - x.count));

  const chosen = [];
  for (const c of candidates) {
    const tooSimilar = chosen.some((o) => {
      const inter = c.idxs.filter((i) => o.set.has(i)).length;
      const union = new Set([...c.idxs, ...o.idxs]).size;
      return inter / union > 0.6;
    });
    if (tooSimilar) continue;
    chosen.push({ ...c, set: new Set(c.idxs) });
    if (chosen.length >= limit) break;
  }

  return chosen.map((c) => {
    const dirs = {};
    const journals = {};
    for (const i of c.idxs) {
      const a = articles[i];
      dirs[a.direction] = (dirs[a.direction] || 0) + 1;
      const js = JOURNAL_SHORT(a.journal);
      journals[js] = (journals[js] || 0) + 1;
    }
    const samples = c.idxs.slice(0, 8).map((i) => ({
      id: articles[i].id,
      t: articles[i].title.length > 110 ? articles[i].title.slice(0, 110) + "…" : articles[i].title,
      j: JOURNAL_SHORT(articles[i].journal)
    }));
    return {
      term: c.term,
      count: c.count,
      transRatio: Number(c.transRatio.toFixed(2)),
      directions: dirs,
      journals,
      ids: c.ids,
      samples
    };
  });
}

function main() {
  const a = parseArgs(process.argv);
  if (!fs.existsSync(a.db)) {
    console.error(`数据库不存在：${a.db}`);
    process.exit(2);
  }
  const unlimited = !(a.days > 0);
  const from = unlimited ? "0000-00-00" : daysAgoYmd(a.days);
  const db = new DatabaseSync(a.db);

  const ph = a.exclude.map(() => "?").join(",");
  const where = `substr(first_seen_at,1,10) >= ?
                 AND research_direction IS NOT NULL
                 AND research_direction <> 'other'
                 AND research_direction NOT IN (${ph})`;

  const rows = db.prepare(`
    SELECT id, title, journal, research_direction, abstract,
           deep_analysis IS NOT NULL AND deep_analysis <> '' AS has_deep,
           figure_path, substr(first_seen_at,1,10) AS seen
    FROM articles
    WHERE ${where}
    ORDER BY id DESC
    LIMIT ?
  `).all(from, ...a.exclude, a.limit);

  const byDirection = {};
  const articles = rows.map((r) => {
    byDirection[r.research_direction] = (byDirection[r.research_direction] || 0) + 1;
    const abs = String(r.abstract || "").replace(/\s+/g, " ").trim();
    return {
      id: r.id,
      title: String(r.title || "").replace(/\s+/g, " ").trim(),
      journal: r.journal || "",
      direction: r.research_direction,
      seen: r.seen,
      hasDeep: Boolean(r.has_deep),
      hasFigure: Boolean(r.figure_path),
      abstract: abs.length > a.abstractChars ? abs.slice(0, a.abstractChars) + "…" : abs
    };
  });

  const total = db.prepare(`SELECT COUNT(*) AS n FROM articles WHERE ${where}`).get(from, ...a.exclude).n;
  const deepCount = db.prepare(`
    SELECT COUNT(*) AS n FROM articles WHERE ${where}
      AND deep_analysis IS NOT NULL AND deep_analysis <> ''
  `).get(from, ...a.exclude).n;

  const window = { days: unlimited ? 0 : a.days, from: unlimited ? "全部" : from, to: daysAgoYmd(0) };
  const payload = { exportedAt: new Date().toISOString(), window, excluded: a.exclude, total, deepCount, byDirection, returned: articles.length, articles };

  fs.mkdirSync(path.dirname(a.out), { recursive: true });
  fs.writeFileSync(a.out, JSON.stringify(payload, null, 1), "utf8");

  const compactPath = a.out.replace(/\.json$/i, "-compact.json");
  fs.writeFileSync(compactPath, JSON.stringify({
    exportedAt: payload.exportedAt, window, total, deepCount, byDirection,
    articles: articles.map((x) => ({
      id: x.id, d: x.direction, j: JOURNAL_SHORT(x.journal),
      t: x.title.length > 96 ? x.title.slice(0, 96) + "…" : x.title,
      deep: x.hasDeep ? 1 : 0
    }))
  }, null, 0), "utf8");

  const out = { out: a.out, compact: compactPath, window, total, deepCount, returned: articles.length, byDirection };

  if (a.cluster) {
    const clusters = buildClusters(articles, a.clusterLimit);
    const clusterPath = path.join(path.dirname(a.out), "topic-clusters.json");
    fs.writeFileSync(clusterPath, JSON.stringify({
      exportedAt: payload.exportedAt, window, total, articlesScanned: articles.length, clusters
    }, null, 1), "utf8");
    out.clusters = clusterPath;
    out.clusterCount = clusters.length;
  }

  console.log(JSON.stringify(out, null, 1));
}

main();
