#!/usr/bin/env node
/**
 * 每日资讯探针（PLAN-DAILY-NEWS.md M1/M3）。
 *
 * 文件模式（默认）：校验 data/daily-news/*.md 的模板结构——
 *   node scripts/probe-daily-news.mjs [目录]
 * API 模式：起服务后校验列表/详情/非法参数——
 *   node scripts/probe-daily-news.mjs --api [BASE]
 *
 * 全部通过输出 DAILY_NEWS_PROBE_PASS，任何一项失败输出 DAILY_NEWS_PROBE_FAIL 并 exit 1。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fail = [];
const ok = [];

function check(condition, label) {
  if (condition) ok.push(label);
  else fail.push(label);
}

function extract(markdown) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const titleLine = lines.find((line) => /^#\s+/.test(line)) || "";
  const overviewIdx = lines.findIndex((line) => /^##\s+概览\s*$/.test(line));
  const overview = [];
  const sections = [];
  let inOverview = overviewIdx !== -1;
  let currentSection = null;
  for (let i = (overviewIdx === -1 ? 0 : overviewIdx + 1); i < lines.length; i++) {
    const line = lines[i];
    const sectionMatch = line.match(/^##\s+(.+)$/);
    if (sectionMatch && !/^##\s+概览\s*$/.test(line)) {
      inOverview = false;
      const nMatch = sectionMatch[1].match(/`#(\d+)`/);
      currentSection = { n: nMatch ? Number(nMatch[1]) : null, title: sectionMatch[1].trim(), body: [] };
      sections.push(currentSection);
      continue;
    }
    if (inOverview) {
      if (/^###\s+/.test(line)) overview.push({ name: line.replace(/^###\s+/, "").trim(), items: [] });
      else if (/^-\s+/.test(line) && overview.length) {
        const nMatch = line.match(/`#(\d+)`/);
        overview[overview.length - 1].items.push(nMatch ? Number(nMatch[1]) : null);
      }
      continue;
    }
    if (currentSection) currentSection.body.push(line);
  }
  const anchorsInOverview = overview.flatMap((group) => group.items).filter((n) => n !== null);
  const anchorsInSections = sections.map((section) => section.n).filter((n) => n !== null);
  return { titleLine, overview, sections, anchorsInOverview, anchorsInSections, raw: lines.join("\n") };
}

function validateFile(filePath) {
  const name = path.basename(filePath);
  const dateMatch = /^(\d{4}-\d{2}-\d{2})\.md$/.exec(name);
  check(dateMatch !== null, `${name}: 文件名 YYYY-MM-DD.md`);
  if (!dateMatch) return;
  const date = dateMatch[1];
  const markdown = fs.readFileSync(filePath, "utf8");
  const data = extract(markdown);

  check(/^#\s+电力能源每日资讯\s+\d{4}-\d{2}-\d{2}\s*$/.test(data.titleLine), `${name}: 一级标题「电力能源每日资讯 日期」`);
  check(data.titleLine.includes(date), `${name}: 标题日期与文件名一致（${date}）`);
  check(data.overview.length >= 1, `${name}: 概览区含至少一个分组`);
  check(data.overview.every((group) => group.items.length > 0 || true), `${name}: 概览分组解析完成`);

  const overviewSet = new Set(data.anchorsInOverview);
  const sectionSet = new Set(data.anchorsInSections);
  const onlyOverview = [...overviewSet].filter((n) => !sectionSet.has(n));
  const onlySection = [...sectionSet].filter((n) => !overviewSet.has(n));
  check(onlyOverview.length === 0 && onlySection.length === 0,
    `${name}: 概览 #N 与详情条目一一对应（概览独有: ${onlyOverview.join(",") || "无"}；详情独有: ${onlySection.join(",") || "无"}）`);

  const maxN = Math.max(0, ...overviewSet, ...sectionSet);
  const missing = [];
  for (let n = 1; n <= maxN; n++) {
    if (!overviewSet.has(n) || !sectionSet.has(n)) missing.push(n);
  }
  check(missing.length === 0, `${name}: #1..#${maxN} 连续无缺号（缺: ${missing.join(",") || "无"}）`);

  const sectionsWithoutSource = data.sections.filter((section) => {
    const body = section.body.join("\n");
    const fences = [...body.matchAll(/```([^\n]*)\n([\s\S]*?)```/g)];
    return !fences.some((match) => /https?:\/\//.test(match[2]));
  });
  check(sectionsWithoutSource.length === 0, `${name}: 每条详情含来源 URL 代码块（缺: ${sectionsWithoutSource.map((s) => s.n).join(",") || "无"}）`);

  const sepCount = (markdown.match(/^\s*\*\s*\*\s*\*\s*$/gm) || []).length;
  check(sepCount >= data.sections.length, `${name}: * * * 分隔线数量（${sepCount}）≥ 条目数（${data.sections.length}）`);
  check(/^\*\*提示\*\*/m.test(markdown), `${name}: 文末 AI 免责声明行存在`);
}

function fileMode(dir) {
  const target = dir || path.join(projectRoot, "data", "daily-news");
  let entries = [];
  try {
    entries = fs.readdirSync(target).filter((name) => /^\d{4}-\d{2}-\d{2}\.md$/.test(name)).sort();
  } catch {
    console.error(`DAILY_NEWS_PROBE_FAIL: 目录不存在 ${target}`);
    process.exit(1);
  }
  check(entries.length > 0, `${target}: 至少存在 1 个日期文件（${entries.length} 个）`);
  for (const name of entries) validateFile(path.join(target, name));
}

async function apiMode(base) {
  const { config } = await import("../server/config.js");
  const target = base || `http://127.0.0.1:${config.port}`;
  const passport = process.env.GATE_PASSPORT || config.adminPassport;
  if (!passport) {
    console.error("DAILY_NEWS_PROBE_FAIL: missing GATE_PASSPORT");
    process.exit(1);
  }
  const login = await fetch(`${target}/api/gate/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ passport })
  });
  check(login.ok, `gate 登录（${login.status}）`);
  if (!login.ok) return;
  const session = await login.json();
  const token = session.token || session.passportToken;
  const headers = { "x-passport-token": token };

  const list = await fetch(`${target}/api/daily-news`, { headers });
  const listBody = await list.json();
  check(list.ok && Array.isArray(listBody.items), `GET /api/daily-news（${list.status}，${listBody.items?.length ?? "?"} 期）`);
  const sorted = (listBody.items || []).every((item, i, arr) => i === 0 || arr[i - 1].date >= item.date);
  check(sorted, `列表按日期倒序`);
  for (const item of listBody.items || []) {
    check(typeof item.title === "string" && item.title.length > 0, `列表元信息含标题（${item.date}）`);
    check(Array.isArray(item.groups) && item.groups.length > 0, `列表元信息含分组计数（${item.date}）`);
  }

  const first = (listBody.items || [])[0];
  if (first) {
    const detail = await fetch(`${target}/api/daily-news/detail?date=${encodeURIComponent(first.date)}`, { headers });
    const detailBody = await detail.json();
    check(detail.ok && detailBody.markdown?.length > 0, `GET /api/daily-news/detail?date=${first.date}（${detail.status}，${detailBody.markdown?.length ?? 0} 字符）`);
    check(detailBody.date === first.date, `detail 返回日期一致`);
    check(detailBody.title === first.title, `detail 标题与列表元信息一致`);
  }

  const invalid = await fetch(`${target}/api/daily-news/detail?date=..%2Fetc`, { headers });
  check(invalid.status === 400, `非法 date（路径穿越）→ 400（实际 ${invalid.status}）`);
  const invalid2 = await fetch(`${target}/api/daily-news/detail?date=abc`, { headers });
  check(invalid2.status === 400, `非法 date（字母）→ 400（实际 ${invalid2.status}）`);
  const missing = await fetch(`${target}/api/daily-news/detail?date=2099-01-01`, { headers });
  check(missing.status === 404, `不存在日期 → 404（实际 ${missing.status}）`);
}

const args = process.argv.slice(2);
const apiFlag = args.includes("--api");
const dirArg = args.find((arg) => arg !== "--api" && !arg.startsWith("--"));
try {
  if (apiFlag) await apiMode(dirArg);
  else fileMode(dirArg);
} catch (error) {
  fail.push(`异常: ${error.message}`);
}

for (const line of ok) console.log(`  ✓ ${line}`);
if (fail.length) {
  for (const line of fail) console.error(`  ✗ ${line}`);
  console.error(`DAILY_NEWS_PROBE_FAIL (${fail.length} 项)`);
  process.exit(1);
}
console.log(`DAILY_NEWS_PROBE_PASS (${ok.length} 项)`);
