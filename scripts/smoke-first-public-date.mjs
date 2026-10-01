// ── first_public_at 切换冒烟验证 ────────────────────────────────────────────
// 在「真实库的临时副本」上完整走一遍：加列 → 回填 → 断言。不触碰真实数据。
//
// 验证项（对应方案验收标准）：
//   1. 回填后不存在 unresolved 行（每行都有 first_public_at + A/B/C/D 标记）；
//   2. 统计口径自描述：dateBasis=first_public_at、timezone=Asia/Shanghai；
//   3. 近 7/30 日恰好为 7/30 个北京自然日（窗口首尾差 N-1 天）；
//   4. 统计胶囊数字与列表页同窗口筛选条数逐条一致（验收 12）；
//   5. 任意文献的主时间不晚于北京今天（未来卷期日不充当主时间，验收 6）；
//   6. first_seen_at 全程未被修改（回填不污染审计字段）；
//   7. 打印新旧口径 7d 对比与 A/B/C/D 分布，供灰度检查。
//
// 用法：node scripts/smoke-first-public-date.mjs
// 可选：SMOKE_SOURCE_DB=<源库路径> 指定被复制的库（默认 data/literature.sqlite）。

import process from "node:process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const execFileAsync = promisify(execFile);

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");

// 1. 复制真实库（含 WAL）到临时目录，之后所有读写只发生在副本上。
const workingDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "literature-smoke-first-public-"));
const sourceDir = process.env.SMOKE_SOURCE_DB
  ? path.dirname(path.resolve(process.env.SMOKE_SOURCE_DB))
  : path.join(projectRoot, "data");
const sourceName = process.env.SMOKE_SOURCE_DB ? path.basename(process.env.SMOKE_SOURCE_DB) : "literature.sqlite";
for (const suffix of ["", "-wal", "-shm"]) {
  const from = path.join(sourceDir, `${sourceName}${suffix}`);
  if (fs.existsSync(from)) fs.copyFileSync(from, path.join(workingDirectory, `literature.sqlite${suffix}`));
}
if (!fs.existsSync(path.join(workingDirectory, "literature.sqlite"))) {
  console.error(`[smoke] 源库不存在：${path.join(sourceDir, sourceName)}`);
  process.exit(1);
}

// 2. 回填前快照 first_seen_at（抽 400 行），回填后比对，实证审计字段未被改动。
const snapshotDb = new DatabaseSync(path.join(workingDirectory, "literature.sqlite"));
const firstSeenSnapshot = new Map(
  snapshotDb.prepare("SELECT id, first_seen_at FROM articles ORDER BY id LIMIT 200").all()
    .concat(snapshotDb.prepare("SELECT id, first_seen_at FROM articles ORDER BY id DESC LIMIT 200").all())
    .map((row) => [row.id, row.first_seen_at])
);
snapshotDb.close();

// 3. 在副本上跑回填脚本（子进程，env 指向副本目录）。
//    ⚠️ 用异步 execFile：本机环境对 Node 的同步 spawn 一律 EBUSY。
let backfill;
try {
  const result = await execFileAsync(
    process.execPath,
    [path.join(scriptDir, "backfill-first-public-date.mjs")],
    { cwd: workingDirectory, env: { ...process.env, LITERATURE_DATA_DIR: workingDirectory }, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }
  );
  backfill = { status: 0, stdout: result.stdout || "", stderr: result.stderr || "" };
} catch (error) {
  backfill = { stdout: error.stdout || "", stderr: error.stderr || String(error.message || error), status: Number.isInteger(error.code) ? error.code : 1 };
  console.error(`[smoke] 回填子进程异常：code=${error.code} signal=${error.signal} killed=${error.killed} message=${error.message}`);
}
console.log((backfill.stdout || "").trim());
if (backfill.status !== 0) {
  console.error((backfill.stderr || "(无 stderr)").trim());
  console.error("[smoke] 回填失败");
  fs.rmSync(workingDirectory, { recursive: true, force: true });
  process.exit(1);
}

// 4. 以副本为数据目录做断言（env 必须先于动态 import 设置）。
process.env.LITERATURE_DATA_DIR = workingDirectory;
const failures = [];
let openedDb = null;
const check = (name, ok, detail = "") => {
  if (ok) console.log(`  ✓ ${name}`);
  else {
    console.error(`  ✗ ${name}${detail ? ` —— ${detail}` : ""}`);
    failures.push(name);
  }
};

try {
  const { db, getUserStatus, listArticlePage } = await import("../server/db.js");
  openedDb = db;
  const { businessToday, businessWindow, shiftBusinessDate } = await import("../server/date/normalize.js");

  // —— 验收 6：主时间不晚于北京今天 ——
  const today = businessToday();
  const futureCount = Number(db.prepare("SELECT COUNT(*) AS count FROM articles WHERE is_non_research_title(title) = 0 AND first_public_at > ?").get(today).count);
  check("所有文献主时间 ≤ 北京今天（未来卷期不充当主时间）", futureCount === 0, `${futureCount} 行主时间在未来`);

  // —— 验收：无 unresolved ——
  const unresolved = Number(db.prepare("SELECT COUNT(*) AS count FROM articles WHERE is_non_research_title(title) = 0 AND (first_public_at IS NULL OR first_public_at = '' OR first_public_confidence IS NULL OR first_public_confidence = '')").get().count);
  check("回填后不存在未解析主时间的文献", unresolved === 0, `${unresolved} 行未解析`);

  // —— 验收 7/8：窗口恰好 N 个自然日 ——
  const window7 = businessWindow(7);
  const window30 = businessWindow(30);
  check("近 7 日窗口首尾差恰好 6 天（共 7 个自然日）", shiftBusinessDate(window7.startDate, 6) === window7.endDate, `${window7.startDate} ~ ${window7.endDate}`);
  check("近 30 日窗口首尾差恰好 29 天（共 30 个自然日）", shiftBusinessDate(window30.startDate, 29) === window30.endDate, `${window30.startDate} ~ ${window30.endDate}`);
  check("窗口右端 = 北京今天", window7.endDate === today && window30.endDate === today);

  // —— 验收 12：胶囊数字与列表筛选逐条一致 ——
  const status = getUserStatus(null);
  check("统计口径自描述 dateBasis/timezone", status.dateBasis === "first_public_at" && status.timezone === "Asia/Shanghai", JSON.stringify({ dateBasis: status.dateBasis, timezone: status.timezone }));
  const list7 = listArticlePage({ from: window7.startDate, to: window7.endDate, limit: "1", offset: "0" }, null);
  const list30 = listArticlePage({ from: window30.startDate, to: window30.endDate, limit: "1", offset: "0" }, null);
  check("近 7 日胶囊数 = 列表同窗口条数", Number(list7.total) === Number(status.newArticleCount7d), `胶囊 ${status.newArticleCount7d} vs 列表 ${list7.total}`);
  check("近 30 日胶囊数 = 列表同窗口条数", Number(list30.total) === Number(status.newArticleCount30d), `胶囊 ${status.newArticleCount30d} vs 列表 ${list30.total}`);

  // —— 可信度分布 ——
  const grades = db.prepare("SELECT COALESCE(NULLIF(first_public_confidence,''),'unresolved') AS confidence, COUNT(*) AS count FROM articles WHERE is_non_research_title(title) = 0 GROUP BY confidence ORDER BY confidence").all();
  console.log("  可信度分布：", grades.map((row) => `${row.confidence}=${row.count}`).join(" "));

  // —— 新旧口径对比（灰度参考，不做硬断言） ——
  const legacyDateExpr = `substr(datetime(CASE
        WHEN datetime(published_at) IS NULL THEN COALESCE(NULLIF(first_seen_at, ''), fetched_at)
        WHEN datetime(published_at) > datetime('now') THEN COALESCE(NULLIF(first_seen_at, ''), fetched_at)
        ELSE published_at END), 1, 10)`;
  const legacy7 = Number(db.prepare(`
    SELECT COUNT(*) AS count FROM articles
    WHERE is_non_research_title(title) = 0
      AND ${legacyDateExpr} >= date('now', '-7 days')
      AND ${legacyDateExpr} <= date('now')
  `).get().count);
  console.log(`  新旧口径对比：近 7 日 旧口径=${legacy7} → 新口径(first_public_at)=${status.newArticleCount7d}`);

  // —— first_seen_at 未被回填修改 ——
  const currentDb = db;
  const drifted = [...firstSeenSnapshot.entries()].filter(([id, seen]) => {
    const row = currentDb.prepare("SELECT first_seen_at FROM articles WHERE id = ?").get(id);
    return (row?.first_seen_at ?? null) !== seen;
  });
  check(`first_seen_at 抽样 ${firstSeenSnapshot.size} 行回填前后一致`, drifted.length === 0, `${drifted.length} 行被改动`);
} catch (error) {
  failures.push(`异常：${error.message}`);
  console.error(error);
} finally {
  // 先关掉本进程持有的连接再删目录，否则 Windows 下 sqlite 文件被锁（EBUSY）。
  try { openedDb?.close(); } catch {}
  fs.rmSync(workingDirectory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}

if (failures.length) {
  console.error(`[smoke] 失败 ${failures.length} 项：${failures.join("；")}`);
  process.exitCode = 1;
} else {
  console.log("[smoke] 全部通过");
}
