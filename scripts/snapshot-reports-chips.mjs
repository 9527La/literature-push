/**
 * 研究速览本轮改动截图探针：
 *  1) 方向 chips 行的把手 / × 隐藏按钮 /「管理方向」开关
 *  2) 管理面板（已隐藏方向恢复 + 恢复默认）
 *  3) 「查看该方向全部」弹窗：左上角类别完整展示 + 每行文献前期刊色标
 * Usage: node scripts/snapshot-reports-chips.mjs [url]
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
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
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
  await page.waitForTimeout(3200);

  const chipCount = await page.locator(".reports-dir-chip").count();
  const wrapCount = await page.locator(".reports-dir-chip-wrap").count();
  const hasManage = await page.locator(".reports-dir-manage-toggle").count();
  console.log(`PROBE chips=${chipCount} wrappable=${wrapCount} manage-toggle=${hasManage}`);

  // 1) 悬停第一个可拖拽 chip，露出把手与 ×
  const firstWrap = page.locator(".reports-dir-chip-wrap").first();
  await firstWrap.hover();
  await page.waitForTimeout(400);
  await page.screenshot({ path: "artifacts/reports-chips-row.png" });

  // 2) 隐藏两个方向 → 打开管理面板
  const hideButtons = page.locator(".reports-dir-chip-hide");
  const hideNum = Math.min(2, await hideButtons.count());
  for (let i = 0; i < hideNum; i += 1) {
    await hideButtons.nth(0).click({ force: true });
    await page.waitForTimeout(250);
  }
  await page.locator(".reports-dir-manage-toggle").click();
  await page.waitForTimeout(500);
  const restored = await page.locator(".reports-dir-restore").count();
  const pref = await page.evaluate(() => localStorage.getItem("reportsChipPrefs"));
  console.log(`PROBE hidden-restored-buttons=${restored} prefs=${pref}`);
  await page.screenshot({ path: "artifacts/reports-chips-manage.png" });

  // 3) 恢复默认后打开「查看该方向全部」弹窗
  await page.locator(".reports-dir-reset").click();
  await page.waitForTimeout(400);
  await page.locator(".reports-dir-manage-toggle").click();
  await page.waitForTimeout(300);

  const moreBtn = page.locator(".reports-group-more").first();
  if (await moreBtn.count()) {
    await page.evaluate(() => {
      const heads = document.querySelectorAll(".reports-sect");
      for (const head of heads) {
        if (head.textContent.includes("方向分组浏览")) { head.scrollIntoView(); window.scrollBy(0, -200); break; }
      }
    });
    await page.waitForTimeout(400);
    await moreBtn.click();
    await page.waitForTimeout(2200);
    const markText = await page.locator(".journal-dialog-mark").first().textContent().catch(() => "");
    const journalTags = await page.locator(".journal-article-journal").count();
    console.log(`PROBE dialog-mark="${markText}" journal-tags=${journalTags}`);
    await page.screenshot({ path: "artifacts/reports-list-dialog.png" });
  } else {
    console.log("PROBE no .reports-group-more found");
  }

  console.log("SNAPSHOT_CHIPS_DONE");
} finally {
  await browser.close();
}
