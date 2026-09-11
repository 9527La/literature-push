import { test } from "node:test";
import assert from "node:assert/strict";
import { formatDate, formatDateTime, formatRelativeDate, isChineseJournalArticle, isChineseSourceText } from "./format.js";

const NOW = new Date("2026-09-11T12:00:00+08:00").getTime();

test("formatRelativeDate 按时间跨度选择相对或绝对表述", () => {
  assert.equal(formatRelativeDate("2026-09-11T11:30:00+08:00", NOW), "刚刚");
  assert.equal(formatRelativeDate("2026-09-11T06:00:00+08:00", NOW), "6 小时前");
  assert.equal(formatRelativeDate("2026-09-08T12:00:00+08:00", NOW), "3 天前");
  assert.equal(formatRelativeDate("2026-08-20T12:00:00+08:00", NOW), "2026-08-20");
  assert.equal(formatRelativeDate("2025-03-04T12:00:00+08:00", NOW), "2025-03");
  assert.equal(formatRelativeDate("20250304", NOW), "2025-03");
  assert.equal(formatRelativeDate("", NOW), "未知日期");
});

test("formatDate 处理紧凑日期与 ISO 日期", () => {
  assert.equal(formatDate("20240915"), "2024-09-15");
  assert.equal(formatDate("2024-09-15T08:00:00Z"), "2024-09-15");
  assert.equal(formatDate(""), "未知日期");
});

test("formatDateTime 格式化合法时间并对非法时间回退", () => {
  assert.match(formatDateTime("2024-09-15T12:00:00Z"), /^2024-09-15 \d{2}:\d{2}:\d{2}$/);
  assert.equal(formatDateTime("2024-13-45T99:99:99.123Z"), "2024-13-45 99:99:99");
  assert.equal(formatDateTime(""), "未知时间");
});

test("isChineseSourceText 识别中文", () => {
  assert.equal(isChineseSourceText("微电网调度"), true);
  assert.equal(isChineseSourceText("microgrid"), false);
  assert.equal(isChineseSourceText("  "), false);
});

test("isChineseJournalArticle 依据期刊平台与语言判定", () => {
  const journals = [{ name: "电力系统自动化", platform: "wanfang" }];
  assert.equal(isChineseJournalArticle({ journal: "电力系统自动化" }, journals), true);
  assert.equal(isChineseJournalArticle({ journal: "IEEE Transactions", external_id: "wanfang:1" }, journals), true);
  assert.equal(isChineseJournalArticle({ journal: "IEEE Transactions", title: "A microgrid study" }, journals), false);
});
