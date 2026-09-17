import test from "node:test";
import assert from "node:assert/strict";
import {
  extractAuthorKeywords,
  extractIndexTerms,
  extractMetaContent,
  extractMetaContentAll,
  parseHtmlMetadata,
  parseIeeeMetadata
} from "./html-metadata.js";

// IEEE Xplore 真实结构：三类关键词混在一个数组里。
const IEEE_KEYWORDS = [
  { type: "IEEE Keywords", kwd: ["Filtering", "Filters", "Electronic mail", "TV"] },
  { type: "Index Terms", kwd: ["Energy Consumption", "Spatial Patterns", "Anomaly Detection", "Peak Load"] },
  { type: "Author Keywords", kwd: ["Anomaly detection", "temporal fusion transformer (TFT)"] }
];

test("作者关键词优先于 IEEE 受控词表", () => {
  const value = extractIndexTerms(IEEE_KEYWORDS);
  assert.equal(value, "Anomaly detection; temporal fusion transformer (TFT)");
});

test("机器抽取的 Index Terms 一律丢弃", () => {
  const value = extractIndexTerms(IEEE_KEYWORDS);
  for (const term of ["Energy Consumption", "Spatial Patterns", "Peak Load", "Anomaly Detection"]) {
    assert.equal(value.includes(term), false, `不该出现 Index Term: ${term}`);
  }
});

test("没有作者关键词时才回退到 IEEE 受控词表", () => {
  const value = extractIndexTerms([{ type: "IEEE Keywords", kwd: ["Transient analysis", "Numerical stability"] }]);
  assert.equal(value, "Transient analysis; Numerical stability");
});

test("只有 Index Terms 时不产出关键词", () => {
  assert.equal(extractIndexTerms([{ type: "Index Terms", kwd: ["A", "B"] }]), "");
});

test("字符串数组视为作者关键词", () => {
  assert.equal(extractIndexTerms(["grid", "inverter"]), "grid; inverter");
});

test("对象形态（按类型分组）同样按优先级取", () => {
  const value = extractIndexTerms({
    "IEEE Keywords": ["Oscillators"],
    "Index Terms": ["Noise"],
    "Author Keywords": ["grid-forming"]
  });
  assert.equal(value, "grid-forming");
});

test("extractAuthorKeywords 宁缺勿滥：没有作者关键词就返回空", () => {
  assert.equal(extractAuthorKeywords([{ type: "IEEE Keywords", kwd: ["Oscillators"] }]), "");
  assert.equal(extractAuthorKeywords(IEEE_KEYWORDS), "Anomaly detection; temporal fusion transformer (TFT)");
});

test("重复词去重且保留顺序", () => {
  assert.equal(extractIndexTerms([{ type: "Author Keywords", kwd: ["grid", "Grid", "inverter"] }]), "grid; Grid; inverter");
});

test("空值安全", () => {
  assert.equal(extractIndexTerms(null), "");
  assert.equal(extractIndexTerms(undefined), "");
  assert.equal(extractIndexTerms([]), "");
});

test("parseIeeeMetadata 从 xplGlobal 里取出作者关键词与摘要", () => {
  const metadata = {
    title: "Reliable Transient Stability-Constrained Optimal Power Flow",
    abstract: "This paper proposes a reliable approach.",
    doi: "10.1109/TPWRS.2025.3649102",
    keywords: IEEE_KEYWORDS,
    authors: [{ name: "A. Author" }, { name: "B. Author" }]
  };
  const html = `<html><body><script>xplGlobal.document.metadata=${JSON.stringify(metadata)};</script></body></html>`;
  const parsed = parseIeeeMetadata(html);
  assert.equal(parsed.title, "Reliable Transient Stability-Constrained Optimal Power Flow");
  assert.equal(parsed.abstract, "This paper proposes a reliable approach.");
  assert.equal(parsed.keywords, "Anomaly detection; temporal fusion transformer (TFT)");
  assert.equal(parsed.authors, "A. Author, B. Author");
  assert.equal(parsed.doi, "10.1109/TPWRS.2025.3649102");
});

test("parseIeeeMetadata 遇到坏 JSON 不会抛异常", () => {
  const html = `<script>xplGlobal.document.metadata={oops;</script>`;
  assert.deepEqual(parseIeeeMetadata(html), {});
});

test("通用 meta 解析支持多个 citation_keywords", () => {
  const html = `<html><head>
    <meta name="citation_title" content="Grid Forming Control">
    <meta name="citation_abstract" content="An abstract here.">
    <meta name="citation_keywords" content="grid">
    <meta name="citation_keywords" content="inverter">
    <meta name="citation_doi" content="10.1000/example">
  </head></html>`;
  const parsed = parseHtmlMetadata(html);
  assert.equal(parsed.title, "Grid Forming Control");
  assert.equal(parsed.abstract, "An abstract here.");
  assert.equal(parsed.keywords, "grid; inverter");
  assert.equal(extractMetaContent(html, "citation_doi"), "10.1000/example");
  assert.deepEqual(extractMetaContentAll(html, "citation_keywords"), ["grid", "inverter"]);
});
