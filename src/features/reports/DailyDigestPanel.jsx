/**
 * 研究速览 ·「当日新增」面板（PLAN-DAILY-DIGEST.md，2026-10-15）
 *
 * 数据来源分两层，缺一层也能正常渲染：
 *   ① 实时统计（/api/reports/daily → digest）：数量 / 来源分布 / 分类情况 / 文献清单，
 *      纯 SQL 零 LLM，页面打开即有数，永不「空白等 AI」；
 *   ② 当日 AI 日报（同一响应里的 report，kind='daily'，可选）：分析摘要 + 重点关注。
 *      未生成时该两块整段不渲染，改为一行说明——不出现空标题或骨架。
 *
 * 三态：加载中（骨架，形状匹配真实内容）/ 无新增（给出路：查看昨日 · 切到一周速览）/
 * 加载失败（重新加载 · 切到一周速览）。空态与失败态都必须是「有出路」的状态。
 *
 * 布局（2026-10-15 用户调整）：
 *   · 日期选择器上移到页头，与标签页同一行（由 ReportsView 渲染，本组件通过
 *     date / onDateChange / onDateResolved 三个 prop 与之对接）；
 *   · 页内不再有信息条（原「统计窗口 / 新增 / 来源 / 覆盖」一行已删除，数字由概览卡承载）。
 *
 * 布局（2026-10-16 用户调整）：
 *   · 概览四张统计卡整块删除（数字由分布标签承载）；
 *   · 来源与分类分布**两组同时展示**（研究方向一行、来源期刊一行），不再二选一切换；
 *   · 当日文献**全部**铺开成三字段速评卡网格（不再只预览 3 张），底部只留「卡片阅读」；
 *   · 「当日分析摘要」只取 `## 当日分析摘要` 小节，AI 正文开头的「总述」句（篇数/来源/
 *     方向分布）与上方标签重复，不再渲染；正文字号提到 15px、行高 2。
 */
import { useEffect, useMemo } from "react";
import { BookOpenCheck, CalendarRange, Check, RefreshCw, Sparkles, Star } from "lucide-react";
import { api } from "../../lib/api.js";
import { directionLabel, directionVar } from "../../lib/directions.js";
import { journalAbbr, journalGroup } from "../../lib/journal.js";
import { parseReportContent } from "../../lib/report-content.js";
import { renderMarkdown } from "../../lib/markdown.jsx";
import EmptyState from "../../components/EmptyState.jsx";
import useAsync from "../../hooks/useAsync.js";
import useCollapsedGroups from "../../hooks/useCollapsedGroups.js";
import BriefCard from "./BriefCard.jsx";

const CHIP_LIMIT = 12;    // 分布 chip 最多显示几个，其余聚合为「其余 N 个」
const VIEW_ALL_LIMIT = 100;
const GROUP_PREVIEW_COUNT = 3; // 方向分组内预览卡片数，与周报/月报一致
const LEGACY_PREVIEW_COUNT = 12; // 无速评时列表只铺前 12 条，其余走「查看全部」

/** 分布数据：非零项降序，超出 CHIP_LIMIT 的聚合成一条。 */
function chipEntries(entries) {
  const list = entries.filter((item) => Number(item.count) > 0).sort((a, b) => b.count - a.count);
  if (list.length <= CHIP_LIMIT) return list;
  const head = list.slice(0, CHIP_LIMIT);
  const rest = list.slice(CHIP_LIMIT);
  head.push({ key: null, name: `其余 ${rest.length} 个`, count: rest.reduce((sum, item) => sum + item.count, 0) });
  return head;
}

/**
 * 从日报正文里剔除「## 重点关注」整节（2026-10-15 用户下线该板块）。
 * parseReportContent 不识别该小节、会把它当作普通段落落进 textCards；历史日报若
 * 含该节，这里按标题过滤掉，避免它以正文卡形式回潮。
 */
function dropRetiredSections(cards) {
  return cards.filter((card) => !card.title.includes("重点关注"));
}

function LoadingSkeleton() {
  return (
    <div className="reports-daily-skeleton" aria-busy="true" aria-live="polite">
      <h2 className="reports-sect">来源与分类分布</h2>
      <div className="reports-daily-chips">
        {[92, 74, 58, 44].map((width, index) => (
          <span className="skeleton" key={index} style={{ height: 26, width, borderRadius: 999, display: "block" }} />
        ))}
      </div>
      <p className="reports-loading">正在统计当日新增文献…</p>
    </div>
  );
}

function DailyDigestPanel({ date, onDateChange, onDateResolved, onOpenArticle, onOpenCardReader, onOpenList, onSwitchToWeekly, statusOverrides = null }) {
  const { data, loading, error, reload } = useAsync(
    () => api.get(`/api/reports/daily${date ? `?date=${encodeURIComponent(date)}` : ""}`),
    [date]
  );
  const { collapsed: collapsedGroups, toggle: toggleGroup, setCollapsed: setCollapsedGroups } = useCollapsedGroups();

  useEffect(() => {
    if (data?.date) onDateResolved(data.date);
  }, [data, onDateResolved]);

  // 切换日期后恢复「全部展开」，与周报/月报切换期数时的行为一致。
  useEffect(() => {
    setCollapsedGroups(new Set());
  }, [data?.date, setCollapsedGroups]);

  const digest = data?.digest || null;
  const report = data?.report || null;
  const resolvedDate = data?.date || date || "";

  const briefById = useMemo(() => {
    const map = new Map();
    for (const brief of report?.stats?.paperBriefs || []) map.set(brief.id, brief);
    return map;
  }, [report]);

  const parsed = useMemo(() => parseReportContent(report?.content_md || ""), [report]);
  const summaryCards = useMemo(() => dropRetiredSections(parsed.textCards), [parsed]);

  const directionChips = useMemo(() => {
    if (!digest) return [];
    return chipEntries(Object.entries(digest.directionCounts || {})
      .map(([key, count]) => ({ key, name: directionLabel(key), count: Number(count) })));
  }, [digest]);
  const journalChips = useMemo(
    // 接口给的是 [{name, count}]，chip 统一按 {key, name, count} 处理（期刊的 key = 刊名）
    () => (digest ? chipEntries((digest.journalCounts || []).map((item) => ({ key: item.name, name: item.name, count: Number(item.count) }))) : []),
    [digest]
  );

  // 已读 / 收藏状态以 statusOverrides 为准：详情弹窗里点「标记已读 / 收藏」后
  // 卡片徽章立即更新，不必重新拉整天数据。
  const articles = useMemo(
    () => (digest?.articles || []).map((article) => {
      const status = statusOverrides?.get(article.id);
      return status ? { ...article, ...status } : article;
    }),
    [digest, statusOverrides]
  );
  const briefs = report?.stats?.paperBriefs || [];
  const hasBriefs = briefs.length > 0;

  // 当日新增按研究方向分组（模仿一周速览/月度趋势的方向分组手风琴）：
  // 每组只预览 3 张，避免一天上百篇时整页铺满卡片。
  const dailyGroups = useMemo(() => {
    const byKey = new Map();
    for (const article of articles) {
      const key = article.research_direction || "";
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(article);
    }
    const orderedKeys = [];
    for (const chip of directionChips) {
      if (byKey.has(chip.key)) orderedKeys.push(chip.key);
    }
    if (byKey.has("")) orderedKeys.push("");
    return orderedKeys.map((key) => {
      const list = byKey.get(key) || [];
      const compositionCounts = new Map();
      for (const article of list) {
        const name = String(article.journal || "").trim();
        if (name) compositionCounts.set(name, (compositionCounts.get(name) || 0) + 1);
      }
      const composition = [...compositionCounts.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
      return {
        key,
        label: key ? directionLabel(key) : "未标注方向",
        articles: list,
        briefs: list.map((article) => briefById.get(article.id)).filter(Boolean),
        composition
      };
    });
  }, [articles, directionChips, briefById]);

  const anyGroupOpen = dailyGroups.some((group) => !collapsedGroups.has(group.key));
  function toggleAllGroups() {
    setCollapsedGroups(() => (anyGroupOpen ? new Set(dailyGroups.map((group) => group.key)) : new Set()));
  }

  /** 下钻：按方向 / 期刊 / 整日拉当日全量文献（口径与 /api/articles 一致）。 */
  function openSubset({ title, markLabel, direction, journal }) {
    const query = [
      direction ? `direction=${encodeURIComponent(direction)}` : "",
      journal ? `journal=${encodeURIComponent(journal)}` : "",
      `from=${encodeURIComponent(resolvedDate)}`,
      `to=${encodeURIComponent(resolvedDate)}`,
      "sort=desc",
      `limit=${VIEW_ALL_LIMIT}`
    ].filter(Boolean).join("&");
    onOpenList({ title, markLabel, subtitle: "正在加载…", items: [], loading: true, error: "" });
    api.get(`/api/articles?${query}`).then((result) => {
      onOpenList({
        title,
        markLabel,
        subtitle: `${result.total || 0} 篇（${resolvedDate}，按首次公开倒序）`,
        items: (result.articles || []).map((article) => ({ id: article.id, article, fallback: "" })),
        loading: false,
        error: ""
      });
    }).catch((failure) => {
      onOpenList({ title, markLabel, subtitle: "", items: [], loading: false, error: failure.message });
    });
  }

  function openCardRead() {
    if (!briefs.length) return;
    onOpenCardReader({
      title: `当日新增 · ${resolvedDate}`,
      ids: briefs.map((brief) => brief.id),
      briefs
    });
  }

  /** 方向分组「查看全部」：直接用当日 digest 的清单，不再发一次 API（口径最稳）。 */
  function openGroupList(group) {
    onOpenList({
      title: `当日新增 · ${group.label}`,
      markLabel: group.key ? group.label : "未标注",
      subtitle: `${group.articles.length} 篇（${resolvedDate}，按首次公开倒序）`,
      items: group.articles.map((article) => ({ id: article.id, article, fallback: "" })),
      loading: false,
      error: ""
    });
  }

  /** 方向分组「卡片阅读」：只读该组有速评的文献。 */
  function openGroupCardRead(group) {
    if (!group.briefs.length) return;
    onOpenCardReader({
      title: `当日新增 · ${group.label} · ${resolvedDate}`,
      ids: group.briefs.map((brief) => brief.id),
      briefs: group.briefs
    });
  }

  if (loading) return <LoadingSkeleton />;

  if (error) {
    return (
      <EmptyState
        icon={CalendarRange}
        title="当日新增分析加载失败"
        description={`${error}。统计数据来自数据库实时查询，稍后重试即可；也可先浏览「一周速览 / 月度趋势」。`}
        action={(
          <>
            <button type="button" className="reports-daily-btn primary" onClick={reload}>
              <RefreshCw size={13} aria-hidden="true" /> 重新加载
            </button>
            <button type="button" className="reports-daily-btn" onClick={onSwitchToWeekly}>切到「一周速览」</button>
          </>
        )}
      />
    );
  }

  if (!digest) return null;

  if (!digest.total) {
    const prevDate = digest.previous?.date || "";
    const prevTotal = Number(digest.previous?.total || 0);
    return (
      <EmptyState
        art="news"
        title="当日暂无新增文献"
        description={`统计窗口为北京时间业务日 ${resolvedDate} 00:00 ~ 24:00，文献入库后自动纳入本板块。抓取作业通常在凌晨完成，若当日尚未入库可稍后再看，或切换到「一周速览」浏览近期文献。`}
        action={(
          <>
            {prevTotal > 0 && prevDate && (
              <button type="button" className="reports-daily-btn" onClick={() => onDateChange(prevDate)}>
                查看昨日（{prevDate} · {prevTotal} 篇）
              </button>
            )}
            <button type="button" className="reports-daily-btn primary" onClick={onSwitchToWeekly}>切到「一周速览」</button>
          </>
        )}
      />
    );
  }

  return (
    <>
      {!report && (
        <p className="reports-daily-note">
          <Sparkles size={13} aria-hidden="true" />
          当日 AI 分析摘要由每日 06:30 作业生成，当日尚未产出；当前展示实时统计与文献清单。
        </p>
      )}

      {/* 来源与分类分布（2026-10-16 用户调整）：不再「按方向 / 按期刊」二选一，
          两组标签同时展示——研究方向一行、来源期刊一行。 */}
      <h2 className="reports-sect">
        来源与分类分布
        <span className="reports-sect-hint">
          点标签查看该方向 / 该期刊的当日文献
          {digest.unclassified > 0 && <> · 另有 {digest.unclassified} 篇待方向标注</>}
        </span>
      </h2>
      <div className="reports-daily-dist">
        <div className="reports-daily-dist-row">
          <span className="reports-daily-dist-label">研究方向</span>
          <div className="reports-daily-chips">
            {directionChips.length > 0 ? directionChips.map((chip) => {
              const clickable = Boolean(chip.key);
              return (
                <button
                  type="button"
                  key={chip.key || "rest"}
                  disabled={!clickable}
                  className={`reports-dir-chip${clickable ? "" : " is-more"}`}
                  style={clickable ? { "--dir-key": directionVar(chip.key) } : undefined}
                  title={clickable ? `${chip.name} · 当日 ${chip.count} 篇` : undefined}
                  onClick={() => clickable && openSubset({ title: `当日新增 · ${chip.name}`, markLabel: chip.name, direction: chip.key, journal: "" })}
                >
                  {clickable && <span className="reports-dir-dot" style={{ "--dir-key": directionVar(chip.key) }} aria-hidden="true" />}
                  {chip.name}
                  <span className="reports-dir-count">{chip.count}</span>
                </button>
              );
            }) : <span className="reports-daily-dist-empty">当日文献均未标注方向</span>}
          </div>
        </div>
        <div className="reports-daily-dist-row">
          <span className="reports-daily-dist-label">来源期刊</span>
          <div className="reports-daily-chips">
            {journalChips.map((chip) => {
              const clickable = Boolean(chip.key);
              return (
                <button
                  type="button"
                  key={chip.key || "rest"}
                  disabled={!clickable}
                  className={`reports-group-jchip tone-${chip.key ? journalGroup(chip.key) : "other"}${clickable ? " is-clickable" : " is-more"}`}
                  title={clickable ? `${chip.name} · 当日 ${chip.count} 篇` : undefined}
                  onClick={() => clickable && openSubset({ title: `当日新增 · ${chip.name}`, markLabel: chip.name, direction: "", journal: chip.key })}
                >
                  {clickable && <span className="rgj-dot" aria-hidden="true" />}
                  <span className="rgj-name">{clickable ? journalAbbr(chip.key) : chip.name}</span>
                  <span className="rgj-count">{chip.count}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* 当日分析摘要（2026-10-16 用户调整）：篇数 / 来源 / 方向这些数字已由上方标签承载，
          AI 正文开头的「总述」句属于重复信息，不再渲染（只取 `## 当日分析摘要` 小节）。 */}
      {report && summaryCards.length > 0 && (
        <>
          <h2 className="reports-sect">
            当日分析摘要
            <span className="reports-sect-hint">AI 基于当日全部文献摘要归纳 · 结论以原文为准</span>
          </h2>
          <div className="reports-text-card reports-daily-summary">
            {summaryCards.map((card) => (
              <div key={card.title}>
                {card.title && !card.title.includes("当日分析摘要") && <p className="reports-text-card-title">{card.title}</p>}
                <div className="reports-md">{renderMarkdown(card.body)}</div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* 「重点关注」板块已于 2026-10-15 下线（用户需求）：当日文献已按三字段速评卡
          全量展示，再单列一份子集只会重复同样的卡。focusIds / `## 重点关注` 小节
          在数据侧继续被容错忽略，不再渲染。 */}

      <div className="reports-daily-list-head">
        <h2 className="reports-sect">
          当日新增文献
          <span className="reports-sect-hint">
            {hasBriefs
              ? `共 ${articles.length} 篇 · 按研究方向分组 · 每组预览 ${GROUP_PREVIEW_COUNT} 张 · 点击卡片查看详情`
              : `共 ${articles.length} 篇 · 按首次公开时间倒序 · 点击任意一条查看详情`}
          </span>
        </h2>
        {hasBriefs && (
          <button type="button" className="reports-cardread-btn reports-daily-cardread" onClick={openCardRead}>
            <BookOpenCheck size={13} aria-hidden="true" /> 卡片阅读 · {briefs.length} 篇
          </button>
        )}
      </div>
      {hasBriefs ? (
        <>
          {/* 2026-10-28 用户调整：一天上百篇时不再全部铺开，改成与「一周速览 / 月度趋势」
              一致的方向分组手风琴：每组预览 3 张，组内再给「卡片阅读 / 查看全部」。 */}
          <div className="reports-groups-bar">
            <h2 className="reports-sect">
              方向分组浏览
              <span className="reports-sect-hint">按研究方向归组 · 点击组头展开/收起 · 组内只预览前 {GROUP_PREVIEW_COUNT} 张</span>
            </h2>
            <button type="button" className="reports-groups-toggle" onClick={toggleAllGroups}>
              {anyGroupOpen ? "全部折叠" : "全部展开"}
            </button>
          </div>
          <div className="reports-groups">
            {dailyGroups.map((group) => {
              const open = !collapsedGroups.has(group.key);
              const previewSource = group.briefs.length
                ? group.articles.filter((article) => briefById.has(article.id))
                : group.articles;
              const previewArticles = previewSource.slice(0, GROUP_PREVIEW_COUNT);
              return (
                <div
                  className={`reports-group${open ? " is-open" : ""}`}
                  key={group.key || "unclassified"}
                  style={group.key ? { "--dir-key": directionVar(group.key) } : undefined}
                >
                  <button
                    type="button"
                    className="reports-group-head"
                    onClick={() => toggleGroup(group.key)}
                    aria-expanded={open}
                  >
                    <span className="reports-group-dot" aria-hidden="true" />
                    <span className="reports-group-name">{group.label}</span>
                    <span className="reports-group-count">{group.articles.length} 篇</span>
                    {group.composition.length > 0 && (
                      <span
                        className="reports-group-jchips"
                        title={`来源期刊：${group.composition.map((item) => `${item.name} ${item.count}`).join(" · ")}`}
                        aria-hidden="true"
                      >
                        {group.composition.slice(0, 8).map((item) => (
                          <span key={item.name} className={`reports-group-jchip tone-${journalGroup(item.name)}`} title={item.name}>
                            <span className="rgj-dot" />
                            <span className="rgj-name">{journalAbbr(item.name)}</span>
                            <span className="rgj-count">{item.count}</span>
                          </span>
                        ))}
                        {group.composition.length > 8 && (
                          <span className="reports-group-jchip is-more">+{group.composition.length - 8} 种</span>
                        )}
                      </span>
                    )}
                    <span className="reports-group-topic">
                      {group.briefs.length ? `${group.briefs.length} 篇有速评` : "暂无速评"}
                    </span>
                    <span className="reports-group-caret" aria-hidden="true">▶</span>
                  </button>
                  <div className="reports-group-body">
                    {previewArticles.length > 0 ? (
                      <div className="reports-group-cards">
                        {previewArticles.map((article) => (
                          <BriefCard
                            key={article.id}
                            id={article.id}
                            article={article}
                            brief={briefById.get(article.id) || null}
                            showLegacyBadge={false}
                            onOpen={onOpenArticle}
                          />
                        ))}
                      </div>
                    ) : (
                      <p className="reports-group-hint">该方向暂无带速评的文献，可点「查看全部」浏览清单。</p>
                    )}
                    <div className="reports-group-foot">
                      {group.briefs.length > 0 && (
                        <button type="button" className="reports-group-cardread" onClick={() => openGroupCardRead(group)}>
                          <BookOpenCheck size={13} aria-hidden="true" /> 卡片阅读 · {group.briefs.length} 篇
                        </button>
                      )}
                      <button type="button" className="reports-group-more" onClick={() => openGroupList(group)}>
                        {group.key ? `查看该方向全部 ${group.articles.length} 篇 ›` : `查看全部 ${group.articles.length} 篇 ›`}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <>
          <div className="reports-list">
            {articles.slice(0, LEGACY_PREVIEW_COUNT).map((article) => (
              <button
                type="button"
                className="journal-article-row"
                key={article.id}
                onClick={() => onOpenArticle(article.id)}
              >
                <span className="journal-article-title">
                  {article.journal && (
                    <span className={`journal-article-journal tone-${journalGroup(article.journal)}`} title={article.journal}>
                      {article.journal}
                    </span>
                  )}
                  {article.translated_title || article.title}
                </span>
                <span className="journal-article-meta">
                  <span className="journal-article-dot" style={{ "--dir-key": article.research_direction ? directionVar(article.research_direction) : "var(--text-tertiary)" }} />
                  <span>{article.research_direction ? directionLabel(article.research_direction) : "未标注方向"}</span>
                  {article.is_read ? <span className="article-status-badge read-badge"><Check size={11} /> 已读</span> : null}
                  {article.is_favorite ? <span className="article-status-badge fav-badge"><Star size={11} /> 收藏</span> : null}
                </span>
              </button>
            ))}
          </div>
          <div className="reports-list-foot">
            <button
              type="button"
              className="reports-group-more"
              onClick={() => openSubset({ title: `当日新增 · ${resolvedDate} 全部文献`, markLabel: "当日新增" })}
            >
              查看当日全部 {digest.total} 篇 ›
            </button>
          </div>
        </>
      )}
    </>
  );
}

export default DailyDigestPanel;
