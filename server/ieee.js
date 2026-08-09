import { config } from "./config.js";

const API_URL = "https://ieeexploreapi.ieee.org/api/v1/search/articles";

function formatDate(date) {
  return date.toISOString().slice(0, 10).replaceAll("-", "");
}

function normalizeAuthors(article) {
  if (Array.isArray(article.authors?.authors)) {
    return article.authors.authors.map((author) => author.full_name).filter(Boolean).join(", ");
  }
  if (Array.isArray(article.authors)) {
    return article.authors.map((author) => author.full_name || author.name || author).filter(Boolean).join(", ");
  }
  return "";
}

function normalizePublishedAt(article) {
  const value = String(article.publication_date || article.date || article.insert_date || article.year || "");
  if (/^\d{8}$/.test(value)) {
    return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6)}`;
  }
  return value;
}

function normalizeKeywords(article) {
  const terms = [];
  const allowedTypes = new Set([
    "ieee keywords", "ieee author keywords", "author keywords"
  ]);
  const indexTerms = article.index_terms;
  if (indexTerms && typeof indexTerms === "object") {
    // IEEE index_terms is an object like { "IEEE Author Keywords": [...], "MeSH Terms": [...] }
    for (const [key, category] of Object.entries(indexTerms)) {
      if (!allowedTypes.has(key.toLowerCase())) continue;
      if (Array.isArray(category)) {
        terms.push(...category.filter(Boolean));
      }
    }
  }
  // Deduplicate and join
  return [...new Set(terms.map((term) => String(term).trim()).filter(Boolean))].join("; ");
}

export function normalizeArticle(article, fallbackJournal) {
  const doi = article.doi || article.DOI || "";
  const articleNumber = article.article_number || article.articleNumber || article.document_identifier || "";
  const externalId = doi || articleNumber || article.pdf_url || article.html_url || article.title;

  return {
    external_id: String(externalId),
    title: article.title || "Untitled",
    authors: normalizeAuthors(article),
    journal: article.publication_title || fallbackJournal,
    year: Number(article.publication_year || article.year || 0) || null,
    volume: article.volume || "",
    issue: article.issue || "",
    doi,
    abstract: article.abstract || "",
    url: article.html_url || article.pdf_url || (doi ? `https://doi.org/${doi}` : ""),
    published_at: normalizePublishedAt(article),
    fetched_at: new Date().toISOString(),
    keywords: normalizeKeywords(article)
  };
}

export async function fetchJournalArticles(journal, options = {}) {
  if (!config.ieeeApiKey) {
    throw new Error("IEEE_API_KEY is not configured");
  }

  const lookbackDays = Number(options.lookbackDays || config.lookbackDays);
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - lookbackDays);

  const params = new URLSearchParams({
    apikey: config.ieeeApiKey,
    format: "json",
    max_records: String(options.maxRecords || 50),
    start_record: "1",
    sort_order: "desc",
    sort_field: "article_number",
    publication_title: journal,
    start_date: formatDate(start),
    end_date: formatDate(end)
  });

  const response = await fetch(`${API_URL}?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`IEEE API returned ${response.status}`);
  }

  const data = await response.json();
  return (data.articles || []).map((article) => normalizeArticle(article, journal));
}
