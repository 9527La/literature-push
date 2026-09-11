import { config } from "./config.js";
import { decodeEntities, stripTags, readResponseText, isNonResearchTitle } from "./utils.js";

const WANFANG_RSS_BASE = "https://apps.wanfangdata.com.cn/perios/rss";
const WANFANG_DETAIL_ENDPOINT = "https://d.wanfangdata.com.cn/Detail.DetailService/getDetailInFormation";

// RSS feeds occasionally contain issue introductions, cover notices, or a
// table of contents mixed in with research papers.  Keep those out of the
// feed while preserving ordinary Chinese titles that contain punctuation.
const NON_ARTICLE_TITLE_PATTERNS = [
  /^目录$/,
  /^目次$/,
  /^特约主编寄语$/,
  /^卷首语$/,
  /^编者按$/,
  /^征稿启事$/,
  /^封面故事$/,
  /^封面说明$/,
  /^广告$/
];

function decodeXmlText(value) {
  let text = String(value || "").trim();
  const cdata = text.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/i);
  if (cdata) text = cdata[1];
  // Strip actual markup before decoding entities so an escaped value such as
  // "&lt;关键&gt;" is not mistaken for an HTML tag.
  return decodeEntities(stripTags(text)
    .replace(/&nbsp;/gi, " ")
    .replace(/&#xA0;/gi, " "));
}

function readTag(block, tagName) {
  const escaped = String(tagName).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = block.match(new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)</${escaped}>`, "i"));
  return match ? decodeXmlText(match[1]) : "";
}

function normalizeArticleId(value) {
  const text = decodeXmlText(value);
  if (!text) return "";
  try {
    const decoded = decodeURIComponent(text);
    const match = decoded.match(/\/periodical\/([^/?#]+)/i);
    if (match?.[1]) return match[1].trim();
    const pathMatch = decoded.match(/\/([^/?#]+)$/);
    return pathMatch?.[1]?.trim() || decoded.trim();
  } catch {
    const match = text.match(/\/periodical\/([^/?#]+)/i);
    return match?.[1]?.trim() || text.trim();
  }
}

function normalizePublishedAt(value) {
  const text = decodeXmlText(value);
  if (!text) return "";
  const dateOnly = text.match(/^(\d{4})[-/.](\d{1,2})(?:[-/.](\d{1,2}))?/);
  if (dateOnly) {
    return `${dateOnly[1]}-${String(dateOnly[2]).padStart(2, "0")}-${String(dateOnly[3] || 1).padStart(2, "0")}`;
  }
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) {
    // Wanfang publishes RSS timestamps in GMT while the publication date is
    // a China-local date.  Format in Asia/Shanghai to avoid moving midnight
    // records to the previous UTC day.
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(parsed);
  }
  const match = text.match(/(\d{4})[-/.](\d{1,2})(?:[-/.](\d{1,2}))?/);
  if (!match) return "";
  return `${match[1]}-${String(match[2]).padStart(2, "0")}-${String(match[3] || 1).padStart(2, "0")}`;
}

function isResearchArticle(title) {
  const text = String(title || "").trim();
  return Boolean(text) && !isNonResearchTitle(text) && !NON_ARTICLE_TITLE_PATTERNS.some((pattern) => pattern.test(text));
}

function parseIssue(articleId) {
  // Wanfang periodical IDs normally end in YYYY + issue + article sequence,
  // e.g. dlxtzdh202615017.  Keep this best-effort because some feeds use a
  // different sequence format.
  const match = String(articleId || "").match(/(\d{4})(\d{2})(\d{3,})$/);
  return {
    year: match ? Number(match[1]) || null : null,
    issue: match ? match[2] : ""
  };
}

function encodeVarint(value) {
  let number = Number(value) || 0;
  const bytes = [];
  while (number > 127) {
    bytes.push((number & 127) | 128);
    number >>>= 7;
  }
  bytes.push(number);
  return Uint8Array.from(bytes);
}

function concatBytes(...arrays) {
  const output = new Uint8Array(arrays.reduce((sum, array) => sum + array.length, 0));
  let offset = 0;
  for (const array of arrays) {
    output.set(array, offset);
    offset += array.length;
  }
  return output;
}

function encodeStringField(field, value) {
  const bytes = new TextEncoder().encode(String(value || ""));
  return concatBytes(encodeVarint((field * 8) + 2), encodeVarint(bytes.length), bytes);
}

function encodeGrpcWebFrame(payload) {
  return concatBytes(
    Uint8Array.from([0, (payload.length >>> 24) & 255, (payload.length >>> 16) & 255, (payload.length >>> 8) & 255, payload.length & 255]),
    payload
  );
}

function encodeDetailRequest(articleId) {
  const payload = concatBytes(
    encodeStringField(1, "Periodical"),
    encodeStringField(2, articleId),
    encodeStringField(7, "AI_READ"),
    encodeStringField(7, "AI_EXTRACT")
  );
  return encodeGrpcWebFrame(payload);
}

function readProtoVarint(bytes, state) {
  let value = 0;
  let shift = 0;
  while (state.offset < bytes.length) {
    const byte = bytes[state.offset++];
    value += (byte & 127) * (2 ** shift);
    if (!(byte & 128)) return value;
    shift += 7;
    if (shift > 53) throw new Error("protobuf varint is too large");
  }
  throw new Error("truncated protobuf varint");
}

function parseProtoFields(bytes) {
  const fields = [];
  const state = { offset: 0 };
  while (state.offset < bytes.length) {
    const key = readProtoVarint(bytes, state);
    const field = Math.floor(key / 8);
    const wire = key % 8;
    if (field <= 0) throw new Error("invalid protobuf field number");
    if (wire === 0) {
      fields.push({ field, wire, value: readProtoVarint(bytes, state) });
    } else if (wire === 1) {
      if (state.offset + 8 > bytes.length) throw new Error("truncated protobuf fixed64 field");
      fields.push({ field, wire, value: bytes.slice(state.offset, state.offset + 8) });
      state.offset += 8;
    } else if (wire === 2) {
      const length = readProtoVarint(bytes, state);
      const end = state.offset + length;
      if (end > bytes.length) throw new Error("truncated protobuf length-delimited field");
      fields.push({ field, wire, value: bytes.slice(state.offset, end) });
      state.offset = end;
    } else if (wire === 5) {
      if (state.offset + 4 > bytes.length) throw new Error("truncated protobuf fixed32 field");
      fields.push({ field, wire, value: bytes.slice(state.offset, state.offset + 4) });
      state.offset += 4;
    } else {
      // The Wanfang messages currently use only wire types 0/2 for the
      // fields needed here.  Fail closed on groups rather than guessing an
      // offset and silently returning corrupt metadata.
      throw new Error(`unsupported protobuf wire type ${wire}`);
    }
  }
  return fields;
}

function protoStrings(fields, field) {
  const decoder = new TextDecoder();
  return fields
    .filter((entry) => entry.field === field && entry.wire === 2)
    .map((entry) => decoder.decode(entry.value).trim())
    .filter(Boolean);
}

function protoFirstString(fields, field) {
  return protoStrings(fields, field)[0] || "";
}

function parseGrpcWebFrames(body) {
  const bytes = body instanceof Uint8Array ? body : new Uint8Array(body || []);
  const frames = [];
  let offset = 0;
  while (offset + 5 <= bytes.length) {
    const flag = bytes[offset];
    const length = bytes[offset + 1] * 2 ** 24
      + bytes[offset + 2] * 2 ** 16
      + bytes[offset + 3] * 2 ** 8
      + bytes[offset + 4];
    const start = offset + 5;
    const end = start + length;
    if (end > bytes.length) throw new Error("truncated gRPC-web frame");
    frames.push({ flag, payload: bytes.slice(start, end) });
    offset = end;
  }
  if (offset !== bytes.length) throw new Error("invalid gRPC-web frame boundary");
  return frames;
}

export function parseWanfangDetailResponse(body) {
  const dataFrame = parseGrpcWebFrames(body).find((frame) => !(frame.flag & 0x80));
  if (!dataFrame) return null;
  const responseFields = parseProtoFields(dataFrame.payload);
  for (const resourceField of responseFields.filter((entry) => entry.field === 1 && entry.wire === 2)) {
    const resourceFields = parseProtoFields(resourceField.value);
    const periodicalField = resourceFields.find((entry) => entry.field === 103 && entry.wire === 2);
    if (!periodicalField) continue;
    const periodicalFields = parseProtoFields(periodicalField.value);
    const titleList = protoStrings(periodicalFields, 2);
    const creators = protoStrings(periodicalFields, 3);
    const foreignCreators = protoStrings(periodicalFields, 6);
    const keywords = protoStrings(periodicalFields, 16);
    const machineKeywords = protoStrings(periodicalFields, 18);
    const abstracts = protoStrings(periodicalFields, 20);
    const publishDate = protoFirstString(periodicalFields, 28);
    const publicationYear = periodicalFields.find((entry) => entry.field === 33 && entry.wire === 0)?.value;
    return {
      title: titleList[0] || "",
      authors: (creators.length ? creators : foreignCreators).join(", "),
      abstract: abstracts[0] || "",
      keywords: (keywords.length ? keywords : machineKeywords).join("; "),
      doi: protoFirstString(periodicalFields, 41),
      published_at: normalizePublishedAt(publishDate),
      year: Number(publicationYear || 0) || null,
      volume: protoFirstString(periodicalFields, 35),
      issue: protoFirstString(periodicalFields, 34),
      page: protoFirstString(periodicalFields, 36),
      language: protoFirstString(periodicalFields, 44),
      issn: protoFirstString(periodicalFields, 45),
      periodical_id: protoFirstString(periodicalFields, 22)
    };
  }
  return null;
}

function articleIdFromArticle(article) {
  const externalId = String(article?.external_id || "");
  if (externalId.toLowerCase().startsWith("wanfang:")) return externalId.slice("wanfang:".length).trim();
  return normalizeArticleId(article?.url || "");
}

export async function fetchWanfangArticleDetails(article, options = {}) {
  const articleId = articleIdFromArticle(article);
  if (!articleId) throw new Error("Wanfang article has no article id");
  const controller = new AbortController();
  const timeoutMs = Number(options.timeoutMs || config.crawlerTimeoutMs || 12000);
  const timer = timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetch(WANFANG_DETAIL_ENDPOINT, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Accept: "application/grpc-web+proto",
        "Content-Type": "application/grpc-web+proto",
        "X-Grpc-Web": "1",
        "X-User-Agent": "grpc-web-javascript/0.1",
        Origin: "https://d.wanfangdata.com.cn",
        Referer: `https://d.wanfangdata.com.cn/periodical/${encodeURIComponent(articleId)}`
      },
      body: encodeDetailRequest(articleId)
    });
    if (!response.ok) throw new Error(`Wanfang detail returned ${response.status}`);
    const detail = parseWanfangDetailResponse(await response.arrayBuffer());
    if (!detail) throw new Error("Wanfang detail returned no periodical metadata");
    return {
      ...detail,
      url: article?.url || `https://d.wanfangdata.com.cn/periodical/${encodeURIComponent(articleId)}`
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function parseWanfangRss(xml, journal, options = {}) {
  const text = String(xml || "").replace(/^\uFEFF/, "");
  const maxRecords = Math.max(1, Number(options.maxRecords || 50));
  const records = [];
  for (const block of text.match(/<item\b[^>]*>[\s\S]*?<\/item>/gi) || []) {
    const title = readTag(block, "title");
    if (!isResearchArticle(title)) continue;
    const description = readTag(block, "description") || readTag(block, "content:encoded");
    const link = readTag(block, "link");
    const guid = readTag(block, "guid");
    const articleId = normalizeArticleId(link || guid);
    if (!articleId) continue;
    const publishedAt = normalizePublishedAt(readTag(block, "pubDate"));
    const issue = parseIssue(articleId);
    const canonicalUrl = `https://d.wanfangdata.com.cn/periodical/${encodeURIComponent(articleId)}`;
    records.push({
      external_id: `wanfang:${articleId.toLowerCase()}`,
      title,
      authors: "",
      journal: journal?.name || "",
      year: issue.year || (publishedAt ? Number(publishedAt.slice(0, 4)) || null : null),
      volume: "",
      issue: issue.issue,
      doi: "",
      abstract: description,
      url: canonicalUrl,
      published_at: publishedAt,
      fetched_at: new Date().toISOString(),
      keywords: ""
    });
    if (records.length >= maxRecords) break;
  }
  return records;
}

export async function fetchWanfangArticles(journal, options = {}) {
  const wanfangId = String(journal?.wanfangId || "").trim();
  if (!wanfangId) return [];
  const url = `${WANFANG_RSS_BASE}/${encodeURIComponent(wanfangId)}`;
  const controller = new AbortController();
  const timeoutMs = Number(config.crawlerTimeoutMs || 12000);
  const timer = timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
        "User-Agent": "literature-push/1.0 (Wanfang RSS collector)"
      }
    });
    if (!response.ok) throw new Error(`Wanfang RSS returned ${response.status} for ${journal.name}`);
    const xml = await readResponseText(response);
    const records = parseWanfangRss(xml, journal, options);
    if (!records.length) throw new Error(`Wanfang RSS returned no usable articles for ${journal.name}`);
    return records;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export const internals = {
  decodeXmlText,
  readTag,
  normalizeArticleId,
  normalizePublishedAt,
  parseIssue,
  isResearchArticle,
  encodeDetailRequest,
  parseProtoFields,
  parseGrpcWebFrames,
  protoStrings,
  protoFirstString,
  articleIdFromArticle
};
