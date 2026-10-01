/**
 * 研究速览前端预览用的隔离数据种子（仅写入 _reports-preview/ 下的副本库，绝不动 data/）。
 * 为什么需要：本地 data/literature.sqlite 既没有 ai_reports 也没有 research_direction
 * （方向分类结果只在远端库），所以本地直接把「研究速览」页面打开是空的，没法截图验收 UI。
 *
 * 用法:
 *   node scripts/preview-seed-reports.mjs                       # 生成/刷新预览库
 *   PORT=4188 LITERATURE_DATA_DIR=<项目根>/_reports-preview node server/index.js
 * 然后跑 scripts/snapshot-reports-chips.mjs http://127.0.0.1:4188 截图。
 *
 * ⚠️ 两处坑：
 *   1) 副本库必须写 status='ready'——listAiReports 只认 ready，写 'ok' 会静默返回空数组。
 *   2) 重新生成前要先 taskkill 掉占用该文件的预览服务（Windows 上被占用的文件 rmSync 会失败）。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const dest = path.join(root, "_reports-preview", "literature.sqlite");
const src = path.join(root, "data", "literature.sqlite");

fs.mkdirSync(path.dirname(dest), { recursive: true });
if (fs.existsSync(dest)) fs.rmSync(dest, { force: true });

const from = new DatabaseSync(src);
from.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
from.close();

const db = new DatabaseSync(dest);

const DIRS = [
  { key: "distributed-gen", label: "分布式电源与并网", clusters: ["构网型变流器控制", "高渗透率光伏并网稳定性"] },
  { key: "stability", label: "电力系统稳定性", clusters: ["弱惯量系统频率稳定", "小干扰稳定与阻尼"] },
  { key: "microgrid", label: "微电网与虚拟电厂", clusters: ["微网能量管理", "虚拟电厂聚合调控"] },
  { key: "storage", label: "储能系统", clusters: ["储能容量配置", "构网储能与构网型支撑"] },
  { key: "market", label: "电力市场与机制", clusters: ["现货市场出清", "辅助服务定价"] },
  { key: "forecasting", label: "预测与数据驱动", clusters: ["风光功率预测", "负荷预测与深度学习"] }
];

const WEEK = { start: "2026-09-21", end: "2026-09-27" };
const MONTH = { start: "2026-09-01", end: "2026-09-30" };

const OBJ = ["园区级光伏聚合系统", "含构网变流器的孤岛微网", "高比例风电送端电网", "共享储能电站", "现货市场下的虚拟电厂", "台风频发地区的配电线路"];
const METH = ["提出基于下垂-虚拟同步协同阻尼的控制律并用 PSCAD 电磁暂态仿真验证", "构建双层鲁棒优化模型，用列约束生成算法求解并做 8760 小时时序仿真", "采用 CNN-LSTM 混合网络结合注意力机制做多步预测", "建立马尔可夫决策过程并用深度确定性策略梯度求解"];
const FIND = ["在弱电网条件下频率最低点抬升 0.12 Hz，惯量支撑响应时间缩短至 40 ms 以内，验证了协同阻尼的有效性", "相较基准模型日运行成本下降 6.8%，弃光率由 4.1% 降至 1.7%", "日前预测 MAPE 由 8.9% 降到 6.2%，极端天气日仍有 7% 以内的精度", "聚合调控可在不新增输电投资的前提下提升可调容量 18%，同时满足配变容量约束"];

function briefs(ids, offset = 0) {
  return ids.map((id, index) => ({
    id,
    object: OBJ[(index + offset) % OBJ.length].slice(0, 30),
    method: METH[(index + offset) % METH.length].slice(0, 40),
    finding: FIND[(index + offset) % FIND.length].slice(0, 50),
    topic: DIRS[(index + offset) % DIRS.length].clusters[0].slice(0, 12)
  }));
}

/** 从本地库挑文献并把方向/日期改写成可预览的样本（仅副本库）。 */
const pool = db.prepare(
  `SELECT id, journal, COALESCE(title,'') title FROM articles
   WHERE journal IS NOT NULL AND IFNULL(title,'') <> ''
   ORDER BY id DESC LIMIT 120`
).all();

const buckets = new Map(DIRS.map((d) => [d.key, []]));
pool.forEach((row, index) => {
  const dir = DIRS[index % DIRS.length];
  if (buckets.get(dir.key).length >= 20) return;
  buckets.get(dir.key).push(row);
});

const upd = db.prepare("UPDATE articles SET research_direction = ?, first_public_at = ?, first_public_source = 'preview_seed' WHERE id = ?");
const days = ["2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25", "2026-09-26"];
for (const dir of DIRS) {
  buckets.get(dir.key).forEach((row, index) => {
    upd.run(dir.key, `${days[index % days.length]} 09:${String(10 + (index % 40)).padStart(2, "0")}:00`, row.id);
  });
}

/** 生成方向专报正文（v2 契约：主题聚类速评 + 论文速评 + 值得精读）。 */
function directionMd(dir, rows) {
  const cut = Math.ceil(rows.length / 2);
  const c1 = rows.slice(0, cut);
  const c2 = rows.slice(cut);
  const line = (row, index) => {
    const b = briefs([row.id], index)[0];
    return `- [${row.id}] **${row.title.slice(0, 46)}**（${row.journal}）｜对象：${b.object}｜方法：${b.method}｜结论：${b.finding}`;
  };
  const out = [];
  out.push(`本期「${dir.label}」方向共收录 ${rows.length} 篇文献，整体围绕${dir.clusters.join("与")}两条主线展开。`);
  out.push("");
  out.push("## 主题聚类速评");
  out.push("");
  out.push(`### ${dir.clusters[0]}`);
  out.push("");
  c1.forEach((row, i) => out.push(line(row, i)));
  out.push("");
  out.push(`### ${dir.clusters[1]}`);
  out.push("");
  c2.forEach((row, i) => out.push(line(row, i + cut)));
  out.push("");
  out.push("## 论文速评");
  out.push("");
  rows.slice(0, 6).forEach((row, i) => out.push(line(row, i)));
  out.push("");
  out.push("## 值得精读");
  out.push("");
  rows.slice(0, 3).forEach((row, i) => out.push(line(row, i)));
  return out.join("\n");
}

const insert = db.prepare(
  `INSERT OR REPLACE INTO ai_reports (kind, period_start, period_end, direction, status, content_md, stats_json, generated_at, generator)
   VALUES (?, ?, ?, ?, 'ready', ?, ?, datetime('now'), 'preview-seed')`
);

function writeReports(kind, period, dirs, total, prevTotal) {
  const counts = Object.fromEntries(dirs.map((d) => [d.key, buckets.get(d.key).length]));
  const allDeltas = Object.fromEntries(dirs.map((d, i) => [d.key, (i % 3) - 1]));
  const highlightIds = dirs.flatMap((d) => buckets.get(d.key).slice(0, 1).map((r) => r.id));
  const highlightBriefs = briefs(highlightIds);

  // 总览
  const overviewMd = [
    `${period.start} ~ ${period.end} 共收录 ${total} 篇电力能源领域文献，覆盖 ${dirs.length} 个研究方向，其中 ${highlightIds.length} 篇值得重点阅读。`,
    "",
    "## 本周值得注意",
    "",
    ...highlightIds.map((id, i) => `- [${id}] **重点文献 ${i + 1}**（${dirs[i % dirs.length].label}）`),
    "",
    "## 高频关键词",
    "",
    "构网型变流器、惯量支撑、虚拟同步机、共享储能、现货市场出清、功率预测、弱电网、配电网韧性",
    "",
    "## 主题脉络",
    "",
    "本周文献呈现出「高比例新能源接入 → 系统惯量下降 → 构网型控制与储能协同支撑」的清晰主线。"
      + "在运行层面，多篇工作把预测误差纳入鲁棒优化框架；在市场层面，现货出清与辅助服务定价开始与惯量支撑耦合建模。"
  ].join("\n");
  insert.run(kind, period.start, period.end, null, overviewMd, JSON.stringify({
    total,
    previous: { total: prevTotal },
    directionCounts: counts,
    directionDelta: allDeltas,
    highlightIds,
    unclassified: 12,
    paperBriefs: highlightBriefs
  }));

  // 各方向专报
  for (const dir of dirs) {
    const rows = buckets.get(dir.key);
    if (!rows.length) continue;
    const ids = rows.map((r) => r.id);
    insert.run(kind, period.start, period.end, dir.key, directionMd(dir, rows), JSON.stringify({
      total: rows.length,
      directionCounts: { [dir.key]: rows.length },
      directionDelta: { [dir.key]: allDeltas[dir.key] },
      highlightIds: ids.slice(0, 3),
      paperBriefs: briefs(ids)
    }));
  }
}

writeReports("weekly", WEEK, DIRS, 128, 141);
writeReports("monthly", MONTH, DIRS.slice(0, 5), 486, 452);

const total = db.prepare("SELECT COUNT(*) c FROM ai_reports").get().c;
const sample = db.prepare("SELECT kind, period_start, direction, length(content_md) n FROM ai_reports ORDER BY direction").all();
console.log(`SEED_OK ai_reports=${total}`);
for (const row of sample) console.log(`  ${row.kind} ${row.period_start} ${row.direction || "(overview)"} content=${row.n}`);
db.close();
