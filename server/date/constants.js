// ── 文献时间语义常量 ─────────────────────────────────────────────────────────
// 「文献主时间」= first_public_at（论文第一次正式、公开、可检索地出现的日期）。
// 业务口径见 docs/文献时间语义问题_详细解决方案.md（§9 判定算法、§10 可信度分级）。
//
// 可信度分级（confidence）：
//   A —— 出版平台明确给出的首次公开日期（IEEE Early Access / Elsevier
//        Available online / 中文期刊网络首发）
//   B —— 已发生的正式出版日期
//   C —— 可信外部元数据代理时间（如 Crossref created，仅近似）
//   D —— 本系统兜底（first_seen_at，仅无法取得任何外部时间时使用）
//
// 数值越小越可信；mergeFirstPublic() 以此决定是否允许覆盖旧值。

/** 各可信度等级的优先序；数值越小越可信。 */
export const CONFIDENCE_RANK = { A: 0, B: 1, C: 2, D: 3 };

/** A 级「首次公开」来源。回填脚本写入 online_first_at 时应同时写入下列来源名。 */
export const ONLINE_FIRST_SOURCES = new Set([
  "ieee_early_access",
  "elsevier_available_online",
  "cn_online_first",
  "online_first"
]);

/** B/C/D 级来源名（resolveFirstPublicDate 输出）。 */
export const SOURCE_OFFICIAL_PUBLICATION = "official_publication";
export const SOURCE_EXTERNAL_CREATED_PROXY = "external_created_proxy";
export const SOURCE_SYSTEM_FIRST_SEEN_FALLBACK = "system_first_seen_fallback";

/**
 * 整期日修正（2026-09-24 拍板）：出版社把整期文章的正式出版日统一写成月初 1 日
 * （IEEE 每月 1 日把上月 Early Access 全部转正），该日期是「期刊出版日」而非
 * 单篇论文的真实日期；若 Crossref created 比它早超过 30 天，改用 created。
 * 来源名单独标记，便于诊断与回滚。
 */
export const SOURCE_ISSUE_DATE_CREATED_PROXY = "issue_date_created_proxy";
