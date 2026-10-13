/**
 * 前端优化批次二探针：导航徽章移除 / 文献库筛选摘要条 + 时间快捷区间 + 回到顶部 /
 * 收藏轻筛选与备注折叠 / 速览分组构成微条 / 统计入场动效 / 资讯空态插画。
 *
 * 用法：
 *   node scripts/probe-frontend-polish.mjs [url] [--skip-account]
 *   --skip-account：跳过「注册 + 收藏写操作」段落（供只读环境，如生产复检）。
 * 前置（本地）：node scripts/preview-seed-reports.mjs 且 4188 预览服务已启动。
 */
import { chromium } from "playwright-core";
import fs from "node:fs";

const args = process.argv.slice(2);
const skipAccount = args.includes("--skip-account");
const base = (args.find((a) => a.startsWith("http")) || "http://127.0.0.1:4188").replace(/\/$/, "");
const shotDir = "_tmp/frontend-polish-shots";
fs.mkdirSync(shotDir, { recursive: true });

function readPassport() {
  try {
    const env = fs.readFileSync(".env", "utf8");
    const match = env.match(/^ADMIN_PASSPORT\s*=\s*(.*)$/m);
    if (match && match[1].trim()) return match[1].trim().replace(/^["']|["']$/g, "");
  } catch { /* .env is required */ }
  console.error("通行证缺失：请在仓库根目录 .env 配置 ADMIN_PASSPORT");
  process.exit(2);
}

const failures = [];
const check = (ok, label, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? ` :: ${detail}` : ""}`);
  if (!ok) failures.push(label);
};

const dateStr = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const browser = await chromium.launch({ channel: process.env.VERIFY_BROWSER || "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
const pageErrors = [];
const unauthorized = [];
page.on("pageerror", (error) => pageErrors.push(String(error.message).slice(0, 220)));
page.on("console", (m) => { if (m.type() === "error") pageErrors.push(`[console] ${m.text().slice(0, 220)}`); });
// /api/account 的 401 是设计行为（首屏与门禁并行检查时还没有通行证），单独记账豁免
page.on("response", (r) => { if (r.status() === 401) unauthorized.push(r.url()); });
const realErrors = () => pageErrors.filter((e) => !(e.includes("401") && unauthorized.every((u) => u.endsWith("/api/account"))));

try {
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  await page.fill('input[type="password"]', readPassport());
  await page.click(".login-form button.primary");
  await page.waitForSelector(".article, .empty", { timeout: 25000 });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(600);

  // ① 导航徽章移除
  const navBadges = await page.evaluate(() => document.querySelectorAll(".nav .nav-badge").length);
  const navFeedText = await page.locator(".nav button:has-text('文献库')").first().innerText().catch(() => "");
  check(navBadges === 0, "导航无数字徽章", `${navBadges} 个`);
  check(!/\d/.test(navFeedText), "文献库导航项不含数字", navFeedText.replace(/\s+/g, " ").trim());

  // ② 时间快捷区间 + 筛选摘要条
  await page.click("button.filter-toggle");
  await page.waitForTimeout(400);
  const noSummary = await page.locator(".feed-filter-summary").count();
  check(noSummary === 0, "初始无筛选摘要条");
  // 筛选分组默认全部折叠：先展开「时间范围」「关键词」两组
  await page.locator('.filter-group-toggle:has-text("时间范围")').click();
  await page.waitForTimeout(300);
  const today = new Date();
  const from7 = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6);
  await page.locator('.feed-date-quick-chip:has-text("近 7 日")').click();
  await page.waitForTimeout(400);
  const fromVal = await page.locator('input[aria-label="开始日期"]').inputValue();
  const toVal = await page.locator('input[aria-label="结束日期"]').inputValue();
  check(fromVal === dateStr(from7) && toVal === dateStr(today), "快捷区间回填起止日期", `${fromVal} ~ ${toVal}`);
  check(await page.locator(".feed-date-quick-chip.on").count() === 1, "快捷 chip 进入选中态");
  let chipCount = await page.locator(".feed-filter-summary .feed-filter-chip").count();
  check(chipCount === 1, "摘要条出现时间 chip", `${chipCount} 枚`);
  await page.locator('.filter-group-toggle:has-text("关键词")').click();
  await page.waitForTimeout(300);
  await page.locator(".keyword-filter-chip:not(.journal-filter-chip)").first().click();
  await page.waitForTimeout(400);
  chipCount = await page.locator(".feed-filter-summary .feed-filter-chip").count();
  check(chipCount === 2, "关键词筛选并入摘要条", `${chipCount} 枚`);
  await page.locator(".feed-filter-summary .feed-filter-chip").first().locator(".feed-filter-chip-x").click();
  await page.waitForTimeout(300);
  chipCount = await page.locator(".feed-filter-summary .feed-filter-chip").count();
  check(chipCount === 1, "单点 × 移除关键词 chip", `${chipCount} 枚`);
  await page.screenshot({ path: `${shotDir}/1-feed-summary.png` });
  await page.locator(".feed-filter-summary-clear").click();
  await page.waitForTimeout(300);
  check(await page.locator(".feed-filter-summary").count() === 0, "清除全部后摘要条隐藏");
  check(await page.locator(".feed-date-quick-chip.on").count() === 0, "清除后快捷 chip 取消选中");
  await page.click("button.filter-toggle"); // 收起面板
  await page.waitForTimeout(300);

  // ③ 回到顶部
  check(await page.locator(".back-to-top").count() === 0, "顶部时无回到顶部按钮");
  await page.evaluate(() => window.scrollTo(0, 1600));
  await page.waitForTimeout(600);
  const bttVisible = await page.locator(".back-to-top").isVisible().catch(() => false);
  const bttText = bttVisible ? (await page.locator(".back-to-top").innerText()).replace(/\s+/g, " ").trim() : "";
  check(bttVisible && /\d+%/.test(bttText), "滚动后浮现回到顶部（含进度%）", bttText);
  await page.screenshot({ path: `${shotDir}/2-backtop.png` });
  await page.locator(".back-to-top").click();
  await page.waitForTimeout(900);
  check((await page.evaluate(() => window.scrollY)) < 80, "点击后回到顶部");

  // ④ 收藏：注册账户 → 收藏 5 篇 → 筛选 + 备注折叠（--skip-account 时跳过）
  if (!skipAccount) {
    await page.evaluate(() => { location.hash = "#account"; });
    await page.waitForTimeout(1600);
    await page.click('button[role="tab"]:has-text("注册个人账户")');
    await page.waitForTimeout(400);
    const regUser = `polish${Date.now().toString().slice(-6)}`;
    await page.fill('input[autocomplete="new-username"]', regUser);
    await page.fill('input[autocomplete="new-password"]', "polish-pass-1234");
    await page.click('button:has-text("注册并登录")');
    await page.waitForTimeout(3500);
    const accText = await page.locator(".profile-layout").first().innerText().catch(() => "");
    check(accText.includes("已登录"), "注册并自动登录", regUser);

    await page.evaluate(() => { location.hash = "#feed"; });
    await page.waitForTimeout(1500);
    // 每次收藏前检查弹层：登录状态点「收藏」会弹出分组选择（FavoriteGroupPicker），
    // 记录其内容（一次性诊断）+ 关闭后继续；顺带覆盖其他意外提示层。
    let pickerLogged = false;
    for (let i = 0; i < 5; i += 1) {
      if (await page.locator(".modal-backdrop").count()) {
        if (!pickerLogged) {
          const info = await page.evaluate(() => {
            const b = document.querySelector(".modal-backdrop");
            const dlg = b?.querySelector('[role="dialog"]');
            return { text: ((dlg?.innerText || "").slice(0, 140) || "").replace(/\s+/g, " "), html: (b?.innerHTML || "").slice(0, 200) };
          });
          console.log(`  [layer] text="${info.text}" html=${info.html}`);
          await page.screenshot({ path: `${shotDir}/0-debug-backdrop.png` });
          pickerLogged = true;
        }
        await page.keyboard.press("Escape");
        await page.waitForTimeout(300);
        if (await page.locator(".modal-backdrop").count()) {
          await page.locator(".modal-backdrop").click({ position: { x: 6, y: 6 } }).catch(() => {});
          await page.waitForTimeout(400);
        }
      }
      const favBtn = page.locator('.article-actions-inline button[aria-label="收藏"]').first();
      if (!(await favBtn.count())) break;
      await favBtn.click();
      await page.waitForTimeout(450);
      // 登录态收藏会弹出分组选择器（FavoriteGroupPicker）：点「确认收藏」完成加入
      const confirmBtn = page.locator('.favorite-picker button:has-text("确认收藏")');
      if (await confirmBtn.count()) {
        if (!pickerLogged) {
          console.log("  [picker] 分组选择器出现，逐次确认收藏");
          await page.screenshot({ path: `${shotDir}/0-favorite-picker.png` });
          pickerLogged = true;
        }
        await confirmBtn.click();
        await page.waitForTimeout(600);
      }
    }
    await page.evaluate(() => { location.hash = "#favorites"; });
    await page.waitForSelector(".favorite-card", { timeout: 20000 });
    await page.waitForTimeout(800);
    const favTotal = await page.locator(".favorite-card").count();
    check(favTotal === 5, "收藏 5 篇后列表渲染", `${favTotal} 张`);
    check(await page.locator(".favorites-tools").count() === 1, "收藏轻筛选工具条渲染");
    const jchips = await page.locator(".fav-jchip").count();
    check(jchips >= 1, "来源期刊 chips 聚合", `${jchips} 种`);
    const countText = (await page.locator(".favorites-tools-count").innerText()).replace(/\s+/g, " ");
    check(new RegExp(`显示\\s*${favTotal}\\s*/\\s*共\\s*${favTotal}\\s*篇`).test(countText), "计数显示全量", countText);
    await page.locator(".fav-jchip").first().click();
    await page.waitForTimeout(400);
    const filtered = await page.locator(".favorite-card").count();
    const chipOn = await page.locator(".fav-jchip.on").count();
    if (jchips >= 2) {
      check(filtered < favTotal && filtered >= 1, "期刊 chip 过滤联动", `${favTotal} → ${filtered}`);
    } else {
      // 收藏恰好全属同一期刊时，过滤后应保持全量（语义正确）：验选中态 + 计数文案
      check(chipOn === 1 && filtered === favTotal, "单刊场景过滤保持全量（选中态生效）", `chip on=${chipOn}`);
    }
    await page.locator(".fav-jchip").first().click();
    await page.waitForTimeout(400);
    check(await page.locator(".favorite-card").count() === favTotal && await page.locator(".fav-jchip.on").count() === 0, "再点恢复全量");

    // 备注折叠 → 展开 → 保存 → 收回归档
    const noteStamp = `探针备注-${Date.now().toString().slice(-5)}`;
    await page.screenshot({ path: `${shotDir}/3-favorites-tools.png` });
    await page.locator(".favorite-note-preview .favorite-note-toggle").first().click();
    await page.waitForTimeout(300);
    check(await page.locator(".favorite-note-edit textarea").first().isVisible(), "备注展开为编辑框");
    await page.locator(".favorite-note-edit textarea").first().fill(noteStamp);
    await page.locator(".favorite-note-edit button:has-text('保存备注')").first().click();
    await page.waitForTimeout(1200);
    const preview = await page.locator(".favorite-note-text").first().innerText();
    const collapsed = await page.locator(".favorite-note-edit").count();
    check(preview.includes(noteStamp) && collapsed === 0, "保存后备注收回单行预览", preview.trim());
  } else {
    console.log("SKIP 账户段落（--skip-account）");
  }

  // ⑤ 速览分组构成微条
  await page.evaluate(() => { location.hash = "#reports"; });
  await page.waitForTimeout(3000);
  const reportsDiag = await page.evaluate(() => ({
    hash: window.location.hash,
    errorBoundary: (document.body.innerText || "").includes("页面出错了"),
    loadingText: (document.querySelector(".reports-loading")?.textContent || "").trim(),
    emptyText: ((document.querySelector(".reports-view .empty")?.innerText) || "").slice(0, 80).replace(/\s+/g, " "),
    groupCount: document.querySelectorAll(".reports-group").length,
    chipCount: document.querySelectorAll(".reports-dir-chip").length,
    keepHidden: (() => { const k = [...document.querySelectorAll(".view-keep")]; return k.map((n) => n.hidden).join(","); })()
  }));
  if (reportsDiag.groupCount === 0) {
    console.log("  [reports-diag]", JSON.stringify(reportsDiag));
    await page.screenshot({ path: `${shotDir}/0-reports-diag.png` });
  }
  await page.waitForSelector(".reports-group", { timeout: 20000 });
  await page.waitForSelector(".reports-group-jchips", { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(600);
  const compInfo = await page.evaluate(() => {
    const wraps = [...document.querySelectorAll(".reports-group-jchips")];
    return { bars: wraps.length, segments: wraps.reduce((sum, wrap) => sum + wrap.querySelectorAll(".reports-group-jchip").length, 0) };
  });
  check(compInfo.bars >= 1 && compInfo.segments >= 2, "分组来源期刊 chips 渲染", `${compInfo.bars} 组 / ${compInfo.segments} 枚`);
  await page.screenshot({ path: `${shotDir}/4-reports-comp.png` });
  // 标题栏加高复核：收起全部已展开的组，量含主题文本的闭合组头高度（≥72px = 主题行成功换行）
  const openGroups = await page.locator(".reports-group.is-open").count();
  for (let i = 0; i < openGroups; i += 1) {
    await page.locator(".reports-group.is-open .reports-group-head").first().click();
    await page.waitForTimeout(250);
  }
  const tallHeads = await page.evaluate(() => [...document.querySelectorAll(".reports-group:not(.is-open) .reports-group-head")]
    .filter((h) => ((h.querySelector(".reports-group-topic")?.textContent) || "").trim().length > 0)
    .map((h) => Math.round(h.getBoundingClientRect().height)));
  if (tallHeads.length) {
    check(tallHeads.every((value) => value >= 72), "闭合分组标题栏含主题行加高", `heights=${tallHeads.slice(0, 4).join(",")}`);
  } else {
    console.log("SKIP 闭合分组标题栏高度复核（本环境 topic 均为空，生产复跑覆盖）");
  }

  // ⑥ 统计入场动效 + 骨架可复盘
  await page.evaluate(() => { location.hash = "#stats"; });
  await page.waitForSelector(".direction-bar", { timeout: 25000 });
  await page.waitForTimeout(1500);
  const barWidth = await page.locator(".direction-bar").first().evaluate((node) => node.getBoundingClientRect().width);
  check(barWidth > 4, "分布条动画终态宽度正常", `${Math.round(barWidth)}px`);
  const replay = await page.locator(".stats-replay").count();
  check(replay === 1, "「重播动画」按钮渲染");
  const errBeforeReplay = realErrors().length;
  await page.locator(".stats-replay").click();
  await page.waitForTimeout(400);
  check(realErrors().length === errBeforeReplay, "重播点击无新增运行时错误");
  await page.screenshot({ path: `${shotDir}/5-stats.png` });

  // ⑦ 每日资讯空态插画（有数据时跳过）
  await page.evaluate(() => { location.hash = "#news"; });
  await page.waitForTimeout(2500);
  const newsEmpty = await page.locator(".daily-news .empty, .empty").count();
  if (newsEmpty > 0) {
    const hasArt = await page.locator(".empty.has-art svg.empty-art").count();
    check(hasArt >= 1, "资讯空态使用插画（has-art）", `${hasArt} 幅`);
  } else {
    console.log("SKIP 资讯空态插画（该环境有资讯数据）");
  }

  check(realErrors().length === 0, "全程无页面运行时错误", realErrors().slice(0, 2).join(" | "));
  console.log(failures.length ? `PROBE_FAIL ${failures.length} 项失败` : "PROBE_OK");
  process.exitCode = failures.length ? 1 : 0;
} catch (error) {
  console.log(`PROBE_ERROR ${String(error.message).slice(0, 220)}`);
  if (pageErrors.length) console.log(`PAGE_ERRORS:\n  ${pageErrors.slice(0, 5).join("\n  ")}`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
