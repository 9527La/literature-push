/**
 * 研究速览 v2 截图探针：登录后导航 #reports，截总览分组态与方向专报态各一张，
 * 供人工确认视觉（期刊 tone 配色 / 分组主题句 / 环比数字）。
 * Usage: node scripts/snapshot-reports.mjs [url]
 */
import { chromium } from "playwright-core";
import fs from "node:fs";

const base = (process.argv[2] || "http://127.0.0.1:4177").replace(/\/$/, "");

function readPassport() {
  try {
    const env = fs.readFileSync(".env", "utf8");
    const match = env.match(/^ADMIN_PASSPORT\s*=\s*(.*)$/m);
    if (match && match[1].trim()) return match[1].trim().replace(/^["']|["']$/g, "");
  } catch { /* .env is required */ }
    console.error("通行证缺失：请在仓库根目录 .env 配置 ADMIN_PASSPORT（代码中不允许硬编码通行证）");
  process.exit(2);
}

const browser = await chromium.launch({ channel: process.env.VERIFY_BROWSER || "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1650 } });
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

  await page.evaluate(() => { window.location.hash = "#reports"; });
  await page.waitForTimeout(3000);
  // 滚到「方向分组浏览」区：截精选卡 + 前两个分组（含 tone 配色与环比数字）
  await page.evaluate(() => {
    const heads = document.querySelectorAll(".reports-sect");
    for (const head of heads) {
      if (head.textContent.includes("方向分组浏览")) { head.scrollIntoView(); break; }
    }
    window.scrollBy(0, -260);
  });
  await page.waitForTimeout(800);
  await page.screenshot({ path: "artifacts/reports-v2-overview.png" });

  // 方向专报态：点第一个可用方向 chip
  await page.evaluate(() => { window.scrollTo(0, 0); });
  await page.waitForTimeout(400);
  const chips = page.locator(".reports-dir-chip:not(.overview):not([disabled])");
  if (await chips.count()) {
    await chips.first().click();
    await page.waitForTimeout(2000);
    await page.screenshot({ path: "artifacts/reports-v2-direction.png" });
  }

  // 月度趋势 · 方向专报：切 tab 后点第一个方向 chip，截主题聚类手风琴
  const tabs = page.locator(".reports-tab");
  if (await tabs.count()) {
    await tabs.last().click();
    await page.waitForTimeout(2000);
    const monthlyChips = page.locator(".reports-dir-chip:not(.overview):not([disabled])");
    if (await monthlyChips.count()) {
      await monthlyChips.first().click();
      await page.waitForTimeout(2000);
      await page.evaluate(() => {
        const heads = document.querySelectorAll(".reports-sect");
        for (const head of heads) {
          if (head.textContent.includes("主题聚类速评")) { head.scrollIntoView(); window.scrollBy(0, -140); break; }
        }
      });
      await page.waitForTimeout(600);
      await page.screenshot({ path: "artifacts/reports-v2-monthly-clusters.png" });
    }
  }
  console.log("SNAPSHOT_DONE artifacts/reports-v2-overview.png artifacts/reports-v2-direction.png artifacts/reports-v2-monthly-clusters.png");
} finally {
  await browser.close();
}
