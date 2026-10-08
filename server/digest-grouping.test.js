import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runNodeScript } from "./run-node-script.js";
import test from "node:test";

// 摘要邮件正文方向分组（A3-4）：偏好顺序优先、其余按篇数降序、其他/未分类
// 殿后、组间编号连续、单组回退平铺（与旧版式逐字节一致）、文件附件不受影响。
test("digest email body groups by direction with user-preferred order", async () => {
  const workingDirectory = mkdtempSync(path.join(tmpdir(), "literature-digest-group-test-"));
  const digestUrl = new URL("./digest.js", import.meta.url).href;
  const script = `
    const { internals } = await import(${JSON.stringify(digestUrl)});
    const fail = (code, detail) => { console.error(code, detail || ""); process.exit(typeof code === "number" ? code : 1); };

    const mk = (id, title, direction, date = "2026-10-01") => ({
      article: {
        id, title, journal: "Applied Energy", doi: "10.0/" + id,
        display_date: date, published_at: date, keywords: "k",
        research_direction: direction, abstract: "Abstract text."
      },
      translation: null
    });
    const items = [
      mk(1, "Storage one", "storage"),
      mk(2, "Storage two", "storage"),
      mk(3, "Market one", "market"),
      mk(4, "Other one", "other"),
      mk(5, "Unclassified one", null)
    ];
    const options = { includeKeywords: false, includeAbstract: false, includeTranslation: false, groupByDirection: true };

    // 1) 用户偏好（storage）置顶，其余按篇数降序（并列走目录序），other/未分类殿后
    const grouped = internals.renderGroupedEmailBody(items, { ...options, directionOrder: ["storage"] }, true);
    const headers = [...grouped.matchAll(/^### (.+?)（(\\d+) 篇）$/gm)].map((m) => m[1]);
    const expected = ["储能系统", "电力市场与机制", "其他/交叉", "未分类"];
    if (headers.join("|") !== expected.join("|")) fail(2, "group order: " + headers.join("|"));

    // 2) 组间编号连续 1..N
    const numbers = [...grouped.matchAll(/^## (\\d+)\\./gm)].map((m) => Number(m[1]));
    if (numbers.join(",") !== "1,2,3,4,5") fail(3, "continuous numbering: " + numbers.join(","));

    // 3) 无偏好 → 篇数降序打头（storage 3 篇 > market 1 篇），组数 >1 才分组
    const byCount = internals.renderGroupedEmailBody(
      [mk(1, "m1", "market"), mk(2, "m2", "market"), mk(3, "m3", "market"), mk(4, "s1", "storage")],
      options, true
    );
    if (!/^### 电力市场与机制（3 篇）/.test(byCount)) fail(4, "count order first group");

    // 4) 单组（或全未分类）→ null → 渲染层回退平铺，输出与旧版式一致（无组标题）
    if (internals.renderGroupedEmailBody([mk(1, "a", null), mk(2, "b", null)], options, true) !== null) {
      fail(5, "single group must fall back to flat");
    }
    const flat = internals.renderEmailBodyMarkdown([mk(1, "a", null), mk(2, "b", null)], options);
    if (/^### /m.test(flat) || !/^## 1\\./m.test(flat)) fail(6, "flat fallback shape");

    // 5) 不开 groupByDirection（文件附件路径）→ 永近平铺
    const fileBody = internals.renderEmailBodyMarkdown(items, { ...options, groupByDirection: false });
    if (/^### /m.test(fileBody)) fail(7, "file attachment must stay flat");

    // 6) 空列表：正文写「本周期未发现」，不抛错
    const empty = internals.renderEmailBodyMarkdown([], options);
    if (!empty.includes("本周期未发现符合条件的新论文")) fail(8, "empty body");
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
