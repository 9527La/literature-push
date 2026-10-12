/**
 * A1：设计令牌对比度校验（node:test，纳入 npm test）。
 *
 * 从 src/styles/00-tokens.css 的 :root 读取真实令牌值，按 WCAG 2.x 相对
 * 亮度公式计算，断言：
 *   · 正文三档文字色对白底 ≥ 4.5:1（AA 正文）
 *   · 15 个方向色上的白色 chip 文字 ≥ 4.5:1（12px 粗体不算大字号）
 *   · 期刊组 ink 对 soft 底 ≥ 4.5:1（关键词胶囊）
 * 新增配色若破线，此测试直接红——把「一次性修复」变成「持续达标」。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TOKENS_CSS = join(ROOT, "src", "styles", "00-tokens.css");
const TAIL_CSS = join(ROOT, "src", "styles", "99-tail.css");

function channel(value) {
  const v = value / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function luminance(hex) {
  const clean = String(hex).replace("#", "").trim();
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

function readTokens() {
  const css = readFileSync(TOKENS_CSS, "utf8");
  const tokens = {};
  const re = /(--[a-z0-9_-]+)\s*:\s*([^;]+);/gi;
  let match;
  while ((match = re.exec(css))) {
    tokens[match[1]] = match[2].trim();
  }
  return tokens;
}

const tokens = readTokens();
const WHITE = "#ffffff";

test("A1: 正文三档文字色对白底达 AA（≥4.5:1）", () => {
  for (const name of ["--text-primary", "--text-secondary", "--text-tertiary"]) {
    const value = tokens[name];
    assert.ok(value, `${name} 未在 :root 定义`);
    const ratio = contrast(value, WHITE);
    assert.ok(
      ratio >= 4.5,
      `${name} ${value} 对白底 ${ratio.toFixed(2)}:1，低于 AA 4.5:1`
    );
  }
});

test("A1: 15 个方向色上的白色 chip 文字达 AA（≥4.5:1）", () => {
  const dirTokens = Object.keys(tokens).filter((key) => key.startsWith("--dir-"));
  assert.equal(dirTokens.length, 15, `方向色应有 15 个，实际 ${dirTokens.length}`);
  for (const key of dirTokens) {
    const ratio = contrast(tokens[key], WHITE);
    assert.ok(
      ratio >= 4.5,
      `${key} ${tokens[key]} 白字 ${ratio.toFixed(2)}:1，低于 AA 4.5:1`
    );
  }
});

test("A1: 期刊组关键词胶囊 ink/soft 对比度达 AA（≥4.5:1）", () => {
  // tone 令牌定义在 99-tail.css 的 .tone-* 规则里（不在 :root），按组解析。
  const tail = readFileSync(TAIL_CSS, "utf8");
  const groups = ["ieee", "elsevier", "cn", "other"];
  for (const group of groups) {
    const block = tail.match(new RegExp(`\\.tone-${group}\\s*\\{[^}]+\\}`));
    assert.ok(block, `期刊组 ${group} 的 tone 规则未找到`);
    const ink = (block[0].match(/--tone-ink:\s*(#[0-9a-fA-F]{3,6})/) || [])[1];
    const soft = (block[0].match(/--tone-soft:\s*(#[0-9a-fA-F]{3,6})/) || [])[1];
    assert.ok(ink && soft, `期刊组 ${group} 缺少 ink/soft 令牌`);
    const ratio = contrast(ink, soft);
    assert.ok(
      ratio >= 4.5,
      `${group} ink ${ink} on soft ${soft} = ${ratio.toFixed(2)}:1，低于 AA 4.5:1`
    );
  }
});
