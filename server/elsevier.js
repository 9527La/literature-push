import { config } from "./config.js";

const ELSEVIER_API_BASE = "https://api.elsevier.com/content";

export async function fetchElsevierArticleDetails(doi) {
  if (!config.elsevierApiKey) {
    throw new Error("Elsevier API key not configured");
  }

  const cleanDoi = doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").trim();
  const url = `${ELSEVIER_API_BASE}/article/doi/${encodeURIComponent(cleanDoi)}`;

  const response = await fetch(url, {
    headers: {
      "X-ELS-APIKey": config.elsevierApiKey,
      "Accept": "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`Elsevier API returned ${response.status}`);
  }

  const data = await response.json();
  return normalizeElsevierItem(data);
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

function stripTags(value) {
  return String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export const internals = {
  fetchElsevierArticleDetails,
  normalizeElsevierItem,
  extractAuthors,
  extractKeywords
};
