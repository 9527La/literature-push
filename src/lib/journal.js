/**
 * Journal identity helpers.
 *
 * A literature list is scanned by journal far more often than it is read line
 * by line, so every journal gets a stable short mark and a publisher tone.
 * The tone is an "index colour", never an action colour: the site accent stays
 * reserved for things you can click, which keeps the four hues quiet.
 */

export const PUBLISHER_GROUPS = [
  { key: "ieee", label: "IEEE 期刊" },
  { key: "elsevier", label: "爱思唯尔期刊" },
  { key: "cn", label: "中文期刊" },
  { key: "other", label: "其他期刊" }
];

const GROUP_LABELS = new Map(PUBLISHER_GROUPS.map((group) => [group.key, group.label]));

/**
 * Catalogue fallback. Some payloads (a user's saved settings, a cached
 * response) predate the explicit `group` field, and inferring from
 * `publisher` alone would file JMPSCE under IEEE again. Pinning the known
 * catalogue by name keeps every surface in agreement.
 */
const GROUP_BY_NAME = new Map([
  ["IEEE Transactions on Power Systems", "ieee"],
  ["IEEE Transactions on Smart Grid", "ieee"],
  ["IEEE Transactions on Power Delivery", "ieee"],
  ["IEEE Transactions on Sustainable Energy", "ieee"],
  ["IEEE Transactions on Energy Conversion", "ieee"],
  ["Applied Energy", "elsevier"],
  ["Energy", "elsevier"],
  ["International Journal of Electrical Power & Energy Systems", "elsevier"],
  ["Renewable Energy", "elsevier"],
  ["Journal of Modern Power Systems and Clean Energy", "other"],
  ["电力系统自动化", "cn"],
  ["中国电机工程学报", "cn"],
  ["电网技术", "cn"],
  ["电工技术学报", "cn"],
  ["高电压技术", "cn"]
]);

/**
 * Publisher tone for a journal record. Order of trust: the explicit `group`
 * field, then the catalogue by name, then publisher/platform inference so an
 * unknown journal added later still lands somewhere sensible.
 */
export function journalGroup(journal) {
  const explicit = String(journal?.group || "").trim().toLowerCase();
  if (GROUP_LABELS.has(explicit)) return explicit;

  const name = String(journal?.name || journal || "").trim();
  const known = GROUP_BY_NAME.get(name);
  if (known) return known;

  const publisher = String(journal?.publisher || "").trim().toLowerCase();
  const platform = String(journal?.platform || "").trim().toLowerCase();
  if (publisher === "ieee") return "ieee";
  if (publisher === "elsevier") return "elsevier";
  if (platform === "wanfang") return "cn";
  return "other";
}

export function journalGroupLabel(key) {
  return GROUP_LABELS.get(key) || "其他期刊";
}

/** Editorial abbreviations for the journals this site carries. */
const ABBREVIATIONS = new Map([
  ["IEEE Transactions on Power Systems", "TPS"],
  ["IEEE Transactions on Smart Grid", "TSG"],
  ["IEEE Transactions on Power Delivery", "TPW"],
  ["IEEE Transactions on Sustainable Energy", "TSE"],
  ["IEEE Transactions on Energy Conversion", "TEC"],
  ["Applied Energy", "AE"],
  ["Energy", "ENY"],
  ["International Journal of Electrical Power & Energy Systems", "IJE"],
  ["Renewable Energy", "REN"],
  ["Journal of Modern Power Systems and Clean Energy", "MPC"],
  ["电力系统自动化", "电自"],
  ["中国电机工程学报", "电机"],
  ["电网技术", "电网"],
  ["电工技术学报", "电工"],
  ["高电压技术", "高压"]
]);

const SKIP_WORDS = /^(of|on|and|the|for|&)$/i;

/** Short mark for a journal: 2–3 characters, never longer. */
export function journalAbbr(name) {
  const value = String(name || "").trim();
  if (!value) return "?";
  const known = ABBREVIATIONS.get(value);
  if (known) return known;

  const words = value.replace(/[^A-Za-z0-9&\s]/g, " ").split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    const initials = words.filter((word) => !SKIP_WORDS.test(word)).map((word) => word[0]).join("");
    if (initials.length >= 2) return initials.slice(0, 3).toUpperCase();
  }
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
  return value.slice(0, 2);
}

/** Resolve the journal record behind an article so the mark matches the filter panel. */
export function findJournal(journals, name) {
  const value = String(name || "").trim();
  if (!value) return null;
  return (Array.isArray(journals) ? journals : []).find((item) => String(item?.name || "").trim() === value) || null;
}

/**
 * Bucket journals into the four publisher groups, preserving catalogue order and
 * dropping empty groups so a group header never appears with nothing under it.
 */
export function groupJournals(journals) {
  const buckets = new Map(PUBLISHER_GROUPS.map((group) => [group.key, []]));
  for (const journal of Array.isArray(journals) ? journals : []) {
    buckets.get(journalGroup(journal))?.push(journal);
  }
  return PUBLISHER_GROUPS
    .map((group) => ({ ...group, items: buckets.get(group.key) || [] }))
    .filter((group) => group.items.length > 0);
}
