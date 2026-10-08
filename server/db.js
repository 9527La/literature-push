import { resolveJournal } from "./publishers.js";
import { DatabaseSync } from "node:sqlite";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DEFAULT_JOURNAL_BY_NAME, DEFAULT_JOURNALS, config } from "./config.js";
import { resolveDataDirectory } from "./paths.js";
import { containsChineseText, escapeLike, decodeEntities, isNonResearchTitle, isUsableMetadataText } from "./utils.js";
import { businessWindow } from "./date/normalize.js";
import { mergeFirstPublic, resolveFirstPublicDate, resolveMergedFirstPublic } from "./date/resolve-first-public.js";
import { DIRECTIONS, isDirectionKey } from "./directions.js";

const DEFAULT_FAVORITE_GROUP_NAME = "默认收藏夹";
const dataDir = resolveDataDirectory();
fs.mkdirSync(dataDir, { recursive: true });

export const db = new DatabaseSync(path.join(dataDir, "literature.sqlite"));
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");
db.function("is_non_research_title", { deterministic: true }, (value) => isNonResearchTitle(value) ? 1 : 0);
db.function("contains_chinese_text", (value) => containsChineseText(value) ? 1 : 0);

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

// ── 文献主时间（first_public_at）字段迁移 ────────────────────────────────────
// 事实字段与业务主字段分离（方案 §4）：online_first_at / published_at /
// first_seen_at / fetched_at 是原始事实；first_public_at 及其来源 / 精度 /
// 可信度是全站统一的「首次公开日期」。全部只增不改旧列，历史数据可回溯。
for (const migration of [
  "ALTER TABLE articles ADD COLUMN online_first_at TEXT",
  "ALTER TABLE articles ADD COLUMN first_public_at TEXT",
  "ALTER TABLE articles ADD COLUMN first_public_source TEXT",
  "ALTER TABLE articles ADD COLUMN first_public_precision TEXT",
  "ALTER TABLE articles ADD COLUMN first_public_confidence TEXT",
  "ALTER TABLE articles ADD COLUMN date_verified_at TEXT",
  "ALTER TABLE articles ADD COLUMN external_created_at TEXT",
  // ── AI 研究方向（RUNBOOK-AI-DIRECTION.md）───────────────────────────────
  // 写入方只有两条：apply-directions.mjs（source='ai'）与管理员改判（source='manual'）。
  // 服务代码只读不写；manual 行永不覆盖。scripts/migrate-directions.mjs 是同一批
  // 列的手动迁移入口（幂等），两处结果一致。
  "ALTER TABLE articles ADD COLUMN research_direction TEXT",
  "ALTER TABLE articles ADD COLUMN research_direction_secondary TEXT",
  "ALTER TABLE articles ADD COLUMN direction_confidence REAL",
  "ALTER TABLE articles ADD COLUMN direction_source TEXT",
  "ALTER TABLE articles ADD COLUMN direction_reason TEXT",
  "ALTER TABLE articles ADD COLUMN classified_at TEXT"
]) {
  try { db.exec(migration); } catch (e) {
    if (!e.message?.includes("duplicate column") && !e.message?.includes("no such table")) throw e;
  }
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
    keywords TEXT,
    -- 文献主时间（first_public_at）：对新建库直接随建表语句给出；存量库由上方的
    -- ALTER 语句补列。两条路径都必须在建 idx_articles_first_public_at 索引前就绪。
    online_first_at TEXT,
    first_public_at TEXT,
    first_public_source TEXT,
    first_public_precision TEXT,
    first_public_confidence TEXT,
    date_verified_at TEXT,
    external_created_at TEXT,
    -- AI 研究方向：与上方 ALTER 迁移保持同列同序（两条路径缺一不可）。
    research_direction TEXT,
    research_direction_secondary TEXT,
    direction_confidence REAL,
    direction_source TEXT,
    direction_reason TEXT,
    classified_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_articles_journal ON articles(journal);
  CREATE INDEX IF NOT EXISTS idx_articles_published_at ON articles(published_at);
  CREATE INDEX IF NOT EXISTS idx_articles_read ON articles(is_read);
  CREATE INDEX IF NOT EXISTS idx_articles_first_public_at ON articles(first_public_at);
  CREATE INDEX IF NOT EXISTS idx_articles_direction ON articles(research_direction);

  CREATE TABLE IF NOT EXISTS refresh_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    added_count INTEGER NOT NULL DEFAULT 0,
    task_type TEXT NOT NULL DEFAULT 'refresh',
    enriched_abstract_count INTEGER NOT NULL DEFAULT 0,
    enriched_keyword_count INTEGER NOT NULL DEFAULT 0,
    translated_count INTEGER NOT NULL DEFAULT 0,
    failed_article_count INTEGER NOT NULL DEFAULT 0,
    failed_abstract_count INTEGER NOT NULL DEFAULT 0,
    failed_keyword_count INTEGER NOT NULL DEFAULT 0,
    failed_translation_count INTEGER NOT NULL DEFAULT 0,
    translated_title_count INTEGER NOT NULL DEFAULT 0,
    translated_abstract_count INTEGER NOT NULL DEFAULT 0,
    translation_unit_count INTEGER NOT NULL DEFAULT 0,
    translation_request_count INTEGER NOT NULL DEFAULT 0,
    remaining_abstract_count INTEGER NOT NULL DEFAULT 0,
    remaining_keyword_count INTEGER NOT NULL DEFAULT 0,
    remaining_translation_count INTEGER NOT NULL DEFAULT 0,
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

  CREATE TABLE IF NOT EXISTS user_sessions (
    session_id TEXT PRIMARY KEY,
    account_id INTEGER NOT NULL,
    login_ip TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    revoked_at INTEGER,
    FOREIGN KEY (account_id) REFERENCES user_accounts(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_user_sessions_account_active
    ON user_sessions(account_id, revoked_at, expires_at);

  CREATE TABLE IF NOT EXISTS discussion_profiles (
    user_id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL DEFAULT '',
    public_tag TEXT NOT NULL,
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

  CREATE TABLE IF NOT EXISTS favorite_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, name)
  );

  CREATE INDEX IF NOT EXISTS idx_favorite_groups_user ON favorite_groups(user_id, created_at);

  CREATE TABLE IF NOT EXISTS user_favorites (
    user_id TEXT NOT NULL,
    article_id INTEGER NOT NULL,
    group_id INTEGER,
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, article_id),
    FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE,
    FOREIGN KEY (group_id) REFERENCES favorite_groups(id) ON DELETE SET NULL
  );

  CREATE INDEX IF NOT EXISTS idx_user_favorites_user ON user_favorites(user_id, updated_at);
  CREATE INDEX IF NOT EXISTS idx_user_favorites_group ON user_favorites(user_id, group_id);

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

  CREATE TABLE IF NOT EXISTS ai_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL CHECK (kind IN ('weekly','monthly')),
    period_start TEXT NOT NULL,
    period_end TEXT NOT NULL,
    direction TEXT,
    status TEXT NOT NULL DEFAULT 'ready',
    content_md TEXT NOT NULL,
    stats_json TEXT,
    generated_at TEXT,
    generator TEXT NOT NULL DEFAULT 'workbuddy-agent',
    UNIQUE(kind, period_start, direction)
  );

  CREATE INDEX IF NOT EXISTS idx_ai_reports_kind_period ON ai_reports(kind, period_start);
`);

// ── ai_reports 方向维度迁移（2026-09-28 晚）：旧表无 direction 列且 UNIQUE 是
// 二元组——SQLite 不能改约束，重建表搬运数据。幂等：direction 列已存在则跳过。
if (!db.prepare("PRAGMA table_info(ai_reports)").all().some((column) => column.name === "direction")) {
  db.exec(`
    BEGIN;
    CREATE TABLE ai_reports_migrated (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL CHECK (kind IN ('weekly','monthly')),
      period_start TEXT NOT NULL,
      period_end TEXT NOT NULL,
      direction TEXT,
      status TEXT NOT NULL DEFAULT 'ready',
      content_md TEXT NOT NULL,
      stats_json TEXT,
      generated_at TEXT,
      generator TEXT NOT NULL DEFAULT 'workbuddy-agent',
      UNIQUE(kind, period_start, direction)
    );
    INSERT INTO ai_reports_migrated (id, kind, period_start, period_end, direction, status, content_md, stats_json, generated_at, generator)
      SELECT id, kind, period_start, period_end, NULL, status, content_md, stats_json, generated_at, generator FROM ai_reports;
    DROP TABLE ai_reports;
    ALTER TABLE ai_reports_migrated RENAME TO ai_reports;
    CREATE INDEX IF NOT EXISTS idx_ai_reports_kind_period ON ai_reports(kind, period_start);
    COMMIT;
  `);
}

for (const migration of [
  "ALTER TABLE user_emails ADD COLUMN name TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE user_emails ADD COLUMN grade TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE user_emails ADD COLUMN show_bilingual_titles INTEGER NOT NULL DEFAULT 1",
  "ALTER TABLE user_emails ADD COLUMN updated_at TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE user_emails ADD COLUMN enrollment_year INTEGER",
  "ALTER TABLE user_emails ADD COLUMN degree TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE feedback ADD COLUMN admin_reply TEXT",
  "ALTER TABLE feedback ADD COLUMN replied_at TEXT",
  "ALTER TABLE feedback ADD COLUMN is_anonymous INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE feedback ADD COLUMN is_closed INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE feedback ADD COLUMN closed_at TEXT",
  "ALTER TABLE user_accounts ADD COLUMN role TEXT NOT NULL DEFAULT 'user'",
  "ALTER TABLE refresh_runs ADD COLUMN task_type TEXT NOT NULL DEFAULT 'refresh'",
  "ALTER TABLE refresh_runs ADD COLUMN enriched_abstract_count INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE refresh_runs ADD COLUMN enriched_keyword_count INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE refresh_runs ADD COLUMN translated_count INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE refresh_runs ADD COLUMN failed_article_count INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE refresh_runs ADD COLUMN failed_abstract_count INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE refresh_runs ADD COLUMN failed_keyword_count INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE refresh_runs ADD COLUMN failed_translation_count INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE refresh_runs ADD COLUMN translated_title_count INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE refresh_runs ADD COLUMN translated_abstract_count INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE refresh_runs ADD COLUMN translation_unit_count INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE refresh_runs ADD COLUMN translation_request_count INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE refresh_runs ADD COLUMN remaining_abstract_count INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE refresh_runs ADD COLUMN remaining_keyword_count INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE refresh_runs ADD COLUMN remaining_translation_count INTEGER NOT NULL DEFAULT 0",
  // Translation attempt memory. Without it a permanently failing article sits at
  // the front of the "missing translation" queue forever and every run spends
  // requests on the same handful of records while the rest are never reached.
  "ALTER TABLE translations ADD COLUMN title_attempt_at TEXT",
  "ALTER TABLE translations ADD COLUMN abstract_attempt_at TEXT"
]) {
  try { db.exec(migration); } catch (error) {
    if (!error.message?.includes("duplicate column")) throw error;
  }
}
// Site administration is now granted by the separate admin web passport;
// personal accounts never carry site-wide administrator privileges.
db.prepare("UPDATE user_accounts SET role = 'user' WHERE role IS NULL OR role <> 'user'").run();
db.exec("UPDATE user_emails SET updated_at = created_at WHERE updated_at IS NULL OR updated_at = ''");

db.exec("UPDATE articles SET first_seen_at = fetched_at WHERE first_seen_at IS NULL OR first_seen_at = ''");

// Preserve favorites created before the dedicated collection tables existed.
// The account principal remains the source of isolation; no global article
// favorite flag is copied into another user's collection.
db.exec(`
  INSERT OR IGNORE INTO user_favorites (user_id, article_id, note, created_at, updated_at)
  SELECT ui.user_id, ui.article_id, '', datetime('now'), datetime('now')
  FROM user_interactions ui
  JOIN articles a ON a.id = ui.article_id
  WHERE ui.is_favorite = 1
`);

// 一次性清理历史遗留的「自动默认收藏夹」。早期实现会在每次读取收藏时凭空建出
// 一条名为「默认收藏夹」的分组记录，用户删掉后下一次读取又被建回来，于是每个人
// 都多一个自己没建过、永远是 0 篇的分组。这里只删除**0 篇收藏**的分组，并把
// 指向它的「默认分组」设置复位为未分组；收藏数据本身一概不动。
if (!db.prepare("SELECT 1 FROM settings WHERE key = 'legacyDefaultFavoriteGroupCleaned'").get()) {
  const removed = db.prepare(`
    DELETE FROM favorite_groups
    WHERE name = ?
      AND NOT EXISTS (SELECT 1 FROM user_favorites uf WHERE uf.group_id = favorite_groups.id)
  `).run(DEFAULT_FAVORITE_GROUP_NAME).changes;
  db.prepare(`
    UPDATE user_settings SET value = 'ungrouped', updated_at = datetime('now')
    WHERE key = 'defaultFavoriteGroupId'
      AND value <> 'ungrouped'
      AND value NOT IN (SELECT CAST(id AS TEXT) FROM favorite_groups)
  `).run();
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('legacyDefaultFavoriteGroupCleaned', ?)")
    .run(new Date().toISOString());
  if (removed) console.log(`[db] 已清理 ${removed} 个遗留的空白「默认收藏夹」分组`);
}

// 这里过去会给历史账户逐个补一个「默认收藏夹」，现已废弃：分组只由用户显式创建，
// 而遗留的空白默认分组由上面 legacyDefaultFavoriteGroupCleaned 那次清理一次性移除。

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
insertSetting.run("pushDirectionFilter", config.pushDirectionFilter);
insertSetting.run("pushIncludeAiReport", String(config.pushIncludeAiReport));

// ── 一次性修正：期刊目录 ISSN 串号带来的历史污染 ────────────────────────────
// 两个已知问题：
//   ① Elsevier《Energy》的 ISSN 里曾混进 ICE《Proceedings of the Institution of
//      Civil Engineers - Energy》的 1751-4223 / 1751-4231，Crossref 按 ISSN 检索
//      于是把土木工程那本刊的论文也拉了进来；
//   ② 有的记录把期刊名存成了 HTML 实体写法（"...Power &amp; Energy Systems"），
//      在统计里会和正规写法各占一行。
// settings.journals 是用 INSERT OR IGNORE 写的，光改代码不会生效，所以这里还要
// 订正已持久化的目录，并清掉归一化后仍不在目录内的论文（连带其交互/收藏/翻译）。
if (!db.prepare("SELECT 1 FROM settings WHERE key = 'journalCatalogIssnsRepaired'").get()) {
  const storedJournals = db.prepare("SELECT value FROM settings WHERE key = 'journals'").get()?.value;
  if (storedJournals) {
    try {
      const list = JSON.parse(storedJournals);
      const bogus = new Set(["1751-4223", "1751-4231"]);
      let changed = false;
      for (const journal of list) {
        if (!journal || journal.name !== "Energy" || !Array.isArray(journal.issns)) continue;
        const before = journal.issns.map((issn) => String(issn).trim());
        const next = before.filter((issn) => issn && !bogus.has(issn));
        if (!next.includes("1873-6785")) next.push("1873-6785");
        if (next.join(",") !== before.join(",")) {
          journal.issns = next;
          changed = true;
        }
      }
      if (changed) db.prepare("UPDATE settings SET value = ? WHERE key = 'journals'").run(JSON.stringify(list));
    } catch { /* 目录不是合法 JSON 时交给 normalizeJournals 兜底 */ }
  }

  const catalogNames = new Set(DEFAULT_JOURNALS.map((journal) => journal.name));
  const removals = [];
  for (const row of db.prepare("SELECT id, journal FROM articles").all()) {
    const canonical = canonicalJournalName(row.journal);
    if (canonical !== row.journal) {
      db.prepare("UPDATE articles SET journal = ? WHERE id = ?").run(canonical, row.id);
    }
    // 期刊名为空的记录保留（界面上按「未标记期刊」显示），只清明确落在目录外的。
    if (canonical && !catalogNames.has(canonical)) removals.push({ id: row.id, journal: canonical });
  }
  if (removals.length) {
    const placeholders = removals.map(() => "?").join(", ");
    const ids = removals.map((row) => row.id);
    db.prepare(`DELETE FROM user_interactions WHERE article_id IN (${placeholders})`).run(...ids);
    db.prepare(`DELETE FROM user_favorites WHERE article_id IN (${placeholders})`).run(...ids);
    db.prepare(`DELETE FROM translations WHERE article_id IN (${placeholders})`).run(...ids);
    db.prepare(`DELETE FROM articles WHERE id IN (${placeholders})`).run(...ids);
    const names = [...new Set(removals.map((row) => row.journal))].join(" | ");
    console.warn(`[db] 已移除 ${removals.length} 篇非期刊目录文献：${names}`);
  }
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('journalCatalogIssnsRepaired', ?)")
    .run(new Date().toISOString());
}

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
    pushJournalFilter: values.pushJournalFilter || "",
    pushDirectionFilter: values.pushDirectionFilter || "",
    pushIncludeAiReport: values.pushIncludeAiReport !== "false"
  };
}

export function normalizeJournals(journals) {
  return journals
    .map((journal) => {
      if (typeof journal === "string") {
        const preset = DEFAULT_JOURNAL_BY_NAME.get(journal);
        return preset || { name: journal, issns: [] };
      }
      journal = resolveJournal(journal);
      const preset = DEFAULT_JOURNAL_BY_NAME.get(journal.name);
      return {
        publisher: journal.publisher || "",
        // `group` is the editorial publisher bucket (ieee / elsevier / cn /
        // other) and may differ from `publisher`: JMPSCE is crawled through
        // IEEE Xplore but published by State Grid.
        group: journal.group || preset?.group || "",
        platform: journal.platform,
        name: journal.name,
        issns: Array.isArray(journal.issns) ? journal.issns.filter(Boolean) : (preset?.issns || []),
        wanfangId: journal.wanfangId || preset?.wanfangId || "",
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
    pushJournalFilter: settings.pushJournalFilter !== undefined ? String(settings.pushJournalFilter) : current.pushJournalFilter,
    pushDirectionFilter: settings.pushDirectionFilter !== undefined ? sanitizeDirectionFilter(settings.pushDirectionFilter) : current.pushDirectionFilter,
    pushIncludeAiReport: settings.pushIncludeAiReport !== undefined ? Boolean(settings.pushIncludeAiReport) : current.pushIncludeAiReport
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
    upsert.run({ key: "pushDirectionFilter", value: next.pushDirectionFilter });
    upsert.run({ key: "pushIncludeAiReport", value: String(next.pushIncludeAiReport) });
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return next;
}

// ── 文献日期口径（全站唯一真值） ──────────────────────────────────────────
// 主口径 = first_public_at（论文第一次正式公开的日期，YYYY-MM-DD）：
//   · A 级：IEEE Early Access / Elsevier Available online / 中文网络首发
//     （online_first_at，由回填作业写入）；
//   · B 级：已发生的正式出版日期；
//   · D 级：没有任何外部时间时的兜底 = first_seen_at（北京业务日）。
// 由 server/date/resolve-first-public.js 统一解析，insertArticles /
// updateArticleDetails / scripts/backfill-first-public-date.mjs 都写入该字段。
//
// effectiveDateSql 保留为**兜底**表达式：first_public_at 尚未回填的行按旧规则
// （正式出版且到期用出版日，否则用入库时间）取日期，保证迁移期内任何一行都有
// 日期可用。display_date / 排序 / 筛选 / 近 N 日统计 / 推送窗口 / 关键词统计 /
// 后台覆盖度 / 导出全部走 displayDateSql（= first_public_at 优先、旧口径兜底）。
// 任何一处漏改，同一批数据在不同页面就会算出不同的「新论文」和不同的日期。
function effectiveDateSql(alias = "a") {
  return `datetime(CASE
      WHEN datetime(${alias}.published_at) IS NULL THEN COALESCE(NULLIF(${alias}.first_seen_at, ''), ${alias}.fetched_at)
      WHEN datetime(${alias}.published_at) > datetime('now') THEN COALESCE(NULLIF(${alias}.first_seen_at, ''), ${alias}.fetched_at)
      ELSE ${alias}.published_at
    END)`;
}

/** 全站展示与比较口径：first_public_at 优先，未回填的行走旧口径，恒为 YYYY-MM-DD。 */
function displayDateSql(alias = "a") {
  return `COALESCE(NULLIF(${alias}.first_public_at, ''), substr(${effectiveDateSql(alias)}, 1, 10))`;
}

export function listArticles(filters = {}, userId) {
  const { clauses, params, order } = buildArticleListQuery(filters, userId);

  if (userId) {
    const whereClause = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const articles = db.prepare(`
      SELECT a.*,
        ${displayDateSql("a")} AS display_date,
        COALESCE(ui_read.is_read, 0) AS is_read,
        COALESCE(ui_fav.is_favorite, 0) AS is_favorite,
        zh.title AS translated_title,
        zh.abstract AS translated_abstract
      FROM articles a
      LEFT JOIN user_interactions ui_read ON ui_read.article_id = a.id AND ui_read.user_id = @userId AND ui_read.is_read = 1
      LEFT JOIN user_interactions ui_fav ON ui_fav.article_id = a.id AND ui_fav.user_id = @userId AND ui_fav.is_favorite = 1
      LEFT JOIN translations zh ON zh.article_id = a.id AND zh.target_language = 'zh'
      ${whereClause}
      ORDER BY ${displayDateSql("a")} ${order}, a.id ${order}
      LIMIT 500
    `).all({ ...params, userId });
    return articles;
  }

  const whereFinal = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return db.prepare(`
    SELECT a.*,
      ${displayDateSql("a")} AS display_date,
      zh.title AS translated_title,
      zh.abstract AS translated_abstract
    FROM articles a
    LEFT JOIN translations zh ON zh.article_id = a.id AND zh.target_language = 'zh'
    ${whereFinal}
    ORDER BY ${displayDateSql("a")} ${order}, a.id ${order}
    LIMIT 500
  `).all(params);
}

// 「其他」方向 = 分类器判定不属于 14 个正式电力系统方向的文献。默认不进入
// 正式展示面（前台列表 / 推送 / 关键词统计），但数据保留在库中：管理端总览、
// /api/directions 方向统计与详情直达仍可见；direction 筛选显式包含 other 时
// 列表豁免此排除（见 buildArticleListQuery）。
const EXCLUDE_OTHER_CLAUSE = "(a.research_direction IS NULL OR a.research_direction != 'other')";
const EXCLUDE_OTHER_PLAIN = "(research_direction IS NULL OR research_direction != 'other')";

// 推送方向过滤（PLAN-AI-REPORTS.md M1）：逗号拆分 → isDirectionKey 白名单 →
// 去重后重新 join。非法 key 静默丢弃，与列表 direction 筛选的清洗语义一致；
// 结果恒为 CSV（可为空串=全部方向），入库前统一走这里。
function sanitizeDirectionFilter(value) {
  const keys = String(value || "").split(",").map((t) => t.trim()).filter(isDirectionKey);
  return [...new Set(keys)].join(",");
}

function buildArticleListQuery(filters = {}, userId) {
  const clauses = ["is_non_research_title(a.title) = 0"];
  const params = {};
  // 未分类（NULL）照常展示：等分类任务收口后 NULL 只剩新增窗口期的文章。
  if (!String(filters.direction || "").split(",").map((t) => t.trim()).includes("other")) {
    clauses.push(EXCLUDE_OTHER_CLAUSE);
  }

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
    // ESCAPE '\\' 让 escapeLike 的 \%/\_ 生效：没有该子句时反斜杠是普通字符，
    // 搜「PM_2.5」「100%」这类词会静默漏检（实测 LIKE '%a\%b%' 匹配 0 行）。
    clauses.push("(a.title LIKE @q ESCAPE '\\' OR a.abstract LIKE @q ESCAPE '\\' OR a.authors LIKE @q ESCAPE '\\' OR a.keywords LIKE @q ESCAPE '\\')");
    params.q = `%${escaped}%`;
  }
  // 日期筛选也走统一口径：提前访问的文献按「加入数据库的时间」参与区间判定，
  // 不然筛「今年」会把一批卷期日写在未来的在线首发论文整批漏掉。
  if (filters.from) {
    clauses.push(`${displayDateSql("a")} >= @from`);
    params.from = filters.from;
  }
  if (filters.to) {
    clauses.push(`${displayDateSql("a")} <= @to`);
    params.to = filters.to;
  }
  if (filters.keyword) {
    const terms = String(filters.keyword).split(",").map((t) => t.trim()).filter(Boolean);
    if (terms.length) {
      // 与 q 分支同规：escapeLike + ESCAPE，关键词里的 %/_ 按字面匹配。
      const orClauses = terms.map((_, i) => `a.keywords LIKE @kw${i} ESCAPE '\\'`);
      clauses.push(`(${orClauses.join(" OR ")})`);
      terms.forEach((term, i) => { params[`kw${i}`] = `%${escapeLike(term)}%`; });
    }
  }
  // 研究方向多选（OR），与 journal 参数同构；key 服务端白名单校验防注入。
  if (filters.direction) {
    const keys = String(filters.direction).split(",").map((t) => t.trim()).filter(isDirectionKey);
    if (keys.length) {
      const orClauses = keys.map((_, i) => `a.research_direction = @dir${i}`);
      clauses.push(`(${orClauses.join(" OR ")})`);
      keys.forEach((key, i) => { params[`dir${i}`] = key; });
    }
  }
  // AI 速览精选/速评文献直取（PLAN-AI-REPORTS.md）：ids 白名单整数、上限 100
  //（大方向专报单期速评可达 59 篇，需一次拉全）；有 ids 值但全部非法时按
  // 「空结果」处理而不是退回全表。
  if (filters.ids) {
    const ids = String(filters.ids).split(",").map((t) => Number(t.trim()))
      .filter((n) => Number.isInteger(n) && n > 0).slice(0, 100);
    if (ids.length) {
      clauses.push(`a.id IN (${ids.map((_, i) => `@aid${i}`).join(", ")})`);
      ids.forEach((id, i) => { params[`aid${i}`] = id; });
    } else {
      clauses.push("0 = 1");
    }
  }

  if (userId) {
    if (filters.unread === "true") {
      clauses.push("NOT EXISTS (SELECT 1 FROM user_interactions ui WHERE ui.user_id = @userId AND ui.article_id = a.id AND ui.is_read = 1)");
      params.userId = userId;
    }
    if (filters.favorite === "true") {
      clauses.push("EXISTS (SELECT 1 FROM user_interactions ui WHERE ui.user_id = @userId AND ui.article_id = a.id AND ui.is_favorite = 1)");
      params.userId = userId;
    }
  }

  return { clauses, params, order: filters.sort === "asc" ? "ASC" : "DESC" };
}

function normalizeArticlePageLimit(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 50;
  return Math.min(Math.max(Math.floor(parsed), 1), 500);
}

function normalizeArticlePageOffset(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(Math.max(Math.floor(parsed), 0), 10_000_000);
}

// The feed only needs a compact preview. Full article text remains available
// through getArticleForUser()/the detail endpoint, so the first page does not
// transfer every full abstract and translation.
export function listArticlePage(filters = {}, userId) {
  const { clauses, params, order } = buildArticleListQuery(filters, userId);
  const limit = normalizeArticlePageLimit(filters.limit);
  const offset = normalizeArticlePageOffset(filters.offset);
  const where = `WHERE ${clauses.join(" AND ")}`;
  const interactionJoins = userId
    ? `
      LEFT JOIN user_interactions ui_read ON ui_read.article_id = a.id AND ui_read.user_id = @userId AND ui_read.is_read = 1
      LEFT JOIN user_interactions ui_fav ON ui_fav.article_id = a.id AND ui_fav.user_id = @userId AND ui_fav.is_favorite = 1
    `
    : "";
  const interactionFields = userId
    ? "COALESCE(ui_read.is_read, 0) AS is_read, COALESCE(ui_fav.is_favorite, 0) AS is_favorite"
    : "0 AS is_read, 0 AS is_favorite";

  const rows = db.prepare(`
    SELECT
      a.id,
      a.external_id,
      a.title,
      a.authors,
      a.journal,
      a.year,
      a.volume,
      a.issue,
      a.doi,
      substr(a.abstract, 1, 320) AS abstract,
      a.url,
      a.published_at,
      ${displayDateSql("a")} AS display_date,
      a.keywords,
      a.research_direction,
      a.research_direction_secondary,
      a.direction_confidence,
      a.direction_source,
      a.direction_reason,
      ${interactionFields},
      zh.title AS translated_title,
      substr(zh.abstract, 1, 320) AS translated_abstract,
      COUNT(*) OVER () AS total_count
    FROM articles a
    LEFT JOIN translations zh ON zh.article_id = a.id AND zh.target_language = 'zh'
    ${interactionJoins}
    ${where}
    ORDER BY ${displayDateSql("a")} ${order}, a.id ${order}
    LIMIT @pageLimitPlusOne OFFSET @pageOffset
  `).all({
    ...params,
    ...(userId ? { userId } : {}),
    pageLimitPlusOne: limit + 1,
    pageOffset: offset
  });

  const hasMore = rows.length > limit;
  const total = rows.length ? Number(rows[0].total_count || 0) : 0;
  const articles = rows.slice(0, limit).map(({ total_count, ...article }) => article);
  return { articles, hasMore, total, limit, offset };
}

export function listRecentArticlesForDigest(days, limit, journals = [], directions = []) {
  // 窗口 = 近 N 日（北京时间今天 + 向前 N-1 个自然日，恰好 N 天），判据 = 全站
  // 统一的「文献主时间」first_public_at（见 displayDateSql）：
  //   · 正式出版且期号日已到 → 用正式出版日期，只有当期真正出版的新论文才算新；
  //   · 提前访问 / 在线首发（卷期日写在未来）→ 用首次公开日期（回填前兜底为入库
  //     时间），同一批在线首发不会因为日期永远大于窗口起点而被每周重复推送；
  //   · 历史补录（首次公开日期早于窗口）→ 排除，否则一次批量回填会把陈年论文全
  //     当新的（方案 §20：历史补录天然不污染周报，不再需要额外上界补丁）。
  // 「今天」按北京业务日取（businessWindow），不再用 UTC 的 toISOString 切日，
  // 北京时间 0—8 点生成的周报不会把窗口整体错位一天。
  const { startDate, endDate } = businessWindow(Number(days || 7));
  const sinceDate = startDate;
  const todayDate = endDate;
  const maxRows = Number(limit || 0);
  const limitClause = maxRows > 0 ? "LIMIT @limit" : "";
  const journalNames = journals.map((journal) => journal.name || journal).filter(Boolean);
  const journalClause = journalNames.length
    ? `AND journal IN (${journalNames.map((_, index) => `@journal${index}`).join(", ")})`
    : "";
  // 推送方向过滤（PLAN-AI-REPORTS.md M3）：与 buildArticleListQuery 的 direction
  // 筛选同语义——key 白名单校验；显式包含 other 时替换（而非叠加）other 排除，
  // 即「选其他=只要其他」；空/非法 key = 不过滤，维持默认排除。
  const directionKeys = (Array.isArray(directions) ? directions : [])
    .map((key) => String(key || "").trim())
    .filter(isDirectionKey);
  const directionClause = directionKeys.length
    ? `AND research_direction IN (${directionKeys.map((_, index) => `@dir${index}`).join(", ")})`
    : "";
  const excludeOtherClause = directionKeys.includes("other") ? "" : `AND ${EXCLUDE_OTHER_PLAIN}`;

  const params = { sinceDate, todayDate };
  journalNames.forEach((journal, index) => {
    params[`journal${index}`] = journal;
  });
  directionKeys.forEach((key, index) => {
    params[`dir${index}`] = key;
  });
  if (maxRows > 0) {
    params.limit = maxRows;
  }

  return db.prepare(`
    SELECT articles.*, ${displayDateSql("articles")} AS display_date
    FROM articles
    WHERE
      ${displayDateSql("articles")} >= @sinceDate
      AND ${displayDateSql("articles")} <= @todayDate
      AND lower(title) NOT LIKE '%information%'
      AND lower(title) NOT LIKE '%table of contents%'
      AND lower(title) NOT LIKE '%blank page%'
      AND lower(title) NOT LIKE 'correction to%'
      AND lower(title) NOT LIKE '%publication information%'
      AND lower(title) NOT LIKE '%front cover%'
      AND lower(title) NOT LIKE '%back cover%'
      ${excludeOtherClause}
      ${directionClause}
      ${journalClause}
    ORDER BY ${displayDateSql("articles")} DESC, id DESC
    ${limitClause}
  `).all(params);
}

export function getArticle(id) {
  // display_date 与列表页同源，详情弹窗才不会和卡片上的日期对不上。
  return db.prepare(`SELECT articles.*, ${displayDateSql("articles")} AS display_date FROM articles WHERE id = ?`).get(id);
}

export function getArticleForUser(id, userId) {
  const article = getArticle(id);
  if (!article) return null;

  const translation = db.prepare(`
    SELECT title AS translated_title, abstract AS translated_abstract
    FROM translations
    WHERE article_id = ? AND target_language = 'zh'
  `).get(id) || {};
  const interaction = userId
    ? getUserInteraction(userId, id)
    : { is_read: 0, is_favorite: 0 };

  return {
    ...article,
    ...translation,
    is_read: interaction.is_read ? 1 : 0,
    is_favorite: interaction.is_favorite ? 1 : 0
  };
}

// ── 相关文献推荐（摘要弹窗「相关文献」，纯 SQL+JS 打分，零 AI、零联网）──────
// 打分口径：关键词共现数（主信号）→ 展示日期新→旧 → id 新→旧。
// 候选池：来源文章有主方向（且非 other）时取同方向；来源是 other 或未分类时
// 在「非 other」全库里找（other 默认移出用户可见面，见 DESIGN-FRONTEND-DIRECTION §2.2）。
function relatedKeywordSet(keywords) {
  return new Set(String(keywords || "")
    .split(/[;；,，]/)
    .map((keyword) => keyword.trim().toLowerCase())
    .filter((keyword) => keyword.length >= 2));
}

export function listRelatedArticles(id, userId, limit = 3) {
  const articleId = Number(id);
  if (!Number.isInteger(articleId) || articleId <= 0) return [];
  const cappedLimit = Math.min(Math.max(Math.floor(Number(limit)) || 3, 1), 10);
  const source = db
    .prepare("SELECT id, keywords, research_direction FROM articles WHERE id = ?")
    .get(articleId);
  if (!source) return [];

  const hasUsableDirection = Boolean(source.research_direction) && source.research_direction !== "other";
  const directionClause = hasUsableDirection
    ? "a.research_direction = @sourceDirection"
    : EXCLUDE_OTHER_CLAUSE;

  const interactionJoins = userId
    ? `
      LEFT JOIN user_interactions ui_read ON ui_read.article_id = a.id AND ui_read.user_id = @userId AND ui_read.is_read = 1
      LEFT JOIN user_interactions ui_fav ON ui_fav.article_id = a.id AND ui_fav.user_id = @userId AND ui_fav.is_favorite = 1
    `
    : "";
  const interactionFields = userId
    ? "COALESCE(ui_read.is_read, 0) AS is_read, COALESCE(ui_fav.is_favorite, 0) AS is_favorite"
    : "0 AS is_read, 0 AS is_favorite";

  // 候选池按展示日期倒序取 240 篇，共现打分在 JS 侧完成（keywords 是分号分隔
  // 自由文本，SQL 侧算交集需要逐词展开，不值得）；池深按最大方向规模估算。
  const pool = db.prepare(`
    SELECT
      a.id,
      a.title,
      a.journal,
      a.doi,
      substr(a.abstract, 1, 200) AS abstract,
      a.url,
      a.published_at,
      a.keywords,
      a.research_direction,
      a.research_direction_secondary,
      a.direction_confidence,
      a.direction_source,
      a.direction_reason,
      ${displayDateSql("a")} AS display_date,
      zh.title AS translated_title,
      substr(zh.abstract, 1, 200) AS translated_abstract,
      ${interactionFields}
    FROM articles a
    LEFT JOIN translations zh ON zh.article_id = a.id AND zh.target_language = 'zh'
    ${interactionJoins}
    WHERE a.id != @sourceId
      AND is_non_research_title(a.title) = 0
      AND ${directionClause}
    ORDER BY ${displayDateSql("a")} DESC, a.id DESC
    LIMIT @poolLimit
  `).all({
    sourceId: articleId,
    ...(hasUsableDirection ? { sourceDirection: source.research_direction } : {}),
    ...(userId ? { userId } : {}),
    poolLimit: 240
  });

  const sourceKeywords = relatedKeywordSet(source.keywords);
  const scored = pool.map((row) => {
    let overlap = 0;
    if (sourceKeywords.size) {
      for (const keyword of relatedKeywordSet(row.keywords)) {
        if (sourceKeywords.has(keyword)) overlap += 1;
      }
    }
    return { row, overlap };
  });
  scored.sort((a, b) =>
    b.overlap - a.overlap
    || String(b.row.display_date || "").localeCompare(String(a.row.display_date || ""))
    || b.row.id - a.row.id
  );
  return scored.slice(0, cappedLimit).map(({ row }) => row);
}

export function updateArticleDetails(id, details) {
  details = { ...details };
  for (const field of ["title", "authors", "journal", "abstract", "keywords"]) {
    if (typeof details[field] === "string") details[field] = decodeEntities(details[field]);
    if (details[field] && !isUsableMetadataText(details[field])) details[field] = "";
  }
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
      online_first_at = COALESCE(NULLIF(@online_first_at, ''), online_first_at),
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
    online_first_at: details.online_first_at || "",
    fetched_at: new Date().toISOString()
  });
  // 事实字段（published_at / online_first_at）更新后重算主时间：允许升级
  // （如入库时是 D 级兜底，补到出版日期后升为 B 级）；已确认的 A 级不被改写
  // （mergeFirstPublic 负责，方案 §25）。
  const row = db.prepare("SELECT * FROM articles WHERE id = ?").get(id);
  if (row) {
    const final = mergeFirstPublic(row, resolveFirstPublicDate(row));
    if (final && (final.first_public_at !== row.first_public_at
      || final.first_public_source !== row.first_public_source
      || final.first_public_precision !== row.first_public_precision
      || final.first_public_confidence !== row.first_public_confidence)) {
      db.prepare(`
        UPDATE articles
        SET first_public_at = @first_public_at,
            first_public_source = @first_public_source,
            first_public_precision = @first_public_precision,
            first_public_confidence = @first_public_confidence,
            date_verified_at = @date_verified_at
        WHERE id = @id
      `).run({ ...final, date_verified_at: new Date().toISOString(), id });
    }
  }
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
      -- Translation requests can intentionally contain only the missing
      -- subset of fields.  Preserve anything already cached when a provider
      -- returns an empty value for the other fields.
      title = CASE WHEN length(trim(coalesce(excluded.title, ''))) > 0 THEN excluded.title ELSE translations.title END,
      abstract = CASE WHEN length(trim(coalesce(excluded.abstract, ''))) > 0 THEN excluded.abstract ELSE translations.abstract END,
      -- Keep the legacy keywords column for old databases, but never create
      -- or overwrite it as part of the title/abstract translation flow.
      keywords = translations.keywords,
      provider = CASE WHEN length(trim(coalesce(excluded.provider, ''))) > 0 THEN excluded.provider ELSE translations.provider END,
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

// Persist several field-level translation results atomically.  A provider can
// return title and abstract results in one request, so committing the whole
// batch together prevents a partially written response from being mistaken
// for a complete translation run.
export function saveTranslations(entries = []) {
  const values = Array.isArray(entries) ? entries.filter((entry) => entry?.articleId && entry?.targetLanguage) : [];
  if (!values.length) return [];
  const statement = db.prepare(`
    INSERT INTO translations (article_id, target_language, title, abstract, keywords, provider, translated_at)
    VALUES (@articleId, @targetLanguage, @title, @abstract, @keywords, @provider, @translatedAt)
    ON CONFLICT(article_id, target_language) DO UPDATE SET
      title = CASE WHEN length(trim(coalesce(excluded.title, ''))) > 0 THEN excluded.title ELSE translations.title END,
      abstract = CASE WHEN length(trim(coalesce(excluded.abstract, ''))) > 0 THEN excluded.abstract ELSE translations.abstract END,
      keywords = translations.keywords,
      provider = CASE WHEN length(trim(coalesce(excluded.provider, ''))) > 0 THEN excluded.provider ELSE translations.provider END,
      translated_at = excluded.translated_at
  `);
  db.exec("BEGIN");
  try {
    for (const entry of values) {
      const translation = entry.translation || {};
      statement.run({
        articleId: entry.articleId,
        targetLanguage: entry.targetLanguage,
        title: translation.title || "",
        abstract: translation.abstract || "",
        keywords: "",
        provider: translation.provider || "",
        translatedAt: new Date().toISOString()
      });
    }
    db.exec("COMMIT");
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch {}
    throw error;
  }
  return values.map((entry) => getTranslation(entry.articleId, entry.targetLanguage));
}

/**
 * 入库时把期刊名归一化：解 HTML 实体、压空白，能对上期刊目录的换成目录里的规范
 * 写法。不然 "International Journal of Electrical Power &amp; Energy Systems" 会
 * 和正规写法在统计里各占一行，管理中心就多出一本「不存在的期刊」。
 */
function canonicalJournalName(value) {
  const decoded = decodeEntities(value || "").replace(/\s+/g, " ").trim();
  return DEFAULT_JOURNAL_BY_NAME.get(decoded)?.name || decoded;
}

export function insertArticles(articles) {
  const exists = db.prepare("SELECT 1 FROM articles WHERE external_id = ?");
  const getId = db.prepare("SELECT id FROM articles WHERE external_id = ?");
  const existingRowStatement = db.prepare(`
    SELECT online_first_at, first_public_at, first_public_source, first_public_precision,
           first_public_confidence, date_verified_at, first_seen_at, published_at
    FROM articles WHERE external_id = ?
  `);
  const statement = db.prepare(`
    INSERT INTO articles (
      external_id, title, authors, journal, year, volume, issue, doi, abstract, url, published_at,
      fetched_at, first_seen_at, keywords, online_first_at,
      first_public_at, first_public_source, first_public_precision, first_public_confidence, date_verified_at
    )
    VALUES (
      @external_id, @title, @authors, @journal, @year, @volume, @issue, @doi, @abstract, @url, @published_at,
      @fetched_at, @first_seen_at, @keywords, @online_first_at,
      @first_public_at, @first_public_source, @first_public_precision, @first_public_confidence, @date_verified_at
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
      online_first_at = COALESCE(NULLIF(articles.online_first_at, ''), excluded.online_first_at),
      -- first_public_* 写入的是「已与存量行合并后重新解析」的最终值（见下方
      -- resolveMergedFirstPublic / mergeFirstPublic）：已确认的 A 级首次公开日期
      -- 不会被后续抓取改写或降级（方案 §25）。first_seen_at 永不更新（§12）。
      first_public_at = excluded.first_public_at,
      first_public_source = excluded.first_public_source,
      first_public_precision = excluded.first_public_precision,
      first_public_confidence = excluded.first_public_confidence,
      date_verified_at = excluded.date_verified_at,
      fetched_at = excluded.fetched_at
  `);

  db.exec("BEGIN");
  try {
    let added = 0;
    const addedArticles = [];
    for (const incoming of articles) {
      const item = { ...incoming, journal: canonicalJournalName(incoming.journal) };
      const firstSeenAt = item.first_seen_at || item.fetched_at || new Date().toISOString();
      const wasExisting = exists.get(item.external_id);
      // 主时间解析：与存量行合并事实字段（新值优先、旧值兜底），再按 A/B/C/D
      // 优先级解析，最后按「不降级、不覆盖已确认值」的规则合并出最终写入值。
      const existingRow = wasExisting ? existingRowStatement.get(item.external_id) : null;
      const resolved = resolveMergedFirstPublic(existingRow, { ...item, first_seen_at: existingRow?.first_seen_at || firstSeenAt });
      const final = mergeFirstPublic(existingRow, resolved);
      item.first_seen_at = existingRow?.first_seen_at || firstSeenAt;
      item.online_first_at = item.online_first_at || existingRow?.online_first_at || null;
      item.first_public_at = final?.first_public_at ?? null;
      item.first_public_source = final?.first_public_source ?? null;
      item.first_public_precision = final?.first_public_precision ?? null;
      item.first_public_confidence = final?.first_public_confidence ?? null;
      item.date_verified_at = final && final !== existingRow ? new Date().toISOString() : existingRow?.date_verified_at ?? null;
      statement.run(item);
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

export function toggleArticleFavoriteForUser(userId, articleId, options = {}) {
  const article = getArticle(articleId);
  if (!article) return null;
  const row = db.prepare("SELECT is_favorite FROM user_interactions WHERE user_id = ? AND article_id = ?").get(userId, articleId);
  const favorite = db.prepare("SELECT 1 AS favorite_exists FROM user_favorites WHERE user_id = ? AND article_id = ?").get(userId, articleId);
  const currentlyFavorite = Boolean(row?.is_favorite || favorite?.favorite_exists);
  if (!currentlyFavorite) {
    const groupId = options.groupId === undefined ? getDefaultFavoriteGroupId(userId) : normalizeFavoriteGroupId(options.groupId);
    if (groupId !== null && !db.prepare("SELECT 1 FROM favorite_groups WHERE id = ? AND user_id = ?").get(groupId, userId)) {
      throw new Error("\u6536\u85cf\u5206\u7ec4\u4e0d\u5b58\u5728");
    }
    db.prepare(`
      INSERT INTO user_interactions (user_id, article_id, is_read, is_favorite, updated_at)
      VALUES (?, ?, 0, 1, datetime('now'))
      ON CONFLICT(user_id, article_id) DO UPDATE SET is_favorite = 1, updated_at = datetime('now')
    `).run(userId, articleId);
    db.prepare(`
      INSERT OR IGNORE INTO user_favorites (user_id, article_id, group_id, note, created_at, updated_at)
      VALUES (?, ?, ?, '', datetime('now'), datetime('now'))
    `).run(userId, articleId, groupId);
    if (options.setDefault) setDefaultFavoriteGroupId(userId, groupId);
  } else {
    db.prepare("UPDATE user_interactions SET is_favorite = 0, updated_at = datetime('now') WHERE user_id = ? AND article_id = ?").run(userId, articleId);
    db.prepare("DELETE FROM user_favorites WHERE user_id = ? AND article_id = ?").run(userId, articleId);
  }
  const interaction = db.prepare("SELECT is_read, is_favorite FROM user_interactions WHERE user_id = ? AND article_id = ?").get(userId, articleId);
  const favoriteRecord = currentlyFavorite ? null : db.prepare(`${favoriteArticleSelect()} WHERE uf.user_id = ? AND uf.article_id = ?`).get(userId, articleId);
  return { ...article, ...(favoriteRecord || {}), is_read: interaction?.is_read || 0, is_favorite: interaction?.is_favorite || 0 };
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
  // 顶栏统计胶囊与列表页同口径：research_direction='other' 的文献默认移出正式
  // 库（列表/推送/统计均排除），这里若仍计入，顶栏总数就会比列表页凭空多出一截。
  // 例外：favoriteCount 不排 other——收藏夹列表（listUserFavorites 等）对用户主动
  // 收藏的文章不做方向过滤，计数必须与列表同口径，否则数字自相矛盾。
  const articleCount = db.prepare(`SELECT COUNT(*) AS count FROM articles WHERE is_non_research_title(title) = 0 AND ${EXCLUDE_OTHER_PLAIN}`).get().count;
  // These two counters describe the shared literature database rather than a
  // personal account. Keep them available in guest mode as well, so the
  // top-right summary does not silently turn into zero before login.
  //
  // "Recent" 走全站统一的「文献主时间」first_public_at（首次公开日期，见文件
  // 头部口径说明）：读者关心的是论文什么时候第一次公开，不是爬虫什么时候看到它。
  //
  // ⚠️ 窗口按「北京时间自然日」计：近 N 日 = 今天 + 向前 N-1 个自然日，恰好
  // N 天（方案 §16）。旧写法 date('now', '-N days') 有两个毛病：一是按 UTC 取
  // 「今天」，北京时间 0—8 点的数据整段归到前一天；二是 -N days 实际包含
  // N+1 个自然日，胶囊数字比标签名义上的「一周」多算一天。窗口两端由
  // businessWindow() 统一给出，与列表页时间范围筛选共用同一对日期。
  const countPublishedWithin = (days) => {
    const window = businessWindow(days);
    return db.prepare(`
      SELECT COUNT(*) AS count
      FROM articles
      WHERE is_non_research_title(title) = 0
        AND ${EXCLUDE_OTHER_PLAIN}
        AND ${displayDateSql("articles")} >= @startDate
        AND ${displayDateSql("articles")} <= @endDate
    `).get(window).count;
  };
  const newArticleCount7d = countPublishedWithin(7);
  const newArticleCount30d = countPublishedWithin(30);
  // 统计口径自描述（方案 §18）：调用方不用猜数字是按出版日还是入库日算的。
  const dateBasis = "first_public_at";
  const timezone = "Asia/Shanghai";
  if (!userId) {
    return { articleCount, unreadCount: 0, favoriteCount: 0, readCount: 0, newArticleCount7d, newArticleCount30d, dateBasis, timezone };
  }
  const unreadCount = db.prepare(`
    SELECT COUNT(*) AS count FROM articles a
    WHERE is_non_research_title(a.title) = 0
      AND ${EXCLUDE_OTHER_CLAUSE}
      AND NOT EXISTS (
      SELECT 1 FROM user_interactions ui
      WHERE ui.user_id = ? AND ui.article_id = a.id AND ui.is_read = 1
    )
  `).get(userId).count;
  const favoriteCount = db.prepare("SELECT COUNT(*) AS count FROM user_favorites uf JOIN articles a ON a.id = uf.article_id WHERE uf.user_id = ? AND is_non_research_title(a.title) = 0").get(userId).count;
  const readCount = db.prepare("SELECT COUNT(*) AS count FROM user_interactions WHERE user_id = ? AND is_read = 1").get(userId).count;
  return { articleCount, unreadCount, favoriteCount, readCount, newArticleCount7d, newArticleCount30d, dateBasis, timezone };
}

function normalizeFavoriteGroupName(name) {
  const value = String(name || "").trim();
  if (!value) throw new Error("收藏分组名称不能为空");
  if (value.length > 40) throw new Error("收藏分组名称不能超过 40 个字符");
  return value;
}

function normalizeFavoriteNote(note) {
  const value = String(note || "").trim();
  if (value.length > 2000) throw new Error("收藏备注不能超过 2000 个字符");
  return value;
}

function normalizeFavoriteGroupId(groupId) {
  if (groupId === undefined || groupId === null || groupId === "" || groupId === "ungrouped") return null;
  const value = Number(groupId);
  if (!Number.isInteger(value) || value <= 0) throw new Error("收藏分组无效");
  return value;
}

/**
 * 「默认收藏夹」只是「下次收藏时预选哪个分组」这一个设置项，不再是一个自动
 * 建出来的分组。
 *
 * 早期实现会在每次读取收藏时 INSERT OR IGNORE 一条名为「默认收藏夹」的分组，
 * 于是每个用户都凭空多出一个自己没建过、永远是 0 篇、而且删不掉（删掉后下一次
 * 读取又被建回来）的分组 —— 这就是「收藏分组逻辑错误」的根因。现在分组只由用户
 * 显式创建（新建分组），默认分组一律从设置里解析，解析不到就回落到「未分组」。
 */
function resolveDefaultFavoriteGroup(userId) {
  const principal = String(userId || "").trim();
  if (!principal) return null;
  const savedDefault = db.prepare(
    "SELECT value FROM user_settings WHERE user_id = ? AND key = 'defaultFavoriteGroupId'"
  ).get(principal)?.value;
  if (!savedDefault || savedDefault === "ungrouped") return null;
  let savedId = null;
  try {
    savedId = normalizeFavoriteGroupId(savedDefault);
  } catch {
    return null;
  }
  if (savedId === null) return null;
  return db.prepare(
    "SELECT id, name, created_at, updated_at FROM favorite_groups WHERE id = ? AND user_id = ?"
  ).get(savedId, principal) || null;
}

function favoriteArticleSelect() {
  return `
    SELECT a.id, a.external_id, a.title, a.authors, a.journal, a.year, a.volume, a.issue,
      a.doi, a.abstract, a.url, a.published_at, a.fetched_at, a.first_seen_at, a.keywords,
      ${displayDateSql("a")} AS display_date,
      COALESCE(ui.is_read, 0) AS is_read,
      1 AS is_favorite,
      uf.group_id,
      COALESCE(fg.name, '') AS group_name,
      COALESCE(uf.note, '') AS note,
      zh.title AS translated_title,
      zh.abstract AS translated_abstract
    FROM user_favorites uf
    JOIN articles a ON a.id = uf.article_id
    LEFT JOIN user_interactions ui ON ui.user_id = uf.user_id AND ui.article_id = uf.article_id
    LEFT JOIN favorite_groups fg ON fg.id = uf.group_id AND fg.user_id = uf.user_id
    LEFT JOIN translations zh ON zh.article_id = a.id AND zh.target_language = 'zh'
  `;
}

export function listFavoriteGroups(userId) {
  const groups = db.prepare(`
    SELECT g.id, g.name, g.created_at, g.updated_at,
      COUNT(CASE WHEN is_non_research_title(a.title) = 0 THEN uf.article_id END) AS count
    FROM favorite_groups g
    LEFT JOIN user_favorites uf ON uf.group_id = g.id AND uf.user_id = g.user_id
    LEFT JOIN articles a ON a.id = uf.article_id
    WHERE g.user_id = ?
    GROUP BY g.id
    ORDER BY g.created_at ASC, g.id ASC
  `).all(userId);
  const ungrouped = db.prepare(`
    SELECT COUNT(*) AS count FROM user_favorites uf
    JOIN articles a ON a.id = uf.article_id
    WHERE uf.user_id = ? AND uf.group_id IS NULL AND is_non_research_title(a.title) = 0
  `).get(userId)?.count || 0;
  return [{ id: null, name: "未分组", count: Number(ungrouped) }, ...groups.map((group) => ({
    ...group,
    count: Number(group.count || 0)
  }))];
}

export function getDefaultFavoriteGroupId(userId) {
  return resolveDefaultFavoriteGroup(userId)?.id ?? null;
}

export function setDefaultFavoriteGroupId(userId, groupId) {
  const id = normalizeFavoriteGroupId(groupId);
  if (id !== null && !db.prepare("SELECT 1 FROM favorite_groups WHERE id = ? AND user_id = ?").get(id, userId)) throw new Error("\u6536\u85cf\u5206\u7ec4\u4e0d\u5b58\u5728");
  db.prepare(`
    INSERT INTO user_settings (user_id, key, value, updated_at)
    VALUES (?, 'defaultFavoriteGroupId', ?, datetime('now'))
    ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
  `).run(userId, id === null ? "ungrouped" : String(id));
  return id;
}

export function listUserFavorites(userId, groupFilter = "all") {
  const params = [userId];
  let where = "WHERE uf.user_id = ? AND is_non_research_title(a.title) = 0";
  if (groupFilter === "ungrouped" || groupFilter === null) {
    where += " AND uf.group_id IS NULL";
  } else if (groupFilter !== undefined && groupFilter !== "" && groupFilter !== "all") {
    const groupId = normalizeFavoriteGroupId(groupFilter);
    const group = db.prepare("SELECT id FROM favorite_groups WHERE id = ? AND user_id = ?").get(groupId, userId);
    if (!group) return [];
    where += " AND uf.group_id = ?";
    params.push(groupId);
  }
  return db.prepare(`${favoriteArticleSelect()} ${where}
    ORDER BY COALESCE(uf.updated_at, uf.created_at) DESC, a.id DESC
  `).all(...params);
}

export function getUserFavorites(userId, groupFilter = "all") {
  // 顶部「N 篇收藏」与侧边栏「全部收藏」都必须是不随筛选变化的真实总数，
  // 否则每切一个分组，同一个数字就会跟着列表长度跳来跳去。
  const total = Number(db.prepare(`
    SELECT COUNT(*) AS count
    FROM user_favorites uf
    JOIN articles a ON a.id = uf.article_id
    WHERE uf.user_id = ? AND is_non_research_title(a.title) = 0
  `).get(userId)?.count || 0);
  return {
    groups: listFavoriteGroups(userId),
    favorites: listUserFavorites(userId, groupFilter),
    defaultGroupId: getDefaultFavoriteGroupId(userId),
    total
  };
}

export function createFavoriteGroup(userId, name) {
  const normalizedName = normalizeFavoriteGroupName(name);
  const count = db.prepare("SELECT COUNT(*) AS count FROM favorite_groups WHERE user_id = ?").get(userId)?.count || 0;
  if (Number(count) >= 50) throw new Error("收藏分组最多创建 50 个");
  try {
    const result = db.prepare(`
      INSERT INTO favorite_groups (user_id, name, created_at, updated_at)
      VALUES (?, ?, datetime('now'), datetime('now'))
    `).run(userId, normalizedName);
    return db.prepare("SELECT id, name, created_at, updated_at, 0 AS count FROM favorite_groups WHERE id = ?").get(result.lastInsertRowid);
  } catch (error) {
    if (String(error.message || "").toLowerCase().includes("unique")) throw new Error("该收藏分组已经存在");
    throw error;
  }
}

export function renameFavoriteGroup(userId, groupId, name) {
  const normalizedName = normalizeFavoriteGroupName(name);
  const id = normalizeFavoriteGroupId(groupId);
  if (id === null) throw new Error("未分组不能重命名");
  try {
    const result = db.prepare(`
      UPDATE favorite_groups
      SET name = ?, updated_at = datetime('now')
      WHERE id = ? AND user_id = ?
    `).run(normalizedName, id, userId);
    if (!result.changes) return null;
    return db.prepare("SELECT id, name, created_at, updated_at, 0 AS count FROM favorite_groups WHERE id = ? AND user_id = ?").get(id, userId);
  } catch (error) {
    if (String(error.message || "").toLowerCase().includes("unique")) throw new Error("该收藏分组已经存在");
    throw error;
  }
}

export function deleteFavoriteGroup(userId, groupId) {
  const id = normalizeFavoriteGroupId(groupId);
  if (id === null) throw new Error("未分组不能删除");
  db.exec("BEGIN IMMEDIATE");
  try {
    const group = db.prepare("SELECT id FROM favorite_groups WHERE id = ? AND user_id = ?").get(id, userId);
    if (!group) {
      db.exec("ROLLBACK");
      return false;
    }
    db.prepare("UPDATE user_favorites SET group_id = NULL, updated_at = datetime('now') WHERE user_id = ? AND group_id = ?").run(userId, id);
    db.prepare("UPDATE user_settings SET value = 'ungrouped', updated_at = datetime('now') WHERE user_id = ? AND key = 'defaultFavoriteGroupId' AND value = ?").run(userId, String(id));
    db.prepare("DELETE FROM favorite_groups WHERE id = ? AND user_id = ?").run(id, userId);
    db.exec("COMMIT");
    return true;
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch {}
    throw error;
  }
}

export function updateUserFavorite(userId, articleId, changes = {}) {
  const current = db.prepare("SELECT group_id, note FROM user_favorites WHERE user_id = ? AND article_id = ?").get(userId, Number(articleId));
  if (!current) return null;
  const groupId = changes.groupId === undefined ? current.group_id : normalizeFavoriteGroupId(changes.groupId);
  if (groupId !== null) {
    const group = db.prepare("SELECT id FROM favorite_groups WHERE id = ? AND user_id = ?").get(groupId, userId);
    if (!group) throw new Error("收藏分组不存在");
  }
  const note = changes.note === undefined ? current.note : normalizeFavoriteNote(changes.note);
  db.prepare(`
    UPDATE user_favorites
    SET group_id = ?, note = ?, updated_at = datetime('now')
    WHERE user_id = ? AND article_id = ?
  `).run(groupId, note, userId, Number(articleId));
  return db.prepare(`${favoriteArticleSelect()} WHERE uf.user_id = ? AND uf.article_id = ?`).get(userId, Number(articleId));
}

export function createRefreshRun({ taskType = "refresh", message = "" } = {}) {
  const startedAt = new Date().toISOString();
  const result = db.prepare(`
    INSERT INTO refresh_runs (started_at, status, message, task_type)
    VALUES (?, 'running', ?, ?)
  `).run(startedAt, String(message || ""), String(taskType || "refresh"));
  return result.lastInsertRowid;
}

export function finishRefreshRun(id, {
  addedCount = 0,
  status,
  message,
  abstractCount = 0,
  keywordCount = 0,
  translatedCount = 0,
  failedArticleCount = 0,
  failedAbstractCount = 0,
  failedKeywordCount = 0,
  failedTranslationCount = 0,
  translatedTitleCount = 0,
  translatedAbstractCount = 0,
  translationUnitCount = 0,
  translationRequestCount = 0,
  remainingAbstractCount = 0,
  remainingKeywordCount = 0,
  remainingTranslationCount = 0
}) {
  db.prepare(`
    UPDATE refresh_runs
    SET finished_at = ?, added_count = ?, status = ?, message = ?,
        enriched_abstract_count = ?, enriched_keyword_count = ?, translated_count = ?,
        failed_article_count = ?, failed_abstract_count = ?, failed_keyword_count = ?, failed_translation_count = ?,
        translated_title_count = ?, translated_abstract_count = ?, translation_unit_count = ?, translation_request_count = ?,
        remaining_abstract_count = ?, remaining_keyword_count = ?, remaining_translation_count = ?
    WHERE id = ?
  `).run(
    new Date().toISOString(),
    Number(addedCount || 0),
    status,
    message || "",
    Number(abstractCount || 0),
    Number(keywordCount || 0),
    Number(translatedCount || 0),
    Number(failedArticleCount || 0),
    Number(failedAbstractCount || 0),
    Number(failedKeywordCount || 0),
    Number(failedTranslationCount || 0),
    Number(translatedTitleCount || 0),
    Number(translatedAbstractCount || 0),
    Number(translationUnitCount || 0),
    Number(translationRequestCount || 0),
    Number(remainingAbstractCount || 0),
    Number(remainingKeywordCount || 0),
    Number(remainingTranslationCount || 0),
    id
  );
}

export function updateRefreshRunSummary(id, {
  message,
  abstractCount = 0,
  keywordCount = 0,
  translatedCount = 0,
  failedArticleCount = 0,
  failedAbstractCount = 0,
  failedKeywordCount = 0,
  failedTranslationCount = 0,
  translatedTitleCount = 0,
  translatedAbstractCount = 0,
  translationUnitCount = 0,
  translationRequestCount = 0,
  remainingAbstractCount = 0,
  remainingKeywordCount = 0,
  remainingTranslationCount = 0
}) {
  db.prepare(`
    UPDATE refresh_runs
    SET enriched_abstract_count = ?, enriched_keyword_count = ?, translated_count = ?,
        failed_article_count = ?, failed_abstract_count = ?, failed_keyword_count = ?, failed_translation_count = ?,
        translated_title_count = ?, translated_abstract_count = ?, translation_unit_count = ?, translation_request_count = ?,
        remaining_abstract_count = ?, remaining_keyword_count = ?, remaining_translation_count = ?,
        message = ?
    WHERE id = ?
  `).run(
    Number(abstractCount || 0),
    Number(keywordCount || 0),
    Number(translatedCount || 0),
    Number(failedArticleCount || 0),
    Number(failedAbstractCount || 0),
    Number(failedKeywordCount || 0),
    Number(failedTranslationCount || 0),
    Number(translatedTitleCount || 0),
    Number(translatedAbstractCount || 0),
    Number(translationUnitCount || 0),
    Number(translationRequestCount || 0),
    Number(remainingAbstractCount || 0),
    Number(remainingKeywordCount || 0),
    Number(remainingTranslationCount || 0),
    message || "",
    id
  );
}

export function getStatus() {
  const latestRun = db.prepare(`
    SELECT *
    FROM refresh_runs
    ORDER BY id DESC
    LIMIT 1
  `).get();
  const unreadCount = db.prepare("SELECT COUNT(*) AS count FROM articles WHERE is_read = 0").get().count;
  const articleCount = db.prepare("SELECT COUNT(*) AS count FROM articles WHERE is_non_research_title(title) = 0").get().count;
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

export function listArticlesWithoutKeywords(limit = 50, excludeIds = []) {
  return db.prepare(`
    SELECT * FROM articles
    WHERE length(trim(coalesce(keywords, ''))) = 0
    AND is_non_research_title(title) = 0
    AND ${EXCLUDE_OTHER_PLAIN}
    AND id NOT IN (SELECT value FROM json_each(?))
    ORDER BY ${displayDateSql("articles")} DESC
    LIMIT ?
  `).all(JSON.stringify(excludeIds), limit);
}

export function countArticlesWithoutKeywords() {
  return Number(db.prepare(`
    SELECT COUNT(*) AS count
    FROM articles
    WHERE length(trim(coalesce(keywords, ''))) = 0
      AND is_non_research_title(title) = 0
      AND ${EXCLUDE_OTHER_PLAIN}
  `).get()?.count || 0);
}

export function listArticlesMissingMetadata(limit = 50) {
  return db.prepare(`
    SELECT * FROM articles
    WHERE is_non_research_title(title) = 0
      AND (length(trim(coalesce(abstract, ''))) = 0 OR length(trim(coalesce(keywords, ''))) = 0)
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
    WHERE is_non_research_title(a.title) = 0
      AND ${EXCLUDE_OTHER_CLAUSE}
      AND (length(trim(coalesce(t.title, ''))) = 0
      OR (length(trim(coalesce(a.abstract, ''))) > 0 AND length(trim(coalesce(t.abstract, ''))) = 0))
    ORDER BY COALESCE(a.first_seen_at, a.fetched_at) DESC, a.id DESC
    LIMIT ?
  `).all(targetLanguage, limit);
}

export function listArticlesMissingAbstract(limit = 50, excludeIds = []) {
  return db.prepare(`
    SELECT * FROM articles
    WHERE length(trim(coalesce(abstract, ''))) = 0
    AND is_non_research_title(title) = 0
    AND ${EXCLUDE_OTHER_PLAIN}
    AND id NOT IN (SELECT value FROM json_each(?))
    ORDER BY COALESCE(first_seen_at, fetched_at) DESC, id DESC
    LIMIT ?
  `).all(JSON.stringify(excludeIds), limit);
}

export function countArticlesMissingAbstract() {
  return Number(db.prepare(`
    SELECT COUNT(*) AS count
    FROM articles
    WHERE length(trim(coalesce(abstract, ''))) = 0
      AND is_non_research_title(title) = 0
      AND ${EXCLUDE_OTHER_PLAIN}
  `).get()?.count || 0);
}

export function countArticlesMissingTranslation(field = "title", targetLanguage = "zh") {
  const sourceColumn = field === "abstract" ? "abstract" : "title";
  const translatedColumn = field === "abstract" ? "abstract" : "title";
  return Number(db.prepare(`
    SELECT COUNT(*) AS count
    FROM articles a
    LEFT JOIN translations t
      ON t.article_id = a.id AND t.target_language = ?
    WHERE is_non_research_title(a.title) = 0
      AND ${EXCLUDE_OTHER_CLAUSE}
      AND length(trim(coalesce(a.${sourceColumn}, ''))) > 0
      AND contains_chinese_text(a.${sourceColumn}) = 0
      AND length(trim(coalesce(t.${translatedColumn}, ''))) = 0
  `).get(targetLanguage)?.count || 0);
}

export function getMetadataGaps() {
  return {
    abstracts: countArticlesMissingAbstract(),
    keywords: countArticlesWithoutKeywords()
  };
}

// Return articles whose requested translated field is still missing. Keep the
// field names allow-listed because they are interpolated into the SQL query.
export function listArticlesMissingTranslation(field = "title", targetLanguage = "zh", limit = 20) {
  const sourceColumn = field === "abstract" ? "abstract" : "title";
  const translatedColumn = field === "abstract" ? "abstract" : "title";
  const attemptColumn = field === "abstract" ? "abstract_attempt_at" : "title_attempt_at";
  return db.prepare(`
    SELECT a.*
    FROM articles a
    LEFT JOIN translations t
      ON t.article_id = a.id AND t.target_language = ?
    WHERE is_non_research_title(a.title) = 0
      AND ${EXCLUDE_OTHER_CLAUSE}
      AND length(trim(coalesce(a.${sourceColumn}, ''))) > 0
      AND contains_chinese_text(a.${sourceColumn}) = 0
      AND length(trim(coalesce(t.${translatedColumn}, ''))) = 0
    -- Never-attempted first, then least-recently-attempted. A record whose
    -- translation keeps failing therefore rotates to the back instead of
    -- occupying the same slot on every run.
    ORDER BY
      CASE WHEN t.${attemptColumn} IS NULL THEN 0 ELSE 1 END,
      t.${attemptColumn} ASC,
      COALESCE(a.first_seen_at, a.fetched_at) DESC,
      a.id DESC
    LIMIT ?
  `).all(targetLanguage, Math.min(Math.max(Number(limit) || 20, 1), 500));
}

/**
 * Remember that a translation was attempted for these articles, whether it
 * succeeded or failed. Rows are created on demand: an attempt-only row carries
 * no text, which every coverage query already treats as "not translated".
 */
export function markTranslationAttempts(articleIds, field = "title", targetLanguage = "zh") {
  const column = field === "abstract" ? "abstract_attempt_at" : "title_attempt_at";
  const ids = [...new Set((Array.isArray(articleIds) ? articleIds : [])
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0))];
  if (!ids.length) return 0;
  const stamp = new Date().toISOString();
  const statement = db.prepare(`
    INSERT INTO translations (article_id, target_language, translated_at, ${column})
    VALUES (?, ?, ?, ?)
    ON CONFLICT(article_id, target_language) DO UPDATE SET ${column} = excluded.${column}
  `);
  let updated = 0;
  db.exec("BEGIN");
  try {
    for (const id of ids) {
      const result = statement.run(id, targetLanguage, stamp, stamp);
      if (result.changes) updated += 1;
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return updated;
}

export function getKeywordStats(filters = {}) {
  const clauses = ["keywords IS NOT NULL", "keywords != ''", "is_non_research_title(title) = 0", EXCLUDE_OTHER_PLAIN];
  const params = {};

  if (filters.journal) {
    clauses.push("journal = @journal");
    params.journal = filters.journal;
  }
  if (filters.from) {
    clauses.push(`${displayDateSql("articles")} >= @from`);
    params.from = filters.from;
  }
  if (filters.to) {
    clauses.push(`${displayDateSql("articles")} <= @to`);
    params.to = filters.to;
  }

  const where = `WHERE ${clauses.join(" AND ")}`;
  const articles = db.prepare(`
    SELECT id, title, journal, published_at, ${displayDateSql("articles")} AS display_date, keywords, url, doi
    FROM articles
    ${where}
    ORDER BY ${displayDateSql("articles")} DESC
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
        // 统计页/导出与列表页保持一致：都用统一口径算出来的日期。
        display_date: article.display_date,
        url: article.url,
        doi: article.doi
      });
    }
  }

  const stats = [...keywordMap.values()].sort((a, b) => b.count - a.count);
  return { totalArticles: articles.length, keywords: stats };
}

export function getKeywordCooccurrence(filters = {}) {
  const clauses = ["keywords IS NOT NULL", "keywords != ''", EXCLUDE_OTHER_PLAIN];
  const params = {};

  if (filters.journal) {
    clauses.push("journal = @journal");
    params.journal = filters.journal;
  }
  if (filters.from) {
    clauses.push(`${displayDateSql("articles")} >= @from`);
    params.from = filters.from;
  }
  if (filters.to) {
    clauses.push(`${displayDateSql("articles")} <= @to`);
    params.to = filters.to;
  }

  const where = `WHERE ${clauses.join(" AND ")}`;
  const articles = db.prepare(`
    SELECT id, title, journal, published_at, ${displayDateSql("articles")} AS display_date, keywords, url, doi
    FROM articles
    ${where}
    ORDER BY ${displayDateSql("articles")} DESC
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
  return db.prepare("SELECT id, username, role, registered_ip, preferences_updated_at, created_at, updated_at FROM user_accounts WHERE id = ?").get(Number(id)) || null;
}

export function getUserAccountCount() {
  return Number(db.prepare("SELECT COUNT(*) AS count FROM user_accounts").get()?.count || 0);
}

export function isUserAccountAdmin(id) {
  return getUserAccountById(id)?.role === "super_admin";
}

export function hasUserAccountForIp(ip) {
  // Kept for compatibility with older callers. Registration is no longer
  // restricted by IP, so this must never be used as an admission check.
  return false;
}

export function createUserSession({ sessionId, accountId, loginIp, role, expiresAt, now = Date.now() }) {
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("DELETE FROM user_sessions WHERE expires_at <= ? OR (revoked_at IS NOT NULL AND revoked_at <= ?)").run(now, now - 7 * 24 * 60 * 60 * 1000);
    const activeSessions = db.prepare(`
      SELECT session_id, login_ip, created_at
      FROM user_sessions
      WHERE account_id = ? AND revoked_at IS NULL AND expires_at > ?
      ORDER BY created_at ASC
    `).all(Number(accountId), now);

    // A personal account may have multiple browser sessions, but only one
    // active IP at a time. A login from another IP takes over the account and
    // revokes its previous sessions, so the old browser cannot keep writing.
    if (activeSessions.some((session) => session.login_ip !== loginIp)) {
      db.prepare("UPDATE user_sessions SET revoked_at = ? WHERE account_id = ? AND revoked_at IS NULL").run(now, Number(accountId));
    }

    // The site-wide cap is measured in distinct active IPs, not sessions.
    const activeIpCount = Number(db.prepare(`
      SELECT COUNT(DISTINCT login_ip) AS count
      FROM user_sessions
      WHERE revoked_at IS NULL AND expires_at > ?
    `).get(now)?.count || 0);
    const alreadyActiveFromIp = Boolean(db.prepare(`
      SELECT 1 FROM user_sessions
      WHERE login_ip = ? AND revoked_at IS NULL AND expires_at > ?
      LIMIT 1
    `).get(loginIp, now));
    if (!alreadyActiveFromIp && activeIpCount >= config.maxActiveIps) {
      db.exec("ROLLBACK");
      return { ok: false, reason: "active_ip_limit" };
    }

    db.prepare(`
      INSERT INTO user_sessions (session_id, account_id, login_ip, expires_at, created_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(sessionId, Number(accountId), loginIp, Number(expiresAt), now, now);
    db.exec("COMMIT");
    return { ok: true };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function getActiveUserSession(sessionId, accountId, now = Date.now()) {
  return db.prepare(`
    SELECT session_id, account_id, login_ip, expires_at, created_at, last_seen_at
    FROM user_sessions
    WHERE session_id = ? AND account_id = ? AND revoked_at IS NULL AND expires_at > ?
  `).get(String(sessionId || ""), Number(accountId), now) || null;
}

export function touchUserSession(sessionId, now = Date.now()) {
  db.prepare("UPDATE user_sessions SET last_seen_at = ? WHERE session_id = ? AND revoked_at IS NULL").run(now, String(sessionId || ""));
}

export function revokeUserSession(sessionId, now = Date.now()) {
  return db.prepare("UPDATE user_sessions SET revoked_at = ? WHERE session_id = ? AND revoked_at IS NULL").run(now, String(sessionId || "")).changes > 0;
}

export function createUserAccount({ username, passwordHash, passwordSalt, registeredIp }) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const accountCount = Number(db.prepare("SELECT COUNT(*) AS count FROM user_accounts").get()?.count || 0);
    if (accountCount >= config.maxPersonalAccounts) {
      throw new Error("个人账户数量已达到上限");
    }
    if (getUserAccountByUsername(username)) {
      throw new Error("该用户名已被使用");
    }
    // registered_ip is a legacy column retained for old databases. Store a
    // unique marker instead of a real IP so the account is never IP-bound.
    const registrationMarker = `unbound:${crypto.randomUUID()}`;
    const result = db.prepare(`
      INSERT INTO user_accounts (username, password_hash, password_salt, registered_ip, role)
      VALUES (?, ?, ?, ?, ?)
    `).run(username, passwordHash, passwordSalt, registrationMarker, "user");
    const accountId = Number(result.lastInsertRowid);
    // 新账户不再预建「默认收藏夹」：分组只由用户自己新建，新收藏默认落到「未分组」。
    db.exec("COMMIT");
    return getUserAccountById(accountId);
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function deleteUserAccount(accountId) {
  const id = Number(accountId);
  if (!Number.isInteger(id) || id <= 0) return false;
  const userId = `account:${id}`;
  db.exec("BEGIN IMMEDIATE");
  try {
    const account = db.prepare("SELECT id FROM user_accounts WHERE id = ?").get(id);
    if (!account) {
      db.exec("ROLLBACK");
      return false;
    }

    // Personal-account tables use a text principal instead of a foreign key
    // because they also support guest/legacy principals. Clean those rows up
    // explicitly so deleting an account never leaves orphaned private data or
    // a discussion identity behind.
    db.prepare("DELETE FROM feedback_likes WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM feedback_comment_likes WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM feedback_comments WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM feedback WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM user_favorites WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM favorite_groups WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM user_interactions WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM user_journals WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM user_settings WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM user_emails WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM discussion_profiles WHERE user_id = ?").run(userId);
    const deleted = db.prepare("DELETE FROM user_accounts WHERE id = ?").run(id).changes > 0;
    db.exec("COMMIT");
    return deleted;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function getAdminOverview() {
  const scalar = (sql) => Number(db.prepare(sql).get()?.count || 0);
  // 管理端「内容完整性」与列表页同口径：AI 分类为 other 的文献已移出正式库，
  // 覆盖率若仍把它计入分母，管理员看到的缺口明细点开后会对不上（other 的缺口
  // 既不该补、也不该出现在待补全清单里）。补全/翻译 gap 查询（上方 7 个）同样
  // 排除，三方（覆盖率 / 待补全明细 / 补全作业）保持一致，翻译额度不再花在
  // other 文献上。
  const articleCount = scalar(`SELECT COUNT(*) AS count FROM articles WHERE is_non_research_title(title) = 0 AND ${EXCLUDE_OTHER_PLAIN}`);
  const abstractCount = scalar(`SELECT COUNT(*) AS count FROM articles WHERE is_non_research_title(title) = 0 AND ${EXCLUDE_OTHER_PLAIN} AND length(trim(coalesce(abstract, ''))) > 0`);
  const keywordCount = scalar(`SELECT COUNT(*) AS count FROM articles WHERE is_non_research_title(title) = 0 AND ${EXCLUDE_OTHER_PLAIN} AND length(trim(coalesce(keywords, ''))) > 0`);
  // `translations` also stores attempt timestamps for records that have no text
  // yet, so a bare row count would overstate coverage.
  const translationCount = scalar(`
    SELECT COUNT(*) AS count FROM translations
    WHERE length(trim(coalesce(title, ''))) > 0
       OR length(trim(coalesce(abstract, ''))) > 0
       OR length(trim(coalesce(keywords, ''))) > 0
  `);
  const translatableTitleCount = scalar(`SELECT COUNT(*) AS count FROM articles WHERE is_non_research_title(title) = 0 AND ${EXCLUDE_OTHER_PLAIN} AND length(trim(coalesce(title, ''))) > 0 AND contains_chinese_text(title) = 0`);
  const translatableAbstractCount = scalar(`SELECT COUNT(*) AS count FROM articles WHERE is_non_research_title(title) = 0 AND ${EXCLUDE_OTHER_PLAIN} AND length(trim(coalesce(abstract, ''))) > 0 AND contains_chinese_text(abstract) = 0`);
  // 分子与分母必须同口径（非中文标题才算可译）：否则中文刊在 translations 里
  // 留下的行会混进分子，出现「中文标题 100.2%」这种超过 100% 的怪数字。
  // is_non_research_title 同理：垃圾标题的历史翻译行只该留在分母外的两边之外，
  // 漏掉它会让分子超过分母（2026-10-01 实测「中文标题 100.1%」）。
  const translatedTitleCount = scalar(`
    SELECT COUNT(*) AS count FROM articles a
    JOIN translations t ON t.article_id = a.id AND t.target_language = 'zh'
    WHERE is_non_research_title(a.title) = 0
      AND length(trim(coalesce(a.title, ''))) > 0
      AND contains_chinese_text(a.title) = 0
      AND ${EXCLUDE_OTHER_CLAUSE}
      AND length(trim(coalesce(t.title, ''))) > 0
  `);
  const translatedAbstractCount = scalar(`
    SELECT COUNT(*) AS count FROM articles a
    JOIN translations t ON t.article_id = a.id AND t.target_language = 'zh'
    WHERE is_non_research_title(a.title) = 0
      AND length(trim(coalesce(a.abstract, ''))) > 0
      AND contains_chinese_text(a.abstract) = 0
      AND ${EXCLUDE_OTHER_CLAUSE}
      AND length(trim(coalesce(t.abstract, ''))) > 0
  `);
  const pending = {
    abstracts: articleCount - abstractCount,
    keywords: articleCount - keywordCount,
    translatedTitles: countArticlesMissingTranslation("title", "zh"),
    translatedAbstracts: countArticlesMissingTranslation("abstract", "zh")
  };

  // AI 方向分类覆盖（2026-10-01 加入内容完整度）：与管理面板其他行同口径
  // （非垃圾标题 + 排除 other）。other 本身是 AI 的判定结果，但已移出用户
  // 可见面，不计入分母；manual 改判与 AI 标注都算「已分类」。
  const classifiedDirectionCount = scalar(`SELECT COUNT(*) AS count FROM articles WHERE is_non_research_title(title) = 0 AND ${EXCLUDE_OTHER_PLAIN} AND research_direction IS NOT NULL AND length(trim(coalesce(research_direction, ''))) > 0`);
  pending.directions = articleCount - classifiedDirectionCount;

  // Keep the dashboard summary cheap to render while still giving the
  // administrator an actionable list for every incomplete metric.  The
  // conditions are allow-listed here because they are interpolated into SQL.
  const coverageConditions = {
    abstracts: "length(trim(coalesce(a.abstract, ''))) = 0",
    keywords: "length(trim(coalesce(a.keywords, ''))) = 0",
    directions: "(a.research_direction IS NULL OR length(trim(coalesce(a.research_direction, ''))) = 0)",
    translatedTitles: "length(trim(coalesce(a.title, ''))) > 0 AND contains_chinese_text(a.title) = 0 AND length(trim(coalesce(zh.title, ''))) = 0",
    translatedAbstracts: "length(trim(coalesce(a.abstract, ''))) > 0 AND contains_chinese_text(a.abstract) = 0 AND length(trim(coalesce(zh.abstract, ''))) = 0"
  };
  const coverageArticleSelect = `
    SELECT a.id, a.title, a.authors, a.journal, a.year, a.volume, a.issue,
      a.doi, a.abstract, a.url, a.published_at, a.fetched_at, a.keywords,
      ${displayDateSql("a")} AS display_date,
      zh.title AS translated_title,
      zh.abstract AS translated_abstract
    FROM articles a
    LEFT JOIN translations zh ON zh.article_id = a.id AND zh.target_language = 'zh'
  `;
  const buildCoverageDetails = (condition) => {
    const articles = db.prepare(`${coverageArticleSelect}
      WHERE is_non_research_title(a.title) = 0 AND ${EXCLUDE_OTHER_CLAUSE} AND (${condition})
      ORDER BY COALESCE(NULLIF(a.journal, ''), '未标记期刊') ASC,
        ${displayDateSql("a")} DESC, a.id DESC
    `).all();
    const journals = new Map();
    for (const article of articles) {
      const journal = String(article.journal || "").trim() || "未标记期刊";
      if (!journals.has(journal)) journals.set(journal, { journal, count: 0, articles: [] });
      const group = journals.get(journal);
      group.count += 1;
      group.articles.push(article);
    }
    return {
      missingCount: articles.length,
      journals: [...journals.values()].sort((left, right) => (
        right.count - left.count || left.journal.localeCompare(right.journal, "zh-CN")
      ))
    };
  };
  const coverageDetails = Object.fromEntries(
    Object.entries(coverageConditions).map(([key, condition]) => [key, buildCoverageDetails(condition)])
  );

  // 时间数据质量（方案 §10 / §22 / 验收 11）：first_public_at 的 A/B/C/D 分布。
  // D 级（system_first_seen_fallback，兜底用入库时间）的比例是时间数据质量的
  // 监控指标，必须可单独统计；unresolved = 尚未回填主时间的行（理论上只出现在
  // 回填作业还没跑过的过渡期）。
  const dateQualityRows = db.prepare(`
    SELECT COALESCE(NULLIF(first_public_confidence, ''), 'unresolved') AS confidence,
           COUNT(*) AS count
    FROM articles
    WHERE is_non_research_title(title) = 0
    GROUP BY confidence
  `).all();
  const dateQuality = {
    grades: Object.fromEntries(dateQualityRows.map((row) => [row.confidence, Number(row.count)])),
    systemFirstSeenFallback: Number(dateQualityRows.find((row) => row.confidence === "D")?.count || 0),
    unresolved: Number(dateQualityRows.find((row) => row.confidence === "unresolved")?.count || 0)
  };

  // 「文献分布」只列期刊目录里的刊。采集侧偶发的 ISSN 串号 / 实体污染会让目录外的
  // 期刊混进库（例如按 1751-4223 查 "Energy" 拉回的 ICE Energy 文章），直接照着
  // articles 表 GROUP BY 输出，看起来就像期刊目录里多了一本根本不存在的刊。
  //
  // 目录真值 = DEFAULT_JOURNALS ∪ settings.journals，和采集侧的 refresh.js
  // (#journalsToCollect) 保持同一个集合。⚠️ 不能只用 settings.journals：那是站点的
  // 「附加期刊」设置，生产库里只有 3 本，照它过滤会把 13 本真期刊（Energy、
  // Applied Energy、中国电机工程学报…）整批从表里删掉，页面上看就是「文献并不全」。
  const catalogJournalNames = new Set(
    [...DEFAULT_JOURNALS, ...(getSettings().journals || [])].map((journal) => journal.name)
  );
  const journalDistribution = db.prepare(`
    SELECT journal, COUNT(*) AS count,
      SUM(CASE WHEN length(trim(coalesce(abstract, ''))) > 0 THEN 1 ELSE 0 END) AS abstract_count
    FROM articles GROUP BY journal ORDER BY count DESC, journal ASC
  `).all().filter((row) => {
    const name = String(row.journal || "").trim();
    // 期刊名为空的记录按「未标记期刊」保留，只滤掉目录外的刊名。
    return !name || catalogJournalNames.has(name);
  });

  return {
    counts: {
      articles: articleCount,
      abstracts: abstractCount,
      keywords: keywordCount,
      translations: translationCount,
      translatedAbstracts: translatedAbstractCount,
      users: scalar("SELECT COUNT(*) AS count FROM user_accounts"),
      discussions: scalar("SELECT COUNT(*) AS count FROM feedback"),
      comments: scalar("SELECT COUNT(*) AS count FROM feedback_comments"),
      likes: scalar("SELECT (SELECT COUNT(*) FROM feedback_likes) + (SELECT COUNT(*) FROM feedback_comment_likes) AS count")
    },
    coverage: {
      abstracts: articleCount ? Math.round(abstractCount * 1000 / articleCount) / 10 : 0,
      keywords: articleCount ? Math.round(keywordCount * 1000 / articleCount) / 10 : 0,
      directions: articleCount ? Math.round(classifiedDirectionCount * 1000 / articleCount) / 10 : 0,
      translatedTitles: translatableTitleCount ? Math.round(translatedTitleCount * 1000 / translatableTitleCount) / 10 : 100,
      translatedAbstracts: translatableAbstractCount ? Math.round(translatedAbstractCount * 1000 / translatableAbstractCount) / 10 : 100
    },
    coverageDetails,
    pending,
    dateQuality,
    users: db.prepare(`
      SELECT a.id, a.username, a.role, a.created_at, a.updated_at,
        COALESCE(u.name, '') AS name, COALESCE(u.email, '') AS email,
        u.enrollment_year, COALESCE(u.degree, '') AS degree
      FROM user_accounts a
      LEFT JOIN user_emails u ON u.user_id = 'account:' || a.id
      ORDER BY CASE a.role WHEN 'super_admin' THEN 0 ELSE 1 END, a.created_at ASC
    `).all(),
    journals: journalDistribution,
    recentRefreshes: db.prepare(`
      SELECT started_at, finished_at, added_count, task_type,
        enriched_abstract_count, enriched_keyword_count, translated_count,
        failed_article_count, failed_abstract_count, failed_keyword_count, failed_translation_count,
        translated_title_count, translated_abstract_count, translation_unit_count, translation_request_count,
        remaining_abstract_count, remaining_keyword_count, remaining_translation_count,
        status, message
      FROM refresh_runs ORDER BY id DESC LIMIT 10
    `).all()
  };
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

export function getDiscussionProfile(userId, publicTag) {
  db.prepare(`
    INSERT INTO discussion_profiles (user_id, public_tag, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET public_tag = excluded.public_tag
  `).run(userId, publicTag);
  const row = db.prepare("SELECT display_name, public_tag FROM discussion_profiles WHERE user_id = ?").get(userId);
  return {
    displayName: row?.display_name || "",
    publicTag: row?.public_tag || publicTag
  };
}

export function updateDiscussionProfile(userId, publicTag, displayName) {
  db.prepare(`
    INSERT INTO discussion_profiles (user_id, display_name, public_tag, updated_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET
      display_name = excluded.display_name,
      public_tag = excluded.public_tag,
      updated_at = datetime('now')
  `).run(userId, displayName, publicTag);
  return getDiscussionProfile(userId, publicTag);
}

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
    SELECT f.id, f.content, f.admin_reply, f.replied_at, f.created_at, f.is_closed, f.closed_at,
      COALESCE(NULLIF(p.display_name, ''), '用户-' || COALESCE(NULLIF(p.public_tag, ''), '历史')) AS author_name,
      COALESCE(NULLIF(p.public_tag, ''), '历史') AS author_tag,
      (SELECT COUNT(*) FROM feedback_likes fl WHERE fl.feedback_id = f.id) AS like_count,
      EXISTS(SELECT 1 FROM feedback_likes fl WHERE fl.feedback_id = f.id AND fl.user_id = ?) AS liked_by_me,
      (SELECT COUNT(*) FROM feedback_comments c WHERE c.feedback_id = f.id) AS comment_count
    FROM feedback f
    LEFT JOIN discussion_profiles p ON p.user_id = f.user_id
    ORDER BY f.created_at DESC, f.id DESC
    LIMIT ?
  `).all(userId, Math.min(Math.max(Number(limit) || 100, 1), 200));

  if (!discussions.length) return discussions;
  const placeholders = discussions.map(() => "?").join(",");
  const comments = db.prepare(`
    SELECT c.id, c.feedback_id, c.content, c.created_at,
      COALESCE(NULLIF(p.display_name, ''), '用户-' || COALESCE(NULLIF(p.public_tag, ''), '历史')) AS author_name,
      COALESCE(NULLIF(p.public_tag, ''), '历史') AS author_tag,
      (SELECT COUNT(*) FROM feedback_comment_likes cl WHERE cl.comment_id = c.id) AS like_count,
      EXISTS(SELECT 1 FROM feedback_comment_likes cl WHERE cl.comment_id = c.id AND cl.user_id = ?) AS liked_by_me
    FROM feedback_comments c
    LEFT JOIN discussion_profiles p ON p.user_id = c.user_id
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
  const discussion = db.prepare("SELECT id, is_closed FROM feedback WHERE id = ?").get(Number(feedbackId));
  if (!discussion) return null;
  if (discussion.is_closed) return { closed: true };
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

export function closeFeedback(id) {
  const result = db.prepare(`
    UPDATE feedback SET is_closed = 1, closed_at = datetime('now') WHERE id = ? AND is_closed = 0
  `).run(Number(id));
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
  if (!userId) return DEFAULT_JOURNALS.map((j) => j.name);
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
  const userRows = userId
    ? db.prepare("SELECT key, value FROM user_settings WHERE user_id = ?").all(userId)
    : [];
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
    pushJournalFilter: values.pushJournalFilter || "",
    pushDirectionFilter: values.pushDirectionFilter || "",
    pushIncludeAiReport: values.pushIncludeAiReport !== "false"
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
    upsert.run({ userId, key: "pushDirectionFilter", value: settings.pushDirectionFilter !== undefined ? sanitizeDirectionFilter(settings.pushDirectionFilter) : current.pushDirectionFilter });
    upsert.run({ userId, key: "pushIncludeAiReport", value: String(settings.pushIncludeAiReport !== undefined ? settings.pushIncludeAiReport : current.pushIncludeAiReport) });
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  
  return getUserSettings(userId);
}

// ── AI 研究方向：统计与管理员改判（RUNBOOK-AI-DIRECTION.md）─────────────────

/** 研究方向维度统计：覆盖率、各方向计数（全量 + 近 N 日）、可选方向×期刊组矩阵。 */
export function getDirectionStats({ windowDays = 30, withMatrix = false } = {}) {
  const base = "is_non_research_title(a.title) = 0";
  const total = db.prepare(`SELECT COUNT(*) AS n FROM articles a WHERE ${base}`).get().n;
  const classified = db.prepare(`SELECT COUNT(*) AS n FROM articles a WHERE ${base} AND a.research_direction IS NOT NULL`).get().n;
  const pendingReview = db.prepare(`SELECT COUNT(*) AS n FROM articles a WHERE ${base} AND a.direction_reason LIKE '[待复核]%'`).get().n;

  const { startDate, endDate } = businessWindow(windowDays);
  const rows = db.prepare(`
    SELECT a.research_direction AS key,
      COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN ${displayDateSql("a")} >= @winStart AND ${displayDateSql("a")} <= @winEnd THEN 1 ELSE 0 END), 0) AS recent
    FROM articles a
    WHERE ${base} AND a.research_direction IS NOT NULL
    GROUP BY a.research_direction
  `).all({ winStart: startDate, winEnd: endDate });
  const countsByKey = new Map(rows.map((row) => [row.key, { total: Number(row.total), recent: Number(row.recent) }]));
  const directions = DIRECTIONS.map((direction) => ({
    key: direction.key,
    label: direction.label,
    total: countsByKey.get(direction.key)?.total || 0,
    lastN: countsByKey.get(direction.key)?.recent || 0
  }));

  const stats = {
    coverage: { classified, total, pendingReview, uncovered: total - classified },
    windowDays,
    directions
  };

  if (withMatrix) {
    const groups = new Map();
    for (const journal of [...DEFAULT_JOURNALS, ...getSettings().journals]) {
      if (journal?.name && journal?.group) groups.set(journal.name, journal.group);
    }
    const matrixRows = db.prepare(`
      SELECT a.journal, a.research_direction AS key, COUNT(*) AS n
      FROM articles a
      WHERE ${base} AND a.research_direction IS NOT NULL
      GROUP BY a.journal, a.research_direction
    `).all();
    const matrix = {};
    for (const row of matrixRows) {
      const group = groups.get(String(row.journal || "")) || "other";
      matrix[row.key] = matrix[row.key] || { ieee: 0, elsevier: 0, cn: 0, other: 0 };
      matrix[row.key][group] += Number(row.n);
    }
    stats.matrix = matrix;
  }
  return stats;
}

/** 管理员人工改判：置 direction_source='manual'，此后 apply 脚本永不覆盖该行。 */
export function setArticleDirectionManually(id, direction, secondary = []) {
  if (!isDirectionKey(direction)) throw new Error("未知的研究方向");
  const keys = [...new Set((Array.isArray(secondary) ? secondary : []).map((key) => String(key || "").trim()).filter(Boolean))]
    .filter((key) => key !== direction).slice(0, 2);
  for (const key of keys) {
    if (!isDirectionKey(key)) throw new Error(`未知的次方向：${key}`);
  }
  const info = db.prepare(`
    UPDATE articles
      SET research_direction = ?, research_direction_secondary = ?, direction_confidence = NULL,
          direction_source = 'manual', direction_reason = NULL, classified_at = ?
    WHERE id = ?
  `).run(direction, keys.length ? keys.join(",") : null, new Date().toISOString(), id);
  if (!info.changes) return null;
  return db.prepare("SELECT id, research_direction, research_direction_secondary, direction_source, classified_at FROM articles WHERE id = ?").get(id);
}

// ── AI 研究速览：周报/月报（PLAN-AI-REPORTS.md）────────────────────────────
// 报告内容由 WorkBuddy 智能体离线生成、经 scripts/apply-report.mjs 写入
// ai_reports 表；服务端只读渲染，任何接口都不得在这里发起 LLM/联网调用。

function parseReportRow(row) {
  if (!row) return null;
  let stats = null;
  if (row.stats_json) {
    try { stats = JSON.parse(row.stats_json); } catch { stats = null; }
  }
  return { ...row, stats_json: undefined, stats };
}

/**
 * 历史期数列表（period_start 倒序），板块「研究速览」回看用。
 * - direction：单个 key / null（仅总览）；缺省返回全部（总览+专报）。
 * - directions：key 数组（多方向专报批量取，配合 periodStart 供前端分组浏览懒加载）。
 * - periodStart：限定某期。
 * - meta：轻量模式（研究速览 v2）——不含 content_md，stats 剥掉 paperBriefs
 *   （json_remove 在 SQL 层完成，避免一次列表拉全量正文与速评数组）。
 */
export function listAiReports({ kind = "weekly", limit = 12, direction, directions, periodStart, meta = false } = {}) {
  if (!["weekly", "monthly"].includes(kind)) return [];
  const maxRows = Math.min(Math.max(Math.floor(Number(limit)) || 12, 1), 200);
  const params = { kind, limit: maxRows };
  const clauses = [];
  if (direction !== undefined) {
    // node:sqlite 严格校验：绑定对象的键必须与 SQL 占位符一一对应，
    // 因此 IS NULL 分支（无占位符）不能带 direction 键。
    if (direction === null) {
      clauses.push("AND direction IS NULL");
    } else {
      clauses.push("AND direction = @direction");
      params.direction = direction;
    }
  }
  if (Array.isArray(directions)) {
    const keys = directions.map((key) => String(key)).filter(isDirectionKey);
    if (keys.length) {
      clauses.push(`AND direction IN (${keys.map((_, index) => `@dirs${index}`).join(", ")})`);
      keys.forEach((key, index) => { params[`dirs${index}`] = key; });
    } else {
      clauses.push("AND 0"); // 显式空数组 = 明确不要方向行
    }
  }
  if (periodStart) {
    clauses.push("AND period_start = @periodStart");
    params.periodStart = String(periodStart);
  }
  // meta 模式在 SQL 层剥 paperBriefs；json_remove 对坏 JSON 返回 NULL（parseReportRow 容错）。
  const statsSelect = meta ? "json_remove(stats_json, '$.paperBriefs') AS stats_json" : "stats_json";
  const contentSelect = meta ? "NULL AS content_md" : "content_md";
  return db.prepare(`
    SELECT id, kind, period_start, period_end, direction, status, ${contentSelect}, ${statsSelect}, generated_at, generator
    FROM ai_reports
    WHERE kind = @kind AND status = 'ready' ${clauses.join(" ")}
    ORDER BY period_start DESC, id DESC
    LIMIT @limit
  `).all(params).map(parseReportRow);
}

/**
 * 单份报告详情（研究速览 v2 懒加载）：
 * - { id }：按行 id 直取；
 * - { kind, periodStart }：该期总览（direction IS NULL）；
 * - { kind, periodStart, direction }：该期某方向专报（direction 须白名单 key）。
 */
export function getAiReportDetail({ id, kind = "weekly", periodStart, direction } = {}) {
  if (id != null) {
    const numeric = Number(id);
    if (!Number.isInteger(numeric) || numeric <= 0) return null;
    return parseReportRow(db.prepare(`
      SELECT id, kind, period_start, period_end, direction, status, content_md, stats_json, generated_at, generator
      FROM ai_reports WHERE id = ?
    `).get(numeric));
  }
  if (!["weekly", "monthly"].includes(kind) || !periodStart) return null;
  if (direction === undefined || direction === null || direction === "") {
    return parseReportRow(db.prepare(`
      SELECT id, kind, period_start, period_end, direction, status, content_md, stats_json, generated_at, generator
      FROM ai_reports WHERE kind = ? AND period_start = ? AND status = 'ready' AND direction IS NULL
      ORDER BY id DESC LIMIT 1
    `).get(kind, String(periodStart)));
  }
  if (!isDirectionKey(direction)) return null;
  return parseReportRow(db.prepare(`
    SELECT id, kind, period_start, period_end, direction, status, content_md, stats_json, generated_at, generator
    FROM ai_reports WHERE kind = ? AND period_start = ? AND status = 'ready' AND direction = ?
    ORDER BY id DESC LIMIT 1
  `).get(kind, String(periodStart), String(direction)));
}

/** 最新一期 ready 报告：digest 邮件置顶与 /api/reports/latest 共用（默认取总览，direction IS NULL）。 */
export function getLatestReadyReport(kind = "weekly", direction = null) {
  if (!["weekly", "monthly"].includes(kind)) return null;
  return parseReportRow(db.prepare(`
    SELECT id, kind, period_start, period_end, direction, status, content_md, stats_json, generated_at, generator
    FROM ai_reports
    WHERE kind = ? AND status = 'ready' AND direction IS ?
    ORDER BY period_start DESC, id DESC
    LIMIT 1
  `).get(kind, direction));
}
