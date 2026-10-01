// 复现并验证「底部一直停在『加载中…』」的问题。
//
// 场景：滚动到底触发翻页（追加请求）之后，如果期间又发出别的列表请求
// （改排序 / 改筛选 / 点已读触发的 reload），旧代码的 loading 收尾会被跳过，
// 「加载下一批」按钮永久停在「加载中…」且 disabled，怎么点都没反应。
//
// 做法：把 offset>0 的请求延迟 4 秒返回，制造一个足够长的追加请求飞行窗口，
// 在这 4 秒内切换排序（触发替换式请求），然后看按钮是否恢复可点。
//
// 用法：
//   node scripts/diagnose-stuck-loading.mjs [url]
//   BASE=http://127.0.0.1:5173/#feed PASSPORT=<ADMIN_PASSPORT> \
//     node scripts/diagnose-stuck-loading.mjs
//
// 退出码：0 = 正常（按钮已恢复）；1 = 复现了卡死。

import fs from "node:fs";
import { chromium } from "playwright-core";

function readEnvPassport() {
  try {
    const env = fs.readFileSync(".env", "utf8");
    const m = env.match(/^ADMIN_PASSPORT\s*=\s*(.*)$/m);
    if (m && m[1].trim()) return m[1].trim().replace(/^["']|["']$/g, "");
  } catch { /* .env is required; see README deployment section */ }
  console.error("通行证缺失：请在仓库根目录 .env 配置 ADMIN_PASSPORT（代码中不允许硬编码通行证）");
  process.exit(2);
}

const BASE = process.argv[2] || process.env.BASE || "http://127.0.0.1:5173/#feed";
const PASSPORT = process.env.PASSPORT || readEnvPassport();
const BROWSER = process.env.VERIFY_BROWSER || "msedge";
const APPEND_DELAY_MS = Number(process.env.APPEND_DELAY_MS || 4000);
const LOAD_MORE_SELECTOR = ".load-more button";

const browser = await chromium.launch({ channel: BROWSER, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

let appendCount = 0;
let replaceCount = 0;
await page.route("**/api/articles?*", async (route) => {
  const offset = Number(new URL(route.request().url()).searchParams.get("offset") || 0);
  if (offset <= 0) {
    replaceCount += 1;
    return route.continue();
  }
  appendCount += 1;
  const response = await route.fetch();
  await new Promise((resolve) => setTimeout(resolve, APPEND_DELAY_MS));
  return route.fulfill({ response });
});

const buttonState = () => page.$eval(LOAD_MORE_SELECTOR, (node) => ({
  text: (node.textContent || "").trim(),
  disabled: node.disabled
})).catch(() => null);

const steps = [];
try {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });

  // fill 自带等待：SPA 首帧还没挂载时 count() 会返回 0，导致直接跳过登录。
  await page.fill('input[type="password"]', PASSPORT);
  await page.click(".login-form button.primary");
  await page.waitForSelector(".app-shell", { timeout: 30000 });
  // 版本更新弹窗的遮罩会吞掉后续点击。
  if (await page.locator(".modal-backdrop").count()) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
  }

  await page.waitForSelector("article.article", { timeout: 60000 });
  await page.waitForFunction(
    () => document.querySelectorAll("article.article").length >= 50,
    { timeout: 60000 }
  );
  // 列表在后台补全期间会不断增高（摘要/关键词/译文陆续回填），"底部"一直在移动，
  // 滚动触发不稳定。这里点按钮触发同一段 loadMore，路径与滚动哨兵完全一致。
  await page.addStyleTag({ content: "html { scroll-behavior: auto !important; }" });
  steps.push(`首屏加载 ${await page.locator("article.article").count()} 篇，${JSON.stringify(await buttonState())}`);

  // 1. 触发翻页，等请求起飞。
  await page.click(LOAD_MORE_SELECTOR);
  await page.waitForFunction(
    (selector) => /加载中/.test(document.querySelector(selector)?.textContent || ""),
    LOAD_MORE_SELECTOR,
    { timeout: 15000 }
  );
  steps.push(`翻页请求已起飞：${JSON.stringify(await buttonState())}`);

  // 2. 趁它还在飞，切排序 —— 这会让前端发出一次「替换式」列表请求。
  await page.selectOption(".sort-select select", "asc");
  steps.push("已切换排序为「最早优先」，制造请求抢占");

  // 3. 等翻页响应回来并稳定。
  await page.waitForTimeout(APPEND_DELAY_MS + 5000);
  const after = await buttonState();
  const cardCount = await page.locator("article.article").count();
  steps.push(`等待结束：${JSON.stringify(after)}，列表 ${cardCount} 篇`);

  const stuck = !after || /加载中/.test(after.text) || after.disabled;
  if (stuck) {
    steps.push("结果：复现卡死 —— 按钮永久停在「加载中…」");
  } else {
    steps.push("结果：按钮已恢复，可以继续加载");
    // 4. 再验证一次正常翻页仍然可用（这次不制造抢占）。
    const before = await page.locator("article.article").count();
    await page.click(LOAD_MORE_SELECTOR);
    await page.waitForFunction(
      (count) => document.querySelectorAll("article.article").length > count,
      before,
      { timeout: 30000 }
    ).catch(() => {});
    const grown = await page.locator("article.article").count();
    steps.push(grown > before
      ? `再次翻页成功：${before} → ${grown} 篇`
      : `再次翻页未增长（${before} → ${grown} 篇），请人工确认`);
  }

  console.log(JSON.stringify({ appendRequests: appendCount, replaceRequests: replaceCount, steps, stuck }, null, 2));
  process.exitCode = stuck ? 1 : 0;
} catch (error) {
  console.log(JSON.stringify({ appendRequests: appendCount, replaceRequests: replaceCount, steps, error: String(error?.message || error) }, null, 2));
  process.exitCode = 2;
} finally {
  await browser.close();
}
