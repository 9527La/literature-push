#!/usr/bin/env node
/**
 * topic-queue.mjs —— 专题选题队列（DESIGN-WECHAT-TRANS-COLUMN.md v4 · 多选与排队）
 *
 * 场景：10:00 的选题单出 4 组，你可能想留两组。第一组当天做，其余入队，
 * 之后每天消费一条，避免"想要但忘了"或"重复推荐"。
 *
 * 状态流转：queued（排队）→ building（制作中）→ drafted（草稿已写）→ published（已发，人工回填）
 *
 * 用法：
 *   node scripts/topic-queue.mjs list
 *   node scripts/topic-queue.mjs add --from data/wechat-topics/2026-10-28.json --groups 2,4
 *   node scripts/topic-queue.mjs take                 # 取队首，标记 building，输出该条 JSON
 *   node scripts/topic-queue.mjs done --id <id> [--issue <期稿.json>]
 *   node scripts/topic-queue.mjs remove --id <id>
 *   node scripts/topic-queue.mjs purge                # 清掉 published
 *
 * 选题单 JSON 约定：
 *   { date, window:{days,total}, groups:[{ index, topic, directions:[], articleIds:[], why }] }
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const QUEUE = resolve(root, "data", "wechat-topics", "queue.json");
const RECOMMENDED = resolve(root, "data", "wechat-topics", "recommended.json");

function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return fallback; }
}

function writeJson(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 1)}\n`, "utf8");
}

const readQueue = () => readJson(QUEUE, { updatedAt: null, items: [] });
function writeQueue(q) {
  q.updatedAt = new Date().toISOString();
  writeJson(QUEUE, q);
}

function parseArgs(argv) {
  const a = { cmd: argv[2] || "list", from: "", groups: "", id: "", issue: "" };
  for (let i = 3; i < argv.length; i += 1) {
    if (argv[i] === "--from") a.from = resolve(process.cwd(), argv[i += 1]);
    else if (argv[i] === "--groups") a.groups = argv[i += 1];
    else if (argv[i] === "--id") a.id = argv[i += 1];
    else if (argv[i] === "--issue") a.issue = resolve(process.cwd(), argv[i += 1]);
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  return a;
}

function cmdList() {
  const q = readQueue();
  const live = q.items.filter((x) => x.status !== "published");
  if (!live.length) { console.log("队列为空"); return; }
  const byStatus = live.reduce((m, x) => ((m[x.status] = (m[x.status] || 0) + 1), m), {});
  console.log(`队列 ${live.length} 条（${Object.entries(byStatus).map(([k, v]) => `${k} ${v}`).join(" · ")}）`);
  for (const it of live) {
    console.log(`  [${it.status}] ${it.id}  ${it.topic}  · ${it.articleIds.length} 篇  · 入队 ${it.addedAt}`);
  }
}

function cmdAdd(a) {
  if (!a.from || !existsSync(a.from)) throw new Error("--from <选题单.json> 不存在");
  const issue = readJson(a.from, null);
  if (!issue?.groups?.length) throw new Error("选题单缺少 groups 数组");
  const wanted = a.groups
    ? a.groups.split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n))
    : issue.groups.map((g) => g.index);

  const q = readQueue();
  const rec = readJson(RECOMMENDED, {});
  let added = 0, skipped = 0;

  for (const g of issue.groups) {
    if (!wanted.includes(g.index)) continue;
    const id = `${issue.date}-g${g.index}`;
    if (q.items.some((x) => x.id === id)) { skipped += 1; continue; }
    q.items.push({
      id,
      sourceDate: issue.date,
      groupIndex: g.index,
      topic: g.topic,
      directions: g.directions || [],
      articleIds: g.articleIds || [],
      why: g.why || "",
      addedAt: new Date().toISOString().slice(0, 10),
      status: "queued",
      issuePath: null,
      draftMediaId: null
    });
    for (const aid of g.articleIds || []) {
      const key = String(aid);
      rec[key] = { ...(rec[key] || { count: 0 }), picked: true, pickedAt: issue.date };
    }
    added += 1;
  }

  writeQueue(q);
  writeJson(RECOMMENDED, rec);
  console.log(`入队 ${added} 条${skipped ? `，跳过已存在 ${skipped} 条` : ""}`);
  cmdList();
}

function cmdTake() {
  const q = readQueue();
  const next = q.items
    .filter((x) => x.status === "queued")
    .sort((x, y) => (x.addedAt === y.addedAt ? x.groupIndex - y.groupIndex : x.addedAt < y.addedAt ? -1 : 1))[0];
  if (!next) { console.log("队列里没有待做的选题"); return; }
  next.status = "building";
  next.startedAt = new Date().toISOString();
  writeQueue(q);
  console.log(JSON.stringify(next, null, 1));
}

function cmdDone(a) {
  if (!a.id) throw new Error("--done 需要 --id");
  const q = readQueue();
  const it = q.items.find((x) => x.id === a.id);
  if (!it) throw new Error(`队列里没有 ${a.id}`);
  it.status = "drafted";
  it.draftedAt = new Date().toISOString();
  if (a.issue) it.issuePath = a.issue.replace(root + "\\", "").replace(root + "/", "");
  writeQueue(q);
  console.log(`✓ ${it.id} → drafted${it.issuePath ? `（${it.issuePath}）` : ""}`);
}

function cmdRemove(a) {
  if (!a.id) throw new Error("--remove 需要 --id");
  const q = readQueue();
  const before = q.items.length;
  q.items = q.items.filter((x) => x.id !== a.id);
  writeQueue(q);
  console.log(before === q.items.length ? `未找到 ${a.id}` : `已移除 ${a.id}`);
}

function cmdPurge() {
  const q = readQueue();
  const before = q.items.length;
  q.items = q.items.filter((x) => x.status !== "published");
  writeQueue(q);
  console.log(`清理已发布 ${before - q.items.length} 条，剩余 ${q.items.length} 条`);
}

const a = parseArgs(process.argv);
switch (a.cmd) {
  case "list": cmdList(); break;
  case "add": cmdAdd(a); break;
  case "take": cmdTake(); break;
  case "done": cmdDone(a); break;
  case "remove": cmdRemove(a); break;
  case "purge": cmdPurge(); break;
  default:
    console.error(`未知命令 ${a.cmd}（可用：list / add / take / done / remove / purge）`);
    process.exit(2);
}
