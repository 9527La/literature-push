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

const KEEP_TESTS = [
  (cp) => cp >= 0x20 && cp <= 0x7e,      // 拉丁基本（英文标题/UI）
  (cp) => cp >= 0xa0 && cp <= 0x24f,     // 拉丁扩展补充
  (cp) => cp >= 0x2000 && cp <= 0x206f,  // 通用标点
  (cp) => cp >= 0x3000 && cp <= 0x303f,  // CJK 符号与标点
  (cp) => cp >= 0x4e00 && cp <= 0x9fff,  // CJK 统一表意文字（中文标题主体）
  (cp) => cp >= 0xff00 && cp <= 0xffef   // 全角形式（中文标点）
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

function isSafeRange([start, end]) {
  const mid = Math.floor((start + end) / 2);
  return KEEP_TESTS.some((test) => test(start) && test(mid) && test(end));
}

function main() {
  const deleteFiles = process.argv.includes("--delete-files");
  const css = readFileSync(CSS_PATH, "utf8");
  const faces = css.match(/@font-face\{[^}]+\}/g) || [];
  if (!faces.length) throw new Error("fonts.css 里没有 @font-face 规则");

  const kept = [];
  const dropped = [];
  for (const face of faces) {
    const rangeText = (face.match(/unicode-range:([^;]+);/) || [])[1] || "";
    const ranges = parseRanges(rangeText);
    const safe = ranges.length > 0 && ranges.every(isSafeRange);
    (safe ? kept : dropped).push(face);
  }

  const header = [
    "/* 由 scripts/fetch-fonts.mjs 生成，请勿手工编辑。",
    "   P7（2026-10-12）：经 scripts/trim-fonts.mjs 按本站实际字码裁剪——",
    "   保留拉丁/CJK 标点/CJK 统一表意/全角，丢弃 emoji、韩文、私用区等",
    `   ${faces.length} → ${kept.length} 条。重新执行 fetch-fonts.mjs 后需再跑一次 trim-fonts.mjs。 */`,
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
