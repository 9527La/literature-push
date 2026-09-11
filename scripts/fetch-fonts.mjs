/**
 * 下载并自托管标题字体（Noto Serif SC 700）。
 *
 * 标题字体在 Windows 上原本会回退到点阵宋体（SimSun），19px 下笔画发虚。
 * 这里把 Google Fonts 的 CJK 分片（unicode-range 切片）落地到
 * `public/fonts/noto-serif-sc/`，并生成 `src/fonts.css`。
 * 浏览器只会下载"当前页面真正用到字符"所在的分片，通常 5–10 个、合计 100 KB 上下。
 *
 * 用法：node scripts/fetch-fonts.mjs
 */
import { mkdir, writeFile, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FONT_DIR = resolve(ROOT, "public/fonts/noto-serif-sc");
const PUBLIC_PREFIX = "/fonts/noto-serif-sc";
const CSS_PATH = resolve(ROOT, "src/fonts.css");

const CSS_URL = "https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@700&display=swap";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

async function main() {
  const css = await (await fetch(CSS_URL, { headers: { "user-agent": UA } })).text();
  const blocks = css.match(/@font-face\s*\{[^}]*\}/g) || [];
  if (!blocks.length) throw new Error("未从 Google Fonts 取到 @font-face 规则");

  await rm(FONT_DIR, { recursive: true, force: true });
  await mkdir(FONT_DIR, { recursive: true });

  const out = [];
  let index = 0;
  for (const block of blocks) {
    const url = block.match(/url\((https:[^)]+\.woff2)\)/)?.[1];
    const range = block.match(/unicode-range:\s*([^;]+);/)?.[1];
    if (!url) continue;
    index += 1;
    const name = `${String(index).padStart(3, "0")}.woff2`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`分片下载失败 ${name}: ${response.status}`);
    await writeFile(resolve(FONT_DIR, name), Buffer.from(await response.arrayBuffer()));
    out.push(
      "@font-face{font-family:'Noto Serif SC';font-style:normal;font-weight:700;"
      + `font-display:swap;src:url(${PUBLIC_PREFIX}/${name}) format('woff2');`
      + `unicode-range:${range};}`
    );
  }

  await writeFile(CSS_PATH, `/* 由 scripts/fetch-fonts.mjs 生成，请勿手工编辑。*/\n${out.join("\n")}\n`, "utf8");
  console.log(`已落地 ${out.length} 个分片 → ${FONT_DIR}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
