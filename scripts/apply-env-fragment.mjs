import fs from "node:fs";

/**
 * Merge KEY=VALUE lines from a fragment file into a .env file.
 *
 * The production .env lives only on the deployment host and is never synced, so
 * secrets have to be applied there by a command. Passing them inline would put
 * them in shell history and in the job log, so they travel as a file and this
 * script merges them.
 *
 * Output lists key names and value lengths only — never the values.
 *
 * Usage: node scripts/apply-env-fragment.mjs <fragment.env> [target.env]
 */
const [fragmentPath, targetPath = ".env"] = process.argv.slice(2);
if (!fragmentPath) {
  console.error("用法: node scripts/apply-env-fragment.mjs <片段文件> [目标 .env]");
  process.exit(2);
}

const KEY_LINE = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/;

const updates = new Map();
for (const line of fs.readFileSync(fragmentPath, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/)) {
  const match = line.match(KEY_LINE);
  if (match) updates.set(match[1], match[2].trim());
}
if (!updates.size) {
  console.error("片段中没有可用的 KEY=VALUE 行");
  process.exit(3);
}

const original = fs.readFileSync(targetPath, "utf8");
// Preserve the byte-order-mark state: rewriting a .env and silently dropping or
// adding a BOM changes whether the first key parses.
const hadBom = original.charCodeAt(0) === 0xfeff;
const lines = (hadBom ? original.slice(1) : original).split(/\r?\n/);

const applied = new Set();
const out = [];
for (const line of lines) {
  const match = line.match(KEY_LINE);
  if (match && updates.has(match[1])) {
    out.push(`${match[1]}=${updates.get(match[1])}`);
    applied.add(match[1]);
    continue;
  }
  out.push(line);
}
for (const [key, value] of updates) {
  if (!applied.has(key)) out.push(`${key}=${value}`);
}

fs.writeFileSync(targetPath, `${hadBom ? "\uFEFF" : ""}${out.join("\r\n")}`, "utf8");

const report = [...updates.keys()].map((key) => `${key}（长度 ${updates.get(key).length}）`);
console.log(`已写入 ${targetPath}：`);
console.log(report.map((line) => `  ${line}`).join("\n"));
console.log(applied.size === updates.size ? "全部为覆盖更新" : `新增 ${updates.size - applied.size} 个键`);
