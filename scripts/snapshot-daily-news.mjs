#!/usr/bin/env node
/**
 * 每日资讯栏目视觉验收（PLAN-DAILY-NEWS.md M4）。
 *
 * 用法：node scripts/snapshot-daily-news.mjs [BASE] [宽度]
 * 默认 http://192.168.31.233:4177 1440。
 * 流程：gate 登录 → 切到「每日资讯」→ 断言概览/条目结构 → 点概览锚点验证跳转 → 截图。
 * 全部通过输出 DAILY_NEWS_VIEW_PASS，失败输出 DAILY_NEWS_VIEW_FAIL 并 exit 1。
 */
import { chromium } from "playwright-core";
import fs from "node:fs";

const base = (process.argv[2] || "http://192.168.31.233:4177").replace(/\/$/, "");
const width = Number(process.argv[3] || 1440);

function readPassport() {
  try {
    const env = fs.readFileSync(".env", "utf8");
    const match = env.match(/^ADMIN_PASSPORT\s*=\s*(.*)$/m);
    if (match && match[1].trim()) return match[1].trim().replace(/^["']|["']$/g, "");
  } catch { /* .env 可选：回落内置默认 */ }
    console.error("通行证缺失：请在仓库根目录 .env 配置 ADMIN_PASSPORT（代码中不允许硬编码通行证）");
  process.exit(2);
}

const failures = [];
const check = (ok, message) => {
  console.log(`${ok ? "  ok  " : "  FAIL"} ${message}`);
  if (!ok) failures.push(message);
};

const browser = await chromium.launch({ channel: process.env.VERIFY_BROWSER || "msedge", headless: true });
const page = await browser.newPage({ viewport: { width, height: 1000 } });
page.on("pageerror", (error) => console.log("  [page error]", String(error.message).slice(0, 200)));

try {
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  await page.fill('input[type="password"]', readPassport());
  await page.click(".login-form button.primary");
  await page.waitForSelector(".app-shell", { timeout: 20000 });
  if (await page.locator(".modal-backdrop").count()) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
  }

  await page.getByRole("button", { name: "每日资讯" }).first().click();
  await page.waitForSelector(".daily-overview", { timeout: 20000 });
  await page.waitForTimeout(800);

  const state = await page.evaluate(() => ({
    dates: document.querySelectorAll(".daily-date").length,
    activeDate: document.querySelector(".daily-date.active .daily-date-value")?.textContent.trim() || "",
    groups: [...document.querySelectorAll(".daily-overview-group h3")].map((h) => h.textContent.trim()),
    overviewButtons: document.querySelectorAll(".daily-overview-group li button").length,
    items: document.querySelectorAll(".daily-item").length,
    footer: document.querySelector(".daily-footer")?.textContent.trim() || "",
    navActive: document.querySelector(".nav button.active")?.textContent.trim() || ""
  }));
  check(state.navActive.includes("每日资讯"), `导航「每日资讯」处于激活态（实际：${state.navActive}）`);
  check(state.dates >= 1, `日期列表渲染（${state.dates} 天）`);
  check(state.activeDate.length > 0, `默认选中最新日期（${state.activeDate}）`);
  check(state.groups.length >= 1, `概览分组渲染（${state.groups.join(" / ")}）`);
  check(state.overviewButtons >= 1, `概览锚点条目渲染（${state.overviewButtons} 条）`);
  check(state.items >= 1 && state.items === state.overviewButtons, `详情条目数与概览一一对应（${state.items}/${state.overviewButtons}）`);
  check(state.footer.includes("AI 辅助创作"), "文末 AI 免责声明渲染");

  const firstAnchor = page.locator(".daily-overview-group li button").nth(3);
  await firstAnchor.click();
  await page.waitForTimeout(900);
  const flashed = await page.evaluate(() => Boolean(document.querySelector(".daily-item.flash")));
  check(flashed, "点概览锚点后对应详情块高亮");

  const sourceLink = page.locator(".daily-item .md-fence-link a").first();
  const href = await sourceLink.getAttribute("href");
  check(Boolean(href && href.startsWith("http")), `来源链接可点击（${String(href).slice(0, 60)}…）`);

  fs.mkdirSync("artifacts", { recursive: true });
  await page.screenshot({ path: "artifacts/daily-news.png", fullPage: false });
  console.log(`\n截图：artifacts/daily-news.png（视口 ${width}px）`);
} finally {
  await browser.close();
}

if (failures.length) {
  console.error(`\nDAILY_NEWS_VIEW_FAIL (${failures.length} 项)`);
  process.exit(1);
}
console.log("\nDAILY_NEWS_VIEW_PASS");
