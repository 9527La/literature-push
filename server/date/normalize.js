// ── 业务自然日（北京时间）与日期精度归一化 ────────────────────────────────────
// 数据库时间戳统一保存 UTC；「业务自然日」统一采用 Asia/Shanghai（UTC+8，无夏令
// 时，可用固定偏移换算）。转换只发生在统计、筛选、展示、日期窗口判断处，不迁移
// 历史 UTC 数据。
//
// 此前 `date('now')` / `toISOString()` 都按 UTC 切日，北京时间 00:00—08:00 的
// 数据会整体归到前一天；近 N 日窗口因此存在跨日误差。全站统一从这里取「今天」。

export const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;

/**
 * 任意时间值 → 北京时间业务日（YYYY-MM-DD）。
 * 接受 Date / 毫秒时间戳 / UTC 时间戳字符串（ISO 或 SQLite 的
 * "YYYY-MM-DD HH:MM:SS" 形态）；已经是纯日期（YYYY-MM-DD）的值原样返回，
 * 避免对「出版社给的就是本地日期」的字段做二次换算。
 */
export function toBusinessDate(value) {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : new Date(value.getTime() + BEIJING_OFFSET_MS).toISOString().slice(0, 10);
  }
  if (typeof value === "number") {
    return new Date(value + BEIJING_OFFSET_MS).toISOString().slice(0, 10);
  }
  const raw = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  if (/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?)?(Z|[+-]\d{2}:?\d{2})?$/.test(raw)) {
    const parsed = Date.parse(raw.replace(" ", "T") + (/Z|[+-]\d{2}:?\d{2}$/.test(raw) ? "" : "Z"));
    if (!Number.isNaN(parsed)) return new Date(parsed + BEIJING_OFFSET_MS).toISOString().slice(0, 10);
  }
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? null : new Date(parsed + BEIJING_OFFSET_MS).toISOString().slice(0, 10);
}

/** 北京时间的「今天」（YYYY-MM-DD）。 */
export function businessToday(now = Date.now()) {
  return toBusinessDate(now);
}

/** 业务日加减 N 天（纯字符串日期运算，不做时区换算）。 */
export function shiftBusinessDate(dateStr, days) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ""));
  if (!match) return null;
  const base = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
  return new Date(base + days * 86400000).toISOString().slice(0, 10);
}

/**
 * 「近 N 日」窗口：北京时间今天 + 向前 N-1 个自然日，共恰好 N 个自然日。
 * 旧的 `date('now', '-N days')` 写法实际包含 N+1 个自然日（窗口多一天），
 * 全站的 7 天 / 30 天统计与推送窗口统一改走这里。
 */
export function businessWindow(days, now = Date.now()) {
  const total = Math.max(1, Math.floor(Number(days) || 1));
  const endDate = businessToday(now);
  return { startDate: shiftBusinessDate(endDate, -(total - 1)), endDate };
}

/**
 * 解析出版社给的各种日期形态，返回 { date, precision }。
 * 绝不把缺日/缺月的日期人为补齐后伪装成日级精度（方案 §24）：
 *   "2020-06-05"      → { date: "2020-06-05", precision: "day" }
 *   "2020-06"         → { date: "2020-06-01", precision: "month" }
 *   "2020"            → { date: "2020-01-01", precision: "year" }
 * 解析失败 → { date: null, precision: null }。
 */
export function normalizeDatePrecision(value) {
  const raw = String(value ?? "").trim();
  let match = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (match) {
    const date = `${match[1]}-${match[2]}-${match[3]}`;
    return Number.isNaN(Date.parse(`${date}T00:00:00Z`)) ? { date: null, precision: null } : { date, precision: "day" };
  }
  match = /^(\d{4})-(\d{2})$/.exec(raw);
  if (match) return { date: `${match[1]}-${match[2]}-01`, precision: "month" };
  match = /^(\d{4})(?:年|-)?$/.exec(raw);
  if (match) return { date: `${match[1]}-01-01`, precision: "year" };
  match = /^(\d{4})(\d{2})(\d{2})$/.exec(raw);
  if (match) {
    const date = `${match[1]}-${match[2]}-${match[3]}`;
    return Number.isNaN(Date.parse(`${date}T00:00:00Z`)) ? { date: null, precision: null } : { date, precision: "day" };
  }
  return { date: null, precision: null };
}

/** 归一化后的日期是否「已经发生」（<= 业务今天）。未来卷期日不参与主时间判定。 */
export function isUsablePastDate(dateStr, today = businessToday()) {
  if (!dateStr) return false;
  return String(dateStr) <= String(today);
}

/**
 * 两个 YYYY-MM-DD（可带时间后缀）之间的天数差：laterDate - earlierDate，
 * later 更晚返回正数。解析失败返回 NaN。
 */
export function daysBetween(laterDate, earlierDate) {
  const toUtcMs = (value) => {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ""));
    return match ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : NaN;
  };
  const diff = toUtcMs(laterDate) - toUtcMs(earlierDate);
  return Number.isNaN(diff) ? NaN : Math.round(diff / 86400000);
}
