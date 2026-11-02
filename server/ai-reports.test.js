import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runNodeScript } from "./run-node-script.js";
import test from "node:test";

// AI 研究速览（PLAN-AI-REPORTS.md）回归：
// ① ai_reports 表读写与 stats 解析容错；② 两个推送 settings 键的两层合并语义；
// ③ listRecentArticlesForDigest 方向过滤（含 other 显式选择替换语义）；
// ④ digest 邮件 AI 段落置顶（冷启动无段落、文件附件不含段落、降级标注）；
// ⑤ articles ids 直取参数。
test("ai reports store, push settings merge, digest section and direction filter", async () => {  const workingDirectory = mkdtempSync(path.join(tmpdir(), "literature-ai-reports-test-"));
  const dbUrl = new URL("./db.js", import.meta.url).href;
  const digestUrl = new URL("./digest.js", import.meta.url).href;
  const normalizeUrl = new URL("./date/normalize.js", import.meta.url).href;
  const script = `
    const { db, getSettings, updateSettings, getUserSettings, updateUserSettings,
            listRecentArticlesForDigest, listAiReports, getLatestReadyReport, listArticlePage }
      = await import(${JSON.stringify(dbUrl)});
    const digest = await import(${JSON.stringify(digestUrl)});
    const { businessWindow } = await import(${JSON.stringify(normalizeUrl)});
    const fail = (code, detail) => { console.error(code, detail || ""); process.exit(typeof code === "number" ? code : 1); };

    // ── 种子数据：4 篇不同方向/日期 ──────────────────────────────────────────
    const today = new Date();
    const ymd = (offset) => {
      const d = new Date(today.getTime() - offset * 86400000);
      return d.toISOString().slice(0, 10);
    };
    const insert = db.prepare(\`
      INSERT INTO articles (external_id, title, abstract, authors, journal, keywords,
        research_direction, first_public_at, fetched_at, first_seen_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    \`);
    insert.run("r-storage", "Grid battery scheduling", "Battery storage economics.", "A", "Applied Energy", "battery", "storage", ymd(1));
    insert.run("r-market", "Market clearing prices", "Market clearing.", "B", "Applied Energy", "market", "market", ymd(3));
    insert.run("r-other", "Sea cucumber report", "Not power systems.", "C", "IEEE Transactions", "aqua", "other", ymd(2));
    insert.run("r-null", "Unclassified paper", "Pending direction.", "D", "Applied Energy", "misc", null, ymd(0));

    // ── settings 两层四处 ───────────────────────────────────────────────────
    const settings = getSettings();
    if (settings.pushIncludeAiReport !== true) fail(1, "default pushIncludeAiReport must be true");
    if (settings.pushDirectionFilter !== "") fail(2, "default pushDirectionFilter must be empty");

    const cleaned = updateSettings({ pushDirectionFilter: "storage, <script>, storage, bogus, market" });
    if (cleaned.pushDirectionFilter !== "storage,market") fail(3, "sanitize+dedupe, got " + cleaned.pushDirectionFilter);
    if (getSettings().pushDirectionFilter !== "storage,market") fail(4, "global persist");

    updateSettings({ pushIncludeAiReport: false });
    if (getSettings().pushIncludeAiReport !== false) fail(5, "global off");

    // 个人层：未设置时回落全局；显式设置覆盖全局
    const u1 = updateUserSettings("u1", { pushIncludeAiReport: true, pushDirectionFilter: "storage" });
    if (u1.pushIncludeAiReport !== true) fail(6, "user override on");
    if (u1.pushDirectionFilter !== "storage") fail(7, "user direction filter");
    const u2 = getUserSettings("u2");
    if (u2.pushIncludeAiReport !== false) fail(8, "u2 inherits global off");
    if (u2.pushDirectionFilter !== "storage,market") fail(9, "u2 inherits global filter");
    // 非法方向 key 入库侧清洗
    const u3 = updateUserSettings("u3", { pushDirectionFilter: "storage, DROP, , other" });
    if (u3.pushDirectionFilter !== "storage,other") fail(10, "user sanitize keeps other, got " + u3.pushDirectionFilter);

    // ── listRecentArticlesForDigest 方向过滤 ────────────────────────────────
    if (listRecentArticlesForDigest(7, 0, []).length !== 3) fail(20, "baseline digest = 3 (other excluded, NULL shown)");
    const storageOnly = listRecentArticlesForDigest(7, 0, [], ["storage"]);
    if (storageOnly.length !== 1 || storageOnly[0].research_direction !== "storage") fail(21, "direction=storage");
    const otherOnly = listRecentArticlesForDigest(7, 0, [], ["other"]);
    if (otherOnly.length !== 1 || otherOnly[0].research_direction !== "other") fail(22, "explicit other replaces exclusion");
    if (listRecentArticlesForDigest(7, 0, [], ["bogus"]).length !== 3) fail(23, "invalid keys = no filtering");
    if (listRecentArticlesForDigest(7, 0, [], ["storage", "other"]).length !== 2) fail(24, "storage+other");

    // ── articles ids 直取 ──────────────────────────────────────────────────
    const idOf = (external) => db.prepare("SELECT id FROM articles WHERE external_id = ?").get(external).id;
    const storageId = idOf("r-storage");
    const marketId = idOf("r-market");
    const byIds = listArticlePage({ ids: storageId + "," + marketId + ",abc,-3" });
    if (byIds.total !== 2) fail(30, "ids picks valid rows, got " + byIds.total);
    if (listArticlePage({ ids: "abc,-3" }).total !== 0) fail(31, "all-invalid ids = empty result");
    const many = Array.from({ length: 25 }, (_, i) => storageId + i).join(",");
    if (listArticlePage({ ids: many }).total > 20) fail(32, "ids capped at 20");

    // ── ai_reports 表：空态（必须在插入报告行之前跑冷启动用例）────────────────
    if (listAiReports({ kind: "weekly" }).length !== 0) fail(40, "empty list");
    if (getLatestReadyReport("weekly") !== null) fail(41, "empty latest = null");
    if (getLatestReadyReport("bogus") !== null) fail(42, "invalid kind = null");

    const range = businessWindow(7);
    // ── digest 集成 A：冷启动（库内无任何报告）→ 邮件无 AI 段落 ────────────────
    updateSettings({ pushIncludeAiReport: true }); // 恢复全局开关（前面用例关过）
    const baseSettings = { ...getSettings(), pushFrequency: "weekly", pushDirectionFilter: "" };
    const cold = await digest.generateWeeklyDigestMarkdown(baseSettings, { days: 7 });
    if (cold.emailBodyMarkdown.includes("AI 研究速览")) fail(50, "cold start must not include AI section");
    if (cold.aiReport !== null) fail(51, "cold start aiReport null");

    const insertReport = db.prepare(\`
      INSERT INTO ai_reports (kind, period_start, period_end, status, content_md, stats_json, generated_at)
      VALUES (?, ?, ?, 'ready', ?, ?, datetime('now'))
    \`);
    insertReport.run("weekly", range.startDate, range.endDate, "# 一周论文速览 · " + range.startDate + "\\n本周期共收录 3 篇。", JSON.stringify({ total: 5, directionCounts: { storage: 5 }, directionDelta: {}, highlightIds: [], topTopics: [] }));
    insertReport.run("monthly", "2026-08-01", "2026-08-31", "# 月报\\n内容", "not-json{");

    const weeklies = listAiReports({ kind: "weekly" });
    if (weeklies.length !== 1 || weeklies[0].period_start !== range.startDate) fail(43, "weekly list order");
    if (weeklies[0].stats.total !== 5 || weeklies[0].stats_json !== undefined) fail(44, "stats parsed and raw field stripped");
    const monthlies = listAiReports({ kind: "monthly" });
    if (monthlies.length !== 1 || monthlies[0].stats !== null) fail(45, "bad stats_json degrades to null");
    const latest = getLatestReadyReport("weekly");
    if (!latest || latest.period_start !== range.startDate) fail(46, "latest weekly");

    // ── digest 集成 B：当期报告置顶 → 文件附件无段落 → 开关关闭无段落 ──────────
    const warm = await digest.generateWeeklyDigestMarkdown(baseSettings, { days: 7 });
    if (!warm.emailBodyMarkdown.includes("AI 研究速览")) fail(52, "warm email has AI section");
    if (!warm.emailBodyMarkdown.includes(range.startDate + " ~ " + range.endDate + " 期）")) fail(53, "section label with period");
    if (warm.emailBodyMarkdown.includes("# 一周论文速览")) fail(54, "report H1 stripped in email");
    if (warm.aiReport.stale !== false) fail(55, "current period not stale");
    if (warm.emailBodyMarkdown.indexOf("AI 研究速览") > warm.emailBodyMarkdown.indexOf("## 1.")) fail(56, "AI section before article list");
    const fileMarkdown = await (await import("node:fs/promises")).readFile(warm.filePath, "utf8");
    if (fileMarkdown.includes("AI 研究速览")) fail(57, "file attachment must not embed AI section");
    if (!fileMarkdown.includes("Market clearing prices")) fail(58, "file keeps article list");

    // 开关关闭 → 无段落
    const off = await digest.generateWeeklyDigestMarkdown({ ...baseSettings, pushIncludeAiReport: false }, { days: 7 });
    if (off.emailBodyMarkdown.includes("AI 研究速览")) fail(59, "switch off removes section");

    // 推送方向过滤生效：只收 storage 一篇
    const filtered = await digest.generateWeeklyDigestMarkdown({ ...baseSettings, pushDirectionFilter: "storage" }, { days: 7 });
    if (filtered.count !== 1) fail(60, "direction filtered digest count, got " + filtered.count);
    if (!filtered.emailBodyMarkdown.includes("AI 研究速览")) fail(61, "AI section survives direction filter");

    // ── 纯函数：频率映射 / 过期判定 / 段标题 ─────────────────────────────────
    const { aiReportKindForFrequency, isStaleAiReport, renderAiReportSection } = digest.internals;
    if (aiReportKindForFrequency("weekly") !== "weekly" || aiReportKindForFrequency("monthly") !== "monthly" || aiReportKindForFrequency("daily") !== "weekly") fail(70, "frequency map");
    if (isStaleAiReport({ period_start: "2000-01-01" }, "weekly", range) !== true) fail(71, "stale weekly");
    if (isStaleAiReport({ period_start: range.startDate, period_end: range.endDate }, "weekly", range) !== false) fail(72, "fresh weekly");
    if (isStaleAiReport({ period_start: "2026-08-01", period_end: "2026-08-31" }, "monthly", { startDate: "2026-09-01" }) !== true) fail(73, "stale monthly");
    const staleSection = renderAiReportSection({ period_start: "2026-09-15", period_end: "2026-09-21", content_md: "# 旧标题\\n正文" }, { stale: true });
    if (!staleSection.includes("·最近一期")) fail(74, "stale mark");
    if (renderAiReportSection(null, {}) !== "") fail(75, "null report = empty section");
  `;
  try {
    const result = await runNodeScript(script, {
      cwd: workingDirectory,
      env: {
        ...process.env,
        LITERATURE_DATA_DIR: workingDirectory,
        WEEKLY_DIGEST_DIR: path.join(workingDirectory, "digests")
      }
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally {
    rmSync(workingDirectory, { recursive: true, force: true });
  }
});

// 方向维度（2026-09-28 晚）：旧表（无 direction 列、UNIQUE 二元组）自动重建迁移；
// listAiReports / getLatestReadyReport 的 direction 过滤语义（总览 = direction IS NULL）。
test("ai reports direction dimension: legacy migration and per-direction reports", async () => {
  const workingDirectory = mkdtempSync(path.join(tmpdir(), "literature-ai-reports-dir-"));
  const dbUrl = new URL("./db.js", import.meta.url).href;
  const script = `
    // 先用裸连接伪造「旧版」ai_reports 表（无 direction 列，UNIQUE 二元组），再放入一行数据。
    const { DatabaseSync } = await import("node:sqlite");
    const pathModule = await import("node:path");
    const legacy = new DatabaseSync(pathModule.join(process.env.LITERATURE_DATA_DIR, "literature.sqlite"));
    legacy.exec(\`
      CREATE TABLE ai_reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL CHECK (kind IN ('weekly','monthly')),
        period_start TEXT NOT NULL,
        period_end TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'ready',
        content_md TEXT NOT NULL,
        stats_json TEXT,
        generated_at TEXT,
        generator TEXT NOT NULL DEFAULT 'workbuddy-agent',
        UNIQUE(kind, period_start)
      );
      INSERT INTO ai_reports (kind, period_start, period_end, status, content_md, generated_at)
        VALUES ('weekly', '2026-09-22', '2026-09-28', 'ready', '# 旧总览', datetime('now'));
    \`);
    legacy.close();

    // 导入 db.js 触发重建迁移。
    const { listAiReports, getLatestReadyReport } = await import(${JSON.stringify(dbUrl)});
    const fail = (code, detail) => { console.error(code, detail || ""); process.exit(typeof code === "number" ? code : 1); };

    const columns = new DatabaseSync(
      pathModule.join(process.env.LITERATURE_DATA_DIR, "literature.sqlite"), { readOnly: true }
    ).prepare("PRAGMA table_info(ai_reports)").all().map((c) => c.name);
    if (!columns.includes("direction")) fail(10, "migration must add direction column, got " + columns.join(","));

    // 旧数据保留且 direction = NULL（总览）
    const all = listAiReports({ kind: "weekly", limit: 50 });
    if (all.length !== 1 || all[0].direction !== null) fail(11, "legacy row preserved as overview, got " + JSON.stringify(all));

    const writer = new DatabaseSync(pathModule.join(process.env.LITERATURE_DATA_DIR, "literature.sqlite"));
    writer.prepare(\`
      INSERT INTO ai_reports (kind, period_start, period_end, direction, status, content_md, generated_at)
      VALUES ('weekly', '2026-09-22', '2026-09-28', 'storage', 'ready', '# 储能专报', datetime('now'))
    \`).run();
    writer.close();

    const allAfter = listAiReports({ kind: "weekly", limit: 50 });
    if (allAfter.length !== 2) fail(12, "overview + direction report both listed");
    const overviewOnly = listAiReports({ kind: "weekly", limit: 50, direction: null });
    if (overviewOnly.length !== 1 || overviewOnly[0].direction !== null) fail(13, "direction=null filters to overview");
    const storageOnly = listAiReports({ kind: "weekly", limit: 50, direction: "storage" });
    if (storageOnly.length !== 1 || storageOnly[0].direction !== "storage") fail(14, "direction filter");
    const bogus = listAiReports({ kind: "weekly", limit: 50, direction: "not-a-key" });
    if (bogus.length !== 0) fail(15, "unknown direction = empty");

    // getLatestReadyReport 默认总览：专报 id 更大也不能抢占邮件置顶位
    const latest = getLatestReadyReport("weekly");
    if (!latest || latest.direction !== null) fail(16, "latest defaults to overview");
    const latestStorage = getLatestReadyReport("weekly", "storage");
    if (!latestStorage || latestStorage.direction !== "storage") fail(17, "latest per direction");
  `;
  try {
    const result = await runNodeScript(script, {
      cwd: workingDirectory,
      env: { ...process.env, LITERATURE_DATA_DIR: workingDirectory }
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally {
    rmSync(workingDirectory, { recursive: true, force: true });
  }
});


// 研究速览 v2（PLAN-AI-REPORTS-V2.md）：paperBriefs 三字段速评契约——
// apply-report.mjs 硬校验（方向专报全量覆盖 / 总览仅精选 / 越界 id / 超长字段 / 缺字段拒收）、
// listAiReports meta 轻量模式（剥 content_md + paperBriefs）、getAiReportDetail 三种定位。
test("ai reports v2: paperBriefs apply contract, meta list and detail queries", async () => {
  const workingDirectory = mkdtempSync(path.join(tmpdir(), "literature-ai-reports-v2-"));
  const dbUrl = new URL("./db.js", import.meta.url).href;
  const applyScript = fileURLToPath(new URL("../scripts/apply-report.mjs", import.meta.url));
  const dbPath = path.join(workingDirectory, "literature.sqlite");
  const script = `
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const { writeFileSync } = await import("node:fs");
    const pathModule = await import("node:path");
    const execFileAsync = promisify(execFile);
    const applyScript = ${JSON.stringify(applyScript)};
    const dbPath = ${JSON.stringify(dbPath)};
    const fail = (code, detail) => { console.error(code, detail || ""); process.exit(typeof code === "number" ? code : 1); };
    const runApply = async (batchFile, resultPayload) => {
      const resultFile = pathModule.join(process.env.LITERATURE_DATA_DIR, "result-" + Math.random().toString(36).slice(2) + ".json");
      writeFileSync(resultFile, JSON.stringify(resultPayload), "utf8");
      try {
        const { stdout } = await execFileAsync(process.execPath, [applyScript, "--export", batchFile, "--file", resultFile, "--db", dbPath], { encoding: "utf8" });
        return { status: 0, body: JSON.parse(stdout) };
      } catch (error) {
        return { status: Number.isInteger(error.code) ? error.code : 1, body: error.stdout ? JSON.parse(error.stdout) : null };
      }
    };

    // ── 方向专报批次：2 篇（id 901/902）───────────────────────────────────────
    const dirBatch = {
      exportedAt: "2026-09-29T10:00:00.000Z", kind: "weekly",
      periodStart: "2026-09-22", periodEnd: "2026-09-28", direction: "storage",
      stats: { total: 2, directionCounts: { storage: 2 }, previous: { total: 0, directionCounts: { storage: 0 } } },
      articles: [
        { id: 901, title: "Paper A", direction: "storage", journal: "J A", doi: "", displayDate: "2026-09-25", keywords: "", abstract: "Abstract A." },
        { id: 902, title: "Paper B", direction: "storage", journal: "J B", doi: "", displayDate: "2026-09-26", keywords: "", abstract: "Abstract B." }
      ]
    };
    const dirBatchFile = pathModule.join(process.env.LITERATURE_DATA_DIR, "batch-d-storage.json");
    writeFileSync(dirBatchFile, JSON.stringify(dirBatch), "utf8");
    const baseHead = { exportedAt: dirBatch.exportedAt, kind: "weekly", periodStart: dirBatch.periodStart, periodEnd: dirBatch.periodEnd, direction: "storage" };
    const goodBriefs = [
      { id: 901, object: "研究对象A", method: "方法A", finding: "结论A" },
      { id: 902, object: "研究对象B", method: "方法B", finding: "结论B", topic: "主题X" }
    ];

    // ① 正常批：全覆盖 briefs → 通过，briefCount=2
    const okRun = await runApply(dirBatchFile, { ...baseHead, contentMd: "# 储能专报\\n正文", highlightIds: [901], topTopics: [], paperBriefs: goodBriefs });
    if (okRun.status !== 0 || okRun.body.briefCount !== 2) fail(10, JSON.stringify(okRun.body));
    // ② 幂等重跑：同头字段覆盖同期 → 通过
    const rerun = await runApply(dirBatchFile, { ...baseHead, contentMd: "# 储能专报\\n正文v2", highlightIds: [901], topTopics: [], paperBriefs: goodBriefs });
    if (rerun.status !== 0) fail(11, JSON.stringify(rerun.body));
    // ③ 方向专报缺 paperBriefs → 整批拒收
    const noBriefs = await runApply(dirBatchFile, { ...baseHead, contentMd: "# 储能专报", highlightIds: [], topTopics: [] });
    if (noBriefs.status !== 1 || !JSON.stringify(noBriefs.body?.errors || []).includes("required for direction reports")) fail(12, JSON.stringify(noBriefs.body));
    // ④ 覆盖不全（缺 902）→ 拒收并列出缺失 id
    const partial = await runApply(dirBatchFile, { ...baseHead, contentMd: "# 储能专报", highlightIds: [], topTopics: [], paperBriefs: [goodBriefs[0]] });
    if (partial.status !== 1 || !JSON.stringify(partial.body?.errors || []).includes("must cover every article")) fail(13, JSON.stringify(partial.body));
    // ⑤ 幻觉 id（999 不在批次）→ 拒收
    const hallucinated = await runApply(dirBatchFile, { ...baseHead, contentMd: "# 储能专报", highlightIds: [], topTopics: [], paperBriefs: [...goodBriefs, { id: 999, object: "x", method: "y", finding: "z" }] });
    if (hallucinated.status !== 1 || !JSON.stringify(hallucinated.body?.errors || []).includes("not in export batch")) fail(14, JSON.stringify(hallucinated.body));
    // ⑥ finding 超 50 字 → 拒收
    const tooLong = await runApply(dirBatchFile, { ...baseHead, contentMd: "# 储能专报", highlightIds: [], topTopics: [], paperBriefs: [
      { id: 901, object: "a", method: "b", finding: "长".repeat(51) },
      { id: 902, object: "a", method: "b", finding: "c" }
    ] });
    if (tooLong.status !== 1 || !JSON.stringify(tooLong.body?.errors || []).includes("exceeds 50")) fail(15, JSON.stringify(tooLong.body));
    // ⑦ method 为空 → 拒收
    const emptyField = await runApply(dirBatchFile, { ...baseHead, contentMd: "# 储能专报", highlightIds: [], topTopics: [], paperBriefs: [
      { id: 901, object: "a", method: "  ", finding: "c" },
      { id: 902, object: "a", method: "b", finding: "c" }
    ] });
    if (emptyField.status !== 1 || !JSON.stringify(emptyField.body?.errors || []).includes("method is empty")) fail(16, JSON.stringify(emptyField.body));

    // ── 总览批次：3 篇（id 901-903，direction null）───────────────────────────
    const ovBatch = {
      exportedAt: "2026-09-29T11:00:00.000Z", kind: "weekly",
      periodStart: "2026-09-22", periodEnd: "2026-09-28", direction: null,
      stats: { total: 3, directionCounts: { storage: 2, market: 1 }, previous: { total: 0, directionCounts: {} } },
      articles: [
        { id: 901, title: "Paper A", direction: "storage", journal: "J A", doi: "", displayDate: "2026-09-25", keywords: "", abstract: "A." },
        { id: 902, title: "Paper B", direction: "storage", journal: "J B", doi: "", displayDate: "2026-09-26", keywords: "", abstract: "B." },
        { id: 903, title: "Paper C", direction: "market", journal: "J C", doi: "", displayDate: "2026-09-27", keywords: "", abstract: "C." }
      ]
    };
    const ovBatchFile = pathModule.join(process.env.LITERATURE_DATA_DIR, "batch-weekly.json");
    writeFileSync(ovBatchFile, JSON.stringify(ovBatch), "utf8");
    const ovHead = { exportedAt: ovBatch.exportedAt, kind: "weekly", periodStart: ovBatch.periodStart, periodEnd: ovBatch.periodEnd, direction: null };
    // ⑧ 总览：仅精选（901）带 brief → 通过
    const ovOk = await runApply(ovBatchFile, { ...ovHead, contentMd: "# 总览\\n正文", highlightIds: [901], topTopics: [], paperBriefs: [{ id: 901, object: "o", method: "m", finding: "f" }] });
    if (ovOk.status !== 0 || ovOk.body.briefCount !== 1) fail(20, JSON.stringify(ovOk.body));
    // ⑨ 总览：brief 指向非精选（902）→ 拒收
    const ovOutside = await runApply(ovBatchFile, { ...ovHead, contentMd: "# 总览\\n正文", highlightIds: [901], topTopics: [], paperBriefs: [{ id: 902, object: "o", method: "m", finding: "f" }] });
    if (ovOutside.status !== 1 || !JSON.stringify(ovOutside.body?.errors || []).includes("for highlightIds only")) fail(21, JSON.stringify(ovOutside.body));
    // ⑩ 总览：无 paperBriefs（旧格式兼容）→ 通过
    const ovLegacy = await runApply(ovBatchFile, { ...ovHead, contentMd: "# 总览\\n正文v2", highlightIds: [901], topTopics: [] });
    if (ovLegacy.status !== 0) fail(22, JSON.stringify(ovLegacy.body));

    // ── db.js：meta 轻量列表 / detail 定位 ───────────────────────────────────
    const { listAiReports, getAiReportDetail } = await import(${JSON.stringify(dbUrl)});
    const metas = listAiReports({ kind: "weekly", limit: 50, meta: true });
    if (metas.length !== 2) fail(30, "meta list rows, got " + metas.length);
    if (metas.some((row) => row.content_md !== null)) fail(31, "meta list must strip content_md");
    if (metas.some((row) => row.stats && row.stats.paperBriefs !== undefined)) fail(32, "meta stats must strip paperBriefs");
    if (!metas.every((row) => row.stats && typeof row.stats.total === "number")) fail(33, "meta stats keeps total");
    const fulls = listAiReports({ kind: "weekly", limit: 50, meta: false });
    if (fulls.some((row) => !row.content_md)) fail(34, "full list keeps content_md");
    const dirFull = fulls.find((row) => row.direction === "storage");
    if (!dirFull || !dirFull.stats.paperBriefs || dirFull.stats.paperBriefs.length !== 2) fail(35, "direction report keeps paperBriefs");
    if (dirFull.stats.paperBriefs[1].topic !== "主题X") fail(36, "brief topic preserved");
    const ovFull = fulls.find((row) => row.direction === null);
    if (!ovFull || ovFull.stats.paperBriefs !== undefined) fail(37, "legacy overview has no paperBriefs key");

    const byId = getAiReportDetail({ id: dirFull.id });
    if (!byId || byId.direction !== "storage" || !byId.content_md) fail(40, "detail by id");
    const overviewDetail = getAiReportDetail({ kind: "weekly", periodStart: "2026-09-22" });
    if (!overviewDetail || overviewDetail.direction !== null) fail(41, "detail overview by period");
    const dirDetail = getAiReportDetail({ kind: "weekly", periodStart: "2026-09-22", direction: "storage" });
    if (!dirDetail || dirDetail.direction !== "storage") fail(42, "detail by period+direction");
    if (getAiReportDetail({ kind: "weekly", periodStart: "2026-09-22", direction: "bogus" }) !== null) fail(43, "bogus direction detail = null");
    if (getAiReportDetail({ id: 0 }) !== null || getAiReportDetail({ id: -3 }) !== null) fail(44, "invalid id detail must be null");
    const dirOnly = listAiReports({ kind: "weekly", limit: 50, directions: ["storage"], periodStart: "2026-09-22" });
    if (dirOnly.length !== 1 || dirOnly[0].direction !== "storage") fail(45, "directions array + periodStart filter");
    const emptyDirs = listAiReports({ kind: "weekly", limit: 50, directions: [] });
    if (emptyDirs.length !== 0) fail(46, "empty directions array = no rows");
    if (getAiReportDetail({ kind: "weekly", periodStart: "2026-09-22", direction: "" }).direction !== null) fail(47, "empty direction string = overview");
  `;
  try {
    const result = await runNodeScript(script, {
      cwd: workingDirectory,
      env: { ...process.env, LITERATURE_DATA_DIR: workingDirectory }
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally {
    rmSync(workingDirectory, { recursive: true, force: true });
  }
});

// 当日新增（PLAN-DAILY-DIGEST.md，2026-10-15）：kind='daily' 全链路——
// ① CHECK 约束由 ('weekly','monthly') 扩到含 'daily' 的幂等重建迁移（旧数据保留）；
// ② listAiReports / getAiReportDetail / getLatestReadyReport 接受 daily；
// ③ 损坏的 stats_json 在 meta 模式与 brief_count 上都不得抛 malformed JSON；
// ④ apply-report.mjs 的 daily 契约：paperBriefs 全覆盖 + focusIds ≤5 / ⊆ 批次 / 仅 daily 可用。
test("ai reports daily kind: kind migration, daily read paths and focusIds contract", async () => {
  const workingDirectory = mkdtempSync(path.join(tmpdir(), "literature-ai-reports-daily-"));
  const dbUrl = new URL("./db.js", import.meta.url).href;
  const applyScript = fileURLToPath(new URL("../scripts/apply-report.mjs", import.meta.url));
  const dbPath = path.join(workingDirectory, "literature.sqlite");
  const script = `
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const { writeFileSync } = await import("node:fs");
    const pathModule = await import("node:path");
    const { DatabaseSync } = await import("node:sqlite");
    const execFileAsync = promisify(execFile);
    const applyScript = ${JSON.stringify(applyScript)};
    const dbPath = ${JSON.stringify(dbPath)};
    const fail = (code, detail) => { console.error(code, detail || ""); process.exit(typeof code === "number" ? code : 1); };

    // ── 伪造「旧版」表：CHECK 只认 weekly/monthly，且已有一行周报 ─────────────
    const legacy = new DatabaseSync(dbPath);
    legacy.exec(\`
      CREATE TABLE ai_reports (
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
      INSERT INTO ai_reports (kind, period_start, period_end, status, content_md, stats_json, generated_at)
        VALUES ('weekly','2026-10-06','2026-10-12','ready','# 旧周报','{"total":1,"directionCounts":{"storage":1},"directionDelta":{}}',datetime('now'));
    \`);
    legacy.close();

    // ── ① 迁移：约束含 daily、旧行保留 ────────────────────────────────────────
    const { listAiReports, getAiReportDetail, getLatestReadyReport } = await import(${JSON.stringify(dbUrl)});
    const tableSql = new DatabaseSync(dbPath, { readOnly: true })
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'ai_reports'").get().sql;
    if (!tableSql.includes("'daily'")) fail(10, "kind migration must widen CHECK to daily");
    if (listAiReports({ kind: "weekly", limit: 10 }).length !== 1) fail(11, "legacy weekly row must survive migration");

    // ── ② daily 写入 → 三个读接口都能取到；坏 JSON 行不得抛错 ────────────────
    const writer = new DatabaseSync(dbPath);
    writer.prepare(\`INSERT INTO ai_reports (kind, period_start, period_end, direction, status, content_md, stats_json, generated_at)
      VALUES ('daily','2026-10-15','2026-10-15',NULL,'ready','# 当日新增','{"total":2,"paperBriefs":[],"focusIds":[]}',datetime('now'))\`).run();
    writer.prepare(\`INSERT INTO ai_reports (kind, period_start, period_end, direction, status, content_md, stats_json, generated_at)
      VALUES ('daily','2026-10-14','2026-10-14',NULL,'ready','# 坏 JSON','not-json{',datetime('now'))\`).run();
    writer.close();

    const daily = listAiReports({ kind: "daily", limit: 10 });
    if (daily.length !== 2) fail(12, "daily list rows, got " + daily.length);
    if (daily.find((row) => row.period_start === "2026-10-14").stats !== null) fail(13, "bad stats_json degrades to null");
    const dailyMeta = listAiReports({ kind: "daily", limit: 10, meta: true });
    if (dailyMeta.length !== 2) fail(14, "meta list must tolerate bad stats_json");
    if (dailyMeta.some((row) => row.content_md !== null)) fail(15, "meta list strips content_md");
    if (!dailyMeta.every((row) => Number.isInteger(row.briefCount))) fail(16, "briefCount must be an integer even for bad JSON");
    const dailyDetail = getAiReportDetail({ kind: "daily", periodStart: "2026-10-15" });
    if (!dailyDetail || dailyDetail.kind !== "daily" || dailyDetail.direction !== null) fail(17, "daily detail");
    const latestDaily = getLatestReadyReport("daily");
    if (!latestDaily || latestDaily.period_start !== "2026-10-15") fail(18, "latest daily");
    if (listAiReports({ kind: "bogus" }).length !== 0) fail(19, "unknown kind still empty");

    // ── ③ apply-report.mjs：daily 契约 ────────────────────────────────────────
    const runApply = async (batchFile, payload) => {
      const resultFile = pathModule.join(process.env.LITERATURE_DATA_DIR, "result-" + Math.random().toString(36).slice(2) + ".json");
      writeFileSync(resultFile, JSON.stringify(payload), "utf8");
      try {
        const { stdout } = await execFileAsync(process.execPath, [applyScript, "--export", batchFile, "--file", resultFile, "--db", dbPath], { encoding: "utf8" });
        return { status: 0, body: JSON.parse(stdout) };
      } catch (error) {
        return { status: Number.isInteger(error.code) ? error.code : 1, body: error.stdout ? JSON.parse(error.stdout) : null };
      }
    };
    const dayBatch = {
      exportedAt: "2026-10-15T06:30:00.000Z", kind: "daily",
      periodStart: "2026-10-16", periodEnd: "2026-10-16", direction: null,
      stats: { total: 2, directionCounts: { storage: 1, market: 1 }, previous: { total: 0, directionCounts: {} } },
      articles: [
        { id: 901, title: "Paper A", direction: "storage", journal: "J A", doi: "", displayDate: "2026-10-16", keywords: "", abstract: "A." },
        { id: 902, title: "Paper B", direction: "market", journal: "J B", doi: "", displayDate: "2026-10-16", keywords: "", abstract: "B." }
      ]
    };
    const dayBatchFile = pathModule.join(process.env.LITERATURE_DATA_DIR, "batch-daily-2026-10-16.json");
    writeFileSync(dayBatchFile, JSON.stringify(dayBatch), "utf8");
    const dayHead = { exportedAt: dayBatch.exportedAt, kind: "daily", periodStart: dayBatch.periodStart, periodEnd: dayBatch.periodEnd, direction: null };
    const dayBriefs = [
      { id: 901, object: "对象A", method: "方法A", finding: "结论A" },
      { id: 902, object: "对象B", method: "方法B", finding: "结论B" }
    ];
    // ④ 合规：全覆盖 briefs + focusIds → 通过，focusCount 落库
    const dayOk = await runApply(dayBatchFile, { ...dayHead, contentMd: "# 当日新增\\n正文", focusIds: [901], topTopics: ["主题"], paperBriefs: dayBriefs });
    if (dayOk.status !== 0 || dayOk.body.focusCount !== 1 || dayOk.body.briefCount !== 2) fail(30, JSON.stringify(dayOk.body));
    const stored = listAiReports({ kind: "daily", limit: 50 }).find((row) => row.period_start === "2026-10-16");
    if (!stored || !Array.isArray(stored.stats.focusIds) || stored.stats.focusIds[0] !== 901) fail(31, "focusIds persisted into stats");
    // ⑤ 缺 paperBriefs → 拒收（daily 与方向专报同门槛）
    const dayNoBriefs = await runApply(dayBatchFile, { ...dayHead, contentMd: "# 当日新增", focusIds: [], topTopics: [] });
    if (dayNoBriefs.status !== 1 || !JSON.stringify(dayNoBriefs.body?.errors || []).includes("required for daily reports")) fail(32, JSON.stringify(dayNoBriefs.body));
    // ⑥ 覆盖不全（缺 902）→ 拒收
    const dayPartial = await runApply(dayBatchFile, { ...dayHead, contentMd: "# 当日新增", focusIds: [], topTopics: [], paperBriefs: [dayBriefs[0]] });
    if (dayPartial.status !== 1 || !JSON.stringify(dayPartial.body?.errors || []).includes("must cover every article")) fail(33, JSON.stringify(dayPartial.body));
    // ⑦ focusIds 超 5 条 → 拒收
    const dayTooMany = await runApply(dayBatchFile, { ...dayHead, contentMd: "# 当日新增", focusIds: [1, 2, 3, 4, 5, 6], topTopics: [], paperBriefs: dayBriefs });
    if (dayTooMany.status !== 1 || !JSON.stringify(dayTooMany.body?.errors || []).includes("focusIds exceeds")) fail(34, JSON.stringify(dayTooMany.body));
    // ⑧ focusIds 越界（幻觉 id）→ 拒收
    const dayHallucinated = await runApply(dayBatchFile, { ...dayHead, contentMd: "# 当日新增", focusIds: [999], topTopics: [], paperBriefs: dayBriefs });
    if (dayHallucinated.status !== 1 || !JSON.stringify(dayHallucinated.body?.errors || []).includes("not in export batch")) fail(35, JSON.stringify(dayHallucinated.body));
    // ⑨ 周报带 focusIds → 拒收（该字段仅 daily 有意义）
    const weeklyBatch = { ...dayBatch, kind: "weekly", periodStart: "2026-10-10", periodEnd: "2026-10-16", exportedAt: "2026-10-15T07:00:00.000Z" };
    const weeklyFile = pathModule.join(process.env.LITERATURE_DATA_DIR, "batch-weekly-focus.json");
    writeFileSync(weeklyFile, JSON.stringify(weeklyBatch), "utf8");
    const weeklyFocus = await runApply(weeklyFile, { exportedAt: weeklyBatch.exportedAt, kind: "weekly", periodStart: weeklyBatch.periodStart, periodEnd: weeklyBatch.periodEnd, direction: null, contentMd: "# 周报", focusIds: [901], topTopics: [] });
    if (weeklyFocus.status !== 1 || !JSON.stringify(weeklyFocus.body?.errors || []).includes("only meaningful for kind=daily")) fail(36, JSON.stringify(weeklyFocus.body));
    // ⑩ 幂等重跑：同期覆盖，不产生重复行
    const dayRerun = await runApply(dayBatchFile, { ...dayHead, contentMd: "# 当日新增 v2", focusIds: [902, 901], topTopics: [], paperBriefs: dayBriefs });
    const dailyRows = new DatabaseSync(dbPath, { readOnly: true })
      .prepare("SELECT COUNT(*) AS n FROM ai_reports WHERE kind = 'daily' AND period_start = '2026-10-16'").get().n;
    if (dayRerun.status !== 0 || dailyRows !== 1) fail(37, "rerun must overwrite, rows=" + dailyRows);
  `;
  try {
    const result = await runNodeScript(script, {
      cwd: workingDirectory,
      env: { ...process.env, LITERATURE_DATA_DIR: workingDirectory }
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally {
    rmSync(workingDirectory, { recursive: true, force: true });
  }
});
