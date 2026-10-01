import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runNodeScript } from "./run-node-script.js";
import test from "node:test";

// 回归：文献日期统一口径。
//   · 正式出版（出版日期已在过去）→ 用正式出版日期
//   · 提前访问 / 在线首发（出版日期写的是未来卷期日）→ 用「加入数据库的时间」
//   · 没有任何出版日期 → 同样回落「加入数据库的时间」
//   · 本周才补录的**历史论文** → 仍然是旧论文，不能因为入库时间在窗口内就被算成新论文
// 这套口径由 db.js 的 effectiveDateSql/displayDateSql 统一提供，列表排序、日期筛选、
// 详情、收藏、近 7/30 天统计、推送窗口、关键词统计都必须一致；任何一处退回直接用
// published_at，同一批数据在不同页面就会算出不同的日期与「新论文」条数。
test("listArticlePage 按统一口径给出 display_date 并用它排序与筛选", async () => {
  const workingDirectory = mkdtempSync(path.join(tmpdir(), "literature-article-date-test-"));
  const dbUrl = new URL("./db.js", import.meta.url).href;
  const script = `
    const { db, listArticlePage } = await import(${JSON.stringify(dbUrl)});
    const DAY = 86400000;
    const base = Date.now();
    const stamp = (offset) => new Date(base + offset * DAY).toISOString().slice(0, 19).replace("T", " ");
    const ymd = (offset) => new Date(base + offset * DAY).toISOString().slice(0, 10);

    const insert = db.prepare("INSERT INTO articles (external_id, title, journal, published_at, first_seen_at, fetched_at) VALUES (?, ?, ?, ?, ?, ?)");
    // formal —— 正式出版：出版日期在过去，用出版日期
    insert.run("formal", "储能系统多目标优化调度", "Energy", stamp(-2), stamp(-2), stamp(-2));
    // early —— 提前访问：出版日期写在未来（爱思唯尔的卷期日），用入库时间（今天）
    insert.run("early", "微电网能量管理在线首发", "Applied Energy", stamp(200), stamp(0), stamp(0));
    // nodate —— 没有出版日期，用入库时间
    insert.run("nodate", "没有出版日期的记录", "Energy", null, stamp(-3), stamp(-3));
    // history —— 本周才补录的历史论文：出版日期很旧，入库时间却是今天，必须仍算旧论文
    insert.run("history", "历史补录论文", "Energy", stamp(-30), stamp(0), stamp(0));

    const page = listArticlePage({ limit: "10", offset: "0" }, null);
    const byId = Object.fromEntries(page.articles.map((item) => [item.external_id, item]));
    const expected = {
      formal: ymd(-2),
      early: ymd(0),
      nodate: ymd(-3),
      history: ymd(-30)
    };
    for (const [id, want] of Object.entries(expected)) {
      const row = byId[id];
      if (!row) process.exit(20);
      if (row.display_date !== want) process.exit(21);
    }
    // 排序同样按统一口径：提前访问（今天）第一，历史补录（30 天前）最后
    if (page.articles.map((item) => item.external_id).join(",") !== "early,formal,nodate,history") process.exit(22);

    // 日期筛选也走统一口径：近 3 天应命中 early / formal / nodate，历史补录不入围
    const recent = listArticlePage({ from: ymd(-3), to: ymd(0), limit: "10", offset: "0" }, null);
    const recentIds = recent.articles.map((item) => item.external_id).sort().join(",");
    if (recentIds !== "early,formal,nodate") process.exit(23);

    // 反证：如果退回直接用 published_at 筛选同一区间，只能命中 1 篇（formal），
    // 提前访问（未来日期）与无日期记录会整批漏掉 —— 这正是要避免的口径。
    const raw = db.prepare("SELECT COUNT(*) AS count FROM articles WHERE substr(published_at, 1, 10) >= ? AND substr(published_at, 1, 10) <= ?").get(ymd(-3), ymd(0));
    if (Number(raw.count) !== 1) process.exit(24);
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

// 回归：顶部「最近一周/一月首发」两个胶囊必须和列表页的时间范围筛选同口径。
//   窗口 = 北京时间「今天 + 向前 N-1 个自然日」，恰好 N 天（方案 §16 / Case 7）。
//   胶囊与列表都按「文献主时间」列（display_date，YYYY-MM-DD）比较。
// 历史：这里先是从时间戳比较（effectiveDateSql >= datetime('now','-N days')，边界日
// 整天被漏）改成按日期比较；但 date('now','-7 days') 的窗口实际包含 8 个自然日，
// 且 date('now') 按 UTC 取「今天」，北京时间 0—8 点会整体错位一天。现在窗口两端
// 由 server/date 的 businessWindow()（北京业务日）给出，恰好 7 天。
test("近 7 天统计按北京自然日边界（恰好 7 天），与列表时间范围筛选一致", async () => {
  const workingDirectory = mkdtempSync(path.join(tmpdir(), "literature-recent-window-test-"));
  const dbUrl = new URL("./db.js", import.meta.url).href;
  const script = `
    const { db, listArticlePage, getUserStatus } = await import(${JSON.stringify(dbUrl)});
    const DAY = 86400000;
    // 北京业务日（UTC+8 固定偏移）；测试数据全部用「该北京日的 UTC 正午」做时间戳，
    // 保证任何时刻跑测试，存储字符串的日期部分都与北京日对齐。
    const beijingToday = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
    const shift = (dateStr, days) => {
      const [y, m, d] = dateStr.split("-").map(Number);
      return new Date(Date.UTC(y, m - 1, d, 12) + days * DAY).toISOString().slice(0, 10);
    };
    const bYmd = (offset) => shift(beijingToday, offset);
    const stamp = (dateStr) => dateStr + "T12:00:00";

    const insert = db.prepare("INSERT INTO articles (external_id, title, journal, published_at, first_seen_at, fetched_at) VALUES (?, ?, ?, ?, ?, ?)");
    // 边界日（今天 - 6 天）：恰好在 7 天窗口起点，必须算
    insert.run("boundary", "边界日出版的论文", "Energy", stamp(bYmd(-6)), stamp(bYmd(-6)), stamp(bYmd(-6)));
    // 边界日的前一天（今天 - 7 天）：恰好 7 天窗口之外，必须排除
    insert.run("before", "更早出版的论文", "Energy", stamp(bYmd(-7)), stamp(bYmd(-7)), stamp(bYmd(-7)));
    // 窗口内：必须算
    insert.run("inside", "窗口内出版的论文", "Energy", stamp(bYmd(-3)), stamp(bYmd(-3)), stamp(bYmd(-3)));
    // 提前访问（出版日期在未来）且入库时间落在边界日：按统一口径用首次公开日期，必须算
    insert.run("earlyBoundary", "边界日入库的提前访问论文", "Applied Energy", stamp(bYmd(60)), stamp(bYmd(-6)), stamp(bYmd(-6)));
    // 提前访问但入库时间在边界日之前：排除
    insert.run("earlyBefore", "更早入库的提前访问论文", "Applied Energy", stamp(bYmd(60)), stamp(bYmd(-7)), stamp(bYmd(-7)));
    // 历史补录：出版日期很旧、入库时间是今天，仍然不能算成新论文
    insert.run("history", "历史补录论文", "Energy", stamp(bYmd(-40)), stamp(bYmd(0)), stamp(bYmd(0)));

    const status = getUserStatus(null);
    // boundary + inside + earlyBoundary
    if (status.newArticleCount7d !== 3) process.exit(30);

    // 与列表页「时间范围」筛选必须完全一致（验收 12）
    const window = listArticlePage({ from: bYmd(-6), to: bYmd(0), limit: "100", offset: "0" }, null);
    const listed = window.articles.map((item) => item.external_id).sort().join(",");
    if (listed !== "boundary,earlyBoundary,inside") process.exit(31);
    if (window.total !== status.newArticleCount7d) process.exit(32);

    // 反证 1：旧的「-7 days」窗口包含 8 个自然日，会多算 before 那一天
    const eightDayStyle = db.prepare("SELECT COUNT(*) AS count FROM articles WHERE is_non_research_title(title) = 0 AND substr(datetime(CASE WHEN datetime(published_at) IS NULL THEN first_seen_at WHEN datetime(published_at) > datetime('now') THEN first_seen_at ELSE published_at END), 1, 10) >= date('now', '-7 days') AND substr(datetime(CASE WHEN datetime(published_at) IS NULL THEN first_seen_at WHEN datetime(published_at) > datetime('now') THEN first_seen_at ELSE published_at END), 1, 10) <= date('now')").get().count;
    if (Number(eightDayStyle) <= Number(status.newArticleCount7d)) process.exit(33);
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
