// ── 文献主时间（first_public_at）统一判定 ────────────────────────────────────
// 回答一个问题：这篇论文第一次以正式、公开、可检索的形式出现在出版平台上的日期
// 是什么？不由「本系统什么时候抓到它」决定，也不被未来卷期日覆盖。
//
// 判定优先级（方案 §9）：
//   A  online_first_at        —— IEEE Early Access / Elsevier Available online /
//                                中文期刊网络首发（出版平台明确给出的首次公开日期）
//   B  published_at           —— 已发生的正式出版日期
//   C  external_created_at    —— 可信外部元数据代理（如 Crossref created，预留）
//   D  first_seen_at          —— 本系统兜底（北京时间业务日）
//
// 未来卷期日（published_at 在未来）保留在事实字段里，但不参与主时间判定（§14）。
// 已落库的 A 级结果不会被后续元数据更新改写（§25）。

import {
  businessToday,
  normalizeDatePrecision,
  isUsablePastDate,
  toBusinessDate,
  daysBetween
} from "./normalize.js";
import {
  CONFIDENCE_RANK,
  ONLINE_FIRST_SOURCES,
  SOURCE_OFFICIAL_PUBLICATION,
  SOURCE_EXTERNAL_CREATED_PROXY,
  SOURCE_SYSTEM_FIRST_SEEN_FALLBACK,
  SOURCE_ISSUE_DATE_CREATED_PROXY
} from "./constants.js";

/**
 * 按优先级解析一篇文献的首次公开日期。
 * @returns {{ first_public_at: string, first_public_precision: string, first_public_source: string, first_public_confidence: string } | null}
 *          所有时间都缺失时返回 null（调用方保留空值，由旧口径兜底）。
 */
export function resolveFirstPublicDate(article, { today = businessToday() } = {}) {
  if (!article) return null;

  // A 级：出版平台明确给出的首次公开日期。
  const onlineFirst = normalizeDatePrecision(article.online_first_at);
  if (onlineFirst.date && isUsablePastDate(onlineFirst.date, today)) {
    const stored = String(article.first_public_source || "");
    return {
      first_public_at: onlineFirst.date,
      first_public_precision: onlineFirst.precision,
      first_public_source: ONLINE_FIRST_SOURCES.has(stored) ? stored : "online_first",
      first_public_confidence: "A"
    };
  }

  // B 级：已发生的正式出版日期。
  // 整期日例外（2026-09-24 拍板）：出版社常把整期文章的正式出版日统一写成月初
  // 1 日（IEEE 每月 1 日把上月 Early Access 全部转正），这一天是「期刊出版日」
  // 而非单篇论文的日期。若 Crossref created 比它早超过 30 天，说明该日只是整期
  // 代理，改用 created 作为首次公开时间。
  const published = normalizeDatePrecision(article.published_at);
  if (published.date && isUsablePastDate(published.date, today)) {
    const external = normalizeDatePrecision(article.external_created_at);
    const isIssueDate = published.precision === "day" && published.date.slice(8, 10) === "01";
    if (isIssueDate && external.date && isUsablePastDate(external.date, today)
      && daysBetween(published.date, external.date) > 30) {
      return {
        first_public_at: external.date,
        first_public_precision: external.precision,
        first_public_source: SOURCE_ISSUE_DATE_CREATED_PROXY,
        first_public_confidence: "C"
      };
    }
    return {
      first_public_at: published.date,
      first_public_precision: published.precision,
      first_public_source: SOURCE_OFFICIAL_PUBLICATION,
      first_public_confidence: "B"
    };
  }

  // C 级：可信外部元数据代理时间（预留字段；当前无写入方，库里有值即生效）。
  const external = normalizeDatePrecision(article.external_created_at);
  if (external.date && isUsablePastDate(external.date, today)) {
    return {
      first_public_at: external.date,
      first_public_precision: external.precision,
      first_public_source: SOURCE_EXTERNAL_CREATED_PROXY,
      first_public_confidence: "C"
    };
  }

  // D 级：本系统兜底 —— first_seen_at（缺失时回落 fetched_at），换算成北京业务日。
  const firstSeen = toBusinessDate(article.first_seen_at || article.fetched_at);
  if (firstSeen) {
    return {
      first_public_at: firstSeen,
      first_public_precision: "day",
      first_public_source: SOURCE_SYSTEM_FIRST_SEEN_FALLBACK,
      first_public_confidence: "D"
    };
  }
  return null;
}

/**
 * 合并「库里已落的第一公开时间」与「按最新事实重新解析的结果」，决定最终写入值。
 *
 * 规则（§11 不覆盖人工/回填确认值、§25 正式卷期元数据只补事实字段）：
 *   · 库里没有值            → 采用新解析结果；
 *   · 库里已是 A 级         → 一律保留（后续 published_at 变化不改写首次公开日期）；
 *   · 整期日修正            → existing 是普通正式出版日、新结果识别出整期代理日并
 *                             用 created 修正 → 这是事实更正而非可信度降级，必须采纳；
 *   · 新结果可信度更高      → 升级覆盖（如 D→B：入库后补到了出版日期）；
 *   · 可信度相同但日期不同  → 采纳新值（同级事实刷新，如出版社修正出版日期）；
 *   · 其余                  → 保留旧值（不做无意义改写，保证脚本可重复执行）。
 */
export function mergeFirstPublic(existing, resolved) {
  if (!resolved) return existing && existing.first_public_at ? existing : null;
  if (!existing || !existing.first_public_at) return resolved;

  // 整期日修正特例：existing 的日期来自「正式出版日」，但新解析发现那是月初 1 日
  // 的整期代理日并改用 created —— 必须采纳，否则重跑回填永远改不动历史 B 级值。
  if (existing.first_public_source === SOURCE_OFFICIAL_PUBLICATION
    && resolved.first_public_source === SOURCE_ISSUE_DATE_CREATED_PROXY) {
    return resolved;
  }

  const existingRank = CONFIDENCE_RANK[existing.first_public_confidence] ?? CONFIDENCE_RANK.D;
  const resolvedRank = CONFIDENCE_RANK[resolved.first_public_confidence] ?? CONFIDENCE_RANK.D;
  if (existingRank === 0) return existing;
  if (resolvedRank < existingRank) return resolved;
  if (resolvedRank === existingRank && String(existing.first_public_at) !== String(resolved.first_public_at)) {
    return resolved;
  }
  return existing;
}

/**
 * 一站式入口：合并事实字段后解析。事实字段以「新值优先、旧值兜底」合并
 * （与 INSERT ... ON CONFLICT 的 COALESCE 语义一致），再按优先级解析。
 */
export function resolveMergedFirstPublic(existing, incoming, options = {}) {
  const facts = {
    ...existing,
    ...Object.fromEntries(Object.entries(incoming || {}).filter(([, value]) => value !== undefined && value !== null && value !== "")),
    online_first_at: incoming?.online_first_at || existing?.online_first_at || null
  };
  return resolveFirstPublicDate(facts, options);
}
