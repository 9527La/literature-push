import { test } from "node:test";
import assert from "node:assert/strict";
import { hiddenIdsForJournals, journalEntriesFromIds } from "./report-journals.js";

const mapOf = (records) => new Map(records.map((record) => [record.id, record]));

test("journalEntriesFromIds 按期刊聚合去重文献数，篇数降序、同篇数按名称升序", () => {
  const articleMap = mapOf([
    { id: 1, journal: "Applied Energy" },
    { id: 2, journal: "Applied Energy" },
    { id: 3, journal: "Energy" },
    { id: 4, journal: "Renewable Energy" },
    { id: 5, journal: "   " },   // 空白期刊 → 跳过
    { id: 6 }                    // 无期刊字段 → 跳过
  ]);
  assert.deepEqual(journalEntriesFromIds([1, 2, 3, 4, 5, 6, 999], articleMap), [
    { name: "Applied Energy", count: 2 },
    { name: "Energy", count: 1 },
    { name: "Renewable Energy", count: 1 }
  ]);
  // 期刊名两侧空白须归并（DB 值可能是 " 电网技术 "）
  assert.deepEqual(journalEntriesFromIds([9], mapOf([{ id: 9, journal: " 电网技术 " }])), [
    { name: "电网技术", count: 1 }
  ]);
  // 防御：非数组 / 空映射不得抛错
  assert.deepEqual(journalEntriesFromIds(null, articleMap), []);
  assert.deepEqual(journalEntriesFromIds([1], null), []);
});

test("hiddenIdsForJournals 只命中被隐藏期刊，无期刊信息的 id 永不命中", () => {
  const articleMap = mapOf([
    { id: 1, journal: "Applied Energy" },
    { id: 2, journal: "Energy" },
    { id: 3, journal: "" },
    { id: 4, journal: "电网技术" }
  ]);
  const hidden = new Set(["Applied Energy", "电网技术"]);
  assert.deepEqual([...hiddenIdsForJournals([1, 2, 3, 4, 999], articleMap, hidden)], [1, 4]);
  // 「Energy」未被隐藏时，同名前缀期刊（Applied Energy）不得误伤
  assert.deepEqual([...hiddenIdsForJournals([1, 2], articleMap, new Set(["Energy"]))], [2]);
  assert.equal(hiddenIdsForJournals([1, 2, 3, 4], articleMap, new Set()).size, 0);
  assert.equal(hiddenIdsForJournals([1, 2, 3, 4], articleMap, []).size, 0);
  assert.equal(hiddenIdsForJournals([1], null, hidden).size, 0);
});
