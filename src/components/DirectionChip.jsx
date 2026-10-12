import { Tag } from "lucide-react";
import { directionLabel, directionVar } from "../lib/directions.js";

/**
 * AI 研究方向 chip（S4）。
 *
 * 此前同一段渲染逻辑散落在 ArticleCard / ArticleDialog / ReportsView
 * BriefCard / 相关文献 / 期刊弹窗五处，配色与结构靠各自维护。这里单点收敛：
 * 颜色只经 --dir-key 间接引用（见 DESIGN-FRONTEND-DIRECTION.md §4），
 * 实底/软底/图标三种变体对应各场景。
 */
export default function DirectionChip({
  direction,
  variant = "solid",
  icon = "dot",
  title = "",
  children
}) {
  if (!direction) return null;
  const className = variant === "soft" ? "direction-chip direction-chip-soft" : "direction-chip";
  return (
    <span className={className} style={{ "--dir-key": directionVar(direction) }} title={title || undefined}>
      {icon === "tag" ? (
        <Tag size={11} aria-hidden="true" />
      ) : icon === "none" ? null : (
        <i className="direction-dot" aria-hidden="true" />
      )}
      {children ?? directionLabel(direction)}
    </span>
  );
}
