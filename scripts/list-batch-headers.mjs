#!/usr/bin/env node
/** 打印 data 下所有 report-batch-*.json 的导出头（apply 校验需要逐字一致的 exportedAt）。 */
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = join(root, "data");
for (const name of readdirSync(dataDir).filter((n) => n.startsWith("report-batch-") && n.endsWith(".json")).sort()) {
  try {
    const batch = JSON.parse(readFileSync(join(dataDir, name), "utf8"));
    console.log([name, batch.exportedAt, batch.kind, batch.periodStart, batch.periodEnd, batch.direction ?? "-", batch.articles?.length ?? "?"].join("|"));
  } catch (error) {
    console.log(`${name}|ERROR|${error.message}`);
  }
}
