#!/usr/bin/env node
/**
 * Export report source material for the AI weekly digest / monthly trend
 * report (PLAN-AI-REPORTS.md, job: digest / report in RUNBOOK-AI-JOBS.md).
 *
 * Used by the WorkBuddy scheduled task: the remote runner executes this on the
 * deployment host, the resulting JSON is pulled back, the agent writes the
 * report from it, and `apply-report.mjs` stores the result.
 *
 * The SQL must stay byte-compatible with `server/db.js#listRecentArticlesForDigest`
 * (window semantics + junk-title filters + `other` exclusion) so report numbers
 * always match what the email/list pipeline would produce. It deliberately
 * avoids custom SQL functions (they are only registered when server/db.js
 * loads) and re-implements `displayDateSql` in plain SQL.
 *
 * Usage:
 *   node scripts/export-report-batch.mjs --kind weekly [--days 7] [--out <path>]
 *   node scripts/export-report-batch.mjs --kind monthly [--month 2026-08] [--out <path>]
 */
import { DatabaseSync } from "node:sqlite";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { businessWindow, shiftBusinessDate } from "../server/date/normalize.js";
import { DIRECTIONS, isDirectionKey } from "../server/directions.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// 研究速览 v2：三字段速评（对象/方法/结论）的「核心结论」需要更长摘要支撑，800 字。
const abstractClip = 800;
const VALID_KINDS = new Set(["weekly", "monthly"]);

function parseArgs(argv) {
  const args = {
    db: resolve(root, "data/literature.sqlite"),
    kind: "weekly",
    days: 7,
    month: "",
    start: "",
    end: "",
    direction: "",
    out: ""
  };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === "--db") args.db = resolve(process.cwd(), argv[i += 1]);
    else if (argv[i] === "--kind") args.kind = String(argv[i += 1]).toLowerCase();
    else if (argv[i] === "--days") args.days = Number(argv[i += 1]);
    else if (argv[i] === "--month") args.month = String(argv[i += 1]).trim();
    else if (argv[i] === "--start") args.start = String(argv[i += 1]).trim();
    else if (argv[i] === "--end") args.end = String(argv[i += 1]).trim();
    else if (argv[i] === "--direction") args.direction = String(argv[i += 1]).trim();
    else if (argv[i] === "--out") args.out = resolve(process.cwd(), argv[i += 1]);
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  if (!VALID_KINDS.has(args.kind)) throw new Error(`--kind must be one of: ${[...VALID_KINDS].join(", ")}`);
  if (args.direction && !isDirectionKey(args.direction)) {
    throw new Error(`--direction must be a whitelisted key from server/directions.js, got: ${args.direction}`);
  }
  if (args.start || args.end) {
    // 回填模式：显式窗口（YYYY-MM-DD）。上期 = 同宽窗口紧贴其前。
    for (const [label, value] of [["--start", args.start], ["--end", args.end]]) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${label} must be YYYY-MM-DD, got: ${value}`);
    }
    if (args.start > args.end) throw new Error("--start must be <= --end");
  } else if (args.kind === "weekly") {
    if (!Number.isFinite(args.days) || args.days < 1) throw new Error("--days must be a positive number");
    args.days = Math.min(Math.floor(args.days), 31);
  } else {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(args.month)) {
      // 默认 = 上一个完整自然月
      const now = new Date(Date.now() + 8 * 60 * 60 * 1000);
      const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
      args.month = `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, "0")}`;
    }
  }
  if (!args.out) {
    const suffix = args.start
      ? `${args.start}_${args.end}`
      : (args.kind === "weekly" ? "weekly" : args.month);
    args.out = resolve(root, `data/report-batch-${args.kind === "weekly" && !args.start ? "weekly" : suffix}${args.direction ? `-${args.direction}` : ""}.json`);
  }
  return args;
}

function monthRange(month) {
  const [year, mon] = month.split("-").map(Number);
  const start = `${month}-01`;
  const lastDay = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  return { start, end: `${month}-${String(lastDay).padStart(2, "0")}` };
}

/** 与 server/db.js#displayDateSql 同构的纯 SQL（裸 node:sqlite 可执行）。 */
const DISPLAY_DATE_SQL = `
COALESCE(NULLIF(a.first_public_at, ''), substr(
  datetime(CASE
    WHEN datetime(a.published_at) IS NULL THEN COALESCE(NULLIF(a.first_seen_at, ''), a.fetched_at)
    WHEN datetime(a.published_at) > datetime('now') THEN COALESCE(NULLIF(a.first_seen_at, ''), a.fetched_at)
    ELSE a.published_at
  END), 1, 10))`;

/** 与 listRecentArticlesForDigest 相同的垃圾标题过滤（逐条对齐，勿增删）。 */
const JUNK_TITLE_CLAUSES = [
  "lower(a.title) NOT LIKE '%information%'",
  "lower(a.title) NOT LIKE '%table of contents%'",
  "lower(a.title) NOT LIKE '%blank page%'",
  "lower(a.title) NOT LIKE 'correction to%'",
  "lower(a.title) NOT LIKE '%publication information%'",
  "lower(a.title) NOT LIKE '%front cover%'",
  "lower(a.title) NOT LIKE '%back cover%'"
].join("\n      AND ");

/**
 * 复用周报速评（2026-10-01 v4）：收集与当期窗口有交集的已入库周报
 * （kind='weekly'、status='ready'，含总览与方向专报两类来源）的 paperBriefs，
 * 按文章 id 建索引后注入素材。月报/月度专报对带 priorBrief 的文献逐字复用，
 * 只新写周报未覆盖的文献——避免对同一篇文献重复总结、防止口径漂移。
 * 同一 id 同时命中总览与方向专报时，方向专报（direction 非空）后写覆盖；
 * 跨期重叠窗口时更晚的 period_start 后写覆盖。
 * ai_reports 表不存在（全新库）时静默返回空索引，不影响导出。
 */
function loadWeeklyBriefs(db, periodStart, periodEnd) {
  const index = new Map();
  let rows;
  try {
    rows = db.prepare(`
      SELECT direction, stats_json FROM ai_reports
      WHERE kind = 'weekly' AND status = 'ready'
        AND period_start <= ? AND period_end >= ?
      ORDER BY direction IS NULL DESC, period_start ASC
    `).all(periodEnd, periodStart);
  } catch {
    return index;
  }
  for (const row of rows) {
    if (!row.stats_json) continue;
    try {
      const stats = JSON.parse(row.stats_json);
      const briefs = Array.isArray(stats && stats.paperBriefs) ? stats.paperBriefs : [];
      for (const brief of briefs) {
        if (brief && Number.isInteger(brief.id)) {
          index.set(brief.id, {
            object: String(brief.object || ""),
            method: String(brief.method || ""),
            finding: String(brief.finding || ""),
            ...(brief.topic ? { topic: String(brief.topic) } : {})
          });
        }
      }
    } catch { /* 单行 stats_json 损坏不影响导出 */ }
  }
  return index;
}

function directionCount(db, start, end) {
  const rows = db.prepare(`
    SELECT a.research_direction AS key, COUNT(*) AS n
    FROM articles a
    WHERE ${DISPLAY_DATE_SQL} >= ?
      AND ${DISPLAY_DATE_SQL} <= ?
      AND ${JUNK_TITLE_CLAUSES}
      AND (a.research_direction IS NULL OR a.research_direction != 'other')
    GROUP BY a.research_direction
  `).all(start, end);
  const counts = {};
  for (const direction of DIRECTIONS) {
    if (direction.key === "other") continue;
    counts[direction.key] = 0;
  }
  for (const row of rows) {
    if (row.key && row.key !== "other") counts[row.key] = Number(row.n);
  }
  return counts;
}

function main() {
  const args = parseArgs(process.argv);
  let periodStart;
  let periodEnd;
  let prevStart;
  let prevEnd;
  if (args.start) {
    periodStart = args.start;
    periodEnd = args.end;
    const width = Math.round((Date.parse(`${args.end}T12:00:00Z`) - Date.parse(`${args.start}T12:00:00Z`)) / 86400000) + 1;
    prevStart = shiftBusinessDate(args.start, -width);
    prevEnd = shiftBusinessDate(args.end, -width);
  } else if (args.kind === "weekly") {
    const { startDate, endDate } = businessWindow(args.days);
    periodStart = startDate;
    periodEnd = endDate;
    prevStart = shiftBusinessDate(startDate, -args.days);
    prevEnd = shiftBusinessDate(endDate, -args.days);
  } else {
    const range = monthRange(args.month);
    periodStart = range.start;
    periodEnd = range.end;
    const [year, mon] = args.month.split("-").map(Number);
    const prevMonth = new Date(Date.UTC(year, mon - 2, 1));
    const prev = monthRange(`${prevMonth.getUTCFullYear()}-${String(prevMonth.getUTCMonth() + 1).padStart(2, "0")}`);
    prevStart = prev.start;
    prevEnd = prev.end;
  }

  const db = new DatabaseSync(args.db, { readOnly: true });
  try {
    const windowFilter = (start, end) => `${DISPLAY_DATE_SQL} >= '${start}' AND ${DISPLAY_DATE_SQL} <= '${end}'`;
    // 方向专报批次：只取该方向（other 排除逻辑不适用——显式方向即精准过滤）。
    const directionFilter = args.direction
      ? `AND a.research_direction = '${args.direction}'`
      : "AND (a.research_direction IS NULL OR a.research_direction != 'other')";
    const rows = db.prepare(`
      SELECT a.id, a.title, a.journal, a.doi, a.research_direction, a.keywords,
        substr(a.abstract, 1, ${abstractClip + 1}) AS abstract,
        ${DISPLAY_DATE_SQL} AS display_date
      FROM articles a
      WHERE ${windowFilter(periodStart, periodEnd)}
        AND ${JUNK_TITLE_CLAUSES}
        ${directionFilter}
      ORDER BY a.research_direction ASC, ${DISPLAY_DATE_SQL} DESC, a.id DESC
    `).all();
    const briefIndex = loadWeeklyBriefs(db, periodStart, periodEnd);
    const articles = rows.map((row) => ({
      id: row.id,
      title: row.title || "",
      direction: row.research_direction || "",
      journal: row.journal || "",
      doi: row.doi || "",
      displayDate: row.display_date,
      keywords: row.keywords || "",
      abstract: String(row.abstract || "").slice(0, abstractClip),
      ...(briefIndex.has(row.id) ? { priorBrief: briefIndex.get(row.id) } : {})
    }));
    const total = db.prepare(`
      SELECT COUNT(*) AS n
      FROM articles a
      WHERE ${windowFilter(periodStart, periodEnd)}
        AND ${JUNK_TITLE_CLAUSES}
        ${directionFilter}
    `).get().n;

    const directionCounts = args.direction
      ? { [args.direction]: Number(total) }
      : directionCount(db, periodStart, periodEnd);
    const prevDirectionCounts = args.direction
      ? { [args.direction]: 0 }
      : directionCount(db, prevStart, prevEnd);
    const prevTotal = args.direction
      ? Number(db.prepare(`
          SELECT COUNT(*) AS n
          FROM articles a
          WHERE ${windowFilter(prevStart, prevEnd)}
            AND ${JUNK_TITLE_CLAUSES}
            AND a.research_direction = '${args.direction}'
        `).get().n)
      : Number(db.prepare(`
          SELECT COUNT(*) AS n
          FROM articles a
          WHERE ${windowFilter(prevStart, prevEnd)}
            AND ${JUNK_TITLE_CLAUSES}
            AND (a.research_direction IS NULL OR a.research_direction != 'other')
        `).get().n);
    if (args.direction) prevDirectionCounts[args.direction] = prevTotal;

    const stats = {
      total: Number(total),
      directionCounts,
      previous: {
        total: prevTotal,
        directionCounts: prevDirectionCounts
      }
    };
    // 未分类（research_direction IS NULL）计数：分类任务未覆盖的新文章会出现在
    // 这里，报告应写明「待方向标注」数量而不是把它们误归入任何方向。
    stats.unclassified = args.direction
      ? 0
      : stats.total - Object.values(stats.directionCounts).reduce((sum, n) => sum + n, 0);
    stats.previous.unclassified = args.direction
      ? 0
      : stats.previous.total
        - Object.values(stats.previous.directionCounts).reduce((sum, n) => sum + n, 0);

    const payload = {
      exportedAt: new Date().toISOString(),
      kind: args.kind,
      periodStart,
      periodEnd,
      direction: args.direction || null,
      previousPeriod: { start: prevStart, end: prevEnd },
      stats,
      briefReuse: {
        available: briefIndex.size,
        matched: articles.filter((article) => article.priorBrief).length
      },
      articles
    };
    mkdirSync(dirname(args.out), { recursive: true });
    writeFileSync(args.out, JSON.stringify(payload, null, 1), "utf8");
    const dirSummary = Object.entries(payload.stats.directionCounts)
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([key, n]) => `${key}:${n}`)
      .join(" ");
    console.log(`exported=${articles.length} kind=${args.kind}${args.direction ? ` direction=${args.direction}` : ""} period=${periodStart}~${periodEnd} total=${payload.stats.total} prev_total=${payload.stats.previous.total} prior_briefs=${payload.briefReuse.matched}/${payload.briefReuse.available} top=[${dirSummary}] out=${args.out}`);
  } finally {
    db.close();
  }
}

main();
