import { requestJson } from "./http.js";
import { stripTags } from "./utils.js";
import { config } from "./config.js";

const ELSEVIER_API_BASE = "https://api.elsevier.com/content";

export async function fetchElsevierArticleDetails(doi) {
  if (!config.elsevierApiKey) {
    throw new Error("Elsevier API key not configured");
  }

  const cleanDoi = doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").trim();
  const url = `${ELSEVIER_API_BASE}/article/doi/${encodeURIComponent(cleanDoi)}`;

  const data = await requestJson(url, {
    headers: {
      "X-ELS-APIKey": config.elsevierApiKey,
      "Accept": "application/json"
    }
  });

  return normalizeElsevierItem(data);
}

// Scopus Abstract Retrieval covers indexed publications from many publishers,
// including IEEE. It is therefore a useful DOI fallback when the publisher
// API or public landing page has not exposed a new paper's abstract yet.
export async function fetchScopusArticleDetails(doi) {
  if (!config.elsevierApiKey) throw new Error("Elsevier API key not configured");
  const cleanDoi = String(doi || "").replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").trim();
  if (!cleanDoi) return {};
  const data = await requestJson(`${ELSEVIER_API_BASE}/abstract/doi/${encodeURIComponent(cleanDoi)}`, {
    headers: { "X-ELS-APIKey": config.elsevierApiKey, Accept: "application/json" }
  });
  return normalizeScopusItem(data);
}

function normalizeScopusItem(data) {
  const response = data?.["abstracts-retrieval-response"];
  if (!response) throw new Error("No data returned from Scopus Abstract Retrieval");
  const core = response.coredata || {};
  const authors = response.authors?.author || response.item?.bibrecord?.head?.["author-group"]?.author || [];
  const authorList = Array.isArray(authors) ? authors : [authors];
  const authKeywords = response.authkeywords?.["author-keyword"] || response.item?.bibrecord?.head?.["citation-info"]?.["author-keywords"]?.["author-keyword"] || [];
  const keywordList = Array.isArray(authKeywords) ? authKeywords : [authKeywords];
  const coverDate = core["prism:coverDate"] || "";
  return {
    title: stripTags(core["dc:title"] || ""),
    abstract: stripTags(core["dc:description"] || response.item?.bibrecord?.head?.abstracts || ""),
    authors: authorList.map((author) => author?.["ce:indexed-name"] || author?.["preferred-name"]?.["ce:indexed-name"] || author?.$ || "").filter(Boolean).join(", "),
    keywords: keywordList.map((keyword) => keyword?.$ || keyword).filter((value) => typeof value === "string").join("; "),
    journal: stripTags(core["prism:publicationName"] || ""),
    doi: core["prism:doi"] || "",
    volume: core["prism:volume"] || "",
    issue: core["prism:issueIdentifier"] || "",
    year: Number(coverDate.slice(0, 4)) || null,
    published_at: coverDate.slice(0, 10)
  };
}

function normalizeElsevierItem(data) {
  const response = data?.["full-text-retrieval-response"];
  if (!response) {
    throw new Error("No data returned from Elsevier API");
  }

  const coredata = response.coredata || {};
  const item = response.item || {};

  // Extract title
  const title = stripTags(coredata["dc:title"] || "");

  // Extract abstract
  const abstract = stripTags(coredata["dc:description"] || "");

  // Extract authors
  const authors = extractAuthors(item.authors?.author || []);

  // Extract keywords (author keywords)
  const keywords = extractKeywords(item.authKeywords?.["author-keyword"] || []);

  // Extract DOI
  const doi = coredata["prism:doi"] || "";

  // Extract publication date
  const coverDate = coredata["prism:coverDate"] || "";
  const published_at = coverDate ? coverDate.slice(0, 10) : "";

  // Extract volume and issue
  const volume = item.bibliography?.volISS || "";
  const issue = item.bibliography?.issueNr || "";

  // Extract year
  const year = coverDate ? Number(coverDate.slice(0, 4)) || null : null;

  return {
    title,
    abstract,
    authors,
    keywords,
    doi,
    volume,
    issue,
    year,
    published_at
  };
}

function extractAuthors(authors) {
  if (!Array.isArray(authors)) return "";

  return authors
    .map((author) => {
      if (typeof author === "string") return author;
      if (author?.$) return author.$;
      if (author?.["ce:indexed-name"]) return author["ce:indexed-name"];
      return "";
    })
    .filter(Boolean)
    .join(", ");
}

function extractKeywords(keywords) {
  if (!Array.isArray(keywords)) return "";

  return keywords
    .map((kw) => {
      if (typeof kw === "string") return kw;
      if (kw?.$) return kw.$;
      return "";
    })
    .filter(Boolean)
    .join("; ");
}


export const internals = {
  fetchElsevierArticleDetails,
  fetchScopusArticleDetails,
  normalizeElsevierItem,
  normalizeScopusItem,
  extractAuthors,
  extractKeywords
};
