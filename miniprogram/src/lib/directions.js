/**
 * AI research-direction catalogue — front-end mirror of server/directions.js.
 *
 * The classifying agent (WorkBuddy scheduled task) owns the definitions; this
 * file only carries what rendering needs: key → Chinese label and the CSS
 * variable name for the per-direction palette defined in styles.css.
 * Any key change must be applied in server/directions.js + RUNBOOK §2 too.
 */
export const DIRECTIONS = [
  { key: "distributed-gen", label: "分布式电源与并网" },
  { key: "storage", label: "储能系统" },
  { key: "market", label: "电力市场与机制" },
  { key: "transmission", label: "输电网运行与规划" },
  { key: "distribution", label: "配电网运行与规划" },
  { key: "microgrid", label: "微电网与虚拟电厂" },
  { key: "forecasting", label: "预测与数据驱动" },
  { key: "stability", label: "电力系统稳定性" },
  { key: "protection", label: "继电保护与故障诊断" },
  { key: "power-quality", label: "电能质量" },
  { key: "hv", label: "高电压与绝缘" },
  { key: "power-electronics", label: "电力电子装备" },
  { key: "transport", label: "电动汽车与电气化" },
  { key: "ies", label: "综合能源系统" },
  { key: "other", label: "其他" }
];

const DIRECTION_BY_KEY = new Map(DIRECTIONS.map((direction) => [direction.key, direction]));

export function directionLabel(key) {
  return DIRECTION_BY_KEY.get(key)?.label || "";
}

/** `storage` → `var(--dir-storage)`; `power-electronics` → `var(--dir-power_electronics)`. */
export function directionVar(key) {
  return `var(--dir-${String(key || "").replace(/-/g, "_")})`;
}
