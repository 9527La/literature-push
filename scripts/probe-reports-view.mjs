/**
 * 研究速览页面探针：登录后导航 #reports（周报/月报/方向 chip 各停留），
 * 抓取 pageerror 与渲染摘要，定位前端运行时错误。
 * Usage: node scripts/probe-reports-view.mjs [url]
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

const errors = [];
const browser = await chromium.launch({ channel: process.env.VERIFY_BROWSER || "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.on("pageerror", (error) => errors.push(`[pageerror] ${String(error.message).slice(0, 300)}`));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(`[console.error] ${message.text().slice(0, 300)}`);
});

try {
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  await page.fill('input[type="password"]', readPassport());
  await page.click(".login-form button.primary");
  await page.waitForTimeout(2000);
  // 版本更新弹窗会以 backdrop 挡住后续点击：Escape 关闭（惯例）
  await page.keyboard.press("Escape");
  await page.waitForTimeout(600);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);

  // 进研究速览
  await page.evaluate(() => { location.hash = "#reports"; });
  await page.waitForTimeout(2500);

  const summary = await page.evaluate(() => {
    const text = document.body.innerText || "";
    return {
      hasErrorBoundary: text.includes("页面出错了") || text.includes("出错了"),
      h1: document.querySelector("#reports-title")?.textContent?.trim() || "",
      insightCards: document.querySelectorAll(".reports-insight-card").length,
      reviewCards: document.querySelectorAll(".reports-mini-card").length,
      clusterHeads: document.querySelectorAll(".reports-cluster-head").length,
      dirChips: document.querySelectorAll(".reports-dir-chip").length,
      periodOptions: document.querySelectorAll(".reports-period-select option").length,
      bodySnippet: text.replace(/\s+/g, " ").slice(0, 220)
    };
  });
  console.log("WEEKLY:", JSON.stringify(summary));

  // 切月报
  const tabs = page.locator(".reports-tab");
  if (await tabs.count() > 1) {
    await tabs.nth(1).click();
    await page.waitForTimeout(1800);
    const monthly = await page.evaluate(() => ({
      hasErrorBoundary: (document.body.innerText || "").includes("页面出错了"),
      insightCards: document.querySelectorAll(".reports-insight-card").length,
      miniCards: document.querySelectorAll(".reports-mini-card").length,
      clusters: document.querySelectorAll(".reports-cluster").length,
      bodySnippet: (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 220)
    }));
    console.log("MONTHLY:", JSON.stringify(monthly));
    // 点一个方向 chip（第 2 个 = 第一个方向）
    const chips = page.locator(".reports-dir-chip:not(.overview):not([disabled])");
    if (await chips.count() > 0) {
      await chips.first().click();
      await page.waitForTimeout(1500);
      const dirView = await page.evaluate(() => ({
        hasErrorBoundary: (document.body.innerText || "").includes("页面出错了"),
        miniCards: document.querySelectorAll(".reports-mini-card").length,
        clusters: document.querySelectorAll(".reports-cluster").length,
        bodySnippet: (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 200)
      }));
      console.log("MONTHLY-DIR:", JSON.stringify(dirView));
    }
  }

  await page.screenshot({ path: "artifacts/probe-reports-view.png", fullPage: false });
  if (errors.length) {
    console.log("PAGE ERRORS:");
    for (const e of errors) console.log(" ", e);
  } else {
    console.log("NO PAGE ERRORS");
  }
} finally {
  await browser.close();
}
