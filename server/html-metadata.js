// 纯 HTML 元数据解析：不依赖浏览器、不做网络请求。
// 供纯 HTTP 抓取（crawler.js）与统一浏览器兜底（web-fallback.js）共用，
// 保证两条路径对同一个页面得到完全一致的结果。
import { decodeEntities, stripTags } from "./utils.js";

export function normalizePublicationDate(value) {
  const text = stripTags(value);
  if (!text) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const monthMatch = text.match(/^(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})$/i);
  if (monthMatch) {
    const months = {
      january: "01",
      february: "02",
      march: "03",
      april: "04",
      may: "05",
      june: "06",
      july: "07",
      august: "08",
      september: "09",
      october: "10",
      november: "11",
      december: "12"
    };
    return `${monthMatch[2]}-${months[monthMatch[1].toLowerCase()]}-01`;
  }
  return text;
}

export function parseTagAttributes(tag) {
  const attributes = {};
  const pattern = /([\w:-]+)\s*=\s*(["'])([\s\S]*?)\2/g;
  let match;
  while ((match = pattern.exec(tag)) !== null) {
    attributes[match[1].toLowerCase()] = decodeEntities(match[3]);
  }
  return attributes;
}

export function extractMetaContent(html, name) {
  const wanted = String(name).toLowerCase();
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const attributes = parseTagAttributes(tag);
    if ([attributes.name, attributes.property, attributes.itemprop].some((value) => String(value || "").toLowerCase() === wanted)) {
      return stripTags(attributes.content || "");
    }
  }
  return "";
}

export function extractMetaContentAll(html, name) {
  const wanted = String(name).toLowerCase();
  const results = [];
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const attributes = parseTagAttributes(tag);
    if (![attributes.name, attributes.property, attributes.itemprop].some((value) => String(value || "").toLowerCase() === wanted)) continue;
    const value = stripTags(attributes.content || "");
    if (value) results.push(value);
  }
  return results;
}

export function extractJsonAssignment(html, marker) {
  const markerIndex = html.indexOf(marker);
  if (markerIndex < 0) return null;
  const start = html.indexOf("{", markerIndex);
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < html.length; index += 1) {
    const char = html[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return html.slice(start, index + 1);
      }
    }
  }

  return null;
}

// IEEE Xplore 的 xplGlobal.document.metadata.keywords 是分类型的数组，实测有三类：
//   Author Keywords —— 作者自己填的，是唯一可信的真值；
//   IEEE Keywords   —— IEEE 受控词表，官方展示，但偶有明显跑偏（轨道交通论文出现
//                      "Electronic mail; TV; Radio access networks"）；
//   Index Terms     —— 机器从正文抽的 30 来个词，与 OpenAlex concepts 同类，一律不取。
// 优先级：Author > IEEE；Index Terms 直接丢弃，避免重蹈 concepts 污染。
export const AUTHOR_KEYWORD_TYPES = new Set(["author keywords", "ieee author keywords", "author"]);
export const IEEE_KEYWORD_TYPES = new Set(["ieee keywords", "ieee terms"]);

function readTermList(item) {
  if (Array.isArray(item?.kwd)) return item.kwd;
  if (Array.isArray(item?.terms)) return item.terms;
  if (Array.isArray(item)) return item;
  if (item?.term) return [item.term];
  if (item?.name) return [item.name];
  if (item?.value) return [item.value];
  if (typeof item === "string") return [item];
  return [];
}

function joinTerms(terms) {
  return [...new Set(terms.map((term) => String(term).trim()).filter(Boolean))].join("; ");
}

export function extractIndexTerms(indexTerms, { allowIeeeKeywords = true } = {}) {
  if (!indexTerms) return "";
  const authorTerms = [];
  const ieeeTerms = [];

  const absorb = (rawType, rawTerms) => {
    const type = String(rawType || "").toLowerCase();
    const terms = readTermList(rawTerms).filter(Boolean);
    if (!terms.length) return;
    if (AUTHOR_KEYWORD_TYPES.has(type)) authorTerms.push(...terms);
    else if (allowIeeeKeywords && IEEE_KEYWORD_TYPES.has(type)) ieeeTerms.push(...terms);
  };

  if (Array.isArray(indexTerms)) {
    for (const item of indexTerms) {
      // 字符串数组没有类型标签，视为作者关键词（至少不是受控词表）。
      if (typeof item === "string") authorTerms.push(item);
      else if (item && typeof item === "object") absorb(item.type, item);
    }
  } else if (typeof indexTerms === "object") {
    for (const [key, category] of Object.entries(indexTerms)) absorb(key, category);
  }

  return joinTerms(authorTerms.length ? authorTerms : ieeeTerms);
}

// 只取作者关键词（用于「宁缺勿滥」的场景）。
export function extractAuthorKeywords(indexTerms) {
  return extractIndexTerms(indexTerms, { allowIeeeKeywords: false });
}

export function parseIeeeMetadata(html) {
  const raw = extractJsonAssignment(html, "xplGlobal.document.metadata=");
  if (!raw) return {};

  try {
    const metadata = JSON.parse(raw);
    const authors = Array.isArray(metadata.authors)
      ? metadata.authors.map((author) => author.name || author.preferredName).filter(Boolean).join(", ")
      : "";

    return {
      title: stripTags(metadata.title || ""),
      authors,
      journal: stripTags(metadata.publicationTitle || metadata.displayPublicationTitle || ""),
      year: Number(metadata.publicationYear || metadata.year || 0) || null,
      volume: metadata.volume || "",
      issue: metadata.issue || "",
      doi: metadata.doi || "",
      abstract: stripTags(metadata.abstract || ""),
      url: metadata.articleUrl ? `https://ieeexplore.ieee.org${metadata.articleUrl}` : "",
      published_at: normalizePublicationDate(metadata.publicationDate || metadata.onlineDate || ""),
      keywords: extractIndexTerms(metadata.indexTerms || metadata.keywords || null)
    };
  } catch {
    return {};
  }
}

export function parseHtmlMetadata(html) {
  const citationKeywords = extractMetaContentAll(html, "citation_keywords");
  const metaKeywords = extractMetaContentAll(html, "keywords");
  const allKeywords = [...new Set([...citationKeywords, ...metaKeywords])].join("; ");

  return {
    title: extractMetaContent(html, "citation_title") || extractMetaContent(html, "og:title"),
    authors: extractMetaContentAll(html, "citation_author").join(", "),
    journal: extractMetaContent(html, "citation_journal_title"),
    year: Number(extractMetaContent(html, "citation_publication_date").slice(0, 4)) || null,
    volume: extractMetaContent(html, "citation_volume"),
    issue: extractMetaContent(html, "citation_issue"),
    doi: extractMetaContent(html, "citation_doi"),
    abstract: extractMetaContent(html, "citation_abstract") || extractMetaContent(html, "Description") || extractMetaContent(html, "description"),
    url: extractMetaContent(html, "citation_abstract_html_url") || extractMetaContent(html, "og:url"),
    published_at: normalizePublicationDate(extractMetaContent(html, "citation_publication_date")),
    keywords: allKeywords
  };
}

export function parseElsevierMetadata(html) {
  // Try to extract from JSON-LD structured data
  const jsonLdMatch = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i);
  if (jsonLdMatch) {
    try {
      const jsonLd = JSON.parse(jsonLdMatch[1]);
      if (jsonLd["@type"] === "ScholarlyArticle" || jsonLd["@type"] === "Article") {
        const keywords = Array.isArray(jsonLd.keywords)
          ? jsonLd.keywords.join("; ")
          : typeof jsonLd.keywords === "string" ? jsonLd.keywords : "";
        return {
          title: stripTags(jsonLd.name || ""),
          abstract: stripTags(jsonLd.abstract || ""),
          keywords,
          authors: Array.isArray(jsonLd.author)
            ? jsonLd.author.map((a) => a.name || [a.givenName, a.familyName].filter(Boolean).join(" ")).filter(Boolean).join(", ")
            : "",
          doi: jsonLd.identifier || jsonLd.sameAs?.match(/doi:(.+)/)?.[1] || ""
        };
      }
    } catch {}
  }

  // Try to extract from Elsevier-specific meta tags
  const elsevierAbstract = extractMetaContent(html, "description") ||
                          extractMetaContent(html, "DC.description");

  const elsevierKeywords = extractMetaContentAll(html, "citation_keywords")
    .concat(extractMetaContentAll(html, "DC.subject"))
    .concat(extractMetaContentAll(html, "keywords"));

  return {
    title: extractMetaContent(html, "citation_title") || extractMetaContent(html, "og:title") || extractMetaContent(html, "DC.title"),
    abstract: elsevierAbstract,
    keywords: [...new Set(elsevierKeywords)].join("; "),
    authors: extractMetaContentAll(html, "citation_author").join(", "),
    doi: extractMetaContent(html, "citation_doi") || extractMetaContent(html, "prism:doi")
  };
}

function jsonLdBlocks(html) {
  const blocks = [];
  const pattern = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = pattern.exec(html)) !== null) {
    try {
      blocks.push(JSON.parse(match[1].trim()));
    } catch {
      // Some publishers emit several JSON objects in one block; try the array form.
      try {
        blocks.push(...JSON.parse(`[${match[1].trim()}]`));
      } catch { /* ignore malformed JSON-LD */ }
    }
  }
  return blocks;
}

function flattenJsonLd(value, sink = []) {
  if (Array.isArray(value)) {
    for (const item of value) flattenJsonLd(item, sink);
    return sink;
  }
  if (value && typeof value === "object") {
    sink.push(value);
    if (value["@graph"] || value.mainEntity) flattenJsonLd(value["@graph"] || value.mainEntity, sink);
  }
  return sink;
}

function jsonLdText(value) {
  if (typeof value === "string") return decodeEntities(stripTags(value)).replace(/\s+/g, " ").trim();
  if (Array.isArray(value)) return value.map(jsonLdText).filter(Boolean).join("; ");
  if (value && typeof value === "object") return jsonLdText(value.name || value.value || "");
  return "";
}

const SCHOLARLY_TYPES = new Set([
  "scholarlyarticle",
  "article",
  "academicarticle",
  "newsarticle",
  "report",
  "creativework",
  "webpage"
]);

// JSON-LD 是出版社落地页上最常见的结构化元数据来源，且往往是纯 HTTP 抓不到、
// 浏览器能拿到的那部分。统一流程里把它作为第一个解析器。
export function parseJsonLdMetadata(html) {
  const nodes = flattenJsonLd(jsonLdBlocks(html));
  for (const node of nodes) {
    const type = String(node["@type"] || "").toLowerCase();
    if (type && !SCHOLARLY_TYPES.has(type)) continue;
    const title = jsonLdText(node.name || node.headline);
    const abstract = jsonLdText(node.abstract || node.description);
    const keywords = jsonLdText(node.keywords);
    if (!title && !abstract && !keywords) continue;
    let doi = jsonLdText(node.identifier || node.sameAs || "");
    doi = doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").replace(/^doi:/i, "").trim();
    return {
      title,
      abstract,
      keywords,
      authors: Array.isArray(node.author)
        ? node.author.map((entry) => jsonLdText(entry?.name || [entry?.givenName, entry?.familyName].filter(Boolean).join(" "))).filter(Boolean).join(", ")
        : jsonLdText(node.author?.name || ""),
      doi,
      url: jsonLdText(node.url || "")
    };
  }
  return {};
}

// 统一兜底解析入口：按「结构化 → 出版社专用 → 通用 meta」的顺序合并。
// 任何一层给出的非空字段都会被保留，后层只补空缺。
export function extractPageMetadata(html, { elsevier = false } = {}) {
  if (!html || typeof html !== "string") return {};
  const layers = [parseJsonLdMetadata(html), parseIeeeMetadata(html), parseHtmlMetadata(html)];
  if (elsevier) layers.splice(2, 0, parseElsevierMetadata(html));
  return layers.reduce((merged, layer) => {
    for (const [key, value] of Object.entries(layer)) {
      if (value === null || value === undefined || value === 0 || value === "") continue;
      if (String(merged[key] || "").trim()) continue;
      merged[key] = value;
    }
    return merged;
  }, {});
}
