#!/usr/bin/env node
/**
 * Read-only probe for the AI-direction APIs (RUNBOOK-AI-DIRECTION.md).
 * Usage: node scripts/probe-direction-api.mjs [base] [passport]
 * Checks: gate login → /api/directions (+matrix) → /api/articles?direction= → plain list regression.
 */

import fs from "node:fs";

function readEnvPassport() {
  try {
    const env = fs.readFileSync(".env", "utf8");
    const m = env.match(/^ADMIN_PASSPORT\s*=\s*(.*)$/m);
    if (m && m[1].trim()) return m[1].trim().replace(/^["']|["']$/g, "");
  } catch { /* .env is required; see README deployment section */ }
  console.error("通行证缺失：请在仓库根目录 .env 配置 ADMIN_PASSPORT（代码中不允许硬编码通行证）");
  process.exit(2);
}
const base = process.argv[2] || "http://127.0.0.1:4177";
const passport = process.argv[3] || readEnvPassport();

const login = await fetch(`${base}/api/gate/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ passport })
}).then((r) => r.json());
if (!login.token) throw new Error("gate login failed");
const headers = { "x-passport-token": login.token };

const stats = await fetch(`${base}/api/directions?window=30`, { headers }).then((r) => {
  if (!r.ok) throw new Error(`/api/directions ${r.status}`);
  return r.json();
});
console.log("coverage:", JSON.stringify(stats.coverage));
const nonEmpty = stats.directions.filter((d) => d.total > 0);
console.log("directions:", nonEmpty.length ? nonEmpty.map((d) => `${d.label}=${d.total}`).join(" ") : "(尚无已分类)");

const key = nonEmpty[0]?.key || "storage";
const page = await fetch(`${base}/api/articles?direction=${key}&limit=3`, { headers }).then((r) => {
  if (!r.ok) throw new Error(`/api/articles?direction= ${r.status}`);
  return r.json();
});
console.log(`filter direction=${key}: total=${page.total}, returned=${page.articles.length}`);
if (page.articles.length) {
  const withDirection = page.articles.filter((a) => a.research_direction === key).length;
  console.log(`rows carrying the direction field: ${withDirection}/${page.articles.length}`);
}

const plain = await fetch(`${base}/api/articles?limit=3`, { headers }).then((r) => r.json());
console.log(`plain list regression: total=${plain.total}, returned=${plain.articles.length}`);

// 顶栏统计胶囊（/api/status → getUserStatus）必须与列表页同口径：都不含「其他」。
const status = await fetch(`${base}/api/status`, { headers }).then((r) => {
  if (!r.ok) throw new Error(`/api/status ${r.status}`);
  return r.json();
});
console.log(`topbar status: articleCount=${status.articleCount}, 7d=${status.newArticleCount7d}, 30d=${status.newArticleCount30d}`);
if (status.articleCount !== plain.total) {
  throw new Error(`topbar/list mismatch: articleCount=${status.articleCount} vs list total=${plain.total}（顶栏口径与列表页不一致，检查 getUserStatus 的 other 排除）`);
}

// 管理端「内容完整性」也与列表页同口径（coverage 分母不含 other）。
const admin = await fetch(`${base}/api/admin/overview`, { headers }).then((r) => {
  if (!r.ok) throw new Error(`/api/admin/overview ${r.status}`);
  return r.json();
});
console.log(`admin overview: articles=${admin.counts.articles}, coverage.abstracts=${admin.coverage.abstracts}%, pending abstracts=${admin.pending.abstracts}, keywords=${admin.pending.keywords}`);
if (admin.counts.articles !== plain.total) {
  throw new Error(`admin/list mismatch: counts.articles=${admin.counts.articles} vs list total=${plain.total}（管理端 coverage 分母与列表页口径不一致，检查 getAdminOverview 的 other 排除）`);
}

const matrix = await fetch(`${base}/api/directions?matrix=1`, { headers }).then((r) => {
  if (!r.ok) throw new Error(`/api/directions?matrix=1 ${r.status}`);
  return r.json();
});
console.log("matrix keys:", Object.keys(matrix.matrix || {}).length);
console.log("PROBE PASS");
