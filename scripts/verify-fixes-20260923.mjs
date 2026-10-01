/**
 * 2026.09.23.2 三项修复的上线校验（走真实浏览器 + 真实接口，非截图肉眼判断）。
 *
 *   一、卡片「中文摘要」块的配色必须等于该卡片的期刊色系（--tone），
 *       而不是固定的主题蓝 #3157d5 / rgb(49, 87, 213)。
 *   二、管理中心「文献分布」必须覆盖整个期刊目录，不能只剩 3 行。
 *   三、顶部「最近一周/一月出版」的数值必须与 /api/status 一致，
 *       且等于按日期边界统计的结果（可用 /api/status 直接比对）。
 *
 * 用法：
 *   node scripts/verify-fixes-20260923.mjs http://192.168.31.233:4177
 *   node scripts/verify-fixes-20260923.mjs https://lhmktz.top
 *   VERIFY_RESOLVE=host:ip node scripts/verify-fixes-20260923.mjs https://lhmktz.top
 */
import { chromium } from "playwright-core";
import fs from "node:fs";

const base = (process.argv[2] || "http://192.168.31.233:4177").replace(/\/$/, "");
const failures = [];
const check = (ok, message) => {
  console.log(`${ok ? "  ok  " : "  FAIL"} ${message}`);
  if (!ok) failures.push(message);
};

function readPassport() {
  try {
    const env = fs.readFileSync(".env", "utf8");
    const match = env.match(/^ADMIN_PASSPORT\s*=\s*(.*)$/m);
    if (match && match[1].trim()) return match[1].trim().replace(/^["']|["']$/g, "");
  } catch { /* .env 可选 */ }
    console.error("通行证缺失：请在仓库根目录 .env 配置 ADMIN_PASSPORT（代码中不允许硬编码通行证）");
  process.exit(2);
}

const resolvePin = (process.env.VERIFY_RESOLVE || "").trim();
const launchArgs = [];
if (resolvePin) {
  const [pinHost, pinIp] = resolvePin.split(":");
  if (pinHost && pinIp) launchArgs.push(`--host-resolver-rules=MAP ${pinHost} ${pinIp}`);
}

const browser = await chromium.launch({
  channel: process.env.VERIFY_BROWSER || "msedge",
  headless: true,
  args: launchArgs
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
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

  // ---------- 三、顶部胶囊 vs 接口 ----------
  const status = await page.evaluate(async () => {
    // /api/status 在通行证网关后面：应用自己用 localStorage 里的 token 拼请求头
    // （见 src/lib/api.js#requestHeaders），cookie 里没有这些信息，裸 fetch 会 401。
    const headers = {};
    const passportToken = localStorage.getItem("passportToken");
    if (passportToken) headers["X-Passport-Token"] = passportToken;
    const userToken = localStorage.getItem("userToken") || sessionStorage.getItem("userToken");
    if (userToken) headers["X-User-Token"] = userToken;
    const response = await fetch("/api/status", { headers });
    if (!response.ok) {
      console.log(`  [status probe] HTTP ${response.status}`);
      return null;
    }
    return response.json();
  });
  const chips = await page.evaluate(() =>
    [...document.querySelectorAll(".topbar-stats .stat-chip")].map((node) => node.textContent.replace(/\s+/g, " ").trim())
  );
  const chipText = chips.join(" | ");
  const chipNumber = (label) => {
    const found = chips.find((text) => text.startsWith(label));
    return found ? Number(found.slice(label.length).trim()) : NaN;
  };
  console.log(`  note  顶部胶囊：${chipText}`);
  check(status !== null, "接口 /api/status 可用");
  if (status) {
    check(chipNumber("最近一周出版") === status.newArticleCount7d, `最近一周出版 = 接口值 ${status.newArticleCount7d}`);
    check(chipNumber("最近一月出版") === status.newArticleCount30d, `最近一月出版 = 接口值 ${status.newArticleCount30d}`);
    // 旧的「时间戳边界」写法在生产库上只会更少（最近一周少 14 篇），用它反证边界确实改成按日期了
    check(status.newArticleCount7d >= 137, `最近一周出版 ${status.newArticleCount7d} ≥ 137（旧的按时间戳边界会偏小）`);
  }

  // ---------- 二、管理中心文献分布 ----------
  await page.getByRole("button", { name: "管理中心" }).first().click();
  await page.waitForSelector(".admin-translate-controls", { timeout: 20000 });
  await page.waitForTimeout(600);
  const distribution = await page.evaluate(() => {
    const header = [...document.querySelectorAll("h2")].find((node) => node.textContent.trim() === "文献分布");
    const panel = header?.closest("section") || header?.parentElement?.parentElement;
    const rows = [...(panel?.querySelectorAll("tbody tr") || [])].map((tr) => {
      const cells = [...tr.querySelectorAll("td")].map((td) => td.textContent.replace(/\s+/g, " ").trim());
      return { journal: cells[0], count: Number(cells[1]) };
    });
    return rows;
  });
  const total = distribution.reduce((sum, row) => sum + row.count, 0);
  console.log(`  note  文献分布 ${distribution.length} 行，合计 ${total} 篇`);
  for (const row of distribution) console.log(`          ${String(row.count).padStart(5)}  ${row.journal}`);
  check(distribution.length >= 15, `文献分布覆盖整个目录（实际 ${distribution.length} 行）`);
  check(distribution.some((row) => row.journal === "Energy"), "包含 Energy");
  check(distribution.some((row) => row.journal === "电网技术"), "包含 电网技术");
  check(!distribution.some((row) => /Civil Engineers/.test(row.journal)), "仍滤掉目录外的 ICE Energy");
  if (status) {
    check(total >= status.articleCount * 0.98, `分布合计 ${total} 与总文献 ${status.articleCount} 基本一致`);
  }

  // ---------- 一、中文摘要块配色跟随期刊色系 ----------
  await page.getByRole("button", { name: "最新文献" }).first().click();
  await page.waitForSelector(".article", { timeout: 20000 });
  // 「中文摘要」是工具栏里的全局显示开关（默认关闭，见 Feed.jsx#display-toggles），
  // 打开后凡是库里已有译文的中文摘要块都会渲染出来。这里做成幂等：
  // 只在该开关处于关闭状态时才点，避免翻页时反复切换把它又关回去。
  const expandChineseAbstracts = async () => {
    const alreadyOn = await page.evaluate(() =>
      [...document.querySelectorAll("button.display-toggle")]
        .some((node) => node.textContent.replace(/\s+/g, "").trim() === "中文摘要" && node.classList.contains("active"))
    );
    if (!alreadyOn) await page.getByRole("button", { name: "中文摘要" }).first().click();
    await page.waitForTimeout(2200);
  };

  const collectToneRows = () => page.evaluate(() => {
    const rgb = (value) => {
      const probe = document.createElement("div");
      probe.style.color = value;
      document.body.appendChild(probe);
      const resolved = getComputedStyle(probe).color;
      probe.remove();
      return resolved;
    };
    const rows = [];
    for (const article of document.querySelectorAll(".article")) {
      const block = article.querySelector(".translated-abstract");
      if (!block) continue;
      const tone = getComputedStyle(article).getPropertyValue("--tone").trim();
      const toneSoft = getComputedStyle(article).getPropertyValue("--tone-soft").trim();
      const label = block.querySelector("span");
      const group = [...article.classList].find((name) => name.startsWith("tone-")) || "";
      rows.push({
        journal: article.querySelector(".article-journal")?.textContent.trim() || "",
        group,
        tone,
        borderColor: getComputedStyle(block).borderLeftColor,
        backgroundColor: getComputedStyle(block).backgroundColor,
        labelColor: label ? getComputedStyle(label).color : "",
        expectTone: tone ? rgb(tone) : "",
        expectToneSoft: toneSoft ? rgb(toneSoft) : ""
      });
    }
    return rows;
  });

  const toneReport = [];
  const groupsSeen = new Set();
  const seenKeys = new Set();
  const loadMoreButton = page.getByRole("button", { name: /加载下一批文献|继续显示下一批文献/ });
  // 首页刚好全是爱思唯尔系的刊，只验证一组说服力不够：连点「加载下一批文献」
  //（列表页的正规翻页入口）直到凑齐 ≥3 个期刊色系分组。
  for (let round = 0; round < 8; round += 1) {
    await expandChineseAbstracts();
    const rows = await collectToneRows();
    for (const row of rows) {
      const key = `${row.group}|${row.journal}|${row.borderColor}|${row.backgroundColor}|${row.labelColor}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      toneReport.push(row);
      groupsSeen.add(row.group);
    }
    console.log(`  note  第 ${round + 1} 批：累计带中文摘要卡片 ${toneReport.length} 张，分组 ${[...groupsSeen].join(", ") || "无"}`);
    if (groupsSeen.size >= 3 || !(await loadMoreButton.count())) break;
    await loadMoreButton.first().click().catch(() => {});
    await page.waitForTimeout(2200);
  }

  const accentBlue = "rgb(49, 87, 213)";
  console.log(`  note  含中文摘要的卡片 ${toneReport.length} 张`);
  for (const row of toneReport.slice(0, 12)) {
    groupsSeen.add(row.group);
    console.log(`          ${row.group.padEnd(14)} ${row.tone.padEnd(9)} 竖条=${row.borderColor} 标签=${row.labelColor} 底色=${row.backgroundColor}  《${row.journal}》`);
  }
  check(toneReport.length > 0, "页面上找到「中文摘要」块");
  check(
    toneReport.length === 0 || toneReport.every((row) => row.borderColor === row.expectTone),
    "中文摘要左侧竖条颜色 = 该卡片的期刊色系 --tone"
  );
  check(
    toneReport.length === 0 || toneReport.every((row) => row.labelColor === row.expectTone),
    "「中文摘要」标签颜色 = 该卡片的期刊色系 --tone"
  );
  check(
    toneReport.length === 0 || toneReport.every((row) => row.backgroundColor === row.expectToneSoft),
    "中文摘要底色 = 该卡片的期刊色系 --tone-soft"
  );
  check(
    toneReport.length === 0 || toneReport.every((row) => row.borderColor !== accentBlue),
    "中文摘要不再固定为主题蓝"
  );
  console.log(`  note  覆盖到的期刊分组：${[...groupsSeen].join(", ") || "无"}`);
  const tonePairs = [...new Map(toneReport.map((row) => [row.group, row.tone])).entries()]
    .map(([group, tone]) => `${group}=${tone}`)
    .join(", ");
  console.log(`  note  分组→色值：${tonePairs || "无"}`);
  check(groupsSeen.size >= 2, `覆盖 ≥2 个期刊色系分组（实际 ${groupsSeen.size} 组）`);

  await page.screenshot({ path: "artifacts/verify-fixes-20260923.png", fullPage: false });
  console.log("\n截图：artifacts/verify-fixes-20260923.png");
} finally {
  await browser.close();
}

if (failures.length) {
  console.error(`\n校验失败 ${failures.length} 项：\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("\n三项修复校验通过");
