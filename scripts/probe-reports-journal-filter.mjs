/**
 * 研究速览 · 专题「来源期刊」筛选探针：功能断言 + 三态截图。
 * 覆盖：清单完整性（页面出现过的期刊必在清单中）/ 实时联动（隐藏后卡片数精确减少 =
 *       该刊渲染卡数、聚类计数变化、状态栏计数）/ 会话级记忆（切走再切回保留）/
 *       「全部显示」复位 / 总览态不显示 / 月度趋势同样覆盖且互不影响。
 *
 * 前置：
 *   node scripts/preview-seed-reports.mjs
 *   PORT=4188 LITERATURE_DATA_DIR=<项目根>/_reports-preview node server/index.js
 * Usage: node scripts/probe-reports-journal-filter.mjs [url]
 */
import { chromium } from "playwright-core";
import fs from "node:fs";

const base = (process.argv[2] || "http://127.0.0.1:4188").replace(/\/$/, "");
const shotDir = "_tmp/journal-filter-shots";
fs.mkdirSync(shotDir, { recursive: true });

function readPassport() {
  try {
    const env = fs.readFileSync(".env", "utf8");
    const match = env.match(/^ADMIN_PASSPORT\s*=\s*(.*)$/m);
    if (match && match[1].trim()) return match[1].trim().replace(/^["']|["']$/g, "");
  } catch { /* .env is required */ }
  console.error("通行证缺失：请在仓库根目录 .env 配置 ADMIN_PASSPORT（代码中不允许硬编码通行证）");
  process.exit(2);
}

const failures = [];
const check = (ok, label, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? ` :: ${detail}` : ""}`);
  if (!ok) failures.push(label);
};

const readCards = (page) => page.evaluate(() => ({
  total: document.querySelectorAll(".reports-brief-card").length,
  journals: [...new Set([...document.querySelectorAll(".reports-brief-card .reports-brief-journal")]
    .map((node) => node.textContent)
    .filter((name) => name && !name.startsWith("文献 #")))]
}));

const browser = await chromium.launch({ channel: process.env.VERIFY_BROWSER || "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1240 } });
const pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(String(error.message).slice(0, 300)));

try {
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  await page.fill('input[type="password"]', readPassport());
  await page.click(".login-form button.primary");
  await page.waitForTimeout(2000);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(600);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  await page.evaluate(() => { location.hash = "#reports"; });
  await page.waitForTimeout(2500);

  // ① 进入第一个方向专报态：清单完整性
  const dirChips = page.locator(".reports-dir-chip:not(.overview):not([disabled])");
  check((await dirChips.count()) > 0, "存在可用方向 chip");
  await dirChips.first().click();
  await page.waitForSelector(".reports-meta-journals", { timeout: 20000 });
  await page.waitForTimeout(800);

  const before = await page.evaluate(() => {
    const chips = [...document.querySelectorAll(".reports-journal-chip")].map((node) => ({
      name: node.querySelector(".reports-journal-name")?.textContent || "",
      count: Number((node.querySelector(".reports-journal-count")?.textContent || "").replace(/[^\d]/g, ""))
    }));
    return {
      chips,
      labelText: document.querySelector(".reports-meta-journals-label")?.textContent || "",
      cards: document.querySelectorAll(".reports-brief-card").length,
      dirLabel: document.querySelector(".reports-meta-direction")?.textContent || ""
    };
  });
  const baseCards = await readCards(page);
  check(before.chips.length >= 2, "期刊清单完整列出（≥2 种）", `${before.chips.length} 种`);
  check(before.chips.every((chip) => chip.count >= 1), "每个期刊 chip 带篇数计数");
  check(baseCards.total > 0, "方向专报卡片已渲染", `${baseCards.total} 张`);
  const missing = baseCards.journals.filter((name) => !before.chips.some((chip) => chip.name === name));
  check(missing.length === 0, "页面上出现的所有期刊均在清单中", missing.join("、"));
  check(before.labelText.includes(`${before.chips.length} 种`), "标签总数与 chip 数一致", before.labelText.replace(/\s+/g, " ").trim());
  await page.locator(".reports-meta").screenshot({ path: `${shotDir}/1-default-meta.png` });
  await page.screenshot({ path: `${shotDir}/1-default-view.png` });

  // ② 展开全部聚类速评（消除「一行切片」对计数的影响），再隐藏渲染卡数最多的期刊
  for (let i = 0; i < 30; i += 1) {
    const more = page.locator(".reports-cluster-more button");
    if (!(await more.count())) break;
    await more.first().click();
    await page.waitForTimeout(150);
  }
  const expanded = await page.evaluate(() => {
    const counts = new Map();
    for (const node of document.querySelectorAll(".reports-brief-card .reports-brief-journal")) {
      const name = node.textContent || "";
      if (!name || name.startsWith("文献 #")) continue;
      counts.set(name, (counts.get(name) || 0) + 1);
    }
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
    return {
      total: document.querySelectorAll(".reports-brief-card").length,
      targetName: sorted[0]?.[0] || "",
      targetCount: sorted[0]?.[1] || 0
    };
  });
  check(expanded.total >= baseCards.total && expanded.targetCount >= 1, "展开全部速评后统计目标期刊", `${expanded.targetName} × ${expanded.targetCount}`);

  const chipIndex = await page.evaluate((name) => [...document.querySelectorAll(".reports-journal-chip")]
    .findIndex((node) => node.querySelector(".reports-journal-name")?.textContent === name), expanded.targetName);
  check(chipIndex >= 0, "目标期刊在来源期刊清单中");
  await page.locator(".reports-journal-chip").nth(chipIndex).click();
  await page.waitForTimeout(500);
  const afterHide = await page.evaluate(() => {
    const off = [...document.querySelectorAll(".reports-journal-chip.is-off")]
      .map((node) => node.querySelector(".reports-journal-name")?.textContent || "");
    const status = (document.querySelector(".reports-meta-journals-status")?.textContent || "").replace(/\s+/g, " ").trim();
    return {
      off,
      status,
      cards: document.querySelectorAll(".reports-brief-card").length,
      journals: [...new Set([...document.querySelectorAll(".reports-brief-card .reports-brief-journal")]
        .map((node) => node.textContent)
        .filter((name) => name && !name.startsWith("文献 #")))],
      clusterBadges: document.querySelectorAll(".reports-cluster-hidden").length
    };
  });
  check(afterHide.off.length === 1 && afterHide.off[0] === expanded.targetName, `chip「${expanded.targetName}」进入已隐藏态`);
  check(
    afterHide.cards === expanded.total - expanded.targetCount,
    `卡片实时联动：移除数 = 该刊渲染卡数（${expanded.targetCount} 张）`,
    `${expanded.total} → ${afterHide.cards}`
  );
  check(!afterHide.journals.includes(expanded.targetName), "剩余卡片不再出现被隐藏期刊");
  check(afterHide.clusterBadges >= 1, "聚类头同步标注「已隐藏 N 条」", `${afterHide.clusterBadges} 处`);
  check(/已隐藏\s*1\s*种\s*·\s*\d+\s*篇/.test(afterHide.status), "状态栏实时计数", afterHide.status);
  await page.locator(".reports-meta").screenshot({ path: `${shotDir}/2-hidden-meta.png` });
  await page.screenshot({ path: `${shotDir}/2-hidden-view.png` });

  // ③ 切走再切回 → 会话级记忆保留（决策 2A）
  await dirChips.nth(1).click();
  await page.waitForTimeout(1800);
  await dirChips.nth(0).click();
  await page.waitForFunction(
    (label) => (document.querySelector(".reports-meta-direction")?.textContent || "") === label,
    before.dirLabel,
    { timeout: 20000 }
  ).catch(() => {});
  await page.waitForTimeout(800);
  const memory = await page.evaluate(() => [...document.querySelectorAll(".reports-journal-chip.is-off")]
    .map((node) => node.querySelector(".reports-journal-name")?.textContent || ""));
  check(memory.includes(expanded.targetName), "切走再切回，筛选状态保留（仅本会话）", memory.join("、"));

  // ④ 「全部显示」复位
  await page.click(".reports-journal-reset");
  await page.waitForTimeout(400);
  const afterReset = await page.evaluate(() => ({
    off: document.querySelectorAll(".reports-journal-chip.is-off").length,
    cards: document.querySelectorAll(".reports-brief-card").length,
    tip: document.querySelector(".reports-meta-journals-tip")?.textContent || ""
  }));
  check(afterReset.off === 0, "「全部显示」后无隐藏 chip");
  check(afterReset.cards === baseCards.total, "卡片数量恢复", `${afterReset.cards}/${baseCards.total}`);
  check(afterReset.tip.includes("点击期刊可隐藏其文献"), "复位后提示文案回归");
  await page.locator(".reports-meta").screenshot({ path: `${shotDir}/3-reset-meta.png` });

  // ⑤ 总览态不显示来源期刊行（决策 3A）
  await page.click(".reports-dir-chip.overview");
  await page.waitForTimeout(1600);
  const overview = await page.evaluate(() => Boolean(document.querySelector(".reports-meta-journals")));
  check(!overview, "总览态不显示来源期刊行（决策 3A）");

  // ⑥ 月度趋势同样覆盖，且与周报筛选互不影响
  await page.locator(".reports-tab").nth(1).click();
  await page.waitForTimeout(3500);
  const monthlyChips = page.locator(".reports-dir-chip:not(.overview):not([disabled])");
  if ((await monthlyChips.count()) > 0) {
    await monthlyChips.first().click();
    await page.waitForSelector(".reports-meta-journals", { timeout: 20000 });
    await page.waitForTimeout(700);
    const monthly = await page.evaluate(() => ({
      chips: document.querySelectorAll(".reports-journal-chip").length,
      off: document.querySelectorAll(".reports-journal-chip.is-off").length
    }));
    check(monthly.chips >= 1, "月度趋势方向专报同样渲染来源期刊行", `${monthly.chips} 种`);
    check(monthly.off === 0, "跨页签（周/月）筛选状态互不影响");
    await page.screenshot({ path: `${shotDir}/4-monthly.png` });
  } else {
    check(false, "月度趋势存在可用方向 chip");
  }

  check(pageErrors.length === 0, "无页面运行时错误", pageErrors.join(" | "));
  console.log(failures.length ? `PROBE_FAIL ${failures.length} 项失败` : "PROBE_OK");
  process.exitCode = failures.length ? 1 : 0;
} finally {
  await browser.close();
}
