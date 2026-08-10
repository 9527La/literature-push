import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { DEFAULT_JOURNAL_BY_NAME, DEFAULT_JOURNALS, config } from "./config.js";
import { escapeLike } from "./utils.js";

const dataDir = path.resolve("data");
fs.mkdirSync(dataDir, { recursive: true });

export const db = new DatabaseSync(path.join(dataDir, "literature.sqlite"));
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

// Add keywords columns to existing tables if they don't exist yet.
try { db.exec("ALTER TABLE articles ADD COLUMN keywords TEXT"); } catch (e) {
  if (!e.message?.includes("duplicate column") && !e.message?.includes("no such table")) throw e;
}
try { db.exec("ALTER TABLE translations ADD COLUMN keywords TEXT"); } catch (e) {
  if (!e.message?.includes("duplicate column") && !e.message?.includes("no such table")) throw e;
}
try { db.exec("ALTER TABLE articles ADD COLUMN first_seen_at TEXT"); } catch (e) {
  if (!e.message?.includes("duplicate column") && !e.message?.includes("no such table")) throw e;
}

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS articles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    external_id TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    authors TEXT,
    journal TEXT,
    year INTEGER,
    volume TEXT,
    issue TEXT,
    doi TEXT,
    abstract TEXT,
    url TEXT,
    published_at TEXT,
    fetched_at TEXT NOT NULL,
    first_seen_at TEXT NOT NULL,
    is_read INTEGER NOT NULL DEFAULT 0,
    is_favorite INTEGER NOT NULL DEFAULT 0,
    keywords TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_articles_journal ON articles(journal);
  CREATE INDEX IF NOT EXISTS idx_articles_published_at ON articles(published_at);
  CREATE INDEX IF NOT EXISTS idx_articles_read ON articles(is_read);

  CREATE TABLE IF NOT EXISTS refresh_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    added_count INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL,
    message TEXT
  );

  CREATE TABLE IF NOT EXISTS translations (
    article_id INTEGER NOT NULL,
    target_language TEXT NOT NULL,
    title TEXT,
    abstract TEXT,
    keywords TEXT,
    provider TEXT,
    translated_at TEXT NOT NULL,
    PRIMARY KEY (article_id, target_language),
    FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS user_emails (
    user_id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    grade TEXT NOT NULL DEFAULT '',
    show_bilingual_titles INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS user_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    registered_ip TEXT NOT NULL UNIQUE,
    preferences_json TEXT,
    preferences_updated_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    email TEXT NOT NULL,
    content TEXT NOT NULL,
    is_anonymous INTEGER NOT NULL DEFAULT 0,
    admin_reply TEXT,
    replied_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS feedback_comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    feedback_id INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    content TEXT NOT NULL,
    is_anonymous INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (feedback_id) REFERENCES feedback(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS feedback_likes (
    feedback_id INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (feedback_id, user_id),
    FOREIGN KEY (feedback_id) REFERENCES feedback(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS feedback_comment_likes (
    comment_id INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (comment_id, user_id),
    FOREIGN KEY (comment_id) REFERENCES feedback_comments(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_feedback_comments_feedback ON feedback_comments(feedback_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_feedback_comments_user ON feedback_comments(user_id, created_at);

  CREATE TABLE IF NOT EXISTS user_interactions (
    user_id TEXT NOT NULL,
    article_id INTEGER NOT NULL,
    is_read INTEGER NOT NULL DEFAULT 0,
    is_favorite INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, article_id),
    FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_ui_user ON user_interactions(user_id);
  CREATE INDEX IF NOT EXISTS idx_ui_article ON user_interactions(article_id);

  CREATE TABLE IF NOT EXISTS user_journals (
    user_id TEXT NOT NULL,
    journal_name TEXT NOT NULL,
    PRIMARY KEY (user_id, journal_name)
  );

  CREATE TABLE IF NOT EXISTS user_settings (
    user_id TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, key)
  );
`);

for (const migration of [
  "ALTER TABLE user_emails ADD COLUMN name TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE user_emails ADD COLUMN grade TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE user_emails ADD COLUMN show_bilingual_titles INTEGER NOT NULL DEFAULT 1",
  "ALTER TABLE user_emails ADD COLUMN updated_at TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE user_emails ADD COLUMN enrollment_year INTEGER",
  "ALTER TABLE user_emails ADD COLUMN degree TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE feedback ADD COLUMN admin_reply TEXT",
  "ALTER TABLE feedback ADD COLUMN replied_at TEXT",
  "ALTER TABLE feedback ADD COLUMN is_anonymous INTEGER NOT NULL DEFAULT 0"
]) {
  try { db.exec(migration); } catch (error) {
    if (!error.message?.includes("duplicate column")) throw error;
  }
}
db.exec("UPDATE user_emails SET updated_at = created_at WHERE updated_at IS NULL OR updated_at = ''");

db.exec("UPDATE articles SET first_seen_at = fetched_at WHERE first_seen_at IS NULL OR first_seen_at = ''");

const insertSetting = db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)");
insertSetting.run("journals", JSON.stringify(DEFAULT_JOURNALS));
insertSetting.run("refreshCron", config.refreshCron);
insertSetting.run("emailEnabled", "false");
insertSetting.run("emailRecipients", JSON.stringify(config.smtp.to ? config.smtp.to.split(",").map((email) => email.trim()).filter(Boolean) : []));
insertSetting.run("pushEnabled", String(config.pushEnabled));
insertSetting.run("pushFrequency", config.pushFrequency);
insertSetting.run("pushCron", config.pushCron);
insertSetting.run("pushDays", String(config.pushDays));
insertSetting.run("pushIncludeFile", String(config.pushIncludeFile));
insertSetting.run("pushIncludeAbstract", String(config.pushIncludeAbstract));
insertSetting.run("pushIncludeKeywords", String(config.pushIncludeKeywords));
insertSetting.run("pushIncludeTranslation", String(config.pushIncludeTranslation));
insertSetting.run("pushJournalFilter", config.pushJournalFilter);

export function getSettings() {
  const rows = db.prepare("SELECT key, value FROM settings").all();
  const values = Object.fromEntries(rows.map((row) => [row.key, row.value]));
  const journals = normalizeJournals(JSON.parse(values.journals || "[]"));
  return {
    journals,
    refreshCron: values.refreshCron || config.refreshCron,
    emailEnabled: values.emailEnabled === "true",
    emailRecipients: JSON.parse(values.emailRecipients || "[]"),
    // Push settings
    pushEnabled: values.pushEnabled === "true",
    pushFrequency: values.pushFrequency || config.pushFrequency,
    pushCron: values.pushCron || config.pushCron,
    pushDays: Number(values.pushDays || config.pushDays),
    pushIncludeFile: values.pushIncludeFile !== "false",
    pushIncludeAbstract: values.pushIncludeAbstract !== "false",
    pushIncludeKeywords: values.pushIncludeKeywords !== "false",
    pushIncludeTranslation: values.pushIncludeTranslation !== "false",
    pushJournalFilter: values.pushJournalFilter || ""
  };
}

export function normalizeJournals(journals) {
  return journals
    .map((journal) => {
      if (typeof journal === "string") {
        const preset = DEFAULT_JOURNAL_BY_NAME.get(journal);
        return preset || { name: journal, issns: [] };
      }
      const preset = DEFAULT_JOURNAL_BY_NAME.get(journal.name);
      return {
        name: journal.name,
        issns: Array.isArray(journal.issns) ? journal.issns.filter(Boolean) : (preset?.issns || []),
        filterKeywords: Array.isArray(journal.filterKeywords)
          ? journal.filterKeywords
          : (preset?.filterKeywords || undefined)
      };
    })
    .filter((journal) => journal.name);
}

export function updateSettings(settings) {
  const current = getSettings();
  const next = {
    journals: Array.isArray(settings.journals) ? normalizeJournals(settings.journals) : current.journals,
    refreshCron: settings.refreshCron || current.refreshCron,
    emailEnabled: Boolean(settings.emailEnabled),
    emailRecipients: Array.isArray(settings.emailRecipients)
      ? settings.emailRecipients.map((email) => String(email).trim()).filter(Boolean)
      : current.emailRecipients,
    // Push settings
    pushEnabled: settings.pushEnabled !== undefined ? Boolean(settings.pushEnabled) : current.pushEnabled,
    pushFrequency: settings.pushFrequency || current.pushFrequency,
    pushCron: settings.pushCron || current.pushCron,
    pushDays: Number(settings.pushDays || current.pushDays),
    pushIncludeFile: settings.pushIncludeFile !== undefined ? Boolean(settings.pushIncludeFile) : current.pushIncludeFile,
    pushIncludeAbstract: settings.pushIncludeAbstract !== undefined ? Boolean(settings.pushIncludeAbstract) : current.pushIncludeAbstract,
    pushIncludeKeywords: settings.pushIncludeKeywords !== undefined ? Boolean(settings.pushIncludeKeywords) : current.pushIncludeKeywords,
    pushIncludeTranslation: settings.pushIncludeTranslation !== undefined ? Boolean(settings.pushIncludeTranslation) : current.pushIncludeTranslation,
    pushJournalFilter: settings.pushJournalFilter !== undefined ? String(settings.pushJournalFilter) : current.pushJournalFilter
  };

  const upsert = db.prepare(`
    INSERT INTO settings (key, value)
    VALUES (@key, @value)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);

  db.exec("BEGIN");
  try {
    upsert.run({ key: "journals", value: JSON.stringify(next.journals) });
    upsert.run({ key: "refreshCron", value: next.refreshCron });
    upsert.run({ key: "emailEnabled", value: String(next.emailEnabled) });
    upsert.run({ key: "emailRecipients", value: JSON.stringify(next.emailRecipients) });
    // Push settings
    upsert.run({ key: "pushEnabled", value: String(next.pushEnabled) });
    upsert.run({ key: "pushFrequency", value: next.pushFrequency });
    upsert.run({ key: "pushCron", value: next.pushCron });
    upsert.run({ key: "pushDays", value: String(next.pushDays) });
    upsert.run({ key: "pushIncludeFile", value: String(next.pushIncludeFile) });
    upsert.run({ key: "pushIncludeAbstract", value: String(next.pushIncludeAbstract) });
    upsert.run({ key: "pushIncludeKeywords", value: String(next.pushIncludeKeywords) });
    upsert.run({ key: "pushIncludeTranslation", value: String(next.pushIncludeTranslation) });
    upsert.run({ key: "pushJournalFilter", value: next.pushJournalFilter });
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return next;
}

export function listArticles(filters = {}, userId) {
  const clauses = [];
  const params = {};

  if (filters.journal) {
    const terms = String(filters.journal).split(",").map((t) => t.trim()).filter(Boolean);
    if (terms.length) {
      const orClauses = terms.map((_, i) => `a.journal = @jrn${i}`);
      clauses.push(`(${orClauses.join(" OR ")})`);
      terms.forEach((term, i) => { params[`jrn${i}`] = term; });
    }
  }
  if (filters.q) {
    const escaped = escapeLike(filters.q);
    clauses.push("(a.title LIKE @q OR a.abstract LIKE @q OR a.authors LIKE @q OR a.keywords LIKE @q)");
    params.q = `%${escaped}%`;
  }
  if (filters.from) {
    clauses.push("a.published_at >= @from");
    params.from = filters.from;
  }
  if (filters.to) {
    clauses.push("a.published_at <= @to");
    params.to = filters.to;
  }
  if (filters.keyword) {
    const terms = String(filters.keyword).split(",").map((t) => t.trim()).filter(Boolean);
    if (terms.length) {
      const orClauses = terms.map((_, i) => `a.keywords LIKE @kw${i}`);
      clauses.push(`(${orClauses.join(" OR ")})`);
      terms.forEach((term, i) => { params[`kw${i}`] = `%${term}%`; });
    }
  }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const order = filters.sort === "asc" ? "ASC" : "DESC";

  if (userId) {
    if (filters.unread === "true") {
      clauses.push("NOT EXISTS (SELECT 1 FROM user_interactions ui WHERE ui.user_id = @userId AND ui.article_id = a.id AND ui.is_read = 1)");
      params.userId = userId;
    }
    if (filters.favorite === "true") {
      clauses.push("EXISTS (SELECT 1 FROM user_interactions ui WHERE ui.user_id = @userId AND ui.article_id = a.id AND ui.is_favorite = 1)");
      params.userId = userId;
    }
    const whereClause = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const articles = db.prepare(`
      SELECT a.*,
        COALESCE(ui_read.is_read, 0) AS is_read,
        COALESCE(ui_fav.is_favorite, 0) AS is_favorite,
        zh.title AS translated_title,
        zh.abstract AS translated_abstract,
        zh.keywords AS translated_keywords
      FROM articles a
      LEFT JOIN user_interactions ui_read ON ui_read.article_id = a.id AND ui_read.user_id = @userId AND ui_read.is_read = 1
      LEFT JOIN user_interactions ui_fav ON ui_fav.article_id = a.id AND ui_fav.user_id = @userId AND ui_fav.is_favorite = 1
      LEFT JOIN translations zh ON zh.article_id = a.id AND zh.target_language = 'zh'
      ${whereClause}
      ORDER BY COALESCE(a.published_at, a.fetched_at) ${order}, a.id ${order}
      LIMIT 500
    `).all({ ...params, userId });
    return articles;
  }

  const whereFinal = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return db.prepare(`
    SELECT a.*,
      zh.title AS translated_title,
      zh.abstract AS translated_abstract,
      zh.keywords AS translated_keywords
    FROM articles a
    LEFT JOIN translations zh ON zh.article_id = a.id AND zh.target_language = 'zh'
    ${whereFinal}
    ORDER BY COALESCE(a.published_at, a.fetched_at) ${order}, a.id ${order}
    LIMIT 500
  `).all(params);
}

export function listRecentArticlesForDigest(days, limit, journals = []) {
  const since = new Date();
  since.setDate(since.getDate() - Number(days || 7));
  const sinceDate = since.toISOString().slice(0, 10);
  const maxRows = Number(limit || 0);
  const limitClause = maxRows > 0 ? "LIMIT @limit" : "";
  const journalNames = journals.map((journal) => journal.name || journal).filter(Boolean);
  const journalClause = journalNames.length
    ? `AND journal IN (${journalNames.map((_, index) => `@journal${index}`).join(", ")})`
    : "";

  const params = { sinceDate };
  journalNames.forEach((journal, index) => {
    params[`journal${index}`] = journal;
  });
  if (maxRows > 0) {
    params.limit = maxRows;
  }

  return db.prepare(`
    SELECT *
    FROM articles
    WHERE
      (
        (published_at IS NOT NULL AND published_at <> '' AND substr(published_at, 1, 10) >= @sinceDate)
        OR
        (first_seen_at IS NOT NULL AND first_seen_at <> '' AND substr(first_seen_at, 1, 10) >= @sinceDate)
      )
      AND lower(title) NOT LIKE '%information%'
      AND lower(title) NOT LIKE '%table of contents%'
      AND lower(title) NOT LIKE '%blank page%'
      AND lower(title) NOT LIKE 'correction to%'
      AND lower(title) NOT LIKE '%publication information%'
      AND lower(title) NOT LIKE '%front cover%'
      AND lower(title) NOT LIKE '%back cover%'
      ${journalClause}
    ORDER BY COALESCE(NULLIF(first_seen_at, ''), fetched_at) DESC, id DESC
    ${limitClause}
  `).all(params);
}

export function getArticle(id) {
  return db.prepare("SELECT * FROM articles WHERE id = ?").get(id);
}

export function updateArticleDetails(id, details) {
  db.prepare(`
    UPDATE articles
    SET
      title = COALESCE(NULLIF(@title, ''), title),
      authors = COALESCE(NULLIF(@authors, ''), authors),
      journal = COALESCE(NULLIF(@journal, ''), journal),
      year = COALESCE(@year, year),
      volume = COALESCE(NULLIF(@volume, ''), volume),
      issue = COALESCE(NULLIF(@issue, ''), issue),
      doi = COALESCE(NULLIF(@doi, ''), doi),
      abstract = COALESCE(NULLIF(@abstract, ''), abstract),
      url = COALESCE(NULLIF(@url, ''), url),
      published_at = COALESCE(NULLIF(@published_at, ''), published_at),
      keywords = COALESCE(NULLIF(@keywords, ''), keywords),
      fetched_at = @fetched_at
    WHERE id = @id
  `).run({
    id,
    title: details.title || "",
    authors: details.authors || "",
    journal: details.journal || "",
    year: details.year || null,
    volume: details.volume || "",
    issue: details.issue || "",
    doi: details.doi || "",
    abstract: details.abstract || "",
    url: details.url || "",
    published_at: details.published_at || "",
    keywords: details.keywords || "",
    fetched_at: new Date().toISOString()
  });
  return getArticle(id);
}

export function getTranslation(articleId, targetLanguage) {
  return db.prepare(`
    SELECT *
    FROM translations
    WHERE article_id = ? AND target_language = ?
  `).get(articleId, targetLanguage);
}

export function saveTranslation(articleId, targetLanguage, translation) {
  db.prepare(`
    INSERT INTO translations (article_id, target_language, title, abstract, keywords, provider, translated_at)
    VALUES (@articleId, @targetLanguage, @title, @abstract, @keywords, @provider, @translatedAt)
    ON CONFLICT(article_id, target_language) DO UPDATE SET
      title = excluded.title,
      abstract = excluded.abstract,
      keywords = excluded.keywords,
      provider = excluded.provider,
      translated_at = excluded.translated_at
  `).run({
    articleId,
    targetLanguage,
    title: translation.title || "",
    abstract: translation.abstract || "",
    keywords: translation.keywords || "",
    provider: translation.provider || "",
    translatedAt: new Date().toISOString()
  });
  return getTranslation(articleId, targetLanguage);
}

export function insertArticles(articles) {
  const exists = db.prepare("SELECT 1 FROM articles WHERE external_id = ?");
  const getId = db.prepare("SELECT id FROM articles WHERE external_id = ?");
  const statement = db.prepare(`
    INSERT INTO articles (
      external_id, title, authors, journal, year, volume, issue, doi, abstract, url, published_at, fetched_at, first_seen_at, keywords
    )
    VALUES (
      @external_id, @title, @authors, @journal, @year, @volume, @issue, @doi, @abstract, @url, @published_at, @fetched_at, @first_seen_at, @keywords
    )
    ON CONFLICT(external_id) DO UPDATE SET
      authors = COALESCE(NULLIF(articles.authors, ''), excluded.authors),
      journal = COALESCE(NULLIF(articles.journal, ''), excluded.journal),
      year = COALESCE(articles.year, excluded.year),
      volume = COALESCE(NULLIF(articles.volume, ''), excluded.volume),
      issue = COALESCE(NULLIF(articles.issue, ''), excluded.issue),
      doi = COALESCE(NULLIF(articles.doi, ''), excluded.doi),
      abstract = COALESCE(NULLIF(articles.abstract, ''), excluded.abstract),
      url = COALESCE(NULLIF(articles.url, ''), excluded.url),
      published_at = COALESCE(NULLIF(articles.published_at, ''), excluded.published_at),
      keywords = COALESCE(NULLIF(articles.keywords, ''), excluded.keywords),
      fetched_at = excluded.fetched_at
  `);

  db.exec("BEGIN");
  try {
    let added = 0;
    const addedArticles = [];
    for (const item of articles) {
      const wasExisting = exists.get(item.external_id);
      statement.run({ ...item, first_seen_at: item.first_seen_at || item.fetched_at || new Date().toISOString() });
      if (!wasExisting) {
        added += 1;
        const row = getId.get(item.external_id);
        addedArticles.push({ ...item, id: row?.id });
      }
    }
    db.exec("COMMIT");
    return { addedCount: added, addedArticles };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function setArticleRead(id) {
  return db.prepare("UPDATE articles SET is_read = 1 WHERE id = ?").run(id);
}

export function toggleArticleFavorite(id) {
  const row = db.prepare("SELECT is_favorite FROM articles WHERE id = ?").get(id);
  if (!row) return null;
  const next = row.is_favorite ? 0 : 1;
  db.prepare("UPDATE articles SET is_favorite = ? WHERE id = ?").run(next, id);
  return db.prepare("SELECT * FROM articles WHERE id = ?").get(id);
}

// ── Per-user interactions ──

export function setArticleReadForUser(userId, articleId) {
  const row = db.prepare("SELECT is_read FROM user_interactions WHERE user_id = ? AND article_id = ?").get(userId, articleId);
  if (!row) {
    db.prepare(`
      INSERT INTO user_interactions (user_id, article_id, is_read, is_favorite, updated_at)
      VALUES (?, ?, 1, 0, datetime('now'))
    `).run(userId, articleId);
    return 1;
  }
  const next = row.is_read ? 0 : 1;
  db.prepare("UPDATE user_interactions SET is_read = ?, updated_at = datetime('now') WHERE user_id = ? AND article_id = ?").run(next, userId, articleId);
  return next;
}

export function toggleArticleFavoriteForUser(userId, articleId) {
  const row = db.prepare("SELECT is_favorite FROM user_interactions WHERE user_id = ? AND article_id = ?").get(userId, articleId);
  if (!row) {
    db.prepare(`
      INSERT INTO user_interactions (user_id, article_id, is_read, is_favorite, updated_at)
      VALUES (?, ?, 0, 1, datetime('now'))
    `).run(userId, articleId);
  } else {
    const next = row.is_favorite ? 0 : 1;
    db.prepare("UPDATE user_interactions SET is_favorite = ?, updated_at = datetime('now') WHERE user_id = ? AND article_id = ?").run(next, userId, articleId);
  }
  const article = getArticle(articleId);
  const interaction = db.prepare("SELECT is_read, is_favorite FROM user_interactions WHERE user_id = ? AND article_id = ?").get(userId, articleId);
  return { ...article, is_read: interaction?.is_read || 0, is_favorite: interaction?.is_favorite || 0 };
}

export function getUserInteraction(userId, articleId) {
  const row = db.prepare("SELECT is_read, is_favorite FROM user_interactions WHERE user_id = ? AND article_id = ?").get(userId, articleId);
  return row || { is_read: 0, is_favorite: 0 };
}

export function getUserInteractionsMap(userId, articleIds) {
  if (!articleIds.length) return new Map();
  const placeholders = articleIds.map(() => "?").join(",");
  const rows = db.prepare(`SELECT article_id, is_read, is_favorite FROM user_interactions WHERE user_id = ? AND article_id IN (${placeholders})`).all(userId, ...articleIds);
  const map = new Map();
  for (const row of rows) {
    map.set(row.article_id, { is_read: row.is_read, is_favorite: row.is_favorite });
  }
  return map;
}

export function getUserStatus(userId) {
  const unreadCount = db.prepare(`
    SELECT COUNT(*) AS count FROM articles a
    WHERE NOT EXISTS (
      SELECT 1 FROM user_interactions ui
      WHERE ui.user_id = ? AND ui.article_id = a.id AND ui.is_read = 1
    )
  `).get(userId).count;
  const articleCount = db.prepare("SELECT COUNT(*) AS count FROM articles").get().count;
  const favoriteCount = db.prepare("SELECT COUNT(*) AS count FROM user_interactions WHERE user_id = ? AND is_favorite = 1").get(userId).count;
  const readCount = db.prepare("SELECT COUNT(*) AS count FROM user_interactions WHERE user_id = ? AND is_read = 1").get(userId).count;
  return { articleCount, unreadCount, favoriteCount, readCount };
}

export function createRefreshRun() {
  const startedAt = new Date().toISOString();
  const result = db.prepare(`
    INSERT INTO refresh_runs (started_at, status, message)
    VALUES (?, 'running', '')
  `).run(startedAt);
  return result.lastInsertRowid;
}

export function finishRefreshRun(id, { addedCount, status, message }) {
  db.prepare(`
    UPDATE refresh_runs
    SET finished_at = ?, added_count = ?, status = ?, message = ?
    WHERE id = ?
  `).run(new Date().toISOString(), addedCount, status, message || "", id);
}

export function getStatus() {
  const latestRun = db.prepare(`
    SELECT *
    FROM refresh_runs
    ORDER BY id DESC
    LIMIT 1
  `).get();
  const unreadCount = db.prepare("SELECT COUNT(*) AS count FROM articles WHERE is_read = 0").get().count;
  const articleCount = db.prepare("SELECT COUNT(*) AS count FROM articles").get().count;
  return {
    latestRun: latestRun || null,
    unreadCount,
    articleCount,
    hasApiKey: Boolean(config.ieeeApiKey),
    hasEmailConfig: Boolean(config.smtp.host && config.smtp.to && config.smtp.from),
    publicDataSources: config.publicDataSources,
    hasPublicDataSources: config.publicDataSources.length > 0
  };
}

export function listArticlesWithoutKeywords(limit = 50) {
  return db.prepare(`
    SELECT * FROM articles
    WHERE keywords IS NULL OR keywords = ''
    ORDER BY COALESCE(published_at, fetched_at) DESC
    LIMIT ?
  `).all(limit);
}

export function listArticlesMissingMetadata(limit = 50) {
  return db.prepare(`
    SELECT * FROM articles
    WHERE abstract IS NULL OR abstract = '' OR keywords IS NULL OR keywords = ''
    ORDER BY COALESCE(first_seen_at, fetched_at) DESC
    LIMIT ?
  `).all(limit);
}

export function listArticlesWithoutTranslation(targetLanguage, limit = 20) {
  return db.prepare(`
    SELECT a.*
    FROM articles a
    LEFT JOIN translations t
      ON t.article_id = a.id AND t.target_language = ?
    WHERE t.article_id IS NULL
    ORDER BY COALESCE(a.first_seen_at, a.fetched_at) DESC
    LIMIT ?
  `).all(targetLanguage, limit);
}

export function getKeywordStats(filters = {}) {
  const clauses = ["keywords IS NOT NULL", "keywords != ''"];
  const params = {};

  if (filters.journal) {
    clauses.push("journal = @journal");
    params.journal = filters.journal;
  }
  if (filters.from) {
    clauses.push("published_at >= @from");
    params.from = filters.from;
  }
  if (filters.to) {
    clauses.push("published_at <= @to");
    params.to = filters.to;
  }

  const where = `WHERE ${clauses.join(" AND ")}`;
  const articles = db.prepare(`
    SELECT id, title, journal, published_at, keywords, url, doi
    FROM articles
    ${where}
    ORDER BY COALESCE(published_at, fetched_at) DESC
  `).all(params);

  // Aggregate keyword frequencies and track which articles contain each keyword
  const keywordMap = new Map();

  for (const article of articles) {
    const terms = article.keywords.split(/[;；]/).map((t) => t.trim()).filter(Boolean);
    const seen = new Set();
    for (const term of terms) {
      const key = term.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      if (!keywordMap.has(key)) {
        keywordMap.set(key, { keyword: term, count: 0, articles: [] });
      }
      const entry = keywordMap.get(key);
      entry.count += 1;
      entry.articles.push({
        id: article.id,
        title: article.title,
        journal: article.journal,
        published_at: article.published_at,
        url: article.url,
        doi: article.doi
      });
    }
  }

  const stats = [...keywordMap.values()].sort((a, b) => b.count - a.count);
  return { totalArticles: articles.length, keywords: stats };
}

export function getKeywordCooccurrence(filters = {}) {
  const clauses = ["keywords IS NOT NULL", "keywords != ''"];
  const params = {};

  if (filters.journal) {
    clauses.push("journal = @journal");
    params.journal = filters.journal;
  }
  if (filters.from) {
    clauses.push("published_at >= @from");
    params.from = filters.from;
  }
  if (filters.to) {
    clauses.push("published_at <= @to");
    params.to = filters.to;
  }

  const where = `WHERE ${clauses.join(" AND ")}`;
  const articles = db.prepare(`
    SELECT id, title, journal, published_at, keywords, url, doi
    FROM articles
    ${where}
    ORDER BY COALESCE(published_at, fetched_at) DESC
  `).all(params);

  // Build keyword frequency map
  const keywordMap = new Map();
  const cooccurrenceMap = new Map();

  for (const article of articles) {
    const terms = article.keywords.split(/[;；]/).map((t) => t.trim().toLowerCase()).filter(Boolean);
    const uniqueTerms = [...new Set(terms)];
    
    // Count individual keywords
    for (const term of uniqueTerms) {
      if (!keywordMap.has(term)) {
        keywordMap.set(term, { keyword: term, count: 0 });
      }
      keywordMap.get(term).count += 1;
    }
    
    // Count co-occurrences
    for (let i = 0; i < uniqueTerms.length; i++) {
      for (let j = i + 1; j < uniqueTerms.length; j++) {
        const pair = [uniqueTerms[i], uniqueTerms[j]].sort().join("|||");
        if (!cooccurrenceMap.has(pair)) {
          cooccurrenceMap.set(pair, { keyword1: uniqueTerms[i], keyword2: uniqueTerms[j], count: 0 });
        }
        cooccurrenceMap.get(pair).count += 1;
      }
    }
  }

  const keywords = [...keywordMap.values()].sort((a, b) => b.count - a.count);
  const cooccurrences = [...cooccurrenceMap.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 100); // Limit to top 100 co-occurrences

  return { keywords, cooccurrences };
}

// ── User Emails ──

export function setUserEmail(userId, email) {
  db.prepare(`
    INSERT INTO user_emails (user_id, email, created_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET email = excluded.email, updated_at = datetime('now')
  `).run(userId, email);
  return { userId, email };
}

export function getUserEmail(userId) {
  const row = db.prepare("SELECT user_id, email, name, grade, enrollment_year, degree, show_bilingual_titles, created_at, updated_at FROM user_emails WHERE user_id = ?").get(userId);
  return row || null;
}

export function getUserProfile(userId) {
  const row = getUserEmail(userId);
  return row ? { ...row, show_bilingual_titles: Boolean(row.show_bilingual_titles) } : {
    user_id: userId, email: "", name: "", enrollment_year: null, degree: "", show_bilingual_titles: true
  };
}

export function updateUserProfile(userId, profile) {
  const current = getUserProfile(userId);
  const next = {
    email: profile.email === undefined ? current.email : String(profile.email).trim(),
    name: profile.name === undefined ? current.name : String(profile.name).trim(),
    enrollment_year: profile.enrollment_year === undefined ? current.enrollment_year : Number(profile.enrollment_year) || null,
    degree: profile.degree === undefined ? current.degree : String(profile.degree).trim(),
    show_bilingual_titles: profile.show_bilingual_titles === undefined
      ? current.show_bilingual_titles
      : Boolean(profile.show_bilingual_titles)
  };
  db.prepare(`
    INSERT INTO user_emails (user_id, email, name, enrollment_year, degree, show_bilingual_titles, created_at, updated_at)
    VALUES (@userId, @email, @name, @enrollmentYear, @degree, @showBilingual, datetime('now'), datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET
      email = excluded.email,
      name = excluded.name,
      enrollment_year = excluded.enrollment_year,
      degree = excluded.degree,
      show_bilingual_titles = excluded.show_bilingual_titles,
      updated_at = datetime('now')
  `).run({
    userId,
    email: next.email,
    name: next.name,
    enrollmentYear: next.enrollment_year,
    degree: next.degree,
    showBilingual: next.show_bilingual_titles ? 1 : 0
  });
  return getUserProfile(userId);
}

export function getAllUserEmails() {
  return db.prepare("SELECT user_id, email, created_at FROM user_emails ORDER BY created_at DESC").all();
}

export function getUserAccountByUsername(username) {
  return db.prepare("SELECT * FROM user_accounts WHERE username = ? COLLATE NOCASE").get(username) || null;
}

export function getUserAccountById(id) {
  return db.prepare("SELECT id, username, registered_ip, preferences_updated_at, created_at, updated_at FROM user_accounts WHERE id = ?").get(Number(id)) || null;
}

export function hasUserAccountForIp(ip) {
  return Boolean(db.prepare("SELECT 1 FROM user_accounts WHERE registered_ip = ?").get(ip));
}

export function createUserAccount({ username, passwordHash, passwordSalt, registeredIp }) {
  db.exec("BEGIN");
  try {
    const result = db.prepare(`
      INSERT INTO user_accounts (username, password_hash, password_salt, registered_ip)
      VALUES (?, ?, ?, ?)
    `).run(username, passwordHash, passwordSalt, registeredIp);
    const accountId = Number(result.lastInsertRowid);
    const principalId = `account:${accountId}`;
    const existingProfile = getUserProfile(registeredIp);
    updateUserProfile(principalId, existingProfile);
    db.prepare(`
      INSERT OR IGNORE INTO user_journals (user_id, journal_name)
      SELECT ?, journal_name FROM user_journals WHERE user_id = ?
    `).run(principalId, registeredIp);
    db.prepare(`
      INSERT OR IGNORE INTO user_interactions (user_id, article_id, is_read, is_favorite, updated_at)
      SELECT ?, article_id, is_read, is_favorite, updated_at FROM user_interactions WHERE user_id = ?
    `).run(principalId, registeredIp);
    db.prepare(`
      INSERT OR IGNORE INTO user_settings (user_id, key, value, updated_at)
      SELECT ?, key, value, updated_at FROM user_settings WHERE user_id = ?
    `).run(principalId, registeredIp);
    db.prepare("UPDATE feedback SET user_id = ? WHERE user_id = ?").run(principalId, registeredIp);
    db.prepare("DELETE FROM user_interactions WHERE user_id = ?").run(registeredIp);
    db.prepare("DELETE FROM user_journals WHERE user_id = ?").run(registeredIp);
    db.prepare("DELETE FROM user_settings WHERE user_id = ?").run(registeredIp);
    db.prepare("DELETE FROM user_emails WHERE user_id = ?").run(registeredIp);
    db.exec("COMMIT");
    return getUserAccountById(accountId);
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function saveRemotePreferences(accountId, preferences) {
  db.prepare(`
    UPDATE user_accounts SET preferences_json = ?, preferences_updated_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ?
  `).run(JSON.stringify(preferences), Number(accountId));
  return getRemotePreferences(accountId);
}

export function getRemotePreferences(accountId) {
  const row = db.prepare("SELECT preferences_json, preferences_updated_at FROM user_accounts WHERE id = ?").get(Number(accountId));
  if (!row) return null;
  let preferences = null;
  try { preferences = row.preferences_json ? JSON.parse(row.preferences_json) : null; } catch { preferences = null; }
  return { preferences, updated_at: row.preferences_updated_at || null };
}

// ── Feedback ──

export function getRecentFeedbackCount(userId) {
  const row = db.prepare(
    "SELECT COUNT(*) as count FROM feedback WHERE user_id = ? AND created_at > datetime('now', '-1 hour')"
  ).get(userId);
  return row?.count || 0;
}

export function getRecentFeedbackCommentCount(userId) {
  const row = db.prepare(
    "SELECT COUNT(*) as count FROM feedback_comments WHERE user_id = ? AND created_at > datetime('now', '-1 hour')"
  ).get(userId);
  return row?.count || 0;
}

export function addFeedback(userId, email, content, isAnonymous = false) {
  const result = db.prepare(
    "INSERT INTO feedback (user_id, email, content, is_anonymous, created_at) VALUES (?, ?, ?, ?, datetime('now'))"
  ).run(userId, email, content, isAnonymous ? 1 : 0);
  return { id: Number(result.lastInsertRowid), content, created_at: new Date().toISOString() };
}

export function listPublicFeedback(limit = 100, userId = "") {
  const discussions = db.prepare(`
    SELECT f.id, f.content, f.admin_reply, f.replied_at, f.created_at,
      CASE WHEN f.is_anonymous = 1 THEN '匿名用户' ELSE COALESCE(NULLIF(u.name, ''), '匿名用户') END AS author_name,
      CASE
        WHEN f.is_anonymous = 1 THEN ''
        WHEN u.enrollment_year IS NOT NULL AND u.degree <> '' THEN CAST(u.enrollment_year AS TEXT) || '级 ' || u.degree
        WHEN u.enrollment_year IS NOT NULL THEN CAST(u.enrollment_year AS TEXT) || '级'
        ELSE COALESCE(NULLIF(u.degree, ''), '')
      END AS author_grade,
      (SELECT COUNT(*) FROM feedback_likes fl WHERE fl.feedback_id = f.id) AS like_count,
      EXISTS(SELECT 1 FROM feedback_likes fl WHERE fl.feedback_id = f.id AND fl.user_id = ?) AS liked_by_me,
      (SELECT COUNT(*) FROM feedback_comments c WHERE c.feedback_id = f.id) AS comment_count
    FROM feedback f
    LEFT JOIN user_emails u ON u.user_id = f.user_id
    ORDER BY f.created_at DESC, f.id DESC
    LIMIT ?
  `).all(userId, Math.min(Math.max(Number(limit) || 100, 1), 200));

  if (!discussions.length) return discussions;
  const placeholders = discussions.map(() => "?").join(",");
  const comments = db.prepare(`
    SELECT c.id, c.feedback_id, c.content, c.created_at,
      CASE WHEN c.is_anonymous = 1 THEN '匿名用户' ELSE COALESCE(NULLIF(u.name, ''), '匿名用户') END AS author_name,
      CASE
        WHEN c.is_anonymous = 1 THEN ''
        WHEN u.enrollment_year IS NOT NULL AND u.degree <> '' THEN CAST(u.enrollment_year AS TEXT) || '级 ' || u.degree
        WHEN u.enrollment_year IS NOT NULL THEN CAST(u.enrollment_year AS TEXT) || '级'
        ELSE COALESCE(NULLIF(u.degree, ''), '')
      END AS author_grade,
      (SELECT COUNT(*) FROM feedback_comment_likes cl WHERE cl.comment_id = c.id) AS like_count,
      EXISTS(SELECT 1 FROM feedback_comment_likes cl WHERE cl.comment_id = c.id AND cl.user_id = ?) AS liked_by_me
    FROM feedback_comments c
    LEFT JOIN user_emails u ON u.user_id = c.user_id
    WHERE c.feedback_id IN (${placeholders})
    ORDER BY c.created_at ASC, c.id ASC
  `).all(userId, ...discussions.map((item) => item.id));

  const commentsByDiscussion = new Map();
  for (const comment of comments) {
    const group = commentsByDiscussion.get(comment.feedback_id) || [];
    group.push(comment);
    commentsByDiscussion.set(comment.feedback_id, group);
  }
  return discussions.map((item) => ({ ...item, comments: commentsByDiscussion.get(item.id) || [] }));
}

export function addFeedbackComment(feedbackId, userId, content, isAnonymous = false) {
  const discussion = db.prepare("SELECT id FROM feedback WHERE id = ?").get(Number(feedbackId));
  if (!discussion) return null;
  const result = db.prepare(`
    INSERT INTO feedback_comments (feedback_id, user_id, content, is_anonymous, created_at)
    VALUES (?, ?, ?, ?, datetime('now'))
  `).run(Number(feedbackId), userId, content, isAnonymous ? 1 : 0);
  return { id: Number(result.lastInsertRowid), feedback_id: Number(feedbackId), content };
}

export function toggleFeedbackLike(feedbackId, userId) {
  if (!db.prepare("SELECT id FROM feedback WHERE id = ?").get(Number(feedbackId))) return null;
  const inserted = db.prepare(`
    INSERT INTO feedback_likes (feedback_id, user_id) VALUES (?, ?)
    ON CONFLICT(feedback_id, user_id) DO NOTHING
  `).run(Number(feedbackId), userId);
  let liked = inserted.changes > 0;
  if (!liked) {
    db.prepare("DELETE FROM feedback_likes WHERE feedback_id = ? AND user_id = ?").run(Number(feedbackId), userId);
  }
  const count = db.prepare("SELECT COUNT(*) AS count FROM feedback_likes WHERE feedback_id = ?").get(Number(feedbackId)).count;
  return { liked, count };
}

export function toggleFeedbackCommentLike(commentId, userId) {
  if (!db.prepare("SELECT id FROM feedback_comments WHERE id = ?").get(Number(commentId))) return null;
  const inserted = db.prepare(`
    INSERT INTO feedback_comment_likes (comment_id, user_id) VALUES (?, ?)
    ON CONFLICT(comment_id, user_id) DO NOTHING
  `).run(Number(commentId), userId);
  let liked = inserted.changes > 0;
  if (!liked) {
    db.prepare("DELETE FROM feedback_comment_likes WHERE comment_id = ? AND user_id = ?").run(Number(commentId), userId);
  }
  const count = db.prepare("SELECT COUNT(*) AS count FROM feedback_comment_likes WHERE comment_id = ?").get(Number(commentId)).count;
  return { liked, count };
}

export function replyFeedback(id, reply) {
  const result = db.prepare(`
    UPDATE feedback SET admin_reply = ?, replied_at = datetime('now') WHERE id = ?
  `).run(reply, Number(id));
  return result.changes > 0;
}

export function deleteFeedback(id) {
  return db.prepare("DELETE FROM feedback WHERE id = ?").run(Number(id)).changes > 0;
}

export function deleteFeedbackComment(id) {
  return db.prepare("DELETE FROM feedback_comments WHERE id = ?").run(Number(id)).changes > 0;
}

// ── User Journals (per-user subscription) ──

export function getUserJournals(userId) {
  const rows = db.prepare("SELECT journal_name FROM user_journals WHERE user_id = ?").all(userId);
  if (rows.length === 0) {
    // Return all available journals as default (first visit)
    return DEFAULT_JOURNALS.map((j) => j.name);
  }
  return rows.map((r) => r.journal_name);
}

export function setUserJournals(userId, journalNames) {
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM user_journals WHERE user_id = ?").run(userId);
    const insert = db.prepare("INSERT INTO user_journals (user_id, journal_name) VALUES (?, ?)");
    for (const name of journalNames) {
      insert.run(userId, name);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return getUserJournals(userId);
}

export function getUserSettings(userId) {
  const rows = db.prepare("SELECT key, value FROM settings").all();
  const values = Object.fromEntries(rows.map((row) => [row.key, row.value]));
  const userRows = db.prepare("SELECT key, value FROM user_settings WHERE user_id = ?").all(userId);
  Object.assign(values, Object.fromEntries(userRows.map((row) => [row.key, row.value])));
  
  // Get user-specific journals - use DEFAULT_JOURNALS as base
  const userJournalNames = getUserJournals(userId);
  const allJournals = normalizeJournals(DEFAULT_JOURNALS);
  const journals = allJournals.filter((j) => userJournalNames.includes(j.name));
  
  return {
    journals,
    refreshCron: values.refreshCron || config.refreshCron,
    emailEnabled: values.emailEnabled === "true",
    emailRecipients: JSON.parse(values.emailRecipients || "[]"),
    pushEnabled: values.pushEnabled === "true",
    pushFrequency: values.pushFrequency || config.pushFrequency,
    pushCron: values.pushCron || config.pushCron,
    pushDays: Number(values.pushDays || config.pushDays),
    pushIncludeFile: values.pushIncludeFile !== "false",
    pushIncludeAbstract: values.pushIncludeAbstract !== "false",
    pushIncludeKeywords: values.pushIncludeKeywords !== "false",
    pushIncludeTranslation: values.pushIncludeTranslation !== "false",
    pushJournalFilter: values.pushJournalFilter || ""
  };
}

export function updateUserSettings(userId, settings) {
  // Save user-specific journals
  if (Array.isArray(settings.journals)) {
    const journalNames = settings.journals.map((j) => j.name || j).filter(Boolean);
    setUserJournals(userId, journalNames);
  }
  
  const current = getUserSettings(userId);
  const upsert = db.prepare(`
    INSERT INTO user_settings (user_id, key, value, updated_at)
    VALUES (@userId, @key, @value, datetime('now'))
    ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
  `);

  db.exec("BEGIN");
  try {
    upsert.run({ userId, key: "refreshCron", value: settings.refreshCron || current.refreshCron });
    upsert.run({ userId, key: "emailEnabled", value: String(settings.emailEnabled !== undefined ? settings.emailEnabled : current.emailEnabled) });
    upsert.run({ userId, key: "emailRecipients", value: JSON.stringify(
      Array.isArray(settings.emailRecipients)
        ? settings.emailRecipients.map((email) => String(email).trim()).filter(Boolean)
        : current.emailRecipients
    )});
    upsert.run({ userId, key: "pushEnabled", value: String(settings.pushEnabled !== undefined ? settings.pushEnabled : current.pushEnabled) });
    upsert.run({ userId, key: "pushFrequency", value: settings.pushFrequency || current.pushFrequency });
    upsert.run({ userId, key: "pushCron", value: settings.pushCron || current.pushCron });
    upsert.run({ userId, key: "pushDays", value: String(settings.pushDays || current.pushDays) });
    upsert.run({ userId, key: "pushIncludeFile", value: String(settings.pushIncludeFile !== undefined ? settings.pushIncludeFile : current.pushIncludeFile) });
    upsert.run({ userId, key: "pushIncludeAbstract", value: String(settings.pushIncludeAbstract !== undefined ? settings.pushIncludeAbstract : current.pushIncludeAbstract) });
    upsert.run({ userId, key: "pushIncludeKeywords", value: String(settings.pushIncludeKeywords !== undefined ? settings.pushIncludeKeywords : current.pushIncludeKeywords) });
    upsert.run({ userId, key: "pushIncludeTranslation", value: String(settings.pushIncludeTranslation !== undefined ? settings.pushIncludeTranslation : current.pushIncludeTranslation) });
    upsert.run({ userId, key: "pushJournalFilter", value: settings.pushJournalFilter !== undefined ? String(settings.pushJournalFilter) : current.pushJournalFilter });
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  
  return getUserSettings(userId);
}
