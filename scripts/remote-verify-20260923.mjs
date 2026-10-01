// 上线后验收（只读）：确认远端生产库在 2026.09.23.1 之后的状态符合四个修复的预期。
import { DatabaseSync } from "node:sqlite";
import { isNonResearchTitle } from "../server/utils.js";

const DATA = "E:/SC/文献推送/data/";
const db = new DatabaseSync(DATA + "literature.sqlite", { readOnly: true });
// 裸连接不带自定义 SQL 函数；按 server/db.js:17 的同一实现注册，保持与生产一致的统计口径。
db.function("is_non_research_title", { deterministic: true }, (value) => (isNonResearchTitle(value) ? 1 : 0));
const q = (sql, ...args) => db.prepare(sql).all(...args);
const one = (sql, ...args) => db.prepare(sql).get(...args);
let failures = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${label}${detail ? " -> " + detail : ""}`);
  if (!ok) failures++;
};

const CATALOG = [
  "IEEE Transactions on Power Systems", "IEEE Transactions on Smart Grid", "IEEE Transactions on Power Delivery",
  "IEEE Transactions on Sustainable Energy", "IEEE Transactions on Energy Conversion",
  "IEEE Transactions on Industrial Informatics", "IEEE Transactions on Transportation Electrification",
  "Applied Energy", "Energy", "International Journal of Electrical Power & Energy Systems", "Renewable Energy",
  "Journal of Modern Power Systems and Clean Energy",
  "电力系统自动化", "中国电机工程学报", "电网技术", "电工技术学报", "高电压技术"
];

const displayDateSql = (alias = "a") => `substr(datetime(CASE
    WHEN datetime(${alias}.published_at) IS NULL THEN COALESCE(NULLIF(${alias}.first_seen_at,''), ${alias}.fetched_at)
    WHEN datetime(${alias}.published_at) > datetime('now') THEN COALESCE(NULLIF(${alias}.first_seen_at,''), ${alias}.fetched_at)
    ELSE ${alias}.published_at END),1,10)`;

console.log("=== 三、期刊分布：库里不应再出现期刊目录之外的刊名 ===");
const journals = q("SELECT journal, COUNT(*) AS c FROM articles GROUP BY journal ORDER BY c DESC");
const total = journals.reduce((sum, row) => sum + row.c, 0);
const offCatalog = journals.filter((row) => !CATALOG.includes(String(row.journal || "").trim()));
console.log(`  共 ${total} 篇 / ${journals.length} 个刊名`);
for (const row of journals) console.log(`    ${String(row.c).padStart(5)}  ${row.journal}`);
check("没有目录外的刊名", offCatalog.length === 0, offCatalog.map((r) => `${r.journal}(${r.c})`).join(", ") || "0 个");

console.log("\n=== 四、日期口径：display_date 不得落在未来 ===");
const future = one(`SELECT COUNT(*) AS c FROM articles a WHERE ${displayDateSql("a")} > date('now')`).c;
const nullDisplay = one(`SELECT COUNT(*) AS c FROM articles a WHERE ${displayDateSql("a")} IS NULL`).c;
const early = one("SELECT COUNT(*) AS c FROM articles WHERE datetime(published_at) > datetime('now')").c;
check("display_date 无未来日期", Number(future) === 0, `${future} 条`);
check("display_date 全部可算", Number(nullDisplay) === 0, String(nullDisplay) + " 条为空");
console.log(`  提前访问（出版日期在未来）= ${early} 篇，已按入库时间计入`);
for (const days of [7, 30]) {
  const byDisplay = one(`SELECT COUNT(*) AS c FROM articles a WHERE ${displayDateSql("a")} >= date('now', ?) AND ${displayDateSql("a")} <= date('now')`, `-${days} day`).c;
  const byRaw = one(`SELECT COUNT(*) AS c FROM articles WHERE substr(published_at,1,10) >= date('now', ?) AND substr(published_at,1,10) <= date('now')`, `-${days} day`).c;
  console.log(`  最近 ${days} 天：统一口径 ${byDisplay} 篇 / 旧的直接看出版日期 ${byRaw} 篇`);
}

console.log("\n=== 二、收藏：不应再有任何空白的「默认收藏夹」 ===");
const groups = q("SELECT id, user_id, name, (SELECT COUNT(*) FROM user_favorites uf WHERE uf.group_id = favorite_groups.id) AS used FROM favorite_groups ORDER BY user_id, id");
console.log(`  favorite_groups 共 ${groups.length} 行`);
for (const row of groups) console.log(`    #${row.id} user=${row.user_id} name=${row.name} 已用=${row.used}`);
const phantom = groups.filter((row) => row.name === "默认收藏夹" && Number(row.used) === 0);
check("没有空白「默认收藏夹」", phantom.length === 0, `${phantom.length} 个`);
const favTotal = one("SELECT COUNT(*) AS c FROM user_favorites uf JOIN articles a ON a.id = uf.article_id WHERE is_non_research_title(a.title) = 0").c;
const favUngrouped = one("SELECT COUNT(*) AS c FROM user_favorites uf JOIN articles a ON a.id = uf.article_id WHERE uf.group_id IS NULL AND is_non_research_title(a.title) = 0").c;
console.log(`  收藏总数 ${favTotal} 篇，其中未分组 ${favUngrouped} 篇（都计入总数）`);

console.log("\n=== 一、自动登录：账户与邮箱表状态 ===");
console.log(`  user_accounts=${one("SELECT COUNT(*) AS c FROM user_accounts").c} user_emails=${one("SELECT COUNT(*) AS c FROM user_emails").c} user_sessions=${one("SELECT COUNT(*) AS c FROM user_sessions").c}`);

console.log("\n=== 一次性修复标记 ===");
for (const key of ["legacyDefaultFavoriteGroupCleaned", "journalCatalogIssnsRepaired"]) {
  const row = one("SELECT value FROM settings WHERE key = ?", key);
  console.log(`  ${key} = ${row ? row.value : "(未写入)"}`);
}

console.log(`\n结论：${failures === 0 ? "全部通过" : failures + " 项未通过"}`);
db.close();
process.exit(failures === 0 ? 0 : 1);
