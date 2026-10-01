// ── first_public_at 历史数据回填（方案 §11 / §12 / §22） ─────────────────────
// 对存量文献统一运行 resolveFirstPublicDate()，生成业务主时间 first_public_at
// 及其来源 / 精度 / 可信度。可重复执行（幂等）、不覆盖已确认的 A 级值、绝不修改
// first_seen_at（历史回填只写主时间字段，保留系统审计信息）。
//
// 口径优先级（2026-09-24 与用户确认）：
//   1) 已正式出版（published_at 已到期）→ 用正式出版日期（B 级，无需联网）；
//   2) 提前出版（Early Access，published_at 缺失或写在未来卷期日）→ 用
//      Crossref `created`（DOI 元数据首次注册时间）作首次上线代理（C 级），
//      存入 external_created_at；解析顺序 A → B → C → D 天然保证「已正式出版」
//      的行不会被 created 覆盖；
//   3) 都不行 → first_seen_at 兜底（D 级）。
//   A 级（出版社官方首发日，online_first_at）仍留给后续逐篇官方接口作业。
//
// 用法：
//   node scripts/backfill-first-public-date.mjs [--crossref] [--dry-run] [--limit N]
//     --crossref   先对「提前出版且有 DOI」的行抓取 Crossref created 写入
//                  external_created_at（幂等：已有值或已 B 级出版的行自动跳过，
//                  中断后重跑自动续传），再执行统一解析。
//     --dry-run    只统计目标人群与样本，不发网络请求、不写库。
//   LITERATURE_DATA_DIR=<目录> ... （data 目录默认走 server/paths.js，与运行服务一致）
//
// 与运行中的服务并发安全：抓取阶段使用小批次短事务（WAL 读写互不阻塞）。

import process from "node:process";
import { db } from "../server/db.js";
import { businessToday } from "../server/date/normalize.js";
import { mergeFirstPublic, resolveFirstPublicDate } from "../server/date/resolve-first-public.js";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const crossref = args.includes("--crossref");
const limitIndex = args.indexOf("--limit");
const limit = limitIndex >= 0 ? Number(args[limitIndex + 1]) || 0 : 0;

const today = businessToday();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ── 阶段 1（可选）：Crossref created 抓取 ────────────────────────────────────
// 目标人群：
//   1) 提前出版（published_at 缺失或写在未来卷期日）—— 已正式出版的行不需要代理；
//   2) 已过期且恰好是「月初 1 日」的整期日行 —— 整期日例外（见
//      resolve-first-public.js 的 B 分支）需要 created 才能判定与修正。
// 两类都以「有 DOI 且尚无代理时间」为前提；已写入的行自动跳过（可续传）。
async function fetchCrossrefCreated(doi) {
  const url = `https://api.crossref.org/works/${String(doi).trim()}`;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": "LiteraturePush/2026.09.24 (https://lhmktz.top; first-public backfill)" },
        signal: AbortSignal.timeout(15000)
      });
      if (response.status === 404) return { status: "not_found" };
      if (response.status === 429 || response.status >= 500) throw new Error(`HTTP ${response.status}`);
      if (!response.ok) return { status: `http_${response.status}` };
      const data = await response.json();
      const created = String(data?.message?.created?.["date-time"] || "");
      if (!created) return { status: "no_created" };
      return { status: "ok", created };
    } catch (error) {
      if (attempt >= 2) return { status: `error_${error?.name || "unknown"}` };
      await sleep(1500);
    }
  }
}

async function runCrossrefFetch() {
  const targets = db.prepare(`
    SELECT id, doi, journal, published_at, external_created_at
    FROM articles
    WHERE doi IS NOT NULL AND trim(doi) <> ''
      AND (external_created_at IS NULL OR external_created_at = '')
      AND (
        published_at IS NULL OR published_at = '' OR datetime(published_at) > datetime('now')
        OR (datetime(published_at) IS NOT NULL AND datetime(published_at) <= datetime('now')
            AND substr(published_at, 9, 2) = '01')
      )
    ORDER BY id ASC
    ${limit > 0 ? "LIMIT @limit" : ""}
  `).all(limit > 0 ? { limit } : {});

  console.log(`[crossref] 目标人群（提前出版 + 有 DOI + 无代理时间）：${targets.length} 篇${dryRun ? "（dry-run，仅统计不抓取）" : ""}`);
  if (dryRun) {
    for (const row of targets.slice(0, 5)) {
      console.log(`  样本 #${row.id} ${row.journal} doi=${row.doi} published_at=${row.published_at || "(空)"}`);
    }
    return;
  }

  const updateExternal = db.prepare("UPDATE articles SET external_created_at = @created WHERE id = @id");
  const flush = (batch) => {
    if (!batch.length) return;
    db.exec("BEGIN");
    try {
      for (const item of batch) updateExternal.run(item);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    batch.length = 0;
  };

  let ok = 0;
  let notFound = 0;
  let failed = 0;
  const notFoundDois = [];
  const failures = [];
  const batch = [];
  for (const row of targets) {
    const result = await fetchCrossrefCreated(row.doi);
    if (result.status === "ok") {
      batch.push({ id: row.id, created: result.created });
      ok += 1;
    } else if (result.status === "not_found") {
      notFound += 1;
      if (notFoundDois.length < 10) notFoundDois.push(row.doi);
    } else {
      failed += 1;
      if (failures.length < 10) failures.push(`${row.doi} → ${result.status}`);
    }
    if (batch.length >= 20) flush(batch);
    await sleep(350);
  }
  flush(batch);

  console.log(`[crossref] 抓取完成：成功 ${ok}，Crossref 无记录 ${notFound}，失败 ${failed}`);
  if (notFoundDois.length) console.log(`[crossref] 无记录样本：${notFoundDois.join(" | ")}`);
  if (failures.length) console.log(`[crossref] 失败样本：${failures.join(" | ")}`);
}

if (crossref) {
  await runCrossrefFetch();
}

// ── 阶段 2：统一解析 first_public_at（原有逻辑不变） ─────────────────────────
const rows = db.prepare(`
  SELECT id, external_id, title, journal, year, published_at, first_seen_at, fetched_at,
         online_first_at, external_created_at,
         first_public_at, first_public_source, first_public_precision, first_public_confidence, date_verified_at
  FROM articles
  ORDER BY id ASC
  ${limit > 0 && !crossref ? "LIMIT @limit" : ""}
`).all(limit > 0 && !crossref ? { limit } : {});

const update = db.prepare(`
  UPDATE articles
  SET first_public_at = @first_public_at,
      first_public_source = @first_public_source,
      first_public_precision = @first_public_precision,
      first_public_confidence = @first_public_confidence,
      date_verified_at = @date_verified_at
  WHERE id = @id
`);

const gradeCount = { A: 0, B: 0, C: 0, D: 0, unresolved: 0 };
const journalStats = new Map();
const conflicts = { ONLINE_AFTER_PUBLICATION: 0, FUTURE_ONLINE_FIRST: 0, EXTERNAL_CREATED_TOO_EARLY: 0 };
let changed = 0;
let kept = 0;

db.exec("BEGIN");
try {
  for (const row of rows) {
    // 不覆盖已确认值：mergeFirstPublic 保留 A 级旧值，同级同值不产生写入；
    // 已正式出版（B 级）的行不会被 C 级代理覆盖（优先级见文件头）。
    const resolved = resolveFirstPublicDate(row, { today });
    const final = mergeFirstPublic(row, resolved);
    const confidence = final?.first_public_confidence || "unresolved";
    gradeCount[confidence] = (gradeCount[confidence] || 0) + 1;

    const journal = String(row.journal || "").trim() || "未标记期刊";
    if (!journalStats.has(journal)) journalStats.set(journal, { total: 0, A: 0, B: 0, C: 0, D: 0 });
    const stats = journalStats.get(journal);
    stats.total += 1;
    stats[confidence] = (stats[confidence] || 0) + 1;

    // 时间冲突诊断（方案 §23）：只记录，不改数据。
    const onlineFirstDay = String(row.online_first_at || "").slice(0, 10);
    const publishedDay = String(row.published_at || "").slice(0, 10);
    if (onlineFirstDay) {
      if (onlineFirstDay > today) conflicts.FUTURE_ONLINE_FIRST += 1;
      else if (publishedDay && onlineFirstDay > publishedDay) conflicts.ONLINE_AFTER_PUBLICATION += 1;
    }
    // C 级代理显著晚于未来卷期日所在年份 → 疑似数据异常，记数排查。
    const externalDay = String(row.external_created_at || "").slice(0, 10);
    if (externalDay && publishedDay && externalDay.slice(0, 4) > publishedDay.slice(0, 4)) {
      conflicts.EXTERNAL_CREATED_TOO_EARLY += 1;
    }

    const willWrite = !dryRun && final && (
      final.first_public_at !== row.first_public_at
      || final.first_public_source !== row.first_public_source
      || final.first_public_precision !== row.first_public_precision
      || final.first_public_confidence !== row.first_public_confidence
    );
    if (willWrite) {
      update.run({ ...final, date_verified_at: new Date().toISOString(), id: row.id });
      changed += 1;
    } else {
      kept += 1;
    }
  }
  db.exec("COMMIT");
} catch (error) {
  db.exec("ROLLBACK");
  throw error;
}

console.log(`[backfill-first-public] 业务今天（北京时间）：${today}`);
console.log(`[backfill-first-public] 处理 ${rows.length} 行：写入 ${changed} 行，保持 ${kept} 行${dryRun ? "（dry-run，未实际写入）" : ""}`);
console.log(`[backfill-first-public] 可信度分布：A=${gradeCount.A || 0} B=${gradeCount.B || 0} C=${gradeCount.C || 0} D=${gradeCount.D || 0} unresolved=${gradeCount.unresolved || 0}`);
if (conflicts.FUTURE_ONLINE_FIRST || conflicts.ONLINE_AFTER_PUBLICATION || conflicts.EXTERNAL_CREATED_TOO_EARLY) {
  console.log(`[backfill-first-public] 时间冲突诊断：FUTURE_ONLINE_FIRST=${conflicts.FUTURE_ONLINE_FIRST} ONLINE_AFTER_PUBLICATION=${conflicts.ONLINE_AFTER_PUBLICATION} EXTERNAL_CREATED_TOO_EARLY=${conflicts.EXTERNAL_CREATED_TOO_EARLY}`);
}

const journalLines = [...journalStats.entries()]
  .sort((left, right) => right[1].total - left[1].total)
  .map(([journal, stats]) => {
    const coverage = stats.total ? Math.round(((stats.A || 0) * 100) / stats.total) : 0;
    return `  ${journal.padEnd(60, " ")} 总=${String(stats.total).padStart(5)} A=${String(stats.A || 0).padStart(5)} B=${String(stats.B || 0).padStart(5)} C=${String(stats.C || 0).padStart(4)} D=${String(stats.D || 0).padStart(4)} A级覆盖率=${coverage}%`;
  });
console.log("[backfill-first-public] 按期刊分布：");
console.log(journalLines.join("\n"));
