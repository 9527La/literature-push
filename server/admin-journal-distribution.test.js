import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runNodeScript } from "./run-node-script.js";
import test from "node:test";

// 回归：管理中心的「文献分布」必须覆盖整个期刊目录。
// 目录真值 = DEFAULT_JOURNALS ∪ settings.journals（和采集侧 refresh.js#journalsToCollect
// 同一个集合）。曾经这里只读 settings.journals —— 那是站点的「附加期刊」设置，生产库里
// 只有 3 本，于是 Energy / Applied Energy / 中国电机工程学报 等 13 本真期刊被整批滤掉，
// 表里只剩 3 行，看上去就是「文献并不全」。目录外的刊（ICE Energy 那种串号拉回来的）
// 仍然要滤掉。
test("文献分布覆盖整个期刊目录，且仍滤掉目录外的刊名", async () => {
  const workingDirectory = mkdtempSync(path.join(tmpdir(), "literature-admin-distribution-test-"));
  const dbUrl = new URL("./db.js", import.meta.url).href;
  const configUrl = new URL("./config.js", import.meta.url).href;
  const script = `
    const { db, getAdminOverview, getSettings } = await import(${JSON.stringify(dbUrl)});
    const { DEFAULT_JOURNALS } = await import(${JSON.stringify(configUrl)});
    const insert = db.prepare("INSERT INTO articles (external_id, title, journal, published_at, first_seen_at, fetched_at) VALUES (?, ?, ?, datetime('now'), datetime('now'), datetime('now'))");
    insert.run("energy-1", "储能系统多目标优化调度", "Energy");
    insert.run("cn-1", "面向新型电力系统的调度方法", "电网技术");
    insert.run("ice-1", "A civil engineering energy paper", "Proceedings of the Institution of Civil Engineers - Energy");

    // 模拟生产：settings.journals 只留一本「附加期刊」，绝不能当成目录真值
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('journals', ?)").run(JSON.stringify([{ name: "Energy" }]));
    if (getSettings().journals.length !== 1) process.exit(40);

    const overview = getAdminOverview();
    const names = overview.journals.map((row) => row.journal).sort().join(",");
    if (names !== "Energy,电网技术") process.exit(41);
    if (overview.journals.some((row) => row.journal.includes("Civil Engineers"))) process.exit(42);
    if (overview.journals.find((row) => row.journal === "电网技术")?.count !== 1) process.exit(43);

    // 目录本身必须远大于 settings.journals，否则这条回归没有意义
    if (DEFAULT_JOURNALS.length < 10) process.exit(44);
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
