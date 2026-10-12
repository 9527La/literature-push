/**
 * P7：标题字体子集精确化（一次性脚本，可重复执行）。
 *
 * src/fonts.css 由 scripts/fetch-fonts.mjs 从 Google Fonts 全量生成（101 个
 * @font-face，覆盖 emoji / 韩文音节 / 私用区等本系统永远用不到的字码）。
 * 本脚本按「本站内容实际可能用到的字码」裁剪：
 *   · 保留：拉丁基本/扩展、通用标点、CJK 标点、CJK 统一表意（U+4E00-9FFF）、
 *     全角形式（FF00-FFEF）
 *   · 丢弃：emoji、区域指示符、韩文、私用区（PUA，图标字体遗留）、CJK 扩展
 * 效果：@font-face 101 → 71，fonts.css 体积约 −30%；同时不再触发 emoji/
 * 韩文分片的误下载。中文标题（任意 U+4E00-9FFF 汉字）与英文标题不受影响。
 *
 * 注意：重新执行 fetch-fonts.mjs 会再生出全量 101 条——之后需要再跑一次本
 * 脚本（或给 fetch-fonts.mjs 追加同样过滤）。对应未被引用的 woff2 分片可
 * 用 `--delete-files` 一并清理。
 *
 * 用法：node scripts/trim-fonts.mjs [--delete-files]
 */
import { existsSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CSS_PATH = join(ROOT, "src", "fonts.css");
const FONT_DIR = join(ROOT, "public", "fonts", "noto-serif-sc");
const PUBLIC_PREFIX = "/fonts/noto-serif-sc";

/* 安全字码区间（保留区）。注意：判定必须「按片段求交集」，不能因分片里
   夹带了少量越界码位（如私用区图标、emoji）就把整片丢掉——Google 的 CJK
   分片常常把常用汉字与个别图标码位放在同一片里，整片丢弃会导致
   电/前/沿/方/分/类… 这类高频字回退到系统宋体，同词内混排（P7 回归事故）。 */
const KEEP_ZONES = [
  [0x20, 0x7e],      // 拉丁基本（英文标题/UI）
  [0xa0, 0x24f],     // 拉丁扩展补充
  [0x2000, 0x206f],  // 通用标点
  [0x3000, 0x303f],  // CJK 符号与标点
  [0x4e00, 0x9fff],  // CJK 统一表意文字（中文标题主体）
  [0xff00, 0xffef]   // 全角形式（中文标点）
];

function parseRanges(str) {
  return String(str)
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token) => {
      const match = token.match(/^U\+([0-9A-Fa-f]+)(?:-([0-9A-Fa-f]+))?$/);
      if (!match) return null;
      const start = parseInt(match[1], 16);
      const end = match[2] ? parseInt(match[2], 16) : start;
      return [start, end];
    })
    .filter(Boolean);
}

/* 把某个 unicode-range 片段与保留区求交集，返回若干「安全片段」。 */
function intersectZones([start, end]) {
  const out = [];
  for (const [zoneStart, zoneEnd] of KEEP_ZONES) {
    const s = Math.max(start, zoneStart);
    const e = Math.min(end, zoneEnd);
    if (s <= e) out.push([s, e]);
  }
  return out;
}

function formatRanges(ranges) {
  return ranges
    .map(([a, b]) => (a === b
      ? `U+${a.toString(16).toUpperCase()}`
      : `U+${a.toString(16).toUpperCase()}-${b.toString(16).toUpperCase()}`))
    .join(", ");
}

/* 合并相邻/重叠片段，避免重写后出现碎片化区间（减少 CSS 体积）。 */
function mergeRanges(ranges) {
  const sorted = [...ranges].sort((x, y) => x[0] - y[0]);
  const merged = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1] + 1) last[1] = Math.max(last[1], range[1]);
    else merged.push([...range]);
  }
  return merged;
}

function main() {
  const deleteFiles = process.argv.includes("--delete-files");
  const css = readFileSync(CSS_PATH, "utf8");
  const faces = css.match(/@font-face\{[^}]+\}/g) || [];
  if (!faces.length) throw new Error("fonts.css 里没有 @font-face 规则");

  const kept = [];
  const dropped = [];
  let rewritten = 0;
  for (const face of faces) {
    const rangeText = (face.match(/unicode-range:([^;]+);/) || [])[1] || "";
    const ranges = parseRanges(rangeText);
    const safe = mergeRanges(ranges.flatMap(intersectZones));
    if (!safe.length) {
      dropped.push(face);
      continue;
    }
    // 有越界片段：仅重写 unicode-range（保留同一 woff2，不丢常用字）
    if (safe.length !== ranges.length) {
      rewritten += 1;
      kept.push(face.replace(/unicode-range:[^;]+;/, `unicode-range:${formatRanges(safe)};`));
    } else {
      kept.push(face);
    }
  }

  const header = [
    "/* 由 scripts/fetch-fonts.mjs 生成，请勿手工编辑。",
    "   P7（2026-10-12）：经 scripts/trim-fonts.mjs 按本站实际字码裁剪——",
    "   保留拉丁/CJK 标点/CJK 统一表意/全角，丢弃 emoji、韩文、私用区等；",
    "   含混合码位的分片只重写 unicode-range，不整片丢弃（避免高频汉字回退）。",
    `   ${faces.length} → ${kept.length} 条（其中 ${rewritten} 条重写 unicode-range）。`,
    "   重新执行 fetch-fonts.mjs 后需再跑一次 trim-fonts.mjs。 */",
    ""
  ].join("\n");
  writeFileSync(CSS_PATH, header + kept.join("\n") + "\n", "utf8");

  const referenced = new Set(
    kept.map((face) => (face.match(new RegExp(`url\\(${PUBLIC_PREFIX}/([^)]+)\\)`)) || [])[1]).filter(Boolean)
  );
  const allFiles = existsSync(FONT_DIR) ? readdirSync(FONT_DIR) : [];
  const orphan = allFiles.filter((name) => !referenced.has(name));

  console.log(`@font-face: ${faces.length} -> ${kept.length} (dropped ${dropped.length})`);
  console.log(`fonts.css: ${(css.length / 1024).toFixed(1)} KB -> ${(readFileSync(CSS_PATH, "utf8").length / 1024).toFixed(1)} KB`);
  console.log(`woff2 referenced: ${referenced.size}, orphan: ${orphan.length}`);

  if (orphan.length && deleteFiles) {
    let freed = 0;
    for (const name of orphan) {
      const path = join(FONT_DIR, name);
      freed += statSync(path).size;
      unlinkSync(path);
    }
    console.log(`deleted ${orphan.length} orphan woff2 files, freed ${(freed / 1024).toFixed(0)} KB`);
  } else if (orphan.length) {
    console.log("orphan woff2 kept (re-run with --delete-files to remove):", orphan.slice(0, 5).join(", "), orphan.length > 5 ? "…" : "");
  }
}

main();
