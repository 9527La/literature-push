import { test } from "node:test";
import assert from "node:assert/strict";
import { highlightParts } from "./highlight.js";

function marks(text, terms) {
  const parts = highlightParts(text, terms) || [];
  return parts.filter((part) => part.matched).map((part) => part.value);
}

function joined(text, terms) {
  const parts = highlightParts(text, terms) || [];
  return parts.map((part) => part.value).join("");
}

test("标记所有命中词，不受正则 lastIndex 状态影响", () => {
  const text = "grid operator, distribution grids, the grid, Grid-level";
  assert.equal(marks(text, ["grid"]).length, 4);
  assert.equal(joined(text, ["grid"]), text);
});

test("大小写变体全部命中", () => {
  const text = "Power flow and POWER FLOW in power systems";
  assert.equal(marks(text, ["power flow"]).length, 2);
  assert.equal(marks(text, ["POWER"]).length, 3);
});

test("中文关键词命中", () => {
  const text = "电网调度与电网安全";
  assert.deepEqual(marks(text, ["电网"]), ["电网", "电网"]);
});

test("正则元字符按字面量处理且不报错", () => {
  assert.deepEqual(marks("Cost is C++ based, see (a+b)", ["C++"]), ["C++"]);
  assert.deepEqual(marks("Cost is C++ based, see (a+b)", ["(a+b)"]), ["(a+b)"]);
});

test("无 term 或无命中时返回 null", () => {
  assert.equal(highlightParts("hello", []), null);
  assert.equal(highlightParts("hello", ["world"]), null);
  assert.equal(highlightParts("", ["a"]), null);
  assert.equal(highlightParts(null, ["a"]), null);
});

test("已被转义中间结果的命中片段数量正确", () => {
  const text = "energy, Energy, ENERGY, energetic";
  assert.equal(marks(text, ["energy"]).length, 3);
});
