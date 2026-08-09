import { config } from "./config.js";
import { normalizeArticle as normalizeIeeeArticle, fetchJournalArticles as fetchIeeeArticles } from "./ieee.js";
import { decodeBasicEntities, stripTags, ELECTRICAL_FILTER_KEYWORDS } from "./utils.js";

const CROSSREF_API = "https://api.crossref.org";
const OPENALEX_API = "https://api.openalex.org/works";

const SKIP_TITLE_PATTERNS = [
  /^table of contents$/i,
  /^ieee transactions .* information for authors$/i,
  /^ieee .* information$/i,
  /^ieee .* publication information$/i,
  /^information for authors$/i,
  /^publication information$/i,
  /^front cover$/i,
  /^back cover$/i,
  /^editorial$/i,
  /^blank page$/i,
  /^correction to /i
];

function isoDateDaysAgo(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

function datePartsToIso(parts) {
  if (!Array.isArray(parts) || !parts.length) return "";
  const [year, month = 1, day = 1] = parts;
  if (!year) return "";
  return [year, month, day].map((value, index) => {
    const text = String(value);
    return index === 0 ? text : text.padStart(2, "0");
  }).join("-");
}

function normalizeDoi(value) {
  return String(value || "")
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")
    .trim()
    .toLowerCase();
}

function articleKey(doi, fallback) {
  const normalizedDoi = normalizeDoi(doi);
  return normalizedDoi ? `doi:${normalizedDoi}` : `source:${String(fallback || "").trim().toLowerCase()}`;
}

function isResearchArticle(title) {
  return title && !SKIP_TITLE_PATTERNS.some((pattern) => pattern.test(title.trim()));
}

function matchesJournalFilter(article, journal) {
  if (!journal.filterKeywords || !journal.filterKeywords.length) return true;
  const text = [article.title, article.abstract, article.keywords].filter(Boolean).join(" ").toLowerCase();
  if (!text) return false;
  return journal.filterKeywords.some((kw) => text.includes(kw.toLowerCase()));
}

// Extract keywords from title/abstract for articles without keywords
function extractKeywordsFromText(title, abstract) {
  const text = [title, abstract].filter(Boolean).join(" ").toLowerCase();
  if (!text) return "";
  
  const powerKeywords = [
    "power grid", "power system", "electric", "electrical", "microgrid", "micro-grid",
    "distributed generation", "renewable energy", "solar", "photovoltaic", "wind",
    "energy storage", "battery", "electric vehicle", "EV", "smart grid",
    "demand response", "power electronics", "inverter", "converter",
    "voltage regulation", "frequency control", "grid", "transmission", "distribution",
    "protection", "power flow", "energy management", "DER", "VPP",
    "machine learning", "deep learning", "optimization", "resilience",
    "hydrogen", "fuel cell", "electricity market"
  ];
  
  const found = [];
  for (const kw of powerKeywords) {
    if (text.includes(kw.toLowerCase())) {
      found.push(kw);
    }
  }
  return found.slice(0, 10).join("; ");
}

function normalizeCrossrefItem(item, journal) {
  const title = decodeBasicEntities(item.title?.[0] || "");
  const doi = normalizeDoi(item.DOI);
  const authors = Array.isArray(item.author)
    ? item.author.map((author) => [author.given, author.family].filter(Boolean).join(" ")).filter(Boolean).join(", ")
    : "";
  const keywords = Array.isArray(item.subject)
    ? item.subject.filter(Boolean).join("; ")
    : "";

  return {
    external_id: articleKey(doi, item.URL || title),
    title,
    authors,
    journal: item["container-title"]?.[0] || journal.name,
    year: item.published?.["date-parts"]?.[0]?.[0] || item.issued?.["date-parts"]?.[0]?.[0] || null,
    volume: item.volume || "",
    issue: item.issue || "",
    doi,
    abstract: decodeBasicEntities(stripTags(item.abstract || "")),
    url: item.URL || (doi ? `https://doi.org/${doi}` : ""),
    published_at: datePartsToIso(item.published?.["date-parts"]?.[0] || item.issued?.["date-parts"]?.[0]),
    fetched_at: new Date().toISOString(),
    keywords
  };
}

function normalizeOpenAlexItem(item, journal) {
  const title = decodeBasicEntities(item.title || item.display_name || "");
  const doi = normalizeDoi(item.doi);
  const authors = Array.isArray(item.authorships)
    ? item.authorships.map((authorship) => authorship.author?.display_name).filter(Boolean).join(", ")
    : "";
  
  // Extract keywords from OpenAlex - ensure we always get strings
  let keywords = "";
  
  // 1. Try OpenAlex keywords array (objects with display_name)
  if (Array.isArray(item.keywords) && item.keywords.length > 0) {
    const kwList = [];
    for (const kw of item.keywords) {
      if (typeof kw === "string") {
        kwList.push(kw);
      } else if (kw && typeof kw === "object") {
        const name = kw.display_name || kw.name || "";
        if (name && typeof name === "string") {
          kwList.push(name);
        }
      }
    }
    keywords = kwList.join("; ");
  }
  
  // 2. Fallback to concepts (objects with display_name and score)
  if (!keywords && Array.isArray(item.concepts) && item.concepts.length > 0) {
    const conceptList = [];
    for (const c of item.concepts) {
      if (!c || typeof c !== "object") continue;
      const score = typeof c.score === "number" ? c.score : 0;
      const name = c.display_name || c.name || "";
      if (score > 0.3 && name && typeof name === "string") {
        conceptList.push(name);
      }
    }
    keywords = conceptList.join("; ");
  }
  
  // 3. Add primary_topic as keyword if available
  if (item.primary_topic && typeof item.primary_topic === "object") {
    const topicName = item.primary_topic.display_name || "";
    if (topicName && typeof topicName === "string" && !keywords.toLowerCase().includes(topicName.toLowerCase())) {
      keywords = keywords ? `${topicName}; ${keywords}` : topicName;
    }
  }
  
  // 4. Fallback: extract keywords from title/abstract if still empty
  if (!keywords) {
    const abstract = decodeBasicEntities(reconstructOpenAlexAbstract(item.abstract_inverted_index));
    keywords = extractKeywordsFromText(title, abstract);
  }

  return {
    external_id: articleKey(doi, item.id || title),
    title,
    authors,
    journal: item.primary_location?.source?.display_name || journal.name,
    year: item.publication_year || null,
    volume: item.biblio?.volume || "",
    issue: item.biblio?.issue || "",
    doi,
    abstract: decodeBasicEntities(reconstructOpenAlexAbstract(item.abstract_inverted_index)),
    url: item.primary_location?.landing_page_url || item.doi || item.id || "",
    published_at: item.publication_date || "",
    fetched_at: new Date().toISOString(),
    keywords: String(keywords || "")
  };
}

function reconstructOpenAlexAbstract(index) {
  if (!index || typeof index !== "object") return "";
  const words = [];
  for (const [word, positions] of Object.entries(index)) {
    for (const position of positions) {
      words[position] = word;
    }
  }
  return words.filter(Boolean).join(" ");
}

async function fetchCrossrefBatch(journal, options = {}, dateFilter = "from-pub-date", sort = "published") {
  const issn = journal.issns?.[0];
  if (!issn) return [];

  const params = new URLSearchParams({
    filter: `${dateFilter}:${isoDateDaysAgo(options.lookbackDays || config.lookbackDays)},type:journal-article`,
    sort,
    order: "desc",
    rows: String(options.maxRecords || 50)
  });
  if (config.crossrefMailto) {
    params.set("mailto", config.crossrefMailto);
  }

  const response = await fetch(`${CROSSREF_API}/journals/${encodeURIComponent(issn)}/works?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`Crossref returned ${response.status} for ${journal.name}`);
  }

  const data = await response.json();
  return (data.message?.items || [])
    .map((item) => normalizeCrossrefItem(item, journal))
    .filter((article) => isResearchArticle(article.title) && matchesJournalFilter(article, journal));
}

async function fetchCrossrefArticles(journal, options = {}) {
  // Crossref publication dates may be future issue dates; the lower-bound
  // filter intentionally keeps those Online Early records while excluding old
  // papers that were merely re-indexed or deposited recently.
  return fetchCrossrefBatch(journal, options, "from-pub-date", "published");
}

async function fetchOpenAlexArticles(journal, options = {}) {
  const issn = journal.issns?.[0];
  if (!issn) return [];

  const params = new URLSearchParams({
    filter: `primary_location.source.issn:${issn},from_publication_date:${isoDateDaysAgo(options.lookbackDays || config.lookbackDays)}`,
    sort: "publication_date:desc",
    "per-page": String(options.maxRecords || 50),
    select: "id,doi,title,display_name,publication_year,publication_date,biblio,authorships,primary_location,abstract_inverted_index,keywords,concepts,primary_topic"
  });
  if (config.crossrefMailto) {
    params.set("mailto", config.crossrefMailto);
  }

  const response = await fetch(`${OPENALEX_API}?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`OpenAlex returned ${response.status} for ${journal.name}`);
  }

  const data = await response.json();
  return (data.results || [])
    .map((item) => normalizeOpenAlexItem(item, journal))
    .filter((article) => isResearchArticle(article.title) && matchesJournalFilter(article, journal));
}

function dedupeArticles(articles) {
  const byId = new Map();
  for (const article of articles) {
    if (!article.external_id) continue;
    const existing = byId.get(article.external_id);
    byId.set(article.external_id, existing ? mergeArticle(existing, article) : article);
  }
  return [...byId.values()];
}

function mergeArticle(primary, secondary) {
  return {
    ...primary,
    title: primary.title || secondary.title,
    authors: primary.authors || secondary.authors,
    journal: primary.journal || secondary.journal,
    year: primary.year || secondary.year,
    volume: primary.volume || secondary.volume,
    issue: primary.issue || secondary.issue,
    doi: primary.doi || secondary.doi,
    abstract: primary.abstract || secondary.abstract,
    url: primary.url || secondary.url,
    published_at: primary.published_at || secondary.published_at,
    keywords: primary.keywords || secondary.keywords,
    fetched_at: new Date().toISOString()
  };
}

export async function fetchJournalArticles(journal, options = {}) {
  const sources = config.publicDataSources;
  const batches = [];
  const errors = [];

  if (sources.includes("crossref")) {
    try {
      batches.push(await fetchCrossrefArticles(journal, options));
    } catch (error) {
      errors.push(error.message);
    }
  }

  if (sources.includes("openalex")) {
    try {
      batches.push(await fetchOpenAlexArticles(journal, options));
    } catch (error) {
      errors.push(error.message);
    }
  }

  if (config.ieeeApiKey && sources.includes("ieee")) {
    try {
      batches.push(await fetchIeeeArticles(journal.name, options));
    } catch (error) {
      errors.push(error.message);
    }
  }

  const articles = dedupeArticles(batches.flat());
  if (!articles.length && errors.length) {
    throw new Error(errors.join("; "));
  }
  return articles;
}

export { normalizeIeeeArticle };
export const internals = {
  normalizeCrossrefItem,
  normalizeOpenAlexItem,
  normalizeDoi,
  reconstructOpenAlexAbstract
};
