import { articlePlatform, PLATFORM_PROFILES } from "./publishers.js";
import { config, DEFAULT_JOURNAL_BY_NAME } from "./config.js";
import { decodeEntities, stripTags, sleep, readResponseText, isUsableMetadataText, safeExternalError } from "./utils.js";
import { fetchElsevierArticleDetails, fetchScopusArticleDetails } from "./elsevier.js";
import { fetchIeeeArticleDetails } from "./ieee.js";
import { fetchWanfangArticleDetails } from "./wanfang.js";
import { fetchSemanticScholarWebDetails } from "./semantic-scholar-web.js";

const CROSSREF_API = "https://api.crossref.org/works";
const OPENALEX_API = "https://api.openalex.org/works";
const SEMANTIC_SCHOLAR_API = "https://api.semanticscholar.org/graph/v1/paper";
const DEFAULT_SEMANTIC_SCHOLAR_INTERVAL_MS = 1100;
let semanticScholarQueue = Promise.resolve();
let semanticScholarLastStartedAt = 0;

function normalizePublicationDate(value) {
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

function parseTagAttributes(tag) {
  const attributes = {};
  const pattern = /([\w:-]+)\s*=\s*(["'])([\s\S]*?)\2/g;
  let match;
  while ((match = pattern.exec(tag)) !== null) {
    attributes[match[1].toLowerCase()] = decodeEntities(match[3]);
  }
  return attributes;
}

function extractMetaContent(html, name) {
  const wanted = String(name).toLowerCase();
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const attributes = parseTagAttributes(tag);
    if ([attributes.name, attributes.property, attributes.itemprop].some((value) => String(value || "").toLowerCase() === wanted)) {
      return stripTags(attributes.content || "");
    }
  }
  return "";
}

function extractJsonAssignment(html, marker) {
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

function parseIeeeMetadata(html) {
  const raw = extractJsonAssignment(html, "xplGlobal.document.metadata=");
  if (!raw) return {};

  try {
    const metadata = JSON.parse(raw);
    const authors = Array.isArray(metadata.authors)
      ? metadata.authors.map((author) => author.name || author.preferredName).filter(Boolean).join(", ")
      : "";

    // Extract index terms (keywords) from IEEE metadata
    const keywords = extractIndexTerms(metadata.indexTerms || metadata.keywords || null);

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
      keywords
    };
  } catch {
    return {};
  }
}

function extractIndexTerms(indexTerms) {
  if (!indexTerms) return "";
  const terms = [];
  const allowedTypes = new Set(["ieee keywords", "author keywords"]);

  if (Array.isArray(indexTerms)) {
    for (const item of indexTerms) {
      if (typeof item === "string") {
        terms.push(item);
      } else if (typeof item === "object" && item) {
        // Only keep IEEE Keywords and Author Keywords, skip Index Terms and others
        const type = String(item.type || "").toLowerCase();
        if (type && !allowedTypes.has(type)) continue;

        if (Array.isArray(item.kwd)) {
          terms.push(...item.kwd.filter(Boolean));
        } else if (Array.isArray(item.terms)) {
          terms.push(...item.terms.filter(Boolean));
        } else if (item.term) {
          terms.push(item.term);
        } else if (item.name) {
          terms.push(item.name);
        } else if (item.value) {
          terms.push(item.value);
        }
      }
    }
  } else if (typeof indexTerms === "object") {
    // Alternate structure: { "IEEE Author Keywords": [...], ... }
    for (const [key, category] of Object.entries(indexTerms)) {
      if (!allowedTypes.has(key.toLowerCase())) continue;
      if (Array.isArray(category)) {
        terms.push(...category.filter(Boolean));
      } else if (typeof category === "string") {
        terms.push(category);
      }
    }
  }

  return [...new Set(terms.map((term) => String(term).trim()).filter(Boolean))].join("; ");
}

function extractMetaContentAll(html, name) {
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

function reconstructOpenAlexAbstract(index) {
  if (!index || typeof index !== "object") return "";
  const words = [];
  for (const [word, positions] of Object.entries(index)) {
    for (const position of positions || []) words[position] = word;
  }
  return words.filter(Boolean).join(" ");
}

function normalizeOpenAlexDetail(item, fallbackDoi = "") {
  const normalizedDoi = String(item?.doi || fallbackDoi || "")
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")
    .trim();
  const keywords = Array.isArray(item?.keywords)
    ? item.keywords.map((keyword) => keyword?.display_name || keyword?.name || keyword).filter(Boolean).join("; ")
    : "";
  const conceptKeywords = Array.isArray(item?.concepts)
    ? item.concepts
      .filter((concept) => Number(concept?.score || 0) >= 0.35)
      .map((concept) => concept?.display_name || concept?.name || "")
      .filter(Boolean)
      .join("; ")
    : "";
  return {
    title: stripTags(item?.title || ""),
    authors: Array.isArray(item?.authorships)
      ? item.authorships.map((entry) => entry.author?.display_name).filter(Boolean).join(", ")
      : "",
    journal: stripTags(item?.primary_location?.source?.display_name || ""),
    year: item?.publication_year || null,
    volume: item?.biblio?.volume || "",
    issue: item?.biblio?.issue || "",
    doi: normalizedDoi,
    abstract: reconstructOpenAlexAbstract(item?.abstract_inverted_index),
    url: item?.primary_location?.landing_page_url || (normalizedDoi ? `https://doi.org/${normalizedDoi}` : item?.id || ""),
    published_at: item?.publication_date || "",
    keywords: keywords || conceptKeywords || item?.primary_topic?.display_name || ""
  };
}

// OpenAlex moved to mandatory API keys plus usage-based billing in early 2026.
// Without a key every call draws on a small anonymous pool that is regularly
// exhausted, which shows up as an immediate HTTP 429 ("Insufficient budget")
// and silently removes the main keyword source.  Send the key when we have one;
// `mailto` remains as the courtesy identifier for the keyless path.
function applyOpenAlexAuth(params) {
  if (config.openAlexApiKey) params.set("api_key", config.openAlexApiKey);
  if (config.crossrefMailto) params.set("mailto", config.crossrefMailto);
  return params;
}

async function fetchOpenAlexDetails(doi) {
  const normalizedDoi = String(doi || "").replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").trim();
  if (!normalizedDoi) return {};
  const params = new URLSearchParams({
    select: "id,doi,title,publication_year,publication_date,biblio,authorships,primary_location,abstract_inverted_index,keywords,concepts,primary_topic"
  });
  applyOpenAlexAuth(params);
  const item = await fetchJson(`https://api.openalex.org/works/${encodeURIComponent(`https://doi.org/${normalizedDoi}`)}?${params}`);
  return normalizeOpenAlexDetail(item, normalizedDoi);
}

function normalizeTitleForMatch(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "");
}

function openAlexSourceMatchesJournal(item, journal) {
  const expectedIssns = new Set((journal?.issns || []).map((issn) => String(issn).trim()).filter(Boolean));
  if (!expectedIssns.size) return false;
  const source = item?.primary_location?.source || {};
  const actualIssns = Array.isArray(source.issn) ? source.issn : [source.issn_l, source.issn];
  return actualIssns.some((issn) => expectedIssns.has(String(issn || "").trim()));
}

async function fetchOpenAlexDetailsByTitle(article) {
  const journal = DEFAULT_JOURNAL_BY_NAME.get(String(article?.journal || "").trim());
  const title = String(article?.title || "").trim();
  if (!journal?.wanfangId || !title || !/[\u3400-\u9fff]/u.test(title)) return {};

  const params = new URLSearchParams({
    search: title,
    "per-page": "10",
    select: "id,doi,title,publication_year,publication_date,biblio,authorships,primary_location,abstract_inverted_index,keywords,concepts,primary_topic"
  });
  const issn = journal.issns?.[0];
  if (issn) params.set("filter", `primary_location.source.issn:${issn},type:article`);
  applyOpenAlexAuth(params);
  const data = await fetchJson(`${OPENALEX_API}?${params.toString()}`);
  const expectedTitle = normalizeTitleForMatch(title);
  const item = (data?.results || []).find((candidate) => (
    openAlexSourceMatchesJournal(candidate, journal)
    && normalizeTitleForMatch(candidate.title || candidate.display_name) === expectedTitle
  ));
  return item ? normalizeOpenAlexDetail(item) : {};
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.crawlerTimeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    if (response.ok === false) {
      const error = new Error(`Metadata source returned ${response.status}`);
      error.status = response.status;
      error.retryAfter = Number(response.headers?.get?.("retry-after")) || 0;
      throw error;
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function semanticScholarIntervalMs() {
  const configured = Number(config.semanticScholarRequestIntervalMs);
  return Number.isFinite(configured) && configured >= 0
    ? configured
    : DEFAULT_SEMANTIC_SCHOLAR_INTERVAL_MS;
}

function enqueueSemanticScholarRequest(request) {
  const run = semanticScholarQueue.catch(() => {}).then(async () => {
    const waitMs = Math.max(0, semanticScholarIntervalMs() - (Date.now() - semanticScholarLastStartedAt));
    if (waitMs > 0) await sleep(waitMs);
    semanticScholarLastStartedAt = Date.now();
    return request();
  });
  semanticScholarQueue = run.catch(() => {});
  return run;
}

async function fetchSemanticScholarJson(url) {
  return enqueueSemanticScholarRequest(async () => {
    let lastError;
    for (let attempt = 0; attempt <= 2; attempt += 1) {
      try {
        return await fetchJson(url, {
          headers: {
            Accept: "application/json",
            "User-Agent": "literature-push/1.0 (metadata crawler)"
          }
        });
      } catch (error) {
        lastError = error;
        const retryable = error?.status === 408 || error?.status === 425 || error?.status === 429 || error?.status >= 500;
        if (!retryable || attempt >= 2) throw error;
        const retryAfter = Number(error.retryAfter) > 0 ? Number(error.retryAfter) * 1000 : 1000 * (attempt + 1);
        await sleep(Math.min(5000, retryAfter));
      }
    }
    throw lastError || new Error("Semantic Scholar request failed");
  });
}

async function fetchCrossrefDetails(doi) {
  const normalizedDoi = String(doi || "").replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").trim();
  if (!normalizedDoi) return {};
  const url = `${CROSSREF_API}/${encodeURIComponent(normalizedDoi)}${config.crossrefMailto ? `?mailto=${encodeURIComponent(config.crossrefMailto)}` : ""}`;
  const data = await fetchJson(url, { headers: { Accept: "application/json" } });
  const item = data?.message || {};
  const title = Array.isArray(item.title) ? item.title[0] : item.title;
  const authors = Array.isArray(item.author)
    ? item.author.map((author) => [author.given, author.family].filter(Boolean).join(" ")).filter(Boolean).join(", ")
    : "";
  const dateParts = item.published?.["date-parts"]?.[0] || item.issued?.["date-parts"]?.[0] || [];
  const publishedAt = dateParts.length
    ? [dateParts[0], dateParts[1] || 1, dateParts[2] || 1].map((value, index) => index ? String(value).padStart(2, "0") : String(value)).join("-")
    : "";
  const keywords = Array.isArray(item.subject)
    ? item.subject.map((subject) => String(subject || "").trim()).filter(Boolean).join("; ")
    : "";
  return {
    title: decodeEntities(stripTags(title || "")),
    authors,
    journal: stripTags(item["container-title"]?.[0] || ""),
    year: Number(dateParts[0] || 0) || null,
    volume: item.volume || "",
    issue: item.issue || "",
    doi: item.DOI || normalizedDoi,
    abstract: decodeEntities(stripTags(item.abstract || "")),
    url: item.URL || `https://doi.org/${normalizedDoi}`,
    published_at: publishedAt,
    keywords
  };
}

async function fetchSemanticScholarDetails(doi) {
  const normalizedDoi = String(doi || "").replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").trim();
  if (!normalizedDoi) return {};
  const fields = "title,abstract,authors,venue,year,externalIds,url";
  const data = await fetchSemanticScholarJson(`${SEMANTIC_SCHOLAR_API}/${encodeURIComponent(`DOI:${normalizedDoi}`)}?fields=${fields}`);
  const authors = Array.isArray(data?.authors)
    ? data.authors.map((author) => author?.name).filter(Boolean).join(", ")
    : "";
  return {
    title: decodeEntities(stripTags(data?.title || "")),
    authors,
    journal: stripTags(data?.venue || ""),
    year: Number(data?.year || 0) || null,
    doi: data?.externalIds?.DOI || normalizedDoi,
    abstract: decodeEntities(stripTags(data?.abstract || "")),
    url: data?.url || `https://doi.org/${normalizedDoi}`,
    keywords: ""
  };
}

function parseHtmlMetadata(html) {
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

function parseElsevierMetadata(html) {
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

function mergeDetails(primary, fallback) {
  return Object.fromEntries(
    Object.keys({ ...fallback, ...primary }).map((key) => {
      const preferred = primary?.[key];
      const usable = typeof preferred === "string" ? preferred.trim().length > 0 : preferred !== null && preferred !== undefined && preferred !== 0;
      return [key, usable ? preferred : fallback?.[key] || ""];
    })
  );
}

function isElsevierArticle(article) {
  return articlePlatform(article) === "elsevier";
}

function isWanfangArticle(article) {
  return articlePlatform(article) === "wanfang";
}

function normalizeRequestedFields(fields) {
  const requested = Array.isArray(fields) && fields.length ? fields : ["abstract", "keywords"];
  return new Set(requested.filter((field) => field === "abstract" || field === "keywords"));
}

function missingRequestedFields(details, requestedFields) {
  return [...requestedFields].filter((field) => !String(details?.[field] || "").trim());
}

export async function crawlArticleDetails(article, options = {}) {
  const requestedFields = normalizeRequestedFields(options.fields);
  const needsAbstract = requestedFields.has("abstract") && !String(article.abstract || "").trim();
  const needsKeywords = requestedFields.has("keywords") && !String(article.keywords || "").trim();
  if (!needsAbstract && !needsKeywords) return { ...article };

  if (!config.crawlerEnabled) {
    throw new Error("Crawler is disabled");
  }

  const target = article.url || (article.doi ? `https://doi.org/${article.doi}` : "");
  if (!target) {
    throw new Error("Article has no DOI or URL to crawl");
  }

  let details = { ...article };
  let sourceFound = false;

  const mergeSource = (candidate) => {
    if (!candidate || typeof candidate !== "object") return;
    const sanitized = { ...candidate };
    for (const field of ["title", "authors", "journal", "abstract", "keywords"]) {
      if (sanitized[field] && !isUsableMetadataText(sanitized[field])) sanitized[field] = "";
    }
    if (sanitized.title || sanitized.abstract || sanitized.keywords) sourceFound = true;
    details = mergeDetails(details, sanitized);
  };
  const isComplete = () =>
    (!needsAbstract || String(details.abstract || "").trim().length > 0)
    && (!needsKeywords || String(details.keywords || "").trim().length > 0);
  // A Wanfang detail response can discover a DOI that was not present in the
  // RSS record.  Resolve the DOI lazily after every source merge so OpenAlex,
  // Crossref, and Semantic Scholar can still act as fallbacks for that same
  // article.
  const getFallbackDoi = () => String(details.doi || article.doi || "").trim();

  const sourceErrors = [];
  const adapters = {
    ieee: () => getFallbackDoi() ? fetchIeeeArticleDetails(getFallbackDoi()) : null,
    scopus: () => getFallbackDoi() ? fetchScopusArticleDetails(getFallbackDoi()) : null,
    elsevier: () => config.elsevierApiKey && getFallbackDoi() ? fetchElsevierArticleDetails(getFallbackDoi()) : null,
    wanfang: () => fetchWanfangArticleDetails(article),
    openalexTitle: () => !getFallbackDoi() ? fetchOpenAlexDetailsByTitle(details) : null,
    openalex: () => getFallbackDoi() ? fetchOpenAlexDetails(getFallbackDoi()) : null,
    crossref: () => getFallbackDoi() ? fetchCrossrefDetails(getFallbackDoi()) : null,
    semanticScholar: () => getFallbackDoi() ? fetchSemanticScholarDetails(getFallbackDoi()) : null,
    semanticScholarWeb: () => needsAbstract ? fetchSemanticScholarWebDetails(details) : null
  };
  for (const source of PLATFORM_PROFILES[articlePlatform(article)].details) {
    if (source === "html" || isComplete()) break;
    try {
      mergeSource(await adapters[source]());
    } catch (error) {
      sourceErrors.push({ source, message: safeExternalError(error) });
    }
  }
  if (typeof options.onDiagnostics === "function") options.onDiagnostics(sourceErrors);

  if (isComplete()) return details;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.crawlerTimeoutMs);

  try {
    const response = await fetch(target, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5"
      }
    });

    if (response.ok === false) throw new Error(`Publisher returned ${response.status}`);
    const html = await readResponseText(response);
    
    // Check if this is a linkinghub redirect page (Elsevier)
    const finalUrl = response.url || target;
    if (finalUrl.includes("linkinghub.elsevier.com")) {
      // Extract the actual ScienceDirect URL from meta refresh
      const refreshMatch = html.match(/content=["']2;\s*url='([^']+)["']/i);
      if (refreshMatch) {
        const redirectPath = refreshMatch[1].replace(/&amp;/g, "&");
        const redirectUrl = /^https?:\/\//i.test(redirectPath)
          ? redirectPath
          : `https://linkinghub.elsevier.com${redirectPath}`;
        try {
          const finalResponse = await fetch(redirectUrl, {
            redirect: "follow",
            signal: controller.signal,
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
              "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
              "Accept-Language": "en-US,en;q=0.5"
            }
          });
          
          if (finalResponse.ok === false) throw new Error(`Publisher returned ${finalResponse.status}`);
          const finalHtml = await readResponseText(finalResponse);
          mergeSource(mergeDetails(
            mergeDetails(parseIeeeMetadata(finalHtml), parseHtmlMetadata(finalHtml)),
            parseElsevierMetadata(finalHtml)
          ));
        } catch {
          // Fall through to parse the redirect page
        }
      }
    }
    
    // Try IEEE metadata first, then HTML metadata, then Elsevier-specific
    const htmlDetails = mergeDetails(parseIeeeMetadata(html), parseHtmlMetadata(html));
    mergeSource(htmlDetails);
    
    // If it's an Elsevier article and we're missing data, try Elsevier parser
    if (isElsevierArticle(article) && !isComplete()) {
      mergeSource(parseElsevierMetadata(html));
    }

    if (!sourceFound) {
      const error = new Error("No crawlable metadata found on the public page");
      error.details = details;
      throw error;
    }
    const missing = missingRequestedFields(details, requestedFields);
    if (missing.length) {
      const error = new Error(`公开来源未返回${missing.map((field) => field === "abstract" ? "摘要" : "关键词").join("、")}`);
      error.details = details;
      throw error;
    }
    return details;
  } catch (error) {
    // Preserve fields collected by an earlier DOI/API source even when the
    // publisher page itself is unavailable. Callers can save the usable
    // portion and report only the field(s) that are still missing.
    if (!error.details) error.details = details;
    error.message = safeExternalError(error, "\u516c\u5f00\u6765\u6e90\u672a\u8fd4\u56de\u53ef\u7528\u7684\u6458\u8981\u6216\u5173\u952e\u8bcd");
    error.sourceErrors = sourceErrors;
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export const internals = {
  extractJsonAssignment,
  parseIeeeMetadata,
  parseHtmlMetadata,
  parseElsevierMetadata,
  extractMetaContent,
  extractMetaContentAll,
  applyOpenAlexAuth,
  fetchOpenAlexDetails,
  fetchOpenAlexDetailsByTitle,
  fetchCrossrefDetails,
  fetchSemanticScholarDetails,
  fetchSemanticScholarWebDetails,
  mergeDetails,
  normalizeRequestedFields,
  missingRequestedFields,
  normalizePublicationDate,
  isElsevierArticle,
  isWanfangArticle
};
