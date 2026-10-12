import { useCallback, useState } from "react";

/**
 * 折叠分组状态（S4）。
 *
 * Feed 筛选面板、期刊小节、ReportsView 方向分组/聚类分组此前的
 * 「Set + toggle 闭包」各写一遍；这里收敛。initial 传 { key: true } 表示
 * 默认折叠的组。
 */
export default function useCollapsedGroups(initial = {}) {
  const [collapsed, setCollapsed] = useState(
    () => new Set(Object.entries(initial).filter(([, value]) => value).map(([key]) => key))
  );
  const isCollapsed = useCallback((key) => collapsed.has(key), [collapsed]);
  const toggle = useCallback((key) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);
  // setCollapsed 原样暴露：批量全折/全展、按外部事件重置等场景直接用。
  return { collapsed, isCollapsed, toggle, setCollapsed };
}
