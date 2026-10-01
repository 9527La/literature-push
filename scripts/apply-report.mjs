#!/usr/bin/env node
/**
 * Apply the AI weekly digest / monthly report to the ai_reports table
 * (PLAN-AI-REPORTS.md, job: digest / report in RUNBOOK-AI-JOBS.md).
 *
 * Trust model — numbers never come from the agent:
 *   The agent only supplies `contentMd` (prose), `highlightIds` (article picks)
 *   and `topTopics`. Everything numeric (total / directionCounts /
 *   directionDelta) is recomputed here from the export file, so the stored
 *   stats_json is correct by construction and prose-vs-data drift is the only
 *   remaining risk (checked by the manual review step in the RUNBOOK).
 *
 * Hard validation (any failure = whole batch refused, exit 1):
 *   - kind / periodStart / periodEnd / exportedAt must match the export file
 *     byte-for-byte (proves the result was generated from *this* export);
 *   - contentMd non-empty, <= 20 000 chars;
 *   - highlightIds ⊆ export article ids, integers, <= 8;
 *   - topTopics string array, <= 12 items, each <= 30 chars;
 *   - paperBriefs (v2, PLAN-AI-REPORTS-V2.md): direction reports MUST provide
 *     three-field briefs covering EVERY article in the batch; overview reports
 *     may attach briefs for highlightIds only. Fields: object <= 30 chars,
 *     method <= 40, finding <= 50, optional topic <= 12; ids ⊆ export batch.
 *
 * Idempotent: UNIQUE(kind, period_start) upsert — rerunning the same period
 * overwrites the previous generation of the same report.
 *
 * Usage:
 *   node scripts/apply-report.mjs --export <report-batch.json> --file <result.json> [--db <path>]
 */
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DIRECTIONS, isDirectionKey } from "../server/directions.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const KEY_SET = new Set(DIRECTIONS.map((d) => d.key).filter((key) => key !== "other"));
const CONTENT_MAX_CHARS = 20_000;
const HIGHLIGHT_MAX = 8;
const TOPICS_MAX = 12;
const TOPIC_MAX_CHARS = 30;
// 研究速览 v2：三字段结构化速评（paperBriefs）字数上限（PLAN-AI-REPORTS-V2.md §2.1）。
const BRIEF_FIELD_MAX = { object: 30, method: 40, finding: 50 };
const BRIEF_TOPIC_MAX = 12;

function parseArgs(argv) {
  const args = { db: resolve(root, "data/literature.sqlite") };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === "--db") args.db = resolve(process.cwd(), argv[i += 1]);
    else if (argv[i] === "--export") args.exportFile = resolve(process.cwd(), argv[i += 1]);
    else if (argv[i] === "--file") args.file = resolve(process.cwd(), argv[i += 1]);
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  if (!args.exportFile) throw new Error("--export <report-batch.json> is required");
  if (!args.file) throw new Error("--file <result.json> is required");
  return args;
}

function recomputeStats(batch) {
  const directionCounts = { ...batch.stats.directionCounts };
  const previous = batch.stats.previous.directionCounts;
  const directionDelta = {};
  for (const key of Object.keys(directionCounts)) {
    const delta = Number(directionCounts[key] || 0) - Number(previous[key] || 0);
    if (delta !== 0) directionDelta[key] = delta;
  }
  return {
    total: Number(batch.stats.total),
    directionCounts,
    directionDelta,
    highlightIds: [],
    topTopics: []
  };
}

function validate(result, batch) {
  const errors = [];
  if (!result || typeof result !== "object") return ["result must be a JSON object"];
  if (result.kind !== batch.kind) errors.push(`kind mismatch: expected ${batch.kind}, got ${result.kind}`);
  if (result.periodStart !== batch.periodStart) errors.push(`periodStart mismatch: expected ${batch.periodStart}, got ${result.periodStart}`);
  if (result.periodEnd !== batch.periodEnd) errors.push(`periodEnd mismatch: expected ${batch.periodEnd}, got ${result.periodEnd}`);
  if (result.exportedAt !== batch.exportedAt) errors.push("exportedAt mismatch: result was not generated from this export");
  // 方向维度：总览报告 direction 为空/null；方向专报必须与导出批次的方向逐字一致。
  const resultDirection = result.direction == null ? null : String(result.direction).trim();
  const batchDirection = batch.direction == null ? null : String(batch.direction).trim();
  if ((resultDirection ?? "") !== (batchDirection ?? "")) {
    errors.push(`direction mismatch: expected ${batchDirection ?? "(overview)"}, got ${resultDirection ?? "(overview)"}`);
  }
  if (resultDirection !== null && !isDirectionKey(resultDirection)) {
    errors.push(`direction is not a whitelisted key: ${resultDirection}`);
  }

  const contentMd = String(result.contentMd || "").trim();
  if (!contentMd) errors.push("contentMd is empty");
  if (contentMd.length > CONTENT_MAX_CHARS) errors.push(`contentMd exceeds ${CONTENT_MAX_CHARS} chars (${contentMd.length})`);

  const highlightIds = Array.isArray(result.highlightIds) ? result.highlightIds : [];
  if (highlightIds.length > HIGHLIGHT_MAX) errors.push(`highlightIds exceeds ${HIGHLIGHT_MAX} items`);
  const exportIds = new Set(batch.articles.map((a) => a.id));
  for (const id of highlightIds) {
    if (!Number.isInteger(id) || id <= 0) { errors.push(`highlightId is not a positive integer: ${id}`); break; }
    if (!exportIds.has(id)) { errors.push(`highlightId not in export batch (hallucinated reference): ${id}`); break; }
  }

  const topTopics = Array.isArray(result.topTopics) ? result.topTopics : [];
  if (topTopics.length > TOPICS_MAX) errors.push(`topTopics exceeds ${TOPICS_MAX} items`);
  for (const topic of topTopics) {
    if (typeof topic !== "string" || !topic.trim() || topic.length > TOPIC_MAX_CHARS) {
      errors.push(`topTopic must be a non-empty string <= ${TOPIC_MAX_CHARS} chars: ${JSON.stringify(topic)}`);
      break;
    }
  }

  // ── paperBriefs（研究速览 v2 三字段速评）───────────────────────────────────
  // 方向专报：必须提供且覆盖批次内每一篇文献（全量契约，决策点 1）；
  // 总览报告：可选，仅精选条目（ids ⊆ highlightIds）。
  if (result.paperBriefs != null && !Array.isArray(result.paperBriefs)) {
    errors.push("paperBriefs must be an array when present");
  } else if (resultDirection !== null && result.paperBriefs == null) {
    errors.push("paperBriefs is required for direction reports (v2 contract: full three-field briefs)");
  } else if (Array.isArray(result.paperBriefs)) {
    const briefErrors = validatePaperBriefs(result.paperBriefs, exportIds);
    errors.push(...briefErrors);
    if (!briefErrors.length) {
      if (resultDirection !== null) {
        const missing = batch.articles.map((a) => a.id).filter((id) => !briefIdSet.has(id));
        if (missing.length) {
          errors.push(`paperBriefs must cover every article in a direction batch (missing ${missing.length}): ${missing.slice(0, 5).join(",")}${missing.length > 5 ? " ..." : ""}`);
        }
      } else {
        const highlightSet = new Set(highlightIds.filter((id) => exportIds.has(id)));
        const outside = result.paperBriefs.map((b) => b.id).filter((id) => !highlightSet.has(id));
        if (outside.length) {
          errors.push(`overview paperBriefs are for highlightIds only, outside ids: ${outside.slice(0, 5).join(",")}`);
        }
      }
    }
  }
  return errors;
}

const briefIdSet = new Set();

/** 单条 paperBrief 形状/去重/越界校验；同时填充 briefIdSet（覆盖检查用）。 */
function validatePaperBriefs(paperBriefs, exportIds) {
  const errors = [];
  briefIdSet.clear();
  for (const brief of paperBriefs) {
    const label = brief && brief.id != null ? `#${brief.id}` : JSON.stringify(brief)?.slice(0, 60) || "(null)";
    if (!brief || typeof brief !== "object" || !Number.isInteger(brief.id) || brief.id <= 0) {
      errors.push(`paperBrief id must be a positive integer: ${label}`);
      break;
    }
    if (briefIdSet.has(brief.id)) {
      errors.push(`paperBrief duplicated id: ${brief.id}`);
      break;
    }
    briefIdSet.add(brief.id);
    if (!exportIds.has(brief.id)) {
      errors.push(`paperBrief id not in export batch (hallucinated): ${brief.id}`);
      break;
    }
    let fieldError = "";
    for (const field of Object.keys(BRIEF_FIELD_MAX)) {
      const value = typeof brief[field] === "string" ? brief[field].trim() : "";
      if (!value) { fieldError = `paperBrief ${brief.id}.${field} is empty`; break; }
      if (value.length > BRIEF_FIELD_MAX[field]) {
        fieldError = `paperBrief ${brief.id}.${field} exceeds ${BRIEF_FIELD_MAX[field]} chars (${value.length})`;
        break;
      }
    }
    if (fieldError) { errors.push(fieldError); break; }
    if (brief.topic != null) {
      const topic = String(brief.topic).trim();
      if (!topic || topic.length > BRIEF_TOPIC_MAX) {
        errors.push(`paperBrief ${brief.id}.topic must be a non-empty string <= ${BRIEF_TOPIC_MAX} chars`);
        break;
      }
    }
  }
  return errors;
}

/** 归一化后的 paperBriefs（去空白、topic 缺省时不带该键），写进 stats_json。 */
function normalizePaperBriefs(paperBriefs) {
  if (!Array.isArray(paperBriefs)) return [];
  return paperBriefs.map((brief) => {
    const normalized = {
      id: brief.id,
      object: String(brief.object).trim(),
      method: String(brief.method).trim(),
      finding: String(brief.finding).trim()
    };
    if (brief.topic != null && String(brief.topic).trim()) normalized.topic = String(brief.topic).trim();
    return normalized;
  });
}

function main() {
  const args = parseArgs(process.argv);
  const batch = JSON.parse(readFileSync(args.exportFile, "utf8"));
  if (!batch || batch.kind == null || !batch.periodStart || !batch.periodEnd || !Array.isArray(batch.articles) || !batch.stats) {
    throw new Error("Export file is not a valid export-report-batch payload");
  }
  const raw = JSON.parse(readFileSync(args.file, "utf8"));
  const errors = validate(raw, batch);
  if (errors.length) {
    console.log(JSON.stringify({ updated: 0, invalid: 1, kind: raw?.kind || "?", period: `${raw?.periodStart || "?"}~${raw?.periodEnd || "?"}`, direction: raw?.direction ?? null, errors }, null, 1));
    process.exitCode = 1;
    return;
  }

  const stats = recomputeStats(batch);
  stats.highlightIds = (raw.highlightIds || []).slice(0, HIGHLIGHT_MAX);
  stats.topTopics = (raw.topTopics || []).map((topic) => String(topic).trim()).slice(0, TOPICS_MAX);
  if (Array.isArray(raw.paperBriefs)) stats.paperBriefs = normalizePaperBriefs(raw.paperBriefs);
  const direction = raw.direction == null ? null : String(raw.direction).trim();

  const db = new DatabaseSync(args.db);
  try {
    ensureSchema(db);
    db.exec("BEGIN");
    try {
      // 幂等：同 (kind, period_start, direction) 先删后插——重跑覆盖同期产物，
      // 旧表（无 direction 列，UNIQUE 二元组）由 ensureSchema 就地重建。
      db.prepare("DELETE FROM ai_reports WHERE kind = ? AND period_start = ? AND direction IS ?").run(batch.kind, batch.periodStart, direction);
      db.prepare(`
        INSERT INTO ai_reports (kind, period_start, period_end, direction, status, content_md, stats_json, generated_at, generator)
        VALUES (@kind, @periodStart, @periodEnd, @direction, 'ready', @contentMd, @statsJson, @generatedAt, 'workbuddy-agent')
      `).run({
        kind: batch.kind,
        periodStart: batch.periodStart,
        periodEnd: batch.periodEnd,
        direction,
        contentMd: String(raw.contentMd).trim(),
        statsJson: JSON.stringify(stats),
        generatedAt: new Date().toISOString()
      });
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }

    const coverage = db.prepare("SELECT kind, direction IS NULL AS isOverview, COUNT(*) AS n FROM ai_reports WHERE status = 'ready' GROUP BY kind, isOverview").all();
    console.log(JSON.stringify({
      updated: 1,
      invalid: 0,
      kind: batch.kind,
      period: `${batch.periodStart}~${batch.periodEnd}`,
      direction: direction ?? "(overview)",
      total: stats.total,
      highlightCount: stats.highlightIds.length,
      briefCount: stats.paperBriefs ? stats.paperBriefs.length : 0,
      coverage: coverage.map((row) => `${row.kind}${row.isOverview ? "" : "*"}:${row.n}`).join(" ")
    }, null, 1));
  } finally {
    db.close();
  }
}

/** 建表 + 旧表（无 direction 列）就地重建迁移。服务端 db.js 有同构逻辑。 */
function ensureSchema(db) {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS ai_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL CHECK (kind IN ('weekly','monthly')),
      period_start TEXT NOT NULL,
      period_end TEXT NOT NULL,
      direction TEXT,
      status TEXT NOT NULL DEFAULT 'ready',
      content_md TEXT NOT NULL,
      stats_json TEXT,
      generated_at TEXT,
      generator TEXT NOT NULL DEFAULT 'workbuddy-agent',
      UNIQUE(kind, period_start, direction)
    )
  `).run();
  const hasDirection = db.prepare("PRAGMA table_info(ai_reports)").all().some((column) => column.name === "direction");
  if (!hasDirection) {
    db.exec(`
      BEGIN;
      CREATE TABLE ai_reports_migrated (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL CHECK (kind IN ('weekly','monthly')),
        period_start TEXT NOT NULL,
        period_end TEXT NOT NULL,
        direction TEXT,
        status TEXT NOT NULL DEFAULT 'ready',
        content_md TEXT NOT NULL,
        stats_json TEXT,
        generated_at TEXT,
        generator TEXT NOT NULL DEFAULT 'workbuddy-agent',
        UNIQUE(kind, period_start, direction)
      );
      INSERT INTO ai_reports_migrated (id, kind, period_start, period_end, direction, status, content_md, stats_json, generated_at, generator)
        SELECT id, kind, period_start, period_end, NULL, status, content_md, stats_json, generated_at, generator FROM ai_reports;
      DROP TABLE ai_reports;
      ALTER TABLE ai_reports_migrated RENAME TO ai_reports;
      CREATE INDEX IF NOT EXISTS idx_ai_reports_kind_period ON ai_reports(kind, period_start);
      COMMIT;
    `);
  } else {
    db.prepare("CREATE INDEX IF NOT EXISTS idx_ai_reports_kind_period ON ai_reports(kind, period_start)").run();
  }
}

main();
