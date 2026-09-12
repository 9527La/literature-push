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
