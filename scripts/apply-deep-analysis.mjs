#!/usr/bin/env node
/**
 * apply-deep-analysis.mjs —— 把「全文深度分析（核心创新点）」写回 articles 表（2026-10-17）。
 *
 * 背景：daily-digest 作业（RUNBOOK §8.6 步骤 2.5）会下载当日文献全文并据此写速评，
 * 但速评只进 ai_reports.paperBriefs —— 详情页/卡片阅读的「核心创新点」区块读的是
 * articles.deep_analysis + articles.figure_path，两者是**两条独立的写库路径**。
 * 本脚本负责第二条路径：把分析结果 JSON 与配图落库。
 *
 * 用法：
 *   node scripts/apply-deep-analysis.mjs --in data\deep-analysis-inbox.json [--figdir data\deep-analysis-figs]
 *
 * 输入 JSON 结构（数组）：
 *   [
 *     {
 *       "id": 138789,                  // 必填，必须是 articles 里已存在的 id
 *       "figure": "138789.png",        // 可选，配图文件名（相对 --figdir）；无图留空或省略
 *       "pages": 17,                   // 可选，PDF 页数（写入 provenance）
 *       "chars": 86243,                // 可选，全文字符数（写入 provenance）
 *       "innovations": [               // 必填、非空
 *         { "title": "…", "points": ["…", "…"], "value": "…" }
 *       ],
 *       "method": { "object": "", "theory": "", "control": "", "validation": "" }  // 可选
 *     }
 *   ]
 *
 * 输出（stdout JSON）：{ updated, invalid, skipped, errors: [] }
 * 退出码：0 = 全部成功或仅跳过；1 = 存在 invalid 条目。
 */
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const args = { db: path.join(root, "data", "literature.sqlite"), inbox: "", figdir: path.join(root, "data", "deep-analysis-figs") };
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    const next = argv[i + 1];
    if (key === "--in" || key === "--inbox") { args.inbox = next; i += 1; }
    else if (key === "--figdir") { args.figdir = next; i += 1; }
    else if (key === "--db") { args.db = next; i += 1; }
  }
  if (!args.inbox) {
    console.error("用法: node scripts/apply-deep-analysis.mjs --in <分析结果.json> [--figdir <配图目录>]");
    process.exit(2);
  }
  return args;
}

/** 逐条校验；返回 { ok, value } 或 { ok:false, error } */
function validate(item, index) {
  if (!item || typeof item !== "object") return { ok: false, error: `#${index}: 不是对象` };
  const id = Number(item.id);
  if (!Number.isFinite(id) || id <= 0) return { ok: false, error: `#${index}: id 非法（${item.id}）` };

  const innovations = Array.isArray(item.innovations) ? item.innovations : item.deep_analysis?.innovations;
  if (!Array.isArray(innovations) || innovations.length === 0) {
    return { ok: false, error: `id ${id}: innovations 缺失或为空（至少 1 条）` };
  }
  for (const [i, inn] of innovations.entries()) {
    if (!inn || typeof inn.title !== "string" || !inn.title.trim()) {
      return { ok: false, error: `id ${id}: innovations[${i}].title 缺失` };
    }
    if (inn.points !== undefined && !Array.isArray(inn.points)) {
      return { ok: false, error: `id ${id}: innovations[${i}].points 必须是数组` };
    }
  }

  // 组装最终落库结构：provenance 由脚本统一补全，避免各作业写法不一
  const deep = {
    innovations: innovations.map((inn) => ({
      title: String(inn.title).trim(),
      points: Array.isArray(inn.points) ? inn.points.map((p) => String(p)) : [],
      ...(inn.value ? { value: String(inn.value) } : {})
    })),
    ...(item.method ? { method: item.method } : {}),
    provenance: {
      pages: Number(item.pages) || 0,
      chars: Number(item.chars) || 0,
      truncated: Boolean(item.truncated)
    }
  };

  return { ok: true, value: { id, figure: item.figure ? String(item.figure) : "", deep } };
}

function main() {
  const args = parseArgs(process.argv);
  if (!fs.existsSync(args.inbox)) {
    console.error(`找不到分析结果文件: ${args.inbox}`);
    process.exit(2);
  }
  const items = JSON.parse(fs.readFileSync(args.inbox, "utf8"));
  if (!Array.isArray(items)) {
    console.error("分析结果必须是数组");
    process.exit(2);
  }

  const db = new DatabaseSync(args.db);
  const figureDir = path.join(root, "data", "figures");
  fs.mkdirSync(figureDir, { recursive: true });

  const errors = [];
  let updated = 0;
  let skipped = 0;

  const exists = db.prepare("SELECT 1 FROM articles WHERE id = ?");
  const update = db.prepare("UPDATE articles SET deep_analysis = ?, figure_path = ? WHERE id = ?");

  for (const [index, item] of items.entries()) {
    const checked = validate(item, index);
    if (!checked.ok) { errors.push(checked.error); continue; }
    const { id, figure, deep } = checked.value;

    if (!exists.get(id)) { errors.push(`id ${id}: articles 中不存在该文献`); continue; }

    // 配图：从 figdir 复制到 data/figures/<id>.png
    let figurePath = null;
    if (figure) {
      const src = path.join(args.figdir, figure);
      if (!fs.existsSync(src)) {
        // 配图缺失不阻塞分析落库——标注后继续
        errors.push(`id ${id}: 配图缺失（${src}），已跳过配图`);
      } else {
        const destName = `${id}${path.extname(figure) || ".png"}`;
        fs.copyFileSync(src, path.join(figureDir, destName));
        figurePath = `figures/${destName}`;
      }
    }

    const r = update.run(JSON.stringify(deep), figurePath, id);
    if (Number(r.changes) > 0) updated += 1;
    else skipped += 1;
  }

  const fatal = errors.filter((e) => !e.includes("已跳过配图"));
  console.log(JSON.stringify({ updated, invalid: fatal.length, skipped, errors }, null, 1));
  process.exit(fatal.length ? 1 : 0);
}

main();
