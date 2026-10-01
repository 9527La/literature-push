import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runNodeScript } from "./run-node-script.js";
import test from "node:test";

// 回归：文献主时间 first_public_at（方案 §9 判定算法、§10 可信度分级、§25 更新
// 策略、§29 测试用例）。解析/合并在 server/date/ 内实现；本文件覆盖：
//   · Case 1-5：A/B/C/D 优先级；
//   · 未来卷期日不参与主时间判定、UTC 跨日（Case 8）、精度标记（§24）；
//   · 入库与补全流程自动生成/升级主时间，已确认 A 级不被改写（§25）；
//   · 历史补录不进当前窗口（Case 6）；推送窗口与统计同口径（§20）。
import { resolveFirstPublicDate, mergeFirstPublic, resolveMergedFirstPublic } from "./date/resolve-first-public.js";
import { toBusinessDate, normalizeDatePrecision, businessWindow, shiftBusinessDate, daysBetween } from "./date/normalize.js";

const TODAY = "2026-09-24";

test("Case 1：IEEE Early Access + 未来卷期 → 首发日优先（A 级）", () => {
  const result = resolveFirstPublicDate(
    { online_first_at: "2026-05-27", published_at: "2027-01-01", first_seen_at: "2026-09-24 10:00:00" },
    { today: TODAY }
  );
  assert.deepEqual(result, {
    first_public_at: "2026-05-27",
    first_public_precision: "day",
    first_public_source: "online_first",
    first_public_confidence: "A"
  });
});

test("Case 2：Elsevier Available online → 首发日优先（A 级）", () => {
  const result = resolveFirstPublicDate(
    { online_first_at: "2026-07-08", published_at: "2026-11-01", first_seen_at: "2026-09-24 10:00:00" },
    { today: TODAY }
  );
  assert.equal(result.first_public_at, "2026-07-08");
  assert.equal(result.first_public_confidence, "A");
});

test("Case 3：中文网络首发 → 首发日优先（A 级）", () => {
  const result = resolveFirstPublicDate(
    { online_first_at: "2025-11-05", published_at: "2026-03-10", first_seen_at: "2026-09-24 10:00:00" },
    { today: TODAY }
  );
  assert.equal(result.first_public_at, "2025-11-05");
  assert.equal(result.first_public_confidence, "A");
});

test("Case 4：没有网络首发、已正式出版 → 出版日期（B 级）", () => {
  const result = resolveFirstPublicDate(
    { online_first_at: null, published_at: "2023-08-01", first_seen_at: "2026-09-24 10:00:00" },
    { today: TODAY }
  );
  assert.equal(result.first_public_at, "2023-08-01");
  assert.equal(result.first_public_confidence, "B");
});

test("Case 5：所有外部日期均缺失 → 兜底 first_seen_at（D 级，北京业务日）", () => {
  const result = resolveFirstPublicDate(
    { online_first_at: null, published_at: null, external_created_at: null, first_seen_at: "2026-09-24T01:30:00Z" },
    { today: TODAY }
  );
  assert.equal(result.first_public_at, "2026-09-24");
  assert.equal(result.first_public_confidence, "D");
});

test("未来卷期不参与主时间判定；UTC 跨日按北京日归位（Case 8）", () => {
  // published_at 在未来且无其他日期 → D 级兜底 first_seen_at
  const futureOnly = resolveFirstPublicDate(
    { published_at: "2027-01-01", first_seen_at: "2026-09-23T16:30:00Z" },
    { today: TODAY }
  );
  assert.equal(futureOnly.first_public_confidence, "D");
  // UTC 2026-09-23T16:30:00Z = 北京时间 2026-09-24 00:30
  assert.equal(futureOnly.first_public_at, "2026-09-24");
  assert.equal(toBusinessDate("2026-09-23T16:30:00Z"), "2026-09-24");
  // 纯日期字符串不做二次换算
  assert.equal(toBusinessDate("2026-05-27"), "2026-05-27");
});

test("日期精度：月/年精度保留标记，不伪装成日级（§24）", () => {
  assert.deepEqual(normalizeDatePrecision("2020-06"), { date: "2020-06-01", precision: "month" });
  assert.deepEqual(normalizeDatePrecision("2020"), { date: "2020-01-01", precision: "year" });
  assert.deepEqual(normalizeDatePrecision("2020-06-05"), { date: "2020-06-05", precision: "day" });
  assert.deepEqual(normalizeDatePrecision("不是日期"), { date: null, precision: null });
  const month = resolveFirstPublicDate({ published_at: "2020-06", first_seen_at: "2026-01-01" }, { today: TODAY });
  assert.equal(month.first_public_confidence, "B");
  assert.equal(month.first_public_precision, "month");
});

test("近 N 日窗口恰好 N 个北京自然日（Case 7）", () => {
  const window7 = businessWindow(7, Date.parse("2026-09-24T02:00:00Z"));
  assert.equal(window7.startDate, "2026-09-18");
  assert.equal(window7.endDate, "2026-09-24");
  const window30 = businessWindow(30, Date.parse("2026-09-24T02:00:00Z"));
  assert.equal(window30.startDate, "2026-08-26");
  assert.equal(window30.endDate, "2026-09-24");
  assert.equal(shiftBusinessDate(window30.startDate, 29), window30.endDate);
  // 北京 0—8 点（UTC 前一天下午）「今天」仍是北京日
  const earlyMorning = businessWindow(1, Date.parse("2026-09-23T16:30:00Z"));
  assert.equal(earlyMorning.endDate, "2026-09-24");
});

test("整期日例外：月初 1 日的正式出版日 + created 早 >30 天 → 改用 created（2026-09-24 拍板）", () => {
  // Case 9：IEEE 整期 —— 9 月 1 日「正式出版」，实际 7 月 15 日就上线了
  const corrected = resolveFirstPublicDate(
    { published_at: "2026-09-01", external_created_at: "2026-07-15T08:30:00Z", first_seen_at: "2026-09-24" },
    { today: TODAY }
  );
  assert.equal(corrected.first_public_at, "2026-07-15");
  assert.equal(corrected.first_public_source, "issue_date_created_proxy");
  assert.equal(corrected.first_public_confidence, "C");

  // created 只早 12 天（≤30）→ 不算整期代理，保持正式出版日
  const within30 = resolveFirstPublicDate(
    { published_at: "2026-09-01", external_created_at: "2026-08-20", first_seen_at: "2026-09-24" },
    { today: TODAY }
  );
  assert.equal(within30.first_public_at, "2026-09-01");
  assert.equal(within30.first_public_confidence, "B");

  // 正式出版日不是月初 1 日 → 不触发例外
  const notIssueDay = resolveFirstPublicDate(
    { published_at: "2026-09-15", external_created_at: "2026-07-28", first_seen_at: "2026-09-24" },
    { today: TODAY }
  );
  assert.equal(notIssueDay.first_public_at, "2026-09-15");
  assert.equal(notIssueDay.first_public_confidence, "B");

  // 整期日但 created 缺失 → 保持正式出版日
  const noExternal = resolveFirstPublicDate(
    { published_at: "2026-09-01", first_seen_at: "2026-09-24" },
    { today: TODAY }
  );
  assert.equal(noExternal.first_public_at, "2026-09-01");
  assert.equal(noExternal.first_public_confidence, "B");

  // daysBetween 基本语义
  assert.equal(daysBetween("2026-09-01", "2026-07-15"), 48);
  assert.equal(daysBetween("2026-07-15", "2026-09-01"), -48);
});

test("合并规则：A 级不被改写（§25），D→B 升级，同级刷新", () => {
  const confirmedA = { first_public_at: "2026-05-27", first_public_source: "ieee_early_access", first_public_precision: "day", first_public_confidence: "A" };
  // 后续正式卷期元数据只补事实字段，不改写已确认的首次公开日期
  assert.equal(mergeFirstPublic(confirmedA, { first_public_at: "2026-06-01", first_public_confidence: "B" }), confirmedA);
  // 整期日修正：existing 是普通正式出版日、新解析识别出整期代理日并改用 created → 采纳
  const officialIssue = { first_public_at: "2026-09-01", first_public_source: "official_publication", first_public_precision: "day", first_public_confidence: "B" };
  const issueFix = mergeFirstPublic(officialIssue, { first_public_at: "2026-07-15", first_public_source: "issue_date_created_proxy", first_public_precision: "day", first_public_confidence: "C" });
  assert.equal(issueFix.first_public_at, "2026-07-15");
  assert.equal(issueFix.first_public_source, "issue_date_created_proxy");
  // 反向：existing 已是整期修正（C），新解析给出非整期的正式出版日 → 正常升级 B
  const issueCorrected = { first_public_at: "2026-07-15", first_public_source: "issue_date_created_proxy", first_public_precision: "day", first_public_confidence: "C" };
  const upgradedBack = mergeFirstPublic(issueCorrected, { first_public_at: "2026-09-15", first_public_source: "official_publication", first_public_precision: "day", first_public_confidence: "B" });
  assert.equal(upgradedBack.first_public_at, "2026-09-15");
  assert.equal(upgradedBack.first_public_confidence, "B");
  // D → B：入库后补到出版日期
  const fallbackD = { first_public_at: "2026-09-24", first_public_source: "system_first_seen_fallback", first_public_precision: "day", first_public_confidence: "D" };
  const upgraded = mergeFirstPublic(fallbackD, { first_public_at: "2023-08-01", first_public_source: "official_publication", first_public_precision: "day", first_public_confidence: "B" });
  assert.equal(upgraded.first_public_confidence, "B");
  // 同级但日期不同：采纳新值（出版社修正日期）
  const oldB = { first_public_at: "2023-08-01", first_public_confidence: "B" };
  const refreshed = mergeFirstPublic(oldB, { first_public_at: "2023-09-01", first_public_source: "official_publication", first_public_precision: "day", first_public_confidence: "B" });
  assert.equal(refreshed.first_public_at, "2023-09-01");
  // 同级同值：保持旧对象（幂等，不产生写入）
  assert.equal(mergeFirstPublic(oldB, { first_public_at: "2023-08-01", first_public_confidence: "B" }), oldB);
  // 空值 → 采纳解析结果
  assert.equal(mergeFirstPublic(null, { first_public_at: "2023-08-01", first_public_confidence: "B" }).first_public_at, "2023-08-01");
  // 事实字段合并：新值优先、旧值兜底
  const merged = resolveMergedFirstPublic({ online_first_at: "2026-05-27" }, { published_at: "2027-01-01" }, { today: TODAY });
  assert.equal(merged.first_public_at, "2026-05-27");
});

// ── DB 集成：入库 / 补全 / 推送窗口 ──────────────────────────────────────────

test("insertArticles 自动生成 first_public_at，回填 published_at 升级 D→B，A 级不被改写", async () => {
  const workingDirectory = mkdtempSync(path.join(tmpdir(), "literature-first-public-db-"));
  const dbUrl = new URL("./db.js", import.meta.url).href;
  const script = `
    const { db, insertArticles, updateArticleDetails, listRecentArticlesForDigest, getUserStatus } = await import(${JSON.stringify(dbUrl)});
    const DAY = 86400000;
    const beijingToday = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
    const shift = (dateStr, days) => {
      const [y, m, d] = dateStr.split("-").map(Number);
      return new Date(Date.UTC(y, m - 1, d, 12) + days * DAY).toISOString().slice(0, 10);
    };
    const bYmd = (offset) => shift(beijingToday, offset);
    const stamp = (dateStr) => dateStr + "T12:00:00";
    const base = {
      title: "测试论文", authors: "", journal: "Energy", year: 2026, volume: "1", issue: "2",
      doi: "", abstract: "", url: "", keywords: ""
    };
    const row = (id, fields) => ({ ...base, external_id: id, fetched_at: stamp(bYmd(0)), ...fields });

    // 新入库：过去出版日 → B；未来卷期 → D（兜底入库日）
    insertArticles([
      row("formal", { published_at: bYmd(-400) }),
      row("early", { published_at: bYmd(120), first_seen_at: stamp(bYmd(-3)) }),
      // Case 6：历史补录 —— 首次公开在 2021 年，不得进入本周推送/统计
      row("history", { published_at: "2021-05-17", first_seen_at: stamp(bYmd(0)) })
    ]);
    const read = (id) => db.prepare("SELECT * FROM articles WHERE external_id = ?").get(id);
    const formal = read("formal");
    const early = read("early");
    const history = read("history");
    if (formal.first_public_at !== bYmd(-400) || formal.first_public_confidence !== "B") process.exit(40);
    if (early.first_public_at !== bYmd(-3) || early.first_public_confidence !== "D") process.exit(41);
    if (history.first_public_at !== "2021-05-17" || history.first_public_confidence !== "B") process.exit(42);
    // first_seen_at 未被改写
    if (early.first_seen_at !== stamp(bYmd(-3))) process.exit(43);

    // Case 6 断言：历史补录不在近 7 日窗口（推送与统计同口径）
    const digest = listRecentArticlesForDigest(7, 0, []);
    if (digest.some((item) => item.external_id === "history")) process.exit(44);
    const status = getUserStatus(null);
    // 窗口内只有 early（bYmd(-3) 在 7 天内）；formal（-400 天）与 history（2021）都不在
    if (status.newArticleCount7d !== 1) process.exit(45);

    // 升级：early 原为 D 级，补全 online_first_at + published_at（过去）→ A 级
    updateArticleDetails(early.id, { online_first_at: bYmd(-100), published_at: bYmd(120) });
    const earlyUpgraded = read("early");
    if (earlyUpgraded.first_public_at !== bYmd(-100) || earlyUpgraded.first_public_confidence !== "A") process.exit(46);

    // §25：已确认 A 级，后续 published_at 变化不改写主时间
    updateArticleDetails(early.id, { published_at: bYmd(200) });
    const earlyFinal = read("early");
    if (earlyFinal.first_public_at !== bYmd(-100) || earlyFinal.first_public_confidence !== "A") process.exit(47);
    // date_verified_at 已记录
    if (!earlyFinal.date_verified_at) process.exit(48);
  `;
  try {
    const result = await runNodeScript(script, {
      cwd: workingDirectory,
      env: { ...process.env, LITERATURE_DATA_DIR: workingDirectory }
    });
    assert.equal(result.status, 0, `exit=${result.status} ${result.stderr || result.stdout}`);
  } finally {
    rmSync(workingDirectory, { recursive: true, force: true });
  }
});
