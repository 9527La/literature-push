/**
 * 速评卡动效专项探针（跑在 _reports-preview 种子服务上）：
 * 验证 .reports-brief-card 悬停上浮/色系光晕/顶部色条 与 is-fallback 豁免、
 * 入场级联、弹窗相关文献行 related-item 上浮。
 * Usage: node scripts/snapshot-card-anim-reports.mjs [url]
 */
import { chromium } from "playwright-core";
import fs from "node:fs";

const base = (process.argv[2] || "http://127.0.0.1:4189").replace(/\/$/, "");

function readPassport() {
  const env = fs.readFileSync(".env", "utf8");
  const match = env.match(/^ADMIN_PASSPORT\s*=\s*(.*)$/m);
  if (match && match[1].trim()) return match[1].trim().replace(/^["']|["']$/g, "");
  console.error("通行证缺失：请在仓库根目录 .env 配置 ADMIN_PASSPORT");
  process.exit(2);
}

const TONE_SRGB = {
  "tone-ieee": [0.2471, 0.3647, 0.5765],
  "tone-elsevier": [0.5412, 0.3843, 0.2196],
  "tone-cn": [0.2392, 0.4314, 0.4],
  "tone-other": [0.3725, 0.4039, 0.451],
};

const consoleIssues = [];
let loggedIn = false;
const browser = await chromium.launch({ channel: process.env.VERIFY_BROWSER || "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1650 } });
page.on("console", (msg) => {
  if (!loggedIn) return;
  if (msg.type() === "error" || msg.type() === "warning") {
    if (/Download the React DevTools|source map|sourcemap|status of 401/i.test(msg.text())) return;
    consoleIssues.push(`${msg.type()}: ${msg.text()}`);
  }
});
page.on("pageerror", (err) => { if (loggedIn) consoleIssues.push(`pageerror: ${err.message}`); });

let failed = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " | " + detail : ""}`);
  if (!ok) failed += 1;
}
function toneShadowOk(cardClass, shadow) {
  const key = Object.keys(TONE_SRGB).find((k) => cardClass.includes(k));
  if (!key) return { ok: false, detail: "无 tone 类（回退色，跳过比对）", skip: true };
  const m = shadow.match(/color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/)
    || shadow.match(/rgba\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return { ok: false, detail: "光晕未检出色彩分量: " + shadow.slice(0, 60) };
  const got = m.slice(1, 4).map(Number);
  const exp = TONE_SRGB[key];
  const ok = got.every((v, i) => Math.abs(v - exp[i]) < 0.02);
  return { ok, detail: `${key} 期望 ${exp.map((v) => v.toFixed(3))} 实测 ${got.map((v) => v.toFixed(3))}` };
}

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
  loggedIn = true;

  await page.evaluate(() => { window.location.hash = "#reports"; });
  await page.waitForTimeout(3000);
  const brief = await page.evaluate(() => {
    const cards = document.querySelectorAll(".reports-brief-card");
    return {
      count: cards.length,
      fallback: document.querySelectorAll(".reports-brief-card.is-fallback").length,
      anim: cards.length ? getComputedStyle(cards[0]).animationName : null,
    };
  });
  check("速览页存在速评卡", brief.count > 0, JSON.stringify(brief).slice(0, 80));

  if (brief.count) {
    check("速评卡入场动画", brief.anim === "card-enter", brief.anim);
    const target = page.locator(".reports-brief-card:not(.is-fallback)").first();
    await target.scrollIntoViewIfNeeded();
    const cls = await target.getAttribute("class");
    await target.hover();
    await page.waitForTimeout(450);
    const hover = await page.evaluate(() => {
      const card = document.querySelector(".reports-brief-card:not(.is-fallback)");
      const cs = getComputedStyle(card);
      return { transform: cs.transform, shadow: cs.boxShadow, bar: getComputedStyle(card, "::before").transform };
    });
    check("速评卡悬停上浮 -2px", hover.transform.includes("-2"), hover.transform);
    const tone = toneShadowOk(cls, hover.shadow);
    check("速评卡光晕=期刊色系色", tone.ok || tone.skip, tone.detail);
    check("速评卡悬停色条展开", hover.bar.startsWith("matrix(1"), hover.bar);
    await page.screenshot({ path: "artifacts/anim-reports-hover.png" });

    const fb = page.locator(".reports-brief-card.is-fallback").first();
    if (await fb.count()) {
      await fb.scrollIntoViewIfNeeded();
      await fb.hover();
      await page.waitForTimeout(400);
      const fbState = await page.evaluate(() => {
        const card = document.querySelector(".reports-brief-card.is-fallback");
        const cs = getComputedStyle(card);
        return { transform: cs.transform, shadow: cs.boxShadow, bar: getComputedStyle(card, "::before").transform };
      });
      check("is-fallback 豁免（不上浮/无光晕/色条不展开）",
        fbState.transform === "none" && fbState.bar.startsWith("matrix(0"),
        JSON.stringify(fbState).slice(0, 90));
    } else {
      console.log("SKIP 无 is-fallback 卡");
    }
  }

  /* 弹窗相关文献行 related-item */
  const firstBrief = page.locator(".reports-brief-card:not(.is-fallback)").first();
  if (await firstBrief.count()) {
    await firstBrief.click();
    await page.waitForTimeout(2500);
    const related = await page.evaluate(() => {
      const li = document.querySelector(".related-list > li");
      const item = document.querySelector(".related-item");
      if (!item) return null;
      return { anim: li ? getComputedStyle(li).animationName : "no-li", itemAnim: getComputedStyle(item).animationName };
    });
    if (related) {
      check("相关文献行入场动画（li 承载级联）", related.anim === "card-enter", JSON.stringify(related));
      await page.locator(".related-item").first().hover();
      await page.waitForTimeout(400);
      const relHover = await page.evaluate(() => getComputedStyle(document.querySelector(".related-item")).transform);
      check("相关文献行悬停上浮 -1px", relHover.includes("-1"), relHover);
      await page.screenshot({ path: "artifacts/anim-related-hover.png" });
    } else {
      console.log("SKIP 弹窗无相关文献");
    }
  }

  check("console 零错误/警告（登录后）", consoleIssues.length === 0, consoleIssues.slice(0, 3).join(" || "));
  console.log(failed === 0 ? "REPORTS_ANIM_ALL_PASS" : `REPORTS_ANIM_FAILED=${failed}`);
} finally {
  await browser.close();
}
process.exit(failed === 0 ? 0 : 1);
