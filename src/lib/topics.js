/**
 * Keyword → research topic.
 *
 * The catalogue already carries thousands of author keywords, which is too many
 * to scan one by one. Mapping them onto a handful of stable research areas gives
 * the list a second reading axis next to the publisher colour, and the mapping is
 * derived from the keywords the crawl actually stores rather than a hand-kept tag
 * list on every record.
 */
export const TOPICS = [
  { key: "storage", label: "储能", pattern: /stor(age|ing)|batter|supercapacitor|flywheel|hydrogen|electroly[sz]|储能|蓄能|电池|氢能|燃料电池/i },
  { key: "renewable", label: "新能源", pattern: /wind|solar|photovoltaic|photo-voltaic|renewable|hydro|wave|tidal|geothermal|风电|风机|光伏|可再生|新能源|水电/i },
  { key: "grid", label: "电网调度", pattern: /dispatch|schedul|unit commitment|power flow|state estimation|stability|oscillation|microgrid|distribution network|transmission|调度|潮流|稳定|振荡|微电网|配电网|输电网|优化运行/i },
  { key: "electronics", label: "电力电子", pattern: /converter|inverter|invertor|rectifier|modulation|semiconductor|igbt|sic|gan|topology|变流|换流|逆变|整流|电力电子|拓扑|调制/i },
  { key: "market", label: "市场机制", pattern: /market|bidding|price|tariff|auction|ancillary|trading|electricity market|市场|报价|电价|定价|交易|辅助服务/i },
  { key: "voltage", label: "高电压", pattern: /insulation|breakdown|partial discharge|lightning|overvoltage|surge|cable|insulator|绝缘|击穿|局放|放电|过电压|雷击|电缆/i }
];

const TOPIC_BY_KEY = new Map(TOPICS.map((topic) => [topic.key, topic]));

export function splitKeywords(value) {
  return String(value || "")
    .split(/[;；]/)
    .map((keyword) => keyword.trim())
    .filter(Boolean);
}

export function topicLabel(key) {
  return TOPIC_BY_KEY.get(key)?.label || "";
}

/** First topic whose vocabulary appears in the keyword list, or null. */
export function articleTopic(keywords) {
  const list = Array.isArray(keywords) ? keywords : splitKeywords(keywords);
  if (!list.length) return null;
  const haystack = list.join(" ; ");
  return TOPICS.find((topic) => topic.pattern.test(haystack))?.key || null;
}

/**
 * Topic histogram over a set of articles, most frequent first. Articles without a
 * recognisable topic are counted as `unknown` so the total still adds up.
 */
export function topicHistogram(articles, limit = 0) {
  const counts = new Map();
  for (const article of Array.isArray(articles) ? articles : []) {
    const key = articleTopic(article?.keywords) || "unknown";
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const rows = [...counts.entries()]
    .filter(([key]) => key !== "unknown")
    .map(([key, count]) => ({ key, label: topicLabel(key), count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "zh"));
  return limit > 0 ? rows.slice(0, limit) : rows;
}

/**
 * Co-occurrence graph over the most frequent keywords, used as the masthead
 * illustration. Nodes are real keywords sized by frequency; an edge means the two
 * appeared in the same paper. Returns an empty graph when there is nothing to draw.
 */
export function keywordGraph(articles, nodeLimit = 7) {
  const frequency = new Map();
  const pairs = new Map();
  for (const article of Array.isArray(articles) ? articles : []) {
    const keywords = [...new Set(splitKeywords(article?.keywords).map((keyword) => keyword.toLowerCase()))];
    for (const keyword of keywords) frequency.set(keyword, (frequency.get(keyword) || 0) + 1);
    for (let i = 0; i < keywords.length; i += 1) {
      for (let j = i + 1; j < keywords.length; j += 1) {
        const pair = [keywords[i], keywords[j]].sort().join("\u0000");
        pairs.set(pair, (pairs.get(pair) || 0) + 1);
      }
    }
  }
  const nodes = [...frequency.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, nodeLimit)
    .map(([label, count]) => ({ label, count }));
  const index = new Map(nodes.map((node, position) => [node.label, position]));
  const edges = [];
  for (const [pair, weight] of pairs) {
    const [a, b] = pair.split("\u0000");
    if (index.has(a) && index.has(b)) edges.push({ a: index.get(a), b: index.get(b), weight });
  }
  return { nodes, edges };
}
