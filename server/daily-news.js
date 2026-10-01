import fs from "node:fs";
import path from "node:path";

// 每日资讯（PLAN-DAILY-NEWS.md）：文件式存储，零 DB 迁移。
// 数据源 data/daily-news/YYYY-MM-DD.md，由 WorkBuddy 定时任务生成并上传；
// 服务端纯读，目录不存在或为空一律返回空列表而不是报错。

const DAILY_NEWS_FILE_RE = /^(\d{4}-\d{2}-\d{2})\.md$/;
const DAILY_NEWS_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export class DailyNewsError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.name = "DailyNewsError";
    this.statusCode = statusCode;
  }
}

export function resolveDailyNewsDirectory(dataDir) {
  return path.join(dataDir, "daily-news");
}

// 解析单篇资讯的元信息：
//   - title  = 首个 `# ` 一级标题（缺失回退 null，由调用方用日期兜底）
//   - groups = 「## 概览」区块内各 `### 板块` 的 `- ` 条目计数
//   - total  = 全文 `#N` 锚点的去重个数（概览与详情重复标注同一 N，取 Set）
export function parseDailyNewsMeta(markdown) {
  const meta = { title: null, groups: [], total: 0 };
  if (typeof markdown !== "string" || markdown.length === 0) return meta;

  const lines = markdown.split("\n");
  for (const line of lines) {
    const titleMatch = /^# (.+?)\s*$/.exec(line);
    if (titleMatch) {
      meta.title = titleMatch[1];
      break;
    }
  }

  const anchors = new Set();
  let inOverview = false;
  let currentGroup = null;
  for (const line of lines) {
    if (/^## 概览\s*$/.test(line)) {
      inOverview = true;
      continue;
    }
    if (inOverview && /^## /.test(line) && !/^## 概览\s*$/.test(line)) {
      inOverview = false; // 概览区块结束，后续是详情条目
    }
    const anchorMatches = [...line.matchAll(/`#(\d+)`/g)];
    for (const match of anchorMatches) anchors.add(Number(match[1]));

    if (!inOverview) continue;
    const groupMatch = /^### (.+?)\s*$/.exec(line);
    if (groupMatch) {
      currentGroup = { name: groupMatch[1], count: 0 };
      meta.groups.push(currentGroup);
      continue;
    }
    if (currentGroup && /^- /.test(line)) currentGroup.count += 1;
  }

  meta.total = anchors.size;
  return meta;
}

export function listDailyNews(dataDir) {
  const dir = resolveDailyNewsDirectory(dataDir);
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return { items: [], total: 0 };
  }
  const items = [];
  for (const name of entries) {
    const match = DAILY_NEWS_FILE_RE.exec(name);
    if (!match) continue; // 文件名白名单：非 YYYY-MM-DD.md 一律忽略
    const date = match[1];
    let markdown;
    try {
      const stat = fs.statSync(path.join(dir, name));
      if (!stat.isFile()) continue;
      markdown = fs.readFileSync(path.join(dir, name), "utf8");
    } catch {
      continue; // 单个文件读失败不影响整体列表
    }
    items.push({ date, ...parseDailyNewsMeta(markdown) });
  }
  items.sort((a, b) => b.date.localeCompare(a.date));
  return { items, total: items.length };
}

export function getDailyNews(dataDir, date) {
  if (!DAILY_NEWS_DATE_RE.test(String(date || ""))) {
    throw new DailyNewsError(400, "date must be YYYY-MM-DD");
  }
  const dir = resolveDailyNewsDirectory(dataDir);
  const filePath = path.join(dir, `${date}.md`);
  // 双保险：date 已通过严格校验，这里仍确保解析结果没有跳出目录（防未来改动引入穿越）。
  if (path.dirname(filePath) !== path.resolve(dir)) {
    throw new DailyNewsError(400, "date must be YYYY-MM-DD");
  }
  let markdown;
  try {
    markdown = fs.readFileSync(filePath, "utf8");
  } catch {
    throw new DailyNewsError(404, `no daily news for ${date}`);
  }
  return { date, ...parseDailyNewsMeta(markdown), markdown };
}
