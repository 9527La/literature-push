/**
 * 卡片动效验证探针（2026-10-09 卡片动效批）：
 * 断言各表面的悬停效果（上浮 / 色系光晕 / 顶部色条展开）与入场级联动画，
 * 并收集浏览器 console 错误（登录完成后的业务错误要求 0）。
 * 401 出现在登录前的会话探测，属既有行为，不计入失败。
 * Usage: node scripts/snapshot-card-anim.mjs [url]
 */
import { chromium } from "playwright-core";
import fs from "node:fs";

const base = (process.argv[2] || "http://127.0.0.1:4188").replace(/\/$/, "");

function readPassport() {
  const key = process.env.PASSPORT_KEY || "ADMIN_PASSPORT";
  try {
    const env = fs.readFileSync(".env", "utf8");
    const match = env.match(new RegExp(`^${key}\\s*=\\s*(.*)$`, "m"));
    if (match && match[1].trim()) return match[1].trim().replace(/^["']|["']$/g, "");
  } catch { /* .env is required */ }
  console.error(`通行证缺失：请在仓库根目录 .env 配置 ${key}`);
  process.exit(2);
}

/* 期刊色系 tone → 期望光晕色（color(srgb …) 分量，Edge color-mix 输出记法） */
const TONE_SRGB = {
  "tone-ieee": [0.2471, 0.3647, 0.5765],     // #3f5d93
  "tone-elsevier": [0.5412, 0.3843, 0.2196], // #8a6238
  "tone-cn": [0.2392, 0.4314, 0.4],          // #3d6e66
  "tone-other": [0.3725, 0.4039, 0.451],     // #5f6773
};

const consoleIssues = [];
let loggedIn = false;
const browser = await chromium.launch({ channel: process.env.VERIFY_BROWSER || "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1650 } });
page.on("console", (msg) => {
  if (!loggedIn) return; // 登录前的会话探测 401 等不计
  if (msg.type() === "error" || msg.type() === "warning") {
    if (/Download the React DevTools|source map|sourcemap/i.test(msg.text())) return;
    if (/status of 401/.test(msg.text())) return; // 个人中心未配置时的会话探测
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
  if (!key) return { ok: false, detail: "无 tone 类" };
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

  /* ── 1. 文献库 Feed ─────────────────────────────────────────────────── */
  await page.waitForSelector(".article", { timeout: 15000 });
  const anim = await page.evaluate(() => {
    const cs = getComputedStyle(document.querySelector(".article"));
    return { name: cs.animationName, dur: cs.animationDuration };
  });
  check("Feed 入场动画=card-enter/300ms", anim.name === "card-enter" && anim.dur === "0.3s", JSON.stringify(anim));

  const feedCardClass = await page.evaluate(() => document.querySelector(".article").className);
  check("Feed 存在期刊色系卡", feedCardClass.includes("tone-"), feedCardClass.slice(0, 60));

  const beforeIdle = await page.evaluate(() => {
    const card = document.querySelector(".article");
    return {
      bar: getComputedStyle(card, "::before").transform,
      barDisplay: getComputedStyle(card, "::before").display,
    };
  });
  check("静止态色条 scaleX(0)", beforeIdle.bar.startsWith("matrix(0"), beforeIdle.bar);
  check("::before 已复活 display:block", beforeIdle.barDisplay === "block");

  await page.locator(".article").first().hover();
  await page.waitForTimeout(500);
  const hoverState = await page.evaluate(() => {
    const cs = getComputedStyle(document.querySelector(".article"));
    return { transform: cs.transform, shadow: cs.boxShadow };
  });
  check("悬停上浮 -2px", hoverState.transform.includes("-2"), hoverState.transform);
  const tone = toneShadowOk(feedCardClass, hoverState.shadow);
  check("悬停光晕=期刊色系色", tone.ok, tone.detail);
  const barHover = await page.evaluate(() => getComputedStyle(document.querySelector(".article"), "::before").transform);
  check("悬停色条 scaleX(1)", barHover.startsWith("matrix(1"), barHover);
  await page.screenshot({ path: "artifacts/anim-feed-hover.png" });

  /* ── 2. 收藏页（本地无收藏时先经接口临时收藏一条，验证后还原）───────── */
  await page.evaluate(() => { window.location.hash = "#favorites"; });
  await page.waitForTimeout(2000);
  let favCount = await page.locator(".favorite-card").count();
  if (!favCount) {
    const seeded = await page.evaluate(async () => {
      const list = await fetch("/api/articles?limit=1").then((r) => r.json());
      const id = list.articles?.[0]?.id ?? list[0]?.id;
      if (!id) return null;
      await fetch(`/api/articles/${id}/favorite`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      return id;
    });
    if (seeded) {
      await page.waitForTimeout(1200);
      favCount = await page.locator(".favorite-card").count();
    }
  }
  if (favCount) {
    const fav = await page.evaluate(() => {
      const card = document.querySelector(".favorite-card");
      return { anim: getComputedStyle(card).animationName, bar: getComputedStyle(card, "::before").display, cls: card.className };
    });
    check("收藏卡入场动画", fav.anim === "card-enter", fav.anim);
    check("收藏卡顶部色条挂载", fav.bar === "block");
    await page.locator(".favorite-card").first().hover();
    await page.waitForTimeout(450);
    const favHover = await page.evaluate(() => {
      const cs = getComputedStyle(document.querySelector(".favorite-card"));
      return { transform: cs.transform, shadow: cs.boxShadow };
    });
    check("收藏卡悬停上浮", favHover.transform.includes("-2"), favHover.transform);
    check("收藏卡光晕=期刊色系色", toneShadowOk(fav.cls, favHover.shadow).ok, toneShadowOk(fav.cls, favHover.shadow).detail);
    await page.screenshot({ path: "artifacts/anim-favorites-hover.png" });
  } else {
    console.log("SKIP 收藏页（无法临时收藏）");
  }

  /* ── 3. 资讯汇总：日报条目 ─────────────────────────────────────────── */
  await page.evaluate(() => { window.location.hash = "#news"; });
  await page.waitForTimeout(2500);
  const daily = await page.evaluate(() => {
    const item = document.querySelector(".daily-item");
    if (!item) return null;
    return { anim: getComputedStyle(item).animationName, bar: getComputedStyle(item, "::before").display };
  });
  if (daily) {
    check("日报条目入场动画+色条", daily.anim === "card-enter" && daily.bar === "block", JSON.stringify(daily));
    await page.locator(".daily-item").first().scrollIntoViewIfNeeded();
    await page.locator(".daily-item").first().hover();
    await page.waitForTimeout(450);
    const dailyHover = await page.evaluate(() => getComputedStyle(document.querySelector(".daily-item")).transform);
    check("日报条目悬停上浮", dailyHover.includes("-2"), dailyHover);
    await page.screenshot({ path: "artifacts/anim-news-hover.png" });
  } else {
    console.log("SKIP 资讯页无条目");
  }

  check("console 零错误/警告（登录后）", consoleIssues.length === 0, consoleIssues.slice(0, 3).join(" || "));
  console.log(failed === 0 ? "SNAPSHOT_CARD_ANIM_ALL_PASS" : `SNAPSHOT_CARD_ANIM_FAILED=${failed}`);
} finally {
  await browser.close();
}
process.exit(failed === 0 ? 0 : 1);
