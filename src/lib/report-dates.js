/**
 * 研究速览的日期工具（2026-10-15 抽出）。
 *
 * 「当日新增」的日期选择器现在渲染在页头（与标签页同一行），而数据仍由
 * DailyDigestPanel 拉取——两处都要按同一个「北京业务日」推算近 7 天，
 * 因此把纯字符串日期运算抽到本模块，避免两处各写一份（写歪了就会
 * 「选择器里的日期」和「接口返回的日期」对不上）。
 * 逻辑与 server/date/normalize.js 的 shiftBusinessDate / toBusinessDate 同源。
 */

const WEEKDAY = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

/** YYYY-MM-DD 加减天数；非法输入返回空串。 */
export function shiftDate(dateStr, days) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ""));
  if (!match) return "";
  const base = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
  return new Date(base + days * 86400000).toISOString().slice(0, 10);
}

/** 中文星期；非法输入返回空串。 */
export function weekdayLabel(dateStr) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ""));
  if (!match) return "";
  return WEEKDAY[new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))).getUTCDay()];
}

/** 近 N 天（含 anchor 当天）的日期列表，倒序；anchor 非法时返回空数组。 */
export function recentDates(anchor, days) {
  if (!anchor) return [];
  const out = [];
  for (let index = 0; index < days; index += 1) {
    const day = shiftDate(anchor, -index);
    if (day) out.push(day);
  }
  return out;
}
