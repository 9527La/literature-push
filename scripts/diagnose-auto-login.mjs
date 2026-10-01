/**
 * 自动登录链路诊断（可重复运行，不写生产库）。
 *
 * 在临时数据目录里起一份独立服务，用真实浏览器跑四种情形：
 *   A 首次登录（勾选「记住密码」+「自动登录」）
 *   B 普通刷新                    —— 期望：凭 token 保持登录
 *   C 令牌被清掉（模拟会话失效）  —— 期望：用已保存的账号密码自动重新登录
 *   D 通行证过期后重新输入通行证  —— 期望：进门后仍然自动登录（这是最容易坏的一环）
 *
 * 用法：node scripts/diagnose-auto-login.mjs
 */
import fs from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";
import { projectRoot } from "../server/paths.js";

function readEnvPassport() {
  try {
    const env = fs.readFileSync(".env", "utf8");
    const m = env.match(/^ADMIN_PASSPORT\s*=\s*(.*)$/m);
    if (m && m[1].trim()) return m[1].trim().replace(/^["']|["']$/g, "");
  } catch { /* .env is required; see README deployment section */ }
  console.error("通行证缺失：请在仓库根目录 .env 配置 ADMIN_PASSPORT（代码中不允许硬编码通行证）");
  process.exit(2);
}

const PORT = Number(process.env.DIAGNOSE_PORT || 4188);
const BASE = `http://127.0.0.1:${PORT}`;
const USERNAME = `autologin${Date.now().toString().slice(-6)}`;
const PASSWORD = "auto-login-1234";

const failures = [];
const check = (ok, message) => {
  console.log(`${ok ? "  ok  " : "  FAIL"} ${message}`);
  if (!ok) failures.push(message);
};

const dataDir = mkdtempSync(path.join(tmpdir(), "autologin-"));
const server = spawn(process.execPath, ["--no-warnings=ExperimentalWarning", path.join(projectRoot, "server", "index.js")], {
  cwd: projectRoot,
  env: { ...process.env, PORT: String(PORT), LITERATURE_DATA_DIR: dataDir, CRAWLER_ENABLED: "false" },
  stdio: ["ignore", "pipe", "pipe"]
});
server.stdout.on("data", () => {});
server.stderr.on("data", (chunk) => {
  const text = String(chunk).trim();
  if (text) console.log(`  [server] ${text.slice(0, 200)}`);
});

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${BASE}/api/gate/session`);
      if (response.ok) return;
    } catch { /* not listening yet */ }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`服务未在 ${BASE} 就绪`);
}

/** 版本更新弹窗的遮罩会吞掉点击，每次进页面都先按 Esc 关掉。 */
async function dismissModals(page) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (!await page.locator(".modal-backdrop").count()) return;
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
  }
}

const snapshot = (page) => page.evaluate(async () => {  const token = localStorage.getItem("userToken") || sessionStorage.getItem("userToken") || "";
  const headers = {};
  const passport = localStorage.getItem("passportToken");
  if (passport) headers["X-Passport-Token"] = passport;
  if (token) headers["X-User-Token"] = token;
  let account = null;
  try { account = await fetch("/api/account", { headers }).then((r) => r.json()); } catch { account = null; }
  return {
    token,
    settings: localStorage.getItem("accountLoginSettings"),
    hasPassport: Boolean(passport),
    authenticated: Boolean(account?.authenticated),
    username: account?.username || "",
    gateVisible: Boolean(document.querySelector('input[type="password"]')) && !document.querySelector(".app-shell")
  };
});

let browser;
try {
  await waitForServer();
  browser = await chromium.launch({ channel: process.env.VERIFY_BROWSER || "msedge", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on("pageerror", (error) => console.log(`  [page error] ${String(error.message).slice(0, 160)}`));

  const passport = process.env.DIAGNOSE_PASSPORT || readEnvPassport();

  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('input[type="password"]', { timeout: 15000 });
  await page.fill('input[type="password"]', passport);
  await page.click(".login-form button.primary");
  await page.waitForSelector(".app-shell", { timeout: 20000 });

  // A 首次注册并勾选两个复选框
  await page.goto(`${BASE}/#account`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".app-shell", { timeout: 20000 });
  await dismissModals(page);
  await page.waitForSelector(".auth-tabs", { timeout: 20000 });
  await page.getByRole("tab", { name: "注册个人账户" }).click();
  await page.locator('.auth-form input[autocomplete="new-username"]').fill(USERNAME);
  await page.locator('.auth-form input[type="password"]').fill(PASSWORD);
  const boxes = page.locator('.auth-option input[type="checkbox"]');
  if (!await boxes.nth(0).isChecked()) await boxes.nth(0).check();
  if (!await boxes.nth(1).isChecked()) await boxes.nth(1).check();
  await page.click(".auth-form button.primary");
  await page.waitForTimeout(2500);
  const afterRegister = await snapshot(page);
  check(afterRegister.authenticated, `A 注册后已登录（username=${afterRegister.username}）`);
  check(afterRegister.hasPassport, "A 通行证已持久化");
  const settings = JSON.parse(afterRegister.settings || "{}");
  check(Boolean(settings.password && settings.rememberPassword && settings.autoLogin), `A 登录设置已保存：${afterRegister.settings}`);
  const tokenAfterRegister = afterRegister.token;

  // B 普通刷新
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  await dismissModals(page);
  const afterReload = await snapshot(page);
  check(afterReload.authenticated, "B 刷新后仍保持登录");
  check(afterReload.token === tokenAfterRegister, "B 未重复签发新令牌（用的还是原 token）");

  // C 令牌被清掉 —— 自动登录应该用保存的密码重建会话
  await page.evaluate(() => { localStorage.removeItem("userToken"); sessionStorage.removeItem("userToken"); });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3500);
  const afterTokenLoss = await snapshot(page);
  check(afterTokenLoss.authenticated, `C 令牌失效后能自动重新登录（token ${afterTokenLoss.token ? "已重建" : "为空"}）`);
  check(afterTokenLoss.token !== tokenAfterRegister, "C 确实签发了新令牌");

  // D 通行证过期：清掉通行证（保留自动登录设置），重新输入通行证后再看是否自动登录
  await page.evaluate(() => { localStorage.removeItem("passportToken"); localStorage.removeItem("userToken"); sessionStorage.removeItem("userToken"); });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  const beforeGate = await snapshot(page);
  check(beforeGate.gateVisible || !beforeGate.authenticated, "D 无通行证时回到门禁");
  await page.waitForSelector('input[type="password"]', { timeout: 15000 });
  await page.fill('input[type="password"]', passport);
  await page.click(".login-form button.primary");
  await page.waitForSelector(".app-shell", { timeout: 20000 });
  await page.waitForTimeout(4000);
  const afterGate = await snapshot(page);
  check(afterGate.authenticated, `D 重新通过通行证后自动恢复了个人账户（username=${afterGate.username || "空"}）`);
} catch (error) {
  check(false, `诊断中断：${error.message}`);
} finally {
  if (browser) await browser.close();
  server.kill();
  try { rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch {}
}

if (failures.length) {
  console.error(`\n自动登录诊断：${failures.length} 项失败`);
  process.exit(1);
}
console.log("\n自动登录诊断：全部通过");
