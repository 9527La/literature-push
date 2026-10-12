/**
 * P7 回归护栏：标题字体（Noto Serif SC）分片覆盖率校验（node:test，纳入 npm test）。
 *
 * 背景事故（2026-10-12）：scripts/trim-fonts.mjs 早期版本用
 * `ranges.every(isSafeRange)` 判定分片去留——只要分片里夹带一个越界码位
 * （Google 的 CJK 分片常与私用区图标/emoji 同片），整片就被丢弃，导致
 * 电/前/沿/方/分/类/点/开/收/看/全/部/出/文 等高频汉字回退到系统宋体，
 * 同一个词里两种字形混排，肉眼一眼可见。
 *
 * 本测试把「一次性修复」变成「持续达标」，断言：
 *   1. fonts.css 里每条 unicode-range 都能解析，且引用的 woff2 真实存在；
 *   2. 六个保留区（拉丁/CJK 标点/统一表意/全角…）的覆盖码位数不低于基线；
 *   3. src/ 内出现的中文文案字符 100% 被覆盖（UI 文案不得回退系统字体）；
 *   4. 事故字符清单逐个覆盖（防止再次整片丢弃）。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FONTS_CSS = join(ROOT, "src", "fonts.css");
const FONT_DIR = join(ROOT, "public", "fonts", "noto-serif-sc");

/* 与 trim-fonts.mjs 保持一致的保留区定义。 */
const KEEP_ZONES = [
  [0x20, 0x7e],
  [0xa0, 0x24f],
  [0x2000, 0x206f],
  [0x3000, 0x303f],
  [0x4e00, 0x9fff],
  [0xff00, 0xffef]
];

/* 基线：2026-10-12 修复后实测覆盖码位数（保留区内）。只允许 ≥，不允许缩水。 */
const COVERAGE_BASELINE = 13078;

/* 事故字符清单：电工文献标题与界面的高频字，必须逐个覆盖。 */
const REGRESSION_CHARS = "电气前沿速递方向分组浏览每周每种研究分类归组点击头展开收起查看全部出文献";

const css = readFileSync(FONTS_CSS, "utf8");
const faces = css.match(/@font-face\{[^}]+\}/g) || [];

function parseRanges(text) {
  return String(text)
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token) => {
      const m = token.match(/^U\+([0-9A-Fa-f]+)(?:-([0-9A-Fa-f]+))?$/);
      if (!m) return null;
      const start = parseInt(m[1], 16);
      const end = m[2] ? parseInt(m[2], 16) : start;
      return [start, end];
    })
    .filter(Boolean);
}

function mergeRanges(ranges) {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1] + 1) last[1] = Math.max(last[1], range[1]);
    else merged.push([...range]);
  }
  return merged;
}

const faceRanges = faces.map((face) => parseRanges((face.match(/unicode-range:([^;]+);/) || [])[1] || ""));
const mergedRanges = mergeRanges(faceRanges.flat());

function isCovered(codePoint) {
  let lo = 0;
  let hi = mergedRanges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const [start, end] = mergedRanges[mid];
    if (codePoint < start) hi = mid - 1;
    else if (codePoint > end) lo = mid + 1;
    else return true;
  }
  return false;
}

test("fonts.css 的 @font-face 均可解析且带 unicode-range", () => {
  assert.ok(faces.length > 0, "fonts.css 里没有 @font-face 规则");
  for (const [index, ranges] of faceRanges.entries()) {
    assert.ok(ranges.length > 0, `第 ${index + 1} 条 @font-face 的 unicode-range 解析失败`);
  }
});

test("fonts.css 引用的 woff2 全部存在于 public/fonts/noto-serif-sc", () => {
  const referenced = [...css.matchAll(/url\(\/fonts\/noto-serif-sc\/([^)]+)\)/g)].map((m) => m[1]);
  assert.equal(referenced.length, faces.length, "url 数量与 @font-face 数量不一致");
  const onDisk = new Set(readdirSync(FONT_DIR));
  const dangling = referenced.filter((name) => !onDisk.has(name));
  assert.deepEqual(dangling, [], `以下分片被引用但文件缺失：${dangling.join(", ")}`);
});

test("保留区覆盖码位数不低于基线（防止整片丢弃）", () => {
  let covered = 0;
  for (const [zoneStart, zoneEnd] of KEEP_ZONES) {
    for (const [start, end] of mergedRanges) {
      const s = Math.max(start, zoneStart);
      const e = Math.min(end, zoneEnd);
      if (s <= e) covered += e - s + 1;
    }
  }
  assert.ok(
    covered >= COVERAGE_BASELINE,
    `保留区覆盖 ${covered} 个码位，低于基线 ${COVERAGE_BASELINE}——疑似分片被整片丢弃`
  );
});

test("事故字符清单逐个被覆盖（不得再回退系统宋体）", () => {
  const missing = [...REGRESSION_CHARS].filter((char) => !isCovered(char.codePointAt(0)));
  assert.deepEqual(missing, [], `以下高频汉字未被字体分片覆盖：${missing.join("")}`);
});

test("src/ 内出现的中文文案字符全部被覆盖", () => {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!/node_modules|\.git|dist/.test(full)) walk(full);
      } else if (/\.(jsx?|css)$/.test(entry.name)) {
        files.push(full);
      }
    }
  };
  walk(join(ROOT, "src"));

  const missing = new Set();
  for (const file of files) {
    for (const char of readFileSync(file, "utf8")) {
      const cp = char.codePointAt(0);
      if (cp >= 0x4e00 && cp <= 0x9fff && !isCovered(cp)) missing.add(char);
    }
  }
  assert.deepEqual([...missing], [], `源码文案中以下汉字无字体分片：${[...missing].join("")}`);
});
