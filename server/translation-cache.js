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
        saveTranslations: dbModule.saveTranslations,
        translateArticle: translateModule.translateArticle,
        translateArticles: translateModule.translateArticles,
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

      const result = await requestTranslation(sourceForFields(article, missingFields), targetLanguage, missingFields);
      const merged = mergeTranslation(existing, result);
      const saved = writeTranslation(articleId, targetLanguage, merged);
      const stillMissing = getMissingTranslationFields(article, saved, missingFields);
      if (stillMissing.length) {
        const providerErrors = Array.isArray(result?.errors) && result.errors.length
          ? `；${result.errors.join("；")}`
          : "";
        throw new Error(`翻译服务未返回：${stillMissing.join("、")}${providerErrors}`);
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

  /**
   * Cache-first batch translation. Each returned item represents one article;
   * the underlying translator may process several title/abstract units in a
   * single provider request. Existing fields are passed through unchanged and
   * only successfully completed fields are written back.
   */
  async function ensureTranslations(articleOrIds, targetLanguage = "zh", options = {}) {
    const suppliedArticles = Array.isArray(articleOrIds) ? articleOrIds : [articleOrIds];
    const resolved = await resolveDependencies();
    const readArticle = resolved.getArticle;
    const readTranslation = resolved.getTranslation;
    const entries = [];
    const results = [];
    const invalid = [];
    for (const supplied of suppliedArticles) {
      const suppliedArticle = typeof supplied === "object" ? supplied : null;
      const articleId = Number(suppliedArticle?.id ?? supplied);
      if (!Number.isInteger(articleId) || articleId <= 0) {
        invalid.push({ id: suppliedArticle?.id ?? supplied, message: "文献不存在" });
        continue;
      }
      const article = readArticle(articleId) || suppliedArticle;
      if (!article) {
        invalid.push({ id: articleId, message: "文献不存在" });
        continue;
      }
      const existing = readTranslation(articleId, targetLanguage) || null;
      const missingFields = getMissingTranslationFields(article, existing, options.fields);
      if (!missingFields.length) {
        results.push({
          articleId,
          translation: existing,
          translated: false,
          fields: [],
          cached: true,
          error: ""
        });
        continue;
      }
      entries.push({ articleId, article, existing, missingFields });
    }

    if (!entries.length) {
      return {
        results,
        failed: invalid.length,
        translated: 0,
        translatedUnits: 0,
        requests: 0,
        errors: invalid
      };
    }

    const requestedFields = [...new Set(entries.flatMap((entry) => entry.missingFields))];
    const sourceArticles = entries.map((entry) => sourceForFields(entry.article, entry.missingFields));
    let batch;
    if (resolved.translateArticles) {
      batch = await resolved.translateArticles(sourceArticles, targetLanguage, requestedFields);
    } else {
      // Test doubles and older integrations may only provide the single-item
      // translator. Keep them functional while the default service uses the
      // provider-specific batch implementation above.
      const translatedResults = [];
      const failedResults = [];
      let requests = 0;
      for (const source of sourceArticles) {
        const entry = entries.find((item) => item.articleId === source.id);
        try {
          const translation = await resolved.translateArticle(source, targetLanguage, entry?.missingFields);
          for (const field of entry?.missingFields || []) {
            if (hasText(translation?.[field])) {
              translatedResults.push({ articleId: source.id, field, translated: translation[field], provider: translation.provider || "" });
            }
          }
          requests += 1;
        } catch (error) {
          failedResults.push(...(entry?.missingFields || []).map((field) => ({ articleId: source.id, field, message: error.message })));
        }
      }
      batch = { results: translatedResults, failed: failedResults, errors: failedResults, requests };
    }

    const payloadByArticle = new Map();
    for (const item of batch.results || []) {
      const key = String(item.articleId);
      const payload = payloadByArticle.get(key) || { title: "", abstract: "", provider: "" };
      if (TRANSLATION_FIELDS.includes(item.field) && hasText(item.translated)) payload[item.field] = item.translated;
      payload.provider = item.provider || payload.provider;
      payloadByArticle.set(key, payload);
    }

    const saveEntries = entries
      .filter((entry) => payloadByArticle.has(String(entry.articleId)))
      .map((entry) => ({
        articleId: entry.articleId,
        targetLanguage,
        translation: mergeTranslation(entry.existing, payloadByArticle.get(String(entry.articleId)))
      }));
    const savedByArticle = new Map();
    if (saveEntries.length && resolved.saveTranslations) {
      for (const saved of resolved.saveTranslations(saveEntries) || []) {
        if (saved) savedByArticle.set(String(saved.article_id), saved);
      }
    } else {
      for (const entry of saveEntries) {
        const saved = resolved.saveTranslation(entry.articleId, targetLanguage, entry.translation);
        if (saved) savedByArticle.set(String(entry.articleId), saved);
      }
    }

    const providerErrors = new Map();
    for (const error of batch.errors || batch.failed || []) {
      const key = String(error.articleId ?? error.id);
      const previous = providerErrors.get(key) || [];
      previous.push(`${error.field === "title" ? "标题" : "摘要"}：${error.message}`);
      providerErrors.set(key, previous);
    }
    for (const entry of entries) {
      const saved = savedByArticle.get(String(entry.articleId))
        || readTranslation(entry.articleId, targetLanguage)
        || entry.existing;
      const stillMissing = getMissingTranslationFields(entry.article, saved, entry.missingFields);
      const fields = entry.missingFields.filter((field) => hasText(saved?.[field]));
      const errorMessages = providerErrors.get(String(entry.articleId)) || [];
      if (stillMissing.length) {
        errorMessages.push(`未完成：${stillMissing.map((field) => field === "title" ? "标题" : "摘要").join("、")}`);
      }
      results.push({
        articleId: entry.articleId,
        translation: saved,
        translated: fields.length > 0,
        fields,
        cached: false,
        error: [...new Set(errorMessages)].join("；")
      });
    }
    for (const item of invalid) results.push({ articleId: item.id, translation: null, translated: false, fields: [], cached: false, error: item.message });
    const failedResults = results.filter((item) => item.error);
    return {
      results,
      failed: failedResults.length,
      translated: results.filter((item) => item.translated).length,
      translatedUnits: results.reduce((total, item) => total + item.fields.length, 0),
      requests: batch.requests || 0,
      errors: failedResults.map((item) => ({ id: item.articleId, message: item.error })),
      providers: batch.providers || []
    };
  }

  return { ensureTranslation, ensureTranslations, getMissingTranslationFields, isTranslationComplete };
}

export const translationCache = createTranslationCacheService();
export const ensureTranslation = translationCache.ensureTranslation;
export const ensureTranslations = translationCache.ensureTranslations;
