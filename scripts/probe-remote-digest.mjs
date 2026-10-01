// 远端只读：导出用户那次点击生成的摘要到 data/_diag_probe.md（data/ 不参与同步），
// 并统计 err.log 里 digest 富化失败的次数。
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.argv[2] || "E:\\SC\\文献推送");
const src = path.join(root, "data", "digests", "ieee-power-weekly-2026-09-14_to_2026-09-21.md");
const dst = path.join(root, "data", "_diag_probe.md");

const stat = fs.statSync(src);
console.log(`源文件 ${src}\n  ${stat.size}B  mtime=${stat.mtime.toISOString()}`);
fs.copyFileSync(src, dst);
console.log(`已复制到 ${dst}`);

const text = fs.readFileSync(src, "utf8");
const head = text.split("\n").slice(0, 10);
console.log("\n--- 前 10 行 ---");
console.log(head.join("\n"));

const count = Number((text.match(/- 文献数量：(\d+)/) || [])[1] || 0);
console.log(`\n文献数量 = ${count}`);
console.log(`章节数 "## N." = ${(text.match(/^## \d+\./gm) || []).length}`);
// 判断摘要是否已不被截断：出现 300 字上下 + 省略号则说明仍是旧逻辑
console.log(`出现省略号 ... 次数 = ${(text.match(/\.\.\./g) || []).length}`);

const errPath = path.join(root, "data", "service-runtime.err.log");
const errText = fs.readFileSync(errPath, "latin1");
const digestLines = (errText.match(/\[digest\]/g) || []).length;
console.log(`\nerr.log 中 [digest] 行数 = ${digestLines}`);
const ids = new Map();
for (const m of errText.matchAll(/\[digest\] metadata enrichment failed for #(\d+)/g)) {
  ids.set(m[1], (ids.get(m[1]) || 0) + 1);
}
const sorted = [...ids.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
console.log(`不同文章数 = ${ids.size}；最高频：${sorted.map(([id, n]) => `#${id}×${n}`).join(", ")}`);
