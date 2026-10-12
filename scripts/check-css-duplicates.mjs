/**
 * S2：CSS 分区重复选择器校验（ informational，不门禁 ）。
 *
 * P6 把 6408 行单文件拆成 12 个 partial 后，「同一选择器在同一文件里出现
 * 多次」基本可以判定为意外重复（跨文件的重复是历史级叠的既定事实，由
 * import 顺序裁决）。本脚本按文件分组报告重复选择器，供清理时参考。
 *
 * 用法：node scripts/check-css-duplicates.mjs
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const STYLES_DIR = join(ROOT, "src", "styles");

function extractSelectors(css) {
  // 去掉注释后按规则块切，取块首的选择器部分（{ 之前）
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const selectors = [];
  const re = /([^{}]+)\{/g;
  let match;
  while ((match = re.exec(noComments))) {
    const head = match[1].trim();
    if (!head || head.startsWith("@")) {
      // @media / @keyframes 等：取其内部（简单展开一层）
      if (/^@(media|supports)/.test(head)) continue;
      continue;
    }
    for (const part of head.split(",")) {
      const selector = part.trim().replace(/\s+/g, " ");
      if (selector) selectors.push(selector);
    }
  }
  return selectors;
}

function main() {
  const files = readdirSync(STYLES_DIR).filter((name) => name.endsWith(".css")).sort();
  let totalDupes = 0;
  for (const name of files) {
    const css = readFileSync(join(STYLES_DIR, name), "utf8");
    const counts = new Map();
    for (const selector of extractSelectors(css)) {
      counts.set(selector, (counts.get(selector) || 0) + 1);
    }
    const dupes = [...counts.entries()].filter(([, count]) => count > 1).sort((a, b) => b[1] - a[1]);
    if (dupes.length) {
      totalDupes += dupes.length;
      console.log(`\n${name} — ${dupes.length} 个重复选择器:`);
      for (const [selector, count] of dupes.slice(0, 12)) {
        console.log(`  ${count}×  ${selector.slice(0, 96)}`);
      }
      if (dupes.length > 12) console.log(`  …另有 ${dupes.length - 12} 个`);
    }
  }
  console.log(`\n合计 ${totalDupes} 个文件内重复选择器（跨文件级联不计）。`);
}

main();
