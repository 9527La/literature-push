const REGEX_META = /[.*+?^${}()|[\]\\]/g;

// 用 split 捕获组的奇偶位判断命中片段，完全不依赖正则的 lastIndex 状态。
export function highlightParts(text, terms) {
  if (text === null || text === undefined || text === "") return null;
  const list = Array.isArray(terms) ? terms : [];
  const escaped = list
    .map((term) => String(term ?? "").replace(REGEX_META, "\\$&"))
    .filter(Boolean);
  if (!escaped.length) return null;
  const parts = String(text).split(new RegExp(`(${escaped.join("|")})`, "gi"));
  const result = parts.map((value, index) => ({ value, matched: index % 2 === 1 }));
  return result.some((part) => part.matched) ? result : null;
}
