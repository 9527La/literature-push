import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runNodeScript } from "./run-node-script.js";
import test from "node:test";

// 摘要弹窗「相关文献」推荐（A3-3）：同方向 + 关键词共现打分的全量回归。
// 覆盖：共现排序、同方向约束、other/未分类来源的兜底池、junk 标题排除、
// limit 上限、自排除、登录态 interaction 字段。
test("related articles rank by keyword overlap inside the same direction", async () => {
  const workingDirectory = mkdtempSync(path.join(tmpdir(), "literature-related-test-"));
  const dbUrl = new URL("./db.js", import.meta.url).href;
  const script = `
    const { db, listRelatedArticles } = await import(${JSON.stringify(dbUrl)});
    const fail = (code, detail) => { console.error(code, detail || ""); process.exit(typeof code === "number" ? code : 1); };

    const ymd = (offset) => {
      const d = new Date(Date.now() - offset * 86400000);
      return d.toISOString().slice(0, 10);
    };
    const insert = db.prepare(\`
      INSERT INTO articles (external_id, title, abstract, authors, journal, keywords,
        research_direction, first_public_at, fetched_at, first_seen_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    \`);
    const idOf = (external) => db.prepare("SELECT id FROM articles WHERE external_id = ?").get(external).id;

    insert.run("r-source", "Battery storage sizing for microgrids", "Sizing study.", "A. One", "Applied Energy", "battery; energy storage; microgrid", "storage", ymd(1));
    insert.run("r-b2", "Microgrid battery dispatch", "Dispatch.", "B. Two", "IEEE Transactions", "battery; microgrid; SOC", "storage", ymd(2));
    insert.run("r-c1", "Battery degradation under grid duty", "Degradation.", "C. Three", "Applied Energy", "battery; degradation", "storage", ymd(0));
    insert.run("r-d0", "Hydrogen storage cavern modelling", "Hydrogen.", "D. Four", "Applied Energy", "hydrogen; electrolyzer", "storage", ymd(0));
    insert.run("r-market", "Battery bidding in the market", "Bidding.", "E. Five", "IEEE Transactions", "battery; microgrid", "market", ymd(3));
    insert.run("r-other", "Sea cucumber farming", "Unrelated.", "F. Six", "IEEE Transactions", "battery; microgrid", "other", ymd(2));
    insert.run("r-junk", "Correction to: Microgrid battery dispatch", "Junk.", "G. Seven", "IEEE Transactions", "battery; microgrid", "storage", ymd(0));
    insert.run("r-null", "Unclassified battery pricing note", "Pending.", "H. Eight", "Applied Energy", "battery; pricing", null, ymd(0));

    const titles = (rows) => rows.map((row) => row.title);

    // 同方向 + 共现排序：B(共现2) > C(共现1) > D(共现0)；market/other/junk 不进池
    const related = listRelatedArticles(idOf("r-source"), null, 3);
    if (titles(related).join("|") !== "Microgrid battery dispatch|Battery degradation under grid duty|Hydrogen storage cavern modelling") {
      fail(2, "storage ranking: " + titles(related).join("|"));
    }

    // limit 生效、来源自身永不出现
    if (listRelatedArticles(idOf("r-source"), null, 2).length !== 2) fail(3, "limit=2");
    if (listRelatedArticles(idOf("r-source"), null, 10).some((row) => row.title.includes("sizing"))) fail(4, "self excluded");

    // other 来源 → 兜底池 = 非 other 全库；共现同为 2 的按日期倒序（A(1d) > B(2d) > E(3d)）
    const fromOther = listRelatedArticles(idOf("r-other"), null, 3);
    if (titles(fromOther).join("|") !== "Battery storage sizing for microgrids|Microgrid battery dispatch|Battery bidding in the market") {
      fail(5, "other source pool: " + titles(fromOther).join("|"));
    }

    // 未分类来源 → 兜底池 = 非 other 全库（market 候选合法）；共现 1 组内按日期
    // C(0d) > A(1d) > B(2d)（来源词 pricing 无候选命中，E 共现同为 1 但日期更早）
    const fromNull = listRelatedArticles(idOf("r-null"), null, 3);
    if (titles(fromNull).join("|") !== "Battery degradation under grid duty|Battery storage sizing for microgrids|Microgrid battery dispatch") {
      fail(6, "null source pool: " + titles(fromNull).join("|"));
    }

    // 非法 id / 不存在的 id → 空数组（前端整块隐藏）
    if (listRelatedArticles("abc", null, 3).length !== 0) fail(7, "invalid id");
    if (listRelatedArticles(999999, null, 3).length !== 0) fail(8, "missing id");

    // 登录态：候选行带 is_read/is_favorite
    const userId = "account:rel-1";
    db.prepare("INSERT INTO user_interactions (user_id, article_id, is_read, is_favorite) VALUES (?, ?, 1, 0)")
      .run(userId, idOf("r-b2"));
    const withUser = listRelatedArticles(idOf("r-source"), userId, 3);
    const readRow = withUser.find((row) => row.title === "Microgrid battery dispatch");
    if (!readRow || readRow.is_read !== 1 || readRow.is_favorite !== 0) fail(9, "user interactions");

    // 紧凑预览字段与列表页同构（弹窗直接渲染，不再二次请求）
    const first = related[0];
    if (!("display_date" in first) || !("research_direction" in first) || !("translated_title" in first)) fail(10, "row shape");
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
