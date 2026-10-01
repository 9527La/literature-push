#!/usr/bin/env node
/** 一次性校验：gate 登录后取 /api/reports/latest 与 /api/reports，验证研究速览链路。 */
import { config } from "../server/config.js";

const BASE = `http://127.0.0.1:${config.port}`;
const PASSPORT = process.env.GATE_PASSPORT || config.adminPassport;
if (!PASSPORT) {
  console.error("missing GATE_PASSPORT");
  process.exit(1);
}
async function main() {
  const login = await fetch(`${BASE}/api/gate/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ passport: PASSPORT })
  });
  if (!login.ok) throw new Error(`gate login failed: ${login.status}`);
  const session = await login.json();
  const token = session.token || session.passportToken;
  if (!token) throw new Error("no token in gate session response");
  const headers = { "x-passport-token": token };
  const latest = await fetch(`${BASE}/api/reports/latest?kind=weekly`, { headers });
  const latestBody = await latest.json();
  if (!latest.ok || !latestBody.report) throw new Error(`latest failed: ${latest.status} ${JSON.stringify(latestBody).slice(0, 200)}`);
  const r = latestBody.report;
  console.log(`latest ok: kind=${r.kind} period=${r.period_start}~${r.period_end} total=${r.stats?.total} highlights=${r.stats?.highlightIds?.length} topics=${r.stats?.topTopics?.length} contentChars=${(r.content_md || "").length}`);
  const list = await fetch(`${BASE}/api/reports?kind=weekly&limit=12`, { headers });
  const listBody = await list.json();
  console.log(`list ok: status=${list.status} count=${listBody.reports?.length}`);
  const monthly = await fetch(`${BASE}/api/reports?kind=monthly&limit=12`, { headers });
  const monthlyBody = await monthly.json();
  console.log(`monthly ok: status=${monthly.status} count=${monthlyBody.reports?.length}`);
  const ids = (r.stats?.highlightIds || []).join(",");
  const arts = await fetch(`${BASE}/api/articles?ids=${ids}&limit=20`, { headers });
  const artsBody = await arts.json();
  const n = (artsBody.articles || artsBody || []).length;
  console.log(`articles ids ok: status=${arts.status} count=${n}`);
  if (!n) throw new Error("highlight ids returned no articles");

  // ── 研究速览 v2：meta 轻量列表 / include=full 兼容 / detail 定位 ───────────
  const metaList = await fetch(`${BASE}/api/reports?kind=weekly&limit=5`, { headers });
  const metaBody = await metaList.json();
  const firstMeta = (metaBody.reports || [])[0];
  if (!firstMeta) throw new Error("meta list empty");
  if (firstMeta.content_md != null) throw new Error("meta list must strip content_md");
  const fullList = await fetch(`${BASE}/api/reports?kind=weekly&limit=5&include=full`, { headers });
  const fullBody = await fullList.json();
  const firstFull = (fullBody.reports || [])[0];
  if (!firstFull || !firstFull.content_md) throw new Error("include=full must keep content_md");
  console.log(`meta/full ok: meta strips content_md; full keeps ${(firstFull.content_md || "").length} chars`);

  const overviewDetail = await fetch(`${BASE}/api/reports/detail?kind=weekly&period_start=${encodeURIComponent(r.period_start)}`, { headers });
  const overviewBody = await overviewDetail.json();
  if (!overviewDetail.ok || !overviewBody.report) throw new Error(`overview detail failed: ${overviewDetail.status}`);
  console.log(`detail overview ok: period=${overviewBody.report.period_start} briefs=${(overviewBody.report.stats?.paperBriefs || []).length}`);

  const dirKeys = Object.entries(r.stats?.directionCounts || {})
    .filter(([, count]) => Number(count) > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([key]) => key);
  if (dirKeys.length) {
    const bundle = await fetch(`${BASE}/api/reports/detail?kind=weekly&period_start=${encodeURIComponent(r.period_start)}&directions=${dirKeys.join(",")}`, { headers });
    const bundleBody = await bundle.json();
    if (!bundle.ok) throw new Error(`directions bundle failed: ${bundle.status}`);
    console.log(`detail bundle ok: ${dirKeys.length} keys requested -> ${(bundleBody.reports || []).length} reports`);
  }
  console.log("REPORTS_PROBE_PASS");
}
main().catch((error) => { console.error("REPORTS_PROBE_FAIL:", error.message); process.exit(1); });
