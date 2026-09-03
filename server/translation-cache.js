// Translation is stored as one row per article/language, but the individual
// fields may be filled at different times.  Keep the field rules in one place
// so every caller (web UI, refresh jobs, digests and preparation jobs) uses the
// same cache-first behaviour.
// Keywords remain a source-language field in the article table.  They are
// deliberately not part of the translation cache: translating a keyword list
// adds little value and made every article look incomplete when the provider
// did not return term-by-term translations.
export const TRANSLATION_FIELDS = ["title", "abstract"];

function hasText(value) {
  return String(value || "").trim().length > 0;
}

function normalizeFields(fields) {
  const requested = Array.isArray(fields) && fields.length ? fields : TRANSLATION_FIELDS;
  return [...new Set(requested.filter((field) => TRANSLATION_FIELDS.includes(field)))];
}

/**
 * Return source fields that still need a translation.  A title is always
 * required; an abstract is required only when the source article contains it.
 */
export function getMissingTranslationFields(article, translation, fields) {
  if (!article) return [];
  return normalizeFields(fields).filter((field) => {
    if (field === "title") return !hasText(translation?.title);
    if (!hasText(article[field])) return false;
    return !hasText(translation?.[field]);
  });
}

export function isTranslationComplete(article, translation) {
  return getMissingTranslationFields(article, translation).length === 0;
}

function mergeTranslation(existing, incoming = {}) {
  const merged = {
    ...(existing || {}),
    ...(incoming || {})
  };
  // Keep any legacy keyword translation for backwards compatibility, but
  // ignore provider output for that field from this point forward.
  merged.keywords = String(existing?.keywords || "");
  delete merged.translated_keywords;
  for (const field of TRANSLATION_FIELDS) {
    // Never replace a previously cached field with an empty response.  This is
    // important when a provider returns only the requested subset of fields.
    merged[field] = hasText(incoming?.[field]) ? String(incoming[field]).trim() : String(existing?.[field] || "");
  }
  merged.provider = String(incoming?.provider || existing?.provider || "");
  return merged;
}

function sourceForFields(article, fields) {
  const requested = new Set(fields);
  // Do not pass keywords to a provider at all.  Apart from making the
  // contract explicit, this prevents a provider implementation from
  // accidentally translating a field that is intentionally source-only.
  const { keywords: _keywords, translated_keywords: _translatedKeywords, ...source } = article;
  return {
    ...source,
    title: requested.has("title") ? article.title || "" : "",
    abstract: requested.has("abstract") ? article.abstract || "" : ""
  };
}

/**
 * Build a cache-first translation service.  Dependencies are injectable so
 * the behaviour can be unit-tested without opening the application database.
 * The default export below is the process-wide service used by the app.
 */
export function createTranslationCacheService(dependencies = {}) {
  const inFlight = new Map();
  let defaultDependenciesPromise = null;

  function resolveDependencies() {
    const hasAllDependencies = dependencies.getArticle
      && dependencies.getTranslation
      && dependencies.saveTranslation
      && dependencies.translateArticle;
    if (hasAllDependencies) return Promise.resolve(dependencies);
    if (!defaultDependenciesPromise) {
      defaultDependenciesPromise = Promise.all([
        import("./db.js"),
        import("./translate.js")
      ]).then(([dbModule, translateModule]) => ({
        getArticle: dbModule.getArticle,
        getTranslation: dbModule.getTranslation,
        saveTranslation: dbModule.saveTranslation,
        translateArticle: translateModule.translateArticle,
        ...dependencies
      }));
    }
    return defaultDependenciesPromise;
  }

  async function ensureTranslation(articleOrId, targetLanguage = "zh", options = {}) {
    const suppliedArticle = typeof articleOrId === "object" ? articleOrId : null;
    const articleId = Number(suppliedArticle?.id ?? articleOrId);
    if (!Number.isInteger(articleId) || articleId <= 0) {
      throw new Error("文献不存在");
    }
    const key = `${articleId}:${String(targetLanguage || "zh")}`;
    const requestedFields = normalizeFields(options.fields);

    // If another user is already translating this article, wait for that
    // request and then re-check SQLite.  The second check also fills a field
    // that was not part of the first caller's requested subset.
    if (inFlight.has(key)) {
      await inFlight.get(key);
      return ensureTranslation(articleOrId, targetLanguage, options);
    }

    const task = (async () => {
      const resolved = await resolveDependencies();
      const readArticle = resolved.getArticle;
      const readTranslation = resolved.getTranslation;
      const writeTranslation = resolved.saveTranslation;
      const requestTranslation = resolved.translateArticle;
      const article = readArticle(articleId) || suppliedArticle;
      if (!article) throw new Error("文献不存在");

      const existing = readTranslation(articleId, targetLanguage) || null;
      const missingFields = getMissingTranslationFields(article, existing, requestedFields);
      if (!missingFields.length) {
        return { translation: existing, translated: false, fields: [], cached: true };
      }

      const result = await requestTranslation(sourceForFields(article, missingFields), targetLanguage);
      const merged = mergeTranslation(existing, result);
      const saved = writeTranslation(articleId, targetLanguage, merged);
      const stillMissing = getMissingTranslationFields(article, saved, missingFields);
      if (stillMissing.length) {
        throw new Error(`翻译服务未返回：${stillMissing.join("、")}`);
      }
      return {
        translation: saved,
        translated: true,
        fields: missingFields,
        cached: false
      };
    })();

    inFlight.set(key, task);
    try {
      return await task;
    } finally {
      if (inFlight.get(key) === task) inFlight.delete(key);
    }
  }

  return { ensureTranslation, getMissingTranslationFields, isTranslationComplete };
}

export const translationCache = createTranslationCacheService();
export const ensureTranslation = translationCache.ensureTranslation;
