/**
 * 研究速览 · 专题「来源期刊」筛选的纯函数（ReportsView 与单元测试共用）。
 *
 * 口径（2026-10-12 与用户确认，与页面卡片一一对应）：期刊集 = 当前报告视图
 * 引用文献（聚类速评 / 论文速评 / 值得精读卡）的期刊聚合，客户端实时计算、
 * 不新增服务端请求；只有能在 articleMap 中解析出期刊名的卡片参与筛选，
 * 无元数据的旧格式卡片永远可见（不得因筛选而丢失）。
 */

/** 引用 id 列表 → [{ name, count }]：按期刊聚合去重文献数；篇数降序、同篇数按名称升序。 */
export function journalEntriesFromIds(ids, articleMap) {
  const counts = new Map();
  for (const id of Array.isArray(ids) ? ids : []) {
    const name = String(articleMap?.get(id)?.journal || "").trim();
    if (!name) continue;
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/** 命中「已隐藏期刊」的文献 id 集合；无期刊信息的 id 永不命中。 */
export function hiddenIdsForJournals(ids, articleMap, hiddenJournals) {
  const hidden = hiddenJournals instanceof Set ? hiddenJournals : new Set(hiddenJournals || []);
  const result = new Set();
  if (!hidden.size) return result;
  for (const id of Array.isArray(ids) ? ids : []) {
    const name = String(articleMap?.get(id)?.journal || "").trim();
    if (name && hidden.has(name)) result.add(id);
  }
  return result;
}
