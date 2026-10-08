/**
 * 顶栏导航分组截图探针（2026-10-08）：登录后在 1440 / 1180 两档宽度截顶栏，
 * 展开「个人中心」下拉，并点击「研究速览」验证组激活态。
 * 空库没有未读/收藏 badge，脚本注入模拟 badge（2937 / 1）按线上最坏宽度核对。
 * Usage: node scripts/snapshot-nav-groups.mjs [url]
 */
import { chromium } from "playwright-core";
import fs from "node:fs";

const base = (process.argv[2] || "http://127.0.0.1:4189").replace(/\/$/, "");
const tag = (process.argv[3] || "nav-groups").replace(/[^a-zA-Z0-9_-]/g, "");

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
try {
  for (const width of [1440, 1180]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.goto(base, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);
    await page.fill('input[type="password"]', readPassport());
    await page.click(".login-form button.primary");
    await page.waitForTimeout(1800);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);

    // 模拟线上 badge（空库无未读/收藏）：宽度核对按有 badge 的最坏情况
    await page.evaluate(() => {
      const feedBtn = document.querySelector(".nav > button");
      if (feedBtn && !feedBtn.querySelector(".nav-badge")) {
        const b = document.createElement("span");
        b.className = "nav-badge";
        b.textContent = "2937";
        feedBtn.appendChild(b);
      }
    });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `artifacts/${tag}-${width}-topbar.png`, clip: { x: 0, y: 0, width, height: 84 } });

    // 展开「个人中心」下拉（hover 触发）
    await page.hover(".group-btn:has-text('个人中心')");
    await page.waitForTimeout(500);
    await page.screenshot({ path: `artifacts/${tag}-${width}-personal-open.png`, clip: { x: 0, y: 0, width, height: 340 } });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);

    // 点「资讯汇总 → 研究速览」，验证组激活态与视图切换（hover 先展开面板）
    await page.hover(".group-btn:has-text('资讯汇总')");
    await page.waitForTimeout(500);
    await page.click(".nav-menu-item:has-text('研究速览')");
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `artifacts/${tag}-${width}-reports-active.png`, clip: { x: 0, y: 0, width, height: 84 } });
    await page.close();
  }
  console.log("NAV_SNAPSHOT_DONE artifacts/${tag}-1440-*.png artifacts/${tag}-1180-*.png");
} finally {
  await browser.close();
}
