// 诊断「突然很多文章缺摘要 / 缺关键词 / 缺翻译」到底是
//   (a) 刚导入的新文章还没轮到补全，还是
//   (b) 旧数据丢了。
//
// 判定依据：把缺口按 first_seen_at 是否落在「今天」切开。若旧数据的缺口接近 0，
// 就是新增造成的积压，不是数据损坏。
//
// 用法（只读打开，不做任何写入）：
//   node --experimental-sqlite scripts/audit-metadata-gaps.mjs [dbPath] [YYYY-MM-DD]
// 远端：
//   .runtime\node\node.exe --experimental-sqlite scripts\audit-metadata-gaps.mjs data\literature.sqlite
import { DatabaseSync } from "node:sqlite";

const dbPath = process.argv[2] || "data/literature.sqlite";
const today = process.argv[3] || new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD，本地时区
const db = new DatabaseSync(dbPath, { readOnly: true });
const q = (sql, ...a) => db.prepare(sql).all(...a);
const one = (sql, ...a) => db.prepare(sql).get(...a);
const hasCjk = (s) => /[\u3400-\u9fff]/u.test(String(s || ""));

const empty = (col) => `length(trim(coalesce(${col}, ''))) = 0`;

const range = one("SELECT MIN(first_seen_at) AS v, MAX(first_seen_at) AS x FROM articles");
console.log(JSON.stringify({ dbPath, today, total: one("SELECT COUNT(*) AS n FROM articles").n, firstSeenRange: [range.v, range.x] }, null, 2));

console.log("\n== 近 12 天按入库日期统计（articles / 缺摘要 / 缺关键词）==");
console.log(JSON.stringify(q(`
  SELECT substr(first_seen_at, 1, 10) AS day, COUNT(*) AS articles,
         SUM(CASE WHEN ${empty("abstract")} THEN 1 ELSE 0 END) AS no_abstract,
         SUM(CASE WHEN ${empty("keywords")} THEN 1 ELSE 0 END) AS no_keywords
  FROM articles GROUP BY day ORDER BY day DESC LIMIT 12
`), null, 2));

console.log("\n== 缺口按「今天新增 / 今天以前」拆分（关键判据）==");
console.log(JSON.stringify(one(`
  SELECT
    SUM(CASE WHEN first_seen_at >= :t THEN 1 ELSE 0 END) AS new_today,
    SUM(CASE WHEN first_seen_at <  :t THEN 1 ELSE 0 END) AS older_total,
    SUM(CASE WHEN first_seen_at <  :t AND ${empty("abstract")} THEN 1 ELSE 0 END) AS older_no_abstract,
    SUM(CASE WHEN first_seen_at <  :t AND ${empty("keywords")} THEN 1 ELSE 0 END) AS older_no_keywords
  FROM articles
`, { t: today }), null, 2));

console.log("\n== 今日新增按期刊分布 ==");
console.log(JSON.stringify(q(`
  SELECT journal, COUNT(*) AS n FROM articles WHERE first_seen_at >= :t GROUP BY journal ORDER BY n DESC
`, { t: today }), null, 2));

console.log("\n== 今日新增的字段缺口组合 ==");
console.log(JSON.stringify(one(`
  SELECT COUNT(*) AS total,
    SUM(CASE WHEN ${empty("abstract")} AND ${empty("keywords")} THEN 1 ELSE 0 END) AS both_missing,
    SUM(CASE WHEN ${empty("abstract")} AND NOT ${empty("keywords")} THEN 1 ELSE 0 END) AS only_abstract,
    SUM(CASE WHEN NOT ${empty("abstract")} AND ${empty("keywords")} THEN 1 ELSE 0 END) AS only_keywords,
    SUM(CASE WHEN NOT ${empty("abstract")} AND NOT ${empty("keywords")} THEN 1 ELSE 0 END) AS complete
  FROM articles WHERE first_seen_at >= :t
`, { t: today }), null, 2));

// 中文原文的条目本来就不需要翻译，必须剔除，否则会把「正常」读成「缺失」。
const missingTrans = q(`
  SELECT a.first_seen_at, a.title,
         length(trim(coalesce(a.title, ''))) + length(trim(coalesce(a.abstract, ''))) AS chars
  FROM articles a
  LEFT JOIN translations t ON t.article_id = a.id AND t.target_language = 'zh'
  WHERE length(trim(coalesce(a.title, ''))) > 0 AND ${empty("t.title")}
`);
const chinese = missingTrans.filter((r) => hasCjk(r.title));
const toTranslate = missingTrans.filter((r) => !hasCjk(r.title));
console.log("\n== 缺译文（剔除「原文就是中文」之后）==");
console.log(JSON.stringify({
  缺译文记录总数: missingTrans.length,
  原文是中文_不需要翻译: chinese.length,
  真正待翻译_总数: toTranslate.length,
  真正待翻译_今日新增: toTranslate.filter((r) => r.first_seen_at >= today).length,
  真正待翻译_今天以前: toTranslate.filter((r) => r.first_seen_at < today).length,
  待翻译字符量估算: toTranslate.reduce((s, r) => s + Number(r.chars || 0), 0)
}, null, 2));

console.log("\n== 每刊缺口分布（前 12）==");
console.log(JSON.stringify(q(`
  SELECT journal, COUNT(*) AS articles,
         SUM(CASE WHEN ${empty("abstract")} THEN 1 ELSE 0 END) AS no_abstract,
         SUM(CASE WHEN ${empty("keywords")} THEN 1 ELSE 0 END) AS no_keywords,
         MAX(substr(first_seen_at, 1, 10)) AS last_seen
  FROM articles GROUP BY journal ORDER BY no_abstract DESC LIMIT 12
`), null, 2));

console.log("\n== 最近 8 次任务（含待补全队列的官方计数）==");
console.log(JSON.stringify(q(`
  SELECT id, started_at, finished_at, task_type, status, added_count,
         remaining_abstract_count, remaining_keyword_count, remaining_translation_count
  FROM refresh_runs ORDER BY id DESC LIMIT 8
`), null, 2));
