import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runNodeScript } from "./run-node-script.js";
import test from "node:test";

// 检索/筛选条件全量回归：direction（含 other 豁免与非法值）、q（LIKE 转义）、
// journal、keyword、from/to、sort、unread/favorite（登录/未登录）与组合筛选。
test("feed filters cover every dimension end to end", async () => {
  const workingDirectory = mkdtempSync(path.join(tmpdir(), "literature-filters-test-"));
  const dbUrl = new URL("./db.js", import.meta.url).href;
  const script = `
    const { db, listArticlePage } = await import(${JSON.stringify(dbUrl)});
    const fail = (code, detail) => { console.error(code, detail || ""); process.exit(typeof code === "number" ? code : 1); };

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
    insert.run("f-storage", "Grid battery deployment study", "Battery storage economics.", "A. Author", "Applied Energy", "battery; storage", "storage", ymd(1));
    insert.run("f-market", "Electricity market power flows", "Market clearing.", "B. Author", "Applied Energy", "market; pricing", "market", ymd(3));
    insert.run("f-other", "Sea cucumber farming report", "Not power systems.", "C. Author", "IEEE Transactions", "aquaculture", "other", ymd(2));
    insert.run("f-null", "Unclassified topic paper", "Pending direction.", "D. Author", "Applied Energy", "misc", null, ymd(0));
    insert.run("f-escape", "Percent 100% and underscore_a title", "Pattern test.", "E. Author", "IEEE Transactions", "PM_2.5; special", "protection", ymd(4));
    insert.run("f-author", "Forecasting wind output", "Author search target.", "Sinan Küfeoğlu", "IEEE Transactions", "forecasting", "forecasting", ymd(6));

    const userId = "account:test-1";
    const mark = db.prepare("INSERT INTO user_interactions (user_id, article_id, is_read, is_favorite) VALUES (?, ?, ?, ?)");
    const idOf = (external) => db.prepare("SELECT id FROM articles WHERE external_id = ?").get(external).id;
    mark.run(userId, idOf("f-storage"), 1, 0);
    mark.run(userId, idOf("f-market"), 0, 1);

    const page = (filters, user) => listArticlePage({ limit: "50", offset: "0", ...filters }, user);
    const totals = (filters, user) => page(filters, user).total;
    const directions = (filters, user) => [...new Set(page(filters, user).articles.map((a) => a.research_direction))];

    // 基线：other 被排除、未分类 NULL 照常展示 → 5 行
    if (totals({}) !== 5) fail(2, "baseline total=" + totals({}));

    // direction 单选 / 多选 / other 豁免 / 非法值
    if (totals({ direction: "storage" }) !== 1) fail(3, "direction=storage");
    const single = page({ direction: "storage" }).articles;
    if (!single.every((a) => a.research_direction === "storage")) fail(4, "direction=storage rows");
    if (totals({ direction: "storage,market" }) !== 2) fail(5, "direction multi");
    if (totals({ direction: "other" }) !== 1) fail(6, "direction=other exemption");
    if (totals({ direction: "storage,other" }) !== 2) fail(7, "direction storage+other");
    if (totals({ direction: "<script>,storage,DROP TABLE" }) !== 1) fail(8, "direction invalid keys");
    const keys = directions({ direction: "market,forecasting" });
    if (keys.length !== 2 || !keys.includes("market") || !keys.includes("forecasting")) fail(9, "direction multi rows");

    // q：普通词、含 % 与 _ 的词（转义 + ESCAPE 子句）、作者命中
    if (totals({ q: "battery" }) !== 1) fail(10, "q=battery");
    if (totals({ q: "100%" }) !== 1) fail(11, "q=100% must escape percent");
    if (totals({ q: "underscore_a" }) !== 1) fail(12, "q=underscore_a");
    if (totals({ q: "%a" }) !== 0) fail(13, "q=%a must not widen");
    if (totals({ q: "Küfeoğlu" }) !== 1) fail(14, "q=author");

    // journal 精确多选（Applied Energy 上有 storage / market / 未分类 f-null 共 3 篇）
    if (totals({ journal: "Applied Energy" }) !== 3) fail(20, "journal single");
    if (totals({ journal: "Applied Energy,Nothing" }) !== 3) fail(21, "journal multi");

    // keyword 筛选：普通词 + 含 _ 的词
    if (totals({ keyword: "battery" }) !== 1) fail(22, "keyword=battery");
    if (totals({ keyword: "PM_2.5" }) !== 1) fail(23, "keyword=PM_2.5 must escape underscore");
    if (totals({ keyword: "battery,forecasting" }) !== 2) fail(24, "keyword multi");

    // from/to 区间（display_date 口径）：区间内有 storage(昨天) 与未分类(今天)，
    // other(前天) 虽落在区间但被基线排除 → 2 行
    if (totals({ from: ymd(2), to: ymd(0) }) !== 2) fail(30, "from/to window");
    const asc = page({ sort: "asc" }).articles.map((a) => a.display_date);
    if (!(asc.length === 5 && asc[0] <= asc[asc.length - 1])) fail(31, "sort=asc");

    // unread / favorite（登录分支）
    if (totals({ unread: "true" }, userId) !== 4) fail(40, "unread excludes read rows, got " + totals({ unread: "true" }, userId));
    if (totals({ favorite: "true" }, userId) !== 1) fail(41, "favorite only");
    const favDir = page({ favorite: "true" }, userId).articles[0].research_direction;
    if (favDir !== "market") fail(42, "favorite row is market");
    // 未登录：unread/favorite 被忽略且不报错
    if (totals({ unread: "true" }) !== 5) fail(43, "guest unread ignored");

    // 组合筛选：q + direction + journal + from/to
    const combo = page({ q: "battery", direction: "storage", journal: "Applied Energy", from: ymd(2), to: ymd(0), sort: "desc", limit: "10", offset: "0" });
    if (combo.total !== 1 || combo.articles[0].research_direction !== "storage") fail(50, "combo");

    // 分页衔接 + hasMore/total
    const p1 = listArticlePage({ limit: "2", offset: "0" }, null);
    const p2 = listArticlePage({ limit: "2", offset: "2" }, null);
    if (p1.total !== 5 || !p1.hasMore) fail(60, "page1");
    if (p2.articles.length !== 2 || p2.total !== 5) fail(61, "page2");
    const ids = new Set([...p1.articles, ...p2.articles].map((a) => a.id));
    if (ids.size !== 4) fail(62, "pages overlap");
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
