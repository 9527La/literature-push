#!/usr/bin/env node
/**
 * Read-only probe for every feed filter dimension (RUNBOOK-AI-DIRECTION.md §API).
 * Usage: node scripts/probe-feed-filters.mjs [base] [passport]
 * Covers: baseline, direction (single/multi/other-exemption/invalid),
 * q (LIKE escaping), journal, keyword, from/to, sort, guest unread/favorite,
 * pagination and combined filters. Fails loudly on any mismatch.
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

const ymd = (offset) => new Date(Date.now() - offset * 86400000).toISOString().slice(0, 10);
let failures = 0;
const check = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}: actual=${JSON.stringify(actual)}${ok ? "" : ` expected=${JSON.stringify(expected)}`}`);
  if (!ok) failures += 1;
};

const page = async (params) => {
  const query = new URLSearchParams({ limit: "10", offset: "0", ...params }).toString();
  const res = await fetch(`${base}/api/articles?${query}`, { headers });
  if (!res.ok) throw new Error(`/api/articles?${query} -> ${res.status}`);
  return res.json();
};
const totals = async (params) => (await page(params)).total;
const sample = async (params) => (await page(params)).articles.slice(0, 10);

console.log("== baseline ==");
const baseline = await totals({});
check("baseline total (other excluded, NULL shown)", baseline > 0 && baseline < 20000, true);

console.log("== direction ==");
const dirRows = await sample({ direction: "storage" });
check("direction=storage rows all storage", [...new Set(dirRows.map((a) => a.research_direction))], ["storage"]);
const otherTotal = await totals({ direction: "other" });
check("direction=other exemption (total>0, rows all other)", otherTotal > 0, true);
const otherRows = await sample({ direction: "other" });
check("direction=other rows all other", [...new Set(otherRows.map((a) => a.research_direction))], ["other"]);
const multiRows = await sample({ direction: "storage,market" });
check("direction multi rows ⊆ {storage,market}", multiRows.every((a) => ["storage", "market"].includes(a.research_direction)), true);
const invalid = await totals({ direction: "<script>,storage,DROP TABLE" });
check("direction invalid keys dropped, storage still applies", invalid, await totals({ direction: "storage" }));

console.log("== q search ==");
const likeProbe = await totals({ q: "%a" });
check("q=%a does not widen (LIKE escaped)", likeProbe, 0);
// 转义生效时 q=_a 只命中含字面 "_a" 的行（线上可能真有下划线文本，数量不必为 0）。
// 摘要在分页接口截断为 320 字符，命中可能落在截断段外——验证时对「恰好 320 字符」
// 的摘要豁免字段检查。
const textHit = (a, term) => [a.title, a.authors, a.keywords, a.abstract]
  .some((f) => String(f || "").toLowerCase().includes(term))
  || (a.abstract && a.abstract.length === 320);
const underRows = await sample({ q: "_a" });
check("q=_a rows contain literal _a (or truncated abstract)", underRows.every((a) => textHit(a, "_a")), true);
const wordTotal = await totals({ q: "grid" });
check("q=grid returns >0", wordTotal > 0, true);
const qRows = await sample({ q: "grid" });
check("q=grid hits title/abstract/authors/keywords", qRows.every((a) => textHit(a, "grid")), true);

console.log("== journal ==");
const anyJournal = (await page({})).articles.find((a) => a.journal)?.journal;
if (anyJournal) {
  const jRows = await sample({ journal: anyJournal });
  check(`journal=${anyJournal} exact match`, [...new Set(jRows.map((a) => a.journal))], [anyJournal]);
  const jTotal = await totals({ journal: anyJournal });
  check("journal total <= baseline", jTotal > 0 && jTotal <= baseline, true);
}

console.log("== keyword ==");
const kwRows = await sample({ keyword: "battery" });
check("keyword=battery rows contain battery", kwRows.every((a) => String(a.keywords || "").toLowerCase().includes("battery")), true);
check("keyword=battery returns >0", kwRows.length > 0, true);

console.log("== from/to ==");
const windowRows = await sample({ from: ymd(7), to: ymd(0) });
check("from/to rows within window", windowRows.every((a) => a.display_date >= ymd(7) && a.display_date <= ymd(0)), true);

console.log("== sort ==");
const asc = (await page({ sort: "asc", limit: "20" })).articles.map((a) => a.display_date);
check("sort=asc non-decreasing", asc.every((d, i) => i === 0 || asc[i - 1] <= d), true);
const desc = (await page({ sort: "desc", limit: "20" })).articles.map((a) => a.display_date);
check("sort=desc non-increasing", desc.every((d, i) => i === 0 || desc[i - 1] >= d), true);

console.log("== guest state filters ==");
check("guest unread=true ignored (equals baseline)", await totals({ unread: "true" }), baseline);
check("guest favorite=true ignored (equals baseline)", await totals({ favorite: "true" }), baseline);

console.log("== pagination ==");
const p1 = await page({ limit: "5", offset: "0" });
const p2 = await page({ limit: "5", offset: "5" });
check("page1 5 rows + hasMore", [p1.articles.length, p1.hasMore], [5, true]);
check("page2 total equals page1 total", p2.total, p1.total);
check("pages disjoint", new Set([...p1.articles, ...p2.articles].map((a) => a.id)).size, 10);

console.log("== combined ==");
const combo = await page({ q: "grid", journal: anyJournal || "", from: ymd(365), to: ymd(0), sort: "desc", limit: "10" });
check("combo rows satisfy all constraints", combo.articles.every((a) =>
  textHit(a, "grid")
  && (!anyJournal || a.journal === anyJournal)
  && a.display_date >= ymd(365) && a.display_date <= ymd(0)), true);

console.log("== cross-check with direction stats ==");
const stats = await fetch(`${base}/api/directions?window=365`, { headers }).then((r) => r.json());
const storageStat = stats.directions.find((d) => d.key === "storage");
if (storageStat) {
  check("direction=storage total == /api/directions window=365 count", await totals({ direction: "storage" }), storageStat.total);
}

if (failures) {
  console.error(`PROBE FAIL: ${failures} mismatch(es)`);
  process.exit(1);
}
console.log("FILTERS PROBE PASS");
