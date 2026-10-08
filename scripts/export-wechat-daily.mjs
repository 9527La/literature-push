#!/usr/bin/env node
/**
 * Export daily source material for the WeChat Official Account daily issue
 * (DESIGN-WECHAT-MP-DAILY.md, job: wechat-daily in RUNBOOK-AI-JOBS.md §A.3).
 *
 * Used by the WorkBuddy scheduled task (每日 06:30): the remote runner executes
 * this on the deployment host, the resulting JSON is pulled back, the agent
 * picks 5-8 articles and writes three-field briefs, then `wechat-render.mjs`
 * turns the issue JSON into WeChat-safe HTML. Read-only against the database.
 *
 * The SQL must stay byte-compatible with `server/db.js#listRecentArticlesForDigest`
 * semantics and with `scripts/export-report-batch.mjs` (window semantics +
 * junk-title filters + `other` exclusion) so the daily issue never disagrees
 * with the list/email pipeline. It deliberately avoids custom SQL functions
 * (bare node:sqlite has none) and re-implements `displayDateSql` in plain SQL.
 *
 * Window = a single Beijing business day, default = yesterday
 * (shiftBusinessDate(businessToday(), -1)). Historical backfill never leaks in:
 * a backfilled article whose first_public_at is older than the day is excluded.
 *
 * Usage:
 *   node scripts/export-wechat-daily.mjs [--date YYYY-MM-DD] [--db <path>] [--out <path>]
 */
import { DatabaseSync } from "node:sqlite";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { businessToday, shiftBusinessDate } from "../server/date/normalize.js";
import { DIRECTIONS, isDirectionKey } from "../server/directions.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// 「核心结论」一句话与写作会话的取材都需要较长的摘要支撑，与周报导出同宽（800 字）。
const abstractClip = 800;

function parseArgs(argv) {
  const args = { db: resolve(root, "data/literature.sqlite"), date: "", out: "" };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === "--db") args.db = resolve(process.cwd(), argv[i += 1]);
    else if (argv[i] === "--date") args.date = String(argv[i += 1]).trim();
    else if (argv[i] === "--out") args.out = resolve(process.cwd(), argv[i += 1]);
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  if (args.date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args.date)) {
      throw new Error(`--date must be YYYY-MM-DD, got: ${args.date}`);
    }
  } else {
    // 默认 = 北京时间昨日业务日（日报固定报道「前一天」入库的文献）。
    args.date = shiftBusinessDate(businessToday(), -1);
  }
  if (!args.out) args.out = resolve(root, `data/wechat-daily-batch-${args.date}.json`);
  return args;
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
 * 复用周报速评（RUNBOOK v4 同一原则）：收集与目标日有交集的已入库周报
 * （kind='weekly'、status='ready'，总览与方向专报都算）的 paperBriefs，按文章
 * id 建索引注入素材。日报速评**命中即逐字复用、未命中才新写**——避免对同一篇
 * 文献重复总结、防止口径漂移。ai_reports 表不存在（全新库）时静默返回空索引。
 * 同一 id 命中总览与方向专报时，方向专报（direction 非空）后写覆盖；
 * 跨期重叠窗口时更晚的 period_start 后写覆盖。
 */
function loadWeeklyBriefs(db, date) {
  const index = new Map();
  let rows;
  try {
    rows = db.prepare(`
      SELECT direction, stats_json FROM ai_reports
      WHERE kind = 'weekly' AND status = 'ready'
        AND period_start <= ? AND period_end >= ?
      ORDER BY direction IS NULL DESC, period_start ASC
    `).all(date, date);
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

function directionLabel(key) {
  if (!key) return "暂未分类";
  const found = DIRECTIONS.find((d) => d.key === key);
  return found ? found.label : key;
}

function main() {
  const args = parseArgs(process.argv);
  const db = new DatabaseSync(args.db, { readOnly: true });
  try {
    const rows = db.prepare(`
      SELECT a.id, a.title, a.journal, a.doi, a.url, a.research_direction, a.keywords,
        substr(a.abstract, 1, ${abstractClip + 1}) AS abstract,
        zh.title AS translated_title,
        zh.abstract AS translated_abstract,
        ${DISPLAY_DATE_SQL} AS display_date
      FROM articles a
      LEFT JOIN translations zh ON zh.article_id = a.id AND zh.target_language = 'zh'
      WHERE ${DISPLAY_DATE_SQL} = ?
        AND ${JUNK_TITLE_CLAUSES}
        AND (a.research_direction IS NULL OR a.research_direction != 'other')
      ORDER BY a.research_direction ASC, ${DISPLAY_DATE_SQL} DESC, a.id DESC
    `).all(args.date);

    const briefs = loadWeeklyBriefs(db, args.date);

    // 方向计数：与 directionCount 同口径（只统计 14 个正式方向，NULL 单列为
    // unclassified，other 已被 WHERE 排除）。
    const counts = {};
    for (const direction of DIRECTIONS) {
      if (direction.key === "other") continue;
      counts[direction.key] = 0;
    }
    let unclassified = 0;
    const articles = rows.map((row) => {
      if (row.research_direction && isDirectionKey(row.research_direction)) {
        counts[row.research_direction] = (counts[row.research_direction] || 0) + 1;
      } else {
        unclassified += 1;
      }
      return {
        id: row.id,
        title: row.title,
        journal: row.journal,
        doi: row.doi,
        url: row.url,
        direction: row.research_direction || null,
        directionLabel: directionLabel(row.research_direction),
        keywords: row.keywords,
        abstract: row.abstract,
        translatedTitle: row.translated_title,
        translatedAbstract: row.translated_abstract,
        displayDate: row.display_date,
        // priorBrief = 周报已写速评，命中则日报逐字复用（object/method/finding）。
        priorBrief: briefs.get(row.id) || null
      };
    });

    const payload = {
      exportedAt: new Date().toISOString(),
      date: args.date,
      total: articles.length,
      unclassified,
      directionCounts: counts,
      articles
    };
    mkdirSync(dirname(args.out), { recursive: true });
    writeFileSync(args.out, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    console.log(`[export-wechat-daily] date=${args.date} total=${articles.length} priorBriefs=${briefs.size} out=${args.out}`);
    if (articles.length === 0) {
      console.log("[export-wechat-daily] 空窗口：当日无新入库文献，日报清单板块应如实写「今日无新入库文献」");
    }
  } finally {
    db.close();
  }
}

main();
