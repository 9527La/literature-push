/**
 * Post-deploy render check.
 *
 * `redeploy.ps1 -VerifyOnly` proves the server answers: port listening, `/` 200,
 * `/api/status` returns a count. It cannot tell whether the *front end* actually
 * ran — a bundle that boots into the error boundary still returns 200 for every
 * one of those checks. That is how a white screen can ship unnoticed.
 *
 * So this script drives a real browser over the deployed URL, logs in with the
 * passport from .env, opens 管理中心 and asserts:
 *   1. the app rendered past the error boundary (no "页面出错了"),
 *   2. the admin header rendered (buttons + both allowance bars),
 *   3. the two allowance bars share one row and none of them overflow,
 *   4. the command-bar button labels are the expected ones.
 *
 * Usage:
 *   node scripts/verify-render.mjs https://<tunnel-host>            # 1440px
 *   node scripts/verify-render.mjs http://192.168.31.233:4177 1280
 *
 * Exit code 0 = all assertions passed. Requires playwright-core (a dependency)
 * and Microsoft Edge or Google Chrome installed on this machine.
 */
import { chromium } from "playwright-core";
import fs from "node:fs";

const base = (process.argv[2] || "http://192.168.31.233:4177").replace(/\/$/, "");
const width = Number(process.argv[3] || 1440);
/** The command bar must not grow a 「一键」 prefix or lose a button. */
const EXPECTED_BUTTONS = ["刷新文献数据", "补全摘要", "补全关键词", "补全摘要和关键词", "翻译标题", "翻译摘要"];

function readPassport() {
  try {
    const env = fs.readFileSync(".env", "utf8");
    const match = env.match(/^ADMIN_PASSPORT\s*=\s*(.*)$/m);
    if (match && match[1].trim()) return match[1].trim().replace(/^["']|["']$/g, "");
  } catch { /* .env is optional: fall back to the built-in default */ }
  return "shenchao";
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

  const gate = await page.evaluate(() => ({
    hasPassword: Boolean(document.querySelector('input[type="password"]')),
    crashed: /页面出错了/.test(document.body.textContent || "")
  }));
  check(!gate.crashed, "首页渲染正常（没有进入错误边界）");
  check(gate.hasPassword, "登录门禁已渲染");
  if (failures.length) throw new Error("page did not render");

  await page.fill('input[type="password"]', readPassport());
  await page.click(".login-form button.primary");
  await page.waitForSelector(".app-shell", { timeout: 20000 });
  // A version bump pops the "what's new" dialog, whose backdrop swallows clicks.
  if (await page.locator(".modal-backdrop").count()) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
  }
  await page.getByRole("button", { name: "管理中心" }).first().click();
  await page.waitForSelector(".admin-translate-controls", { timeout: 20000 });
  await page.waitForTimeout(600);

  const layout = await page.evaluate(() => {
    const controls = document.querySelector(".admin-translate-controls");
    const quotas = [...document.querySelectorAll(".translate-quota")];
    const probe = quotas[0]?.cloneNode(true);
    let needed = null;
    let available = Math.round(controls.getBoundingClientRect().width);
    if (probe) {
      Object.assign(probe.style, { position: "absolute", visibility: "hidden", width: "max-content", height: "auto", flex: "0 0 auto" });
      document.body.appendChild(probe);
      const maxContent = Math.round(probe.getBoundingClientRect().width);
      probe.remove();
      const button = Math.round(controls.querySelector("button").getBoundingClientRect().width);
      const gap = parseFloat(getComputedStyle(controls).columnGap) || 0;
      needed = Math.round(button + 2 * gap + 2 * maxContent);
    }
    return {
      barCount: quotas.length,
      rows: new Set(quotas.map((q) => Math.round(q.getBoundingClientRect().top))).size,
      overflows: quotas.map((q) => q.scrollWidth - q.clientWidth),
      texts: quotas.map((q) => q.textContent.trim()),
      needed,
      available,
      buttons: [...document.querySelectorAll(".admin-command-bar button")].map((b) => b.textContent.trim()),
      hints: document.querySelectorAll(".admin-translate-hint").length,
      hasMaintenanceProgress: Boolean(document.querySelector(".admin-maintenance"))
    };
  });

  check(layout.barCount === 2, `两条翻译额度条都在（实际 ${layout.barCount}）`);
  check(layout.rows === 1, `两条额度条在同一行（实际 ${layout.rows} 行）`);
  check(layout.overflows.every((value) => value <= 0), `额度条没有内容溢出（${layout.overflows.join(", ")}）`);
  check(layout.needed === null || layout.needed <= layout.available, `一行放得下：需要 ${layout.needed}px / 可用 ${layout.available}px`);
  check(JSON.stringify(layout.buttons) === JSON.stringify(EXPECTED_BUTTONS), `命令栏按钮：${layout.buttons.join(" | ")}`);
  console.log(`  note  翻译额度：${layout.texts.join(" ／ ")}`);
  console.log(`  note  维护面板${layout.hasMaintenanceProgress ? "在" : "未显示（暂无任务记录）"}，小字说明 ${layout.hints} 处`);

  await page.screenshot({ path: "artifacts/verify-render.png", fullPage: false });
  console.log(`\n截图：artifacts/verify-render.png（视口 ${width}px）`);
} finally {
  await browser.close();
}

if (failures.length) {
  console.error(`\n渲染检查失败 ${failures.length} 项`);
  process.exit(1);
}
console.log("\n渲染检查通过");
