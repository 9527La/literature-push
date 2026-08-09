import { config } from "./config.js";
import { decodeEntities, stripTags } from "./utils.js";
import { fetchElsevierArticleDetails } from "./elsevier.js";

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

async function fetchOpenAlexDetails(doi) {
  const normalizedDoi = String(doi || "").replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").trim();
  if (!normalizedDoi) return {};
  const params = new URLSearchParams({
    select: "id,doi,title,publication_year,publication_date,biblio,authorships,primary_location,abstract_inverted_index,keywords,primary_topic"
  });
  if (config.crossrefMailto) params.set("mailto", config.crossrefMailto);
  const response = await fetch(`https://api.openalex.org/works/${encodeURIComponent(`https://doi.org/${normalizedDoi}`)}?${params}`);
  if (!response.ok) throw new Error(`OpenAlex returned ${response.status}`);
  const item = await response.json();
  const keywords = Array.isArray(item.keywords)
    ? item.keywords.map((keyword) => keyword?.display_name || keyword?.name || keyword).filter(Boolean).join("; ")
    : "";
  return {
    title: stripTags(item.title || ""),
    authors: Array.isArray(item.authorships)
      ? item.authorships.map((entry) => entry.author?.display_name).filter(Boolean).join(", ")
      : "",
    journal: stripTags(item.primary_location?.source?.display_name || ""),
    year: item.publication_year || null,
    volume: item.biblio?.volume || "",
    issue: item.biblio?.issue || "",
    doi: normalizedDoi,
    abstract: reconstructOpenAlexAbstract(item.abstract_inverted_index),
    url: item.primary_location?.landing_page_url || `https://doi.org/${normalizedDoi}`,
    published_at: item.publication_date || "",
    keywords: keywords || item.primary_topic?.display_name || ""
  };
}

function parseHtmlMetadata(html) {
  const citationKeywords = extractMetaContentAll(html, "citation_keywords");
  const metaKeywords = extractMetaContentAll(html, "keywords");
  const allKeywords = [...new Set([...citationKeywords, ...metaKeywords])].join("; ");

  return {
    title: extractMetaContent(html, "citation_title") || extractMetaContent(html, "og:title"),
    authors: "",
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
    authors: "",
    doi: extractMetaContent(html, "citation_doi") || extractMetaContent(html, "prism:doi")
  };
}

function mergeDetails(primary, fallback) {
  return Object.fromEntries(
    Object.keys({ ...fallback, ...primary }).map((key) => [key, primary[key] || fallback[key] || ""])
  );
}

function isElsevierArticle(article) {
  const doi = article.doi || "";
  const url = article.url || "";
  return doi.includes("10.1016/") || 
         url.includes("sciencedirect.com") || 
         url.includes("elsevier.com");
}

export async function crawlArticleDetails(article) {
  if (!config.crawlerEnabled) {
    throw new Error("Crawler is disabled");
  }

  const target = article.url || (article.doi ? `https://doi.org/${article.doi}` : "");
  if (!target) {
    throw new Error("Article has no DOI or URL to crawl");
  }

  let publisherDetails = {};

  // Prefer the official Elsevier API. OpenAlex often has topic keywords but no
  // abstract; treating those keywords as a complete result used to bypass this
  // API even when a valid Elsevier key was configured.
  if (config.elsevierApiKey && isElsevierArticle(article) && article.doi) {
    try {
      const elsevierDetails = await fetchElsevierArticleDetails(article.doi);
      if (elsevierDetails.abstract || elsevierDetails.keywords) {
        publisherDetails = {
          title: elsevierDetails.title || "",
          authors: elsevierDetails.authors || "",
          journal: article.journal || "",
          year: elsevierDetails.year || article.year || null,
          volume: elsevierDetails.volume || "",
          issue: elsevierDetails.issue || "",
          doi: elsevierDetails.doi || article.doi || "",
          abstract: elsevierDetails.abstract || "",
          url: article.url || "",
          published_at: elsevierDetails.published_at || "",
          keywords: elsevierDetails.keywords || ""
        };
      }
    } catch {
      // Fall through to HTML scraping
    }
  }

  // OpenAlex is the public DOI-level fallback for publishers that block HTML
  // crawlers or when a publisher API does not cover a particular record.
  if (article.doi) {
    try {
      const openAlexDetails = await fetchOpenAlexDetails(article.doi);
      const mergedDetails = mergeDetails(publisherDetails, openAlexDetails);
      if (mergedDetails.abstract || mergedDetails.keywords) return mergedDetails;
    } catch {
      // Continue with public HTML metadata.
    }
  }

  if (publisherDetails.abstract || publisherDetails.keywords) return publisherDetails;

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

    const html = await response.text();
    
    // Check if this is a linkinghub redirect page (Elsevier)
    const finalUrl = response.url;
    if (finalUrl.includes("linkinghub.elsevier.com")) {
      // Extract the actual ScienceDirect URL from meta refresh
      const refreshMatch = html.match(/content=["']2;\s*url='([^']+)["']/i);
      if (refreshMatch) {
        const redirectPath = refreshMatch[1].replace(/&amp;/g, "&");
        const redirectUrl = `https://linkinghub.elsevier.com${redirectPath}`;
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
          
          const finalHtml = await finalResponse.text();
          const details = mergeDetails(parseIeeeMetadata(finalHtml), parseHtmlMetadata(finalHtml));
          const elsevierDetails = parseElsevierMetadata(finalHtml);
          const merged = mergeDetails(details, elsevierDetails);
          if (merged.abstract || merged.title) {
            clearTimeout(timeout);
            return merged;
          }
        } catch {
          // Fall through to parse the redirect page
        }
      }
    }
    
    // Try IEEE metadata first, then HTML metadata, then Elsevier-specific
    let details = mergeDetails(parseIeeeMetadata(html), parseHtmlMetadata(html));
    
    // If it's an Elsevier article and we're missing data, try Elsevier parser
    if (isElsevierArticle(article) && (!details.abstract || !details.keywords)) {
      const elsevierDetails = parseElsevierMetadata(html);
      details = mergeDetails(details, elsevierDetails);
    }
    
    if (!details.abstract && !details.title) {
      throw new Error("No crawlable metadata found on the public page");
    }
    return details;
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
  fetchOpenAlexDetails,
  normalizePublicationDate,
  isElsevierArticle
};
