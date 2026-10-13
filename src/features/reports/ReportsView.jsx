import { useEffect, useMemo, useState } from "react";
import { BookOpenCheck, CalendarRange, Check, ChevronDown, GripVertical, Plus, RotateCcw, Settings2, Sparkles, Star, X } from "lucide-react";
import CardReader from "../reader/CardReader.jsx";
import { api } from "../../lib/api.js";
import { DIRECTIONS, directionLabel, directionVar } from "../../lib/directions.js";
import { journalAbbr, journalGroup } from "../../lib/journal.js";
import { hiddenIdsForJournals, journalEntriesFromIds } from "../../lib/report-journals.js";
import { parseReportContent } from "../../lib/report-content.js";
import { renderInlineMarkdown, renderMarkdown } from "../../lib/markdown.jsx";
import { formatRelativeDate } from "../../lib/format.js";
import ArticleDialog from "../feed/ArticleDialog.jsx";
import Modal from "../../components/Modal.jsx";
import EmptyState from "../../components/EmptyState.jsx";
import useAsync from "../../hooks/useAsync.js";
import useCollapsedGroups from "../../hooks/useCollapsedGroups.js";

const KINDS = [
  { key: "weekly", label: "一周速览" },
  { key: "monthly", label: "月度趋势" }
];
const BAR_LIMIT = 8;
// 期刊组 tone 实底色（与 99-tail 的 tone-* 变量一致），供分组构成微条内联着色
const TONE_FILL = { ieee: "#3f5d93", elsevier: "#8a6238", cn: "#3d6e66", other: "#5f6773" };
const PREVIEW_COUNT = 3; // 方向分组内预览的速评卡张数
const VIEW_ALL_LIMIT = 100; // 「查看全部」弹窗拉取上限（与服务端列表上限一致）
const NAME_BY_LABEL = new Map(DIRECTIONS.map((d) => [d.label, d.key]));
const DIRECTION_KEY_SET = new Set(DIRECTIONS.map((d) => d.key));
const CHIP_PREFS_KEY = "reportsChipPrefs";

/** 方向 chips 个性化偏好（拖拽顺序 + 隐藏列表），仅保存在本浏览器。 */
function loadChipPrefs() {
  try {
    const raw = JSON.parse(localStorage.getItem(CHIP_PREFS_KEY) || "null");
    const order = Array.isArray(raw?.order) ? raw.order.filter((key) => DIRECTION_KEY_SET.has(key)) : [];
    const hidden = Array.isArray(raw?.hidden) ? raw.hidden.filter((key) => DIRECTION_KEY_SET.has(key)) : [];
    return { order, hidden };
  } catch {
    return { order: [], hidden: [] };
  }
}

/** 方向分布条：非零方向按篇数降序，超出 BAR_LIMIT 的聚合为一行。 */
function directionBars(stats) {
  const counts = stats?.directionCounts || {};
  const deltas = stats?.directionDelta || {};
  const entries = Object.entries(counts)
    .filter(([, n]) => Number(n) > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([key, n]) => ({ key, count: Number(n), delta: Number(deltas[key] || 0) }));
  if (!entries.length) return [];
  const head = entries.slice(0, BAR_LIMIT);
  const rest = entries.slice(BAR_LIMIT);
  if (rest.length) {
    head.push({
      key: null,
      label: `其余 ${rest.length} 个方向`,
      count: rest.reduce((sum, item) => sum + item.count, 0),
      delta: rest.reduce((sum, item) => sum + item.delta, 0)
    });
  }
  return head;
}

/** 期刊名 → 可点击链接：只在「（…）」括号内整段精确匹配已知期刊名。 */
function linkifyJournals(markdown, journalNames) {
  if (!journalNames?.length || !markdown) return markdown;
  return markdown.replace(/（([^（）]{1,80})）/g, (match, inner) => {
    const trimmed = inner.trim();
    const hit = journalNames.find((name) => trimmed === name || trimmed.startsWith(`${name}，`) || trimmed.startsWith(`${name},`));
    if (!hit) return match;
    const rest = trimmed.slice(hit.length);
    return `（[${hit}](#journal:${encodeURIComponent(hit)})${rest}）`;
  });
}

// parseReportContent 已抽至 ../../lib/report-content.js（2026-10-13）：
// 「卡片阅读」的专题选择与速览页共用解析口径，抽公共模块避免主包静态
// 引用本文件而破坏速览路由的懒加载（Vite chunk 警告 + 首包膨胀）。

/** 三字段速评字段区（研究对象/研究方法/核心结论）。 */
function BriefFields({ brief }) {
  return (
    <span className="reports-brief-fields">
      <span className="reports-brief-field"><span className="k">研究对象</span><span className="v">{brief.object}</span></span>
      <span className="reports-brief-field"><span className="k">研究方法</span><span className="v">{brief.method}</span></span>
      <span className="reports-brief-field"><span className="k">核心结论</span><span className="v">{brief.finding}</span></span>
    </span>
  );
}

/**
 * 三字段结构化速评卡（研究速览 v2）。
 * 配色走期刊组色系（tone-ieee/elsevier/cn/other，与信息流卡片一致），
 * 不随研究方向变色；无 brief（旧格式期数）降级为一行速评 + 「旧格式」角标。
 */
function BriefCard({ id, article, brief, fallbackText, onOpen }) {
  const tone = article ? journalGroup(article.journal) : "";
  const hasBrief = Boolean(brief && brief.object && brief.method && brief.finding);
  const inner = (
    <>
      <span className="reports-brief-head">
        {article ? (
          <>
            <span className="reports-brief-mark">{journalAbbr(article.journal) || (article.journal || "").slice(0, 4)}</span>
            <span className="reports-brief-journal">{article.journal}</span>
            {article.is_read ? <span className="article-status-badge read-badge"><Check size={11} /> 已读</span> : null}
            {article.is_favorite ? <span className="article-status-badge fav-badge"><Star size={11} /> 收藏</span> : null}
            <span className="reports-brief-date">{formatRelativeDate(article.display_date || article.published_at)}</span>
          </>
        ) : (
          <span className="reports-brief-journal">文献 #{id}</span>
        )}
      </span>
      <span className="reports-brief-body">
        {article && (
          <>
            <span className="reports-brief-title">{article.translated_title || article.title}</span>
            {article.title && article.translated_title && article.title !== article.translated_title && (
              <span className="reports-brief-title-en">{article.title}</span>
            )}
          </>
        )}
        {hasBrief ? (
          <BriefFields brief={brief} />
        ) : (
          <span className="reports-brief-legacy">
            {fallbackText || (article ? "" : `文献 #${id}`)}
            <span className="reports-legacy-badge">旧格式</span>
          </span>
        )}
      </span>
      <span className="reports-brief-open" aria-hidden="true">详情 ›</span>
    </>
  );
  const clickable = Boolean(article);
  const className = `reports-brief-card${tone ? ` tone-${tone}` : ""}`;
  return clickable ? (
    <button
      type="button"
      className={className}
      data-article-id={id}
      onClick={() => onOpen(id)}
    >
      {inner}
    </button>
  ) : (
    <div className={`${className} is-fallback`} data-article-id={id}>
      {inner}
    </div>
  );
}

function DirectionBars({ report }) {
  const bars = directionBars(report.stats);
  if (!bars.length) return null;
  const max = Math.max(...bars.map((bar) => bar.count), 1);
  return (
    <>
      <h2 className="reports-sect">方向分布</h2>
      <div className="reports-bars">
        {bars.map((bar) => (
          <div className="reports-bar-row" key={bar.key || "rest"}>
            <span className="reports-bar-name">{bar.key ? directionLabel(bar.key) : bar.label}</span>
            <div className="reports-bar-track">
              <div
                className="reports-bar-fill"
                style={bar.key
                  ? { width: `${Math.max(4, Math.round((bar.count / max) * 100))}%`, "--dir-key": directionVar(bar.key) }
                  : { width: `${Math.max(4, Math.round((bar.count / max) * 100))}%` }}
              />
            </div>
            <span className="reports-bar-val">
              {bar.count}
              {bar.delta !== 0 && (
                <span className={bar.delta > 0 ? "reports-delta up" : "reports-delta down"}>
                  {" "}( {bar.delta > 0 ? "+" : ""}{bar.delta} )
                </span>
              )}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}

/** 方向动态卡片网格（旧格式总览期数仍在用）。 */
function InsightGrid({ insights }) {
  if (!insights.length) return null;
  return (
    <div className="reports-insight-grid">
      {insights.map((insight) => {
        const key = NAME_BY_LABEL.get(insight.name);
        return (
          <div className={`reports-insight-card${key ? " has-direction" : ""}`} key={insight.name} style={key ? { "--dir-key": directionVar(key) } : undefined}>
            <div className="reports-insight-head">
              <span className="reports-dir-dot" style={key ? { "--dir-key": directionVar(key) } : undefined} aria-hidden="true" />
              <span className="reports-insight-name">{insight.name}</span>
              {insight.meta && <span className="reports-insight-meta">{insight.meta}</span>}
            </div>
            <p className="reports-insight-text">{renderInlineMarkdown(insight.text)}</p>
          </div>
        );
      })}
    </div>
  );
}

/** 方向分组手风琴（研究速览 v2 分类浏览核心）：默认全展开，组头可折叠。 */
function DirectionGroup({ group, open, onToggle, onPreviewOpen, onViewAll, onCardRead }) {
  const composition = group.composition || [];
  const compositionTotal = composition.reduce((sum, item) => sum + item.count, 0);
  return (
    <div className={`reports-group${open ? " is-open" : ""}`} style={{ "--dir-key": directionVar(group.key) }}>
      <button type="button" className="reports-group-head" onClick={onToggle} aria-expanded={open}>
        <span className="reports-group-dot" aria-hidden="true" />
        <span className="reports-group-name">{group.label}</span>
        <span className="reports-group-count">
          {group.count} 篇
          {group.delta !== 0 && (
            <span className={group.delta > 0 ? "reports-delta up" : "reports-delta down"}>
              {" "}( {group.delta > 0 ? "+" : ""}{group.delta} )
            </span>
          )}
        </span>
        {composition.length > 0 && compositionTotal > 0 && (
          <span
            className="reports-group-jchips"
            title={`来源期刊：${composition.map((item) => `${item.name} ${item.count}`).join(" · ")}`}
            aria-hidden="true"
          >
            {composition.slice(0, 8).map((item) => (
              <span key={item.name} className={`reports-group-jchip tone-${journalGroup(item.name)}`} title={item.name}>
                <span className="rgj-dot" />
                <span className="rgj-name">{journalAbbr(item.name)}</span>
                <span className="rgj-count">{item.count}</span>
              </span>
            ))}
            {composition.length > 8 && (
              <span className="reports-group-jchip is-more">+{composition.length - 8} 种</span>
            )}
          </span>
        )}
        <span className="reports-group-topic">{group.insight?.text || ""}</span>
        <span className="reports-group-caret" aria-hidden="true">▶</span>
      </button>
      <div className="reports-group-body">
        {group.insight?.text && <p className="reports-group-insight">{renderInlineMarkdown(group.insight.text)}</p>}
        {group.previewItems.length > 0 && (
          <div className="reports-group-cards">
            {group.previewItems.map((item) => (
              <BriefCard
                key={`${group.key}-${item.id}`}
                id={item.id}
                article={item.article}
                brief={item.brief}
                fallbackText={item.fallbackText}
                onOpen={onPreviewOpen}
              />
            ))}
          </div>
        )}
        {!group.report && (
          <p className="reports-group-hint">该方向本期暂无方向专报，可点击上方方向 chips 查看，或直接浏览本期全部文献。</p>
        )}
        <div className="reports-group-foot">
          {(group.report?.stats?.paperBriefs?.length || 0) > 0 && (
            <button type="button" className="reports-group-cardread" onClick={onCardRead}>
              <BookOpenCheck size={13} aria-hidden="true" /> 卡片阅读 · {group.report.stats.paperBriefs.length} 篇
            </button>
          )}
          <button type="button" className="reports-group-more" onClick={onViewAll}>
            查看该方向全部 {group.count} 篇 ›
          </button>
        </div>
      </div>
    </div>
  );
}

/** 通用文献列表弹窗（分组查看全部 / 聚类全部文献 / 主题搜索结果）。 */
function ArticleListDialog({ title, markLabel, subtitle, items, loading, error, onClose, onOpenArticle }) {
  // 左上角类别徽章：有显式类别时完整展示（不截断），否则退回标题前 4 字
  const markText = markLabel || (title ? String(title).slice(0, 4) : "");
  return (
    <Modal open={Boolean(title)} onClose={onClose} labelledBy="article-list-dialog-title" className="journal-dialog">
      <div className="journal-dialog-head">
        <span className={`journal-dialog-mark${markLabel ? " is-full" : ""}`}>{markText}</span>
        <div className="journal-dialog-title-wrap">
          <h3 id="article-list-dialog-title">{title}</h3>
          <p>{loading ? "正在加载…" : (subtitle || `${items.length} 篇`)}</p>
        </div>
        <button type="button" className="journal-dialog-close" onClick={onClose} aria-label="关闭"><X size={16} /></button>
      </div>
      <div className="journal-dialog-body">
        {error && <p className="journal-dialog-msg">加载失败：{error}</p>}
        {!loading && !error && !items.length && <p className="journal-dialog-msg">暂无文献。</p>}
        {items.map((item) => {
          const article = item.article;
          const direction = article?.research_direction || "";
          const tone = article?.journal ? journalGroup(article.journal) : "";
          return (
            <button
              key={item.id}
              type="button"
              className={`journal-article-row${direction ? " has-direction" : ""}`}
              style={direction ? { "--dir-key": directionVar(direction) } : undefined}
              disabled={!article}
              onClick={() => article && onOpenArticle(article)}
            >
              <span className="journal-article-title">
                {article?.journal && (
                  <span className={`journal-article-journal${tone ? ` tone-${tone}` : ""}`} title={article.journal}>
                    {article.journal}
                  </span>
                )}
                {article ? (article.translated_title || article.title) : (item.fallback || `文献 #${item.id}`)}
              </span>
              <span className="journal-article-meta">
                {direction && <span className="journal-article-dot" aria-hidden="true" />}
                <span>{direction ? directionLabel(direction) : "未标注方向"}</span>
                {article?.is_read ? <span className="article-status-badge read-badge"><Check size={11} /> 已读</span> : null}
                {article?.is_favorite ? <span className="article-status-badge fav-badge"><Star size={11} /> 收藏</span> : null}
                {article && <span>{formatRelativeDate(article.display_date || article.published_at)}</span>}
              </span>
            </button>
          );
        })}
      </div>
    </Modal>
  );
}

/** 期刊文献卡片弹窗（S3：数据三态走 useAsync/AsyncState 同一套）。 */
function JournalArticlesDialog({ journalName, onClose, onOpenArticle }) {
  const { data, loading, error, reload } = useAsync(
    () => (journalName
      ? api.get(`/api/articles?journal=${encodeURIComponent(journalName)}&sort=desc&limit=12`)
      : Promise.resolve({ articles: [], total: 0 })),
    [journalName]
  );
  const articles = data?.articles || [];
  const total = data?.total || 0;

  return (
    <Modal open={Boolean(journalName)} onClose={onClose} labelledBy="journal-dialog-title" className="journal-dialog">
      <div className="journal-dialog-head">
        <span className="journal-dialog-mark">{journalAbbr(journalName) || (journalName || "").slice(0, 4)}</span>
        <div className="journal-dialog-title-wrap">
          <h3 id="journal-dialog-title">{journalName}</h3>
          <p>{loading ? "正在加载最新文献…" : `共收录 ${total} 篇 · 最近 12 篇`}</p>
        </div>
        <button type="button" className="journal-dialog-close" onClick={onClose} aria-label="关闭"><X size={16} /></button>
      </div>
      <div className="journal-dialog-body">
        {loading ? (
          <div className="journal-dialog-loading" role="status" aria-live="polite">
            <span className="skeleton" style={{ height: 14, marginBottom: 10 }} />
            <span className="skeleton" style={{ height: 14, marginBottom: 10 }} />
            <span className="skeleton" style={{ height: 14, width: "60%" }} />
          </div>
        ) : error ? (
          <div className="journal-dialog-msg" role="alert">
            加载失败：{error}
            <button className="secondary compact" type="button" onClick={reload} style={{ marginLeft: 10 }}>重试</button>
          </div>
        ) : !articles.length ? (
          <p className="journal-dialog-msg">该刊暂无入库文献。</p>
        ) : (
          articles.map((article) => {
            const direction = article.research_direction || "";
            return (
              <button
                key={article.id}
                type="button"
                className={`journal-article-row${direction ? " has-direction" : ""}`}
                style={direction ? { "--dir-key": directionVar(direction) } : undefined}
                onClick={() => onOpenArticle(article)}
              >
                <span className="journal-article-title">{article.translated_title || article.title}</span>
                <span className="journal-article-meta">
                  {direction && <span className="journal-article-dot" aria-hidden="true" />}
                  <span>{direction ? directionLabel(direction) : "未标注方向"}</span>
                  <span>{formatRelativeDate(article.display_date || article.published_at)}</span>
                </span>
              </button>
            );
          })
        )}
      </div>
    </Modal>
  );
}

function ReportsView({ canPersonalize, markRead, toggleFavorite, onArticleUpdated, canModerate = false }) {
  const [kind, setKind] = useState("weekly");
  const [lists, setLists] = useState({ weekly: [], monthly: [] });
  const [selectedPeriod, setSelectedPeriod] = useState({ weekly: null, monthly: null });
  const [selectedDirection, setSelectedDirection] = useState({ weekly: null, monthly: null });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [articleMap, setArticleMap] = useState(new Map());
  const [dialogArticle, setDialogArticle] = useState(null);
  const [loadingArticle, setLoadingArticle] = useState(false);
  const [journalName, setJournalName] = useState(null);
  const [journalNames, setJournalNames] = useState([]);
  const [listDialog, setListDialog] = useState(null); // {title, subtitle, items, loading, error}
  // 研究速览 v2：当前期数详情（总览 + 全部方向专报）按需懒加载
  const [periodDetails, setPeriodDetails] = useState({ overview: null, dirs: new Map() });
  const [loadingDetail, setLoadingDetail] = useState(false);
  // 折叠分组（S4：与文献库筛选面板、期刊小节共用 useCollapsedGroups）
  const { collapsed: collapsedGroups, toggle: toggleGroup, setCollapsed: setCollapsedGroups } = useCollapsedGroups();
  const { collapsed: collapsedClusters, toggle: toggleCluster, setCollapsed: setCollapsedClusters } = useCollapsedGroups();
  // 聚类组内速评卡「默认一行、按需加载全部」（需求）：记录用户点了
  // 「继续加载全部」的组名；未点过的组只渲染前 3 条（宽屏一行）。
  const [expandedClusterReviews, setExpandedClusterReviews] = useState(() => new Set());
  // 方向 chips 个性化：拖拽排序 + 隐藏不关心的方向（localStorage 持久化）
  const [chipPrefs, setChipPrefs] = useState(loadChipPrefs);
  const [chipPanelOpen, setChipPanelOpen] = useState(false);
  const [dragKey, setDragKey] = useState(null);
  // 来源期刊筛选（仅方向专报态）：按「类型|期数|方向」逐报告独立记忆，仅保留在本次会话内存中
  const [hiddenJournalsByReport, setHiddenJournalsByReport] = useState({});

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError("");
    // v2：列表走轻量行（无 content_md/paperBriefs），详情经 /api/reports/detail 懒加载
    Promise.all([
      api.get("/api/reports?kind=weekly&limit=200"),
      api.get("/api/reports?kind=monthly&limit=200"),
      api.get("/api/journals")
    ]).then(([weekly, monthly, journals]) => {
      if (cancelled) return;
      setLists({ weekly: weekly.reports || [], monthly: monthly.reports || [] });
      setJournalNames((journals || []).map((journal) => journal.name).filter(Boolean));
    }).catch((error) => {
      if (!cancelled) setLoadError(error.message);
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  const kindReports = lists[kind];
  const periods = useMemo(() => {
    const seen = new Map();
    for (const report of kindReports) {
      if (!seen.has(report.period_start)) {
        seen.set(report.period_start, { periodStart: report.period_start, periodEnd: report.period_end, total: 0 });
      }
      seen.get(report.period_start).total += 1;
    }
    return [...seen.values()];
  }, [kindReports]);

  const activePeriod = selectedPeriod[kind] ?? periods[0]?.periodStart ?? null;
  const activePeriodEnd = periods.find((period) => period.periodStart === activePeriod)?.periodEnd || "";
  const overviewMeta = useMemo(
    () => kindReports.find((report) => report.period_start === activePeriod && report.direction == null) || null,
    [kindReports, activePeriod]
  );

  const directionChips = useMemo(() => {
    const counts = overviewMeta?.stats?.directionCounts
      || Object.fromEntries(
        kindReports
          .filter((report) => report.period_start === activePeriod && report.direction)
          .map((report) => [report.direction, 1])
      );
    const deltas = overviewMeta?.stats?.directionDelta || {};
    return Object.entries(counts)
      .filter(([key, n]) => Number(n) > 0 || kindReports.some((r) => r.period_start === activePeriod && r.direction === key))
      .sort((a, b) => b[1] - a[1])
      .map(([key, n]) => ({ key, count: Number(n), delta: Number(deltas[key] || 0) }));
  }, [overviewMeta, kindReports, activePeriod]);

  // 应用个性化：隐藏过滤 + 自定义顺序优先（未自定义的方向按篇数降序排在末尾）
  const visibleChips = useMemo(() => {
    const rank = new Map(chipPrefs.order.map((key, index) => [key, index]));
    return directionChips
      .filter((chip) => !chipPrefs.hidden.includes(chip.key))
      .sort((a, b) => {
        const ra = rank.has(a.key) ? rank.get(a.key) : Number.MAX_SAFE_INTEGER;
        const rb = rank.has(b.key) ? rank.get(b.key) : Number.MAX_SAFE_INTEGER;
        if (ra !== rb) return ra - rb;
        return b.count - a.count;
      });
  }, [directionChips, chipPrefs]);

  useEffect(() => {
    try { localStorage.setItem(CHIP_PREFS_KEY, JSON.stringify(chipPrefs)); } catch { /* ignore */ }
  }, [chipPrefs]);

  // 期数/类型切换 → 懒加载该期总览 + 全部方向专报（detail 接口一次批量）
  useEffect(() => {
    if (!activePeriod) return undefined;
    let cancelled = false;
    setLoadingDetail(true);
    setPeriodDetails({ overview: null, dirs: new Map() });
    setCollapsedGroups(new Set());
    const keys = Object.entries(overviewMeta?.stats?.directionCounts || {})
      .filter(([, n]) => Number(n) > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([key]) => key);
    const periodQuery = `kind=${kind}&period_start=${encodeURIComponent(activePeriod)}`;
    Promise.all([
      overviewMeta ? api.get(`/api/reports/detail?${periodQuery}`) : Promise.resolve({ report: null }),
      api.get(`/api/reports/detail?${periodQuery}&directions=${keys.join(",")}`)
    ]).then(([overview, bundle]) => {
      if (cancelled) return;
      setPeriodDetails({
        overview: overview.report || null,
        dirs: new Map((bundle.reports || []).map((report) => [report.direction, report]))
      });
    }).catch(() => {
      if (!cancelled) setPeriodDetails({ overview: null, dirs: new Map() });
    }).finally(() => {
      if (!cancelled) setLoadingDetail(false);
    });
    return () => { cancelled = true; };
  }, [kind, activePeriod, overviewMeta]);

  const activeDirection = selectedDirection[kind] ?? null;
  const current = activeDirection === null
    ? periodDetails.overview
    : (periodDetails.dirs.get(activeDirection) || null);

  const parsed = useMemo(() => parseReportContent(current?.content_md || ""), [current]);

  // 当前视图可用 brief：总览 = 总览精选 brief + 各方向专报 brief；方向 = 该专报 brief
  const briefById = useMemo(() => {
    const map = new Map();
    for (const brief of current?.stats?.paperBriefs || []) map.set(brief.id, brief);
    if (activeDirection === null) {
      for (const report of periodDetails.dirs.values()) {
        for (const brief of report.stats?.paperBriefs || []) {
          if (!map.has(brief.id)) map.set(brief.id, brief);
        }
      }
    }
    return map;
  }, [current, periodDetails, activeDirection]);

  // 方向分组（总览态分类浏览核心）——跟随 chips 个性化（隐藏的方向不分组显示）
  const groups = useMemo(() => {
    if (activeDirection !== null) return [];
    return visibleChips.map((chip) => {
      const report = periodDetails.dirs.get(chip.key) || null;
      const label = directionLabel(chip.key);
      const insight = parsed.insights.find((item) => item.name === label) || null;
      const briefs = (report?.stats?.paperBriefs || []).slice(0, PREVIEW_COUNT);
      const legacyReviews = briefs.length
        ? []
        : (report ? parseReportContent(report.content_md).reviews.slice(0, PREVIEW_COUNT) : []);
      const previewItems = [
        ...briefs.map((brief) => ({ id: brief.id, brief, article: articleMap.get(brief.id) || null, fallbackText: "" })),
        ...legacyReviews.map((review) => ({ id: review.id, brief: null, article: articleMap.get(review.id) || null, fallbackText: review.text }))
      ];
      // 甲-4：来源构成——按该方向全部 briefs 的期刊聚合（articleMap 已由 refIds 分批拉全）
      const compositionCounts = new Map();
      for (const brief of report?.stats?.paperBriefs || []) {
        const name = String(articleMap.get(brief.id)?.journal || "").trim();
        if (!name) continue;
        compositionCounts.set(name, (compositionCounts.get(name) || 0) + 1);
      }
      const composition = [...compositionCounts.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
      return { ...chip, label, report, insight, previewItems, composition };
    });
  }, [activeDirection, visibleChips, periodDetails, parsed, articleMap]);

  // 当前报告引用的全部文献 id（精选 + 速评 + 聚类 + 分组预览 + 分组全部 briefs，
  // 后者供总览「来源构成」微条聚合）→ 分批批量取元数据；上限 300 兜底。
  const refIds = useMemo(() => {
    const ids = new Set(current?.stats?.highlightIds || []);
    for (const review of parsed.reviews) ids.add(review.id);
    for (const cluster of parsed.clusters) for (const review of cluster.reviews) ids.add(review.id);
    for (const group of groups) {
      for (const item of group.previewItems) ids.add(item.id);
      for (const brief of group.report?.stats?.paperBriefs || []) ids.add(brief.id);
    }
    return [...ids].filter((id) => Number.isInteger(id) && id > 0).slice(0, 300);
  }, [current, parsed, groups]);

  useEffect(() => {
    if (!refIds.length) { setArticleMap(new Map()); return undefined; }
    let cancelled = false;
    // 分批（每批 ≤100，与服务端上限一致）；总览分组构成需要全量 briefs 的期刊
    const chunks = [];
    for (let index = 0; index < refIds.length; index += 100) chunks.push(refIds.slice(index, index + 100));
    Promise.all(chunks.map((ids) => api.get(`/api/articles?ids=${ids.join(",")}&limit=100`))).then((results) => {
      if (cancelled) return;
      const map = new Map();
      for (const data of results) for (const article of data.articles || []) map.set(article.id, article);
      setArticleMap(map);
    }).catch(() => {
      if (!cancelled) setArticleMap(new Map());
    });
    return () => { cancelled = true; };
  }, [refIds.join("|")]);

  // 卡片阅读（2026-10-13）：分组 / 方向专报 → 全屏逐条阅读（含速评、支持跳过已读）
  const [cardReader, setCardReader] = useState(null);
  function openGroupReader(group) {
    const briefs = group.report?.stats?.paperBriefs || [];
    if (!briefs.length) return;
    setCardReader({
      title: `${group.label} · ${kind === "weekly" ? "周报" : "月报"} ${group.report.period_start}`,
      ids: briefs.map((brief) => brief.id),
      briefs
    });
  }
  // 主题聚类（专题）级卡片阅读（2026-10-13 用户需求）：读该聚类下的全部速评文献
  function openClusterReader(cluster, reviewIds) {
    if (!reviewIds.length) return;
    const idSet = new Set(reviewIds);
    const briefs = (current?.stats?.paperBriefs || []).filter((brief) => idSet.has(brief.id));
    setCardReader({
      title: `${directionLabel(current.direction)} · ${cluster.name} · ${kind === "weekly" ? "周报" : "月报"} ${current.period_start}`,
      ids: reviewIds,
      briefs
    });
  }
  function openDirectionReader(report) {
    const briefs = report?.stats?.paperBriefs || [];
    if (!briefs.length) return;
    setCardReader({
      title: `${directionLabel(report.direction)} · ${kind === "weekly" ? "周报" : "月报"} ${report.period_start}`,
      ids: briefs.map((brief) => brief.id),
      briefs
    });
  }

  function switchKind(nextKind) {
    setKind(nextKind);
    setSelectedDirection((currentValue) => ({ ...currentValue, [nextKind]: null }));
  }

  function handleReportClick(event) {
    const anchor = event.target.closest("a");
    if (anchor) {
      const href = anchor.getAttribute("href") || "";
      if (href.startsWith("#journal:")) {
        event.preventDefault();
        setJournalName(decodeURIComponent(href.slice("#journal:".length)));
        return;
      }
    }
    const card = event.target.closest("[data-article-id]");
    if (card) {
      const id = Number(card.getAttribute("data-article-id"));
      if (Number.isInteger(id) && id > 0 && card.tagName !== "DIV") openArticleById(id);
    }
  }

  function openArticleById(id) {
    if (!id || loadingArticle) return;
    setLoadingArticle(true);
    api.get(`/api/articles/${id}`).then((article) => {
      setDialogArticle(article);
    }).catch(() => {}).finally(() => setLoadingArticle(false));
  }

  // 全部折叠/展开：只要有任一组打开就折叠全部，全关时才展开全部（避免手工折叠一组后按钮语义翻转）。
  const anyGroupOpen = groups.some((group) => !collapsedGroups.has(group.key));
  function toggleAllGroups() {
    setCollapsedGroups(() => (anyGroupOpen ? new Set(groups.map((group) => group.key)) : new Set()));
  }

  // 主题聚类（方向/月度专报）：同一套全部折叠/展开交互，切换报告时重置为全展开；
  // 组内速评卡的「继续加载」状态同步重置（新报告重新从一行开始）。
  useEffect(() => {
    setCollapsedClusters(new Set());
    setExpandedClusterReviews(new Set());
  }, [current?.id]);
  const anyClusterOpen = parsed.clusters.some((cluster) => !collapsedClusters.has(cluster.name));
  function toggleAllClusters() {
    setCollapsedClusters(() => (anyClusterOpen ? new Set(parsed.clusters.map((cluster) => cluster.name)) : new Set()));
  }

  // 方向 chips：拖拽排序 / 隐藏 / 恢复 / 重置
  const hiddenChips = directionChips.filter((chip) => chipPrefs.hidden.includes(chip.key));
  function handleChipDrop(targetKey) {
    if (!dragKey || dragKey === targetKey) return;
    const keys = visibleChips.map((chip) => chip.key);
    const from = keys.indexOf(dragKey);
    const to = keys.indexOf(targetKey);
    if (from < 0 || to < 0) return;
    keys.splice(to, 0, keys.splice(from, 1)[0]);
    setChipPrefs((prev) => ({ ...prev, order: keys }));
    setDragKey(null);
  }
  function hideChip(key) {
    setChipPrefs((prev) => (prev.hidden.includes(key) ? prev : { ...prev, hidden: [...prev.hidden, key] }));
  }
  function restoreChip(key) {
    setChipPrefs((prev) => ({ ...prev, hidden: prev.hidden.filter((item) => item !== key) }));
  }
  function resetChipPrefs() {
    setChipPrefs({ order: [], hidden: [] });
    setChipPanelOpen(false);
  }

  function openGroupAll(group) {
    const groupTitle = `${group.label} · 本期全部文献`;
    setListDialog({
      title: groupTitle,
      markLabel: group.label,
      subtitle: "正在加载…",
      items: [],
      loading: true,
      error: ""
    });
    const query = `direction=${encodeURIComponent(group.key)}&from=${encodeURIComponent(activePeriod)}&to=${encodeURIComponent(activePeriodEnd)}&sort=desc&limit=${VIEW_ALL_LIMIT}`;
    api.get(`/api/articles?${query}`).then((data) => {
      setListDialog({
        title: groupTitle,
        markLabel: group.label,
        subtitle: `${data.total || 0} 篇（${activePeriod} ~ ${activePeriodEnd}，按首次公开倒序）`,
        items: (data.articles || []).map((article) => ({ id: article.id, article, fallback: "" })),
        loading: false,
        error: ""
      });
    }).catch((e) => {
      setListDialog({
        title: groupTitle,
        markLabel: group.label,
        subtitle: "",
        items: [],
        loading: false,
        error: e.message
      });
    });
  }

  function openTopic(topic) {
    const keyword = topic.replace(/\(.*?\)/g, "").trim();
    if (!keyword) return;
    setListDialog({ title: `「${keyword}」搜索结果`, markLabel: "主题检索", subtitle: "正在搜索…", items: [], loading: true, error: "" });
    api.get(`/api/articles?q=${encodeURIComponent(keyword)}&sort=desc&limit=20`).then((data) => {
      setListDialog({
        title: `「${keyword}」搜索结果`,
        markLabel: "主题检索",
        subtitle: `${data.total || 0} 篇（按首次公开倒序，前 20）`,
        items: (data.articles || []).map((article) => ({ id: article.id, article, fallback: "" })),
        loading: false,
        error: ""
      });
    }).catch((e) => {
      setListDialog({ title: `「${keyword}」搜索结果`, markLabel: "主题检索", subtitle: "", items: [], loading: false, error: e.message });
    });
  }

  const parsedWithJournals = useMemo(() => {
    const linkReview = (review) => ({ ...review, text: linkifyJournals(review.text, journalNames) });
    return {
      ...parsed,
      insights: parsed.insights.map((insight) => ({ ...insight, text: linkifyJournals(insight.text, journalNames) })),
      reviews: parsed.reviews.map(linkReview),
      clusters: parsed.clusters.map((cluster) => ({
        ...cluster,
        reviews: cluster.reviews.map(linkReview)
      })),
      textCards: parsed.textCards.map((card) => ({ ...card, body: linkifyJournals(card.body, journalNames) }))
    };
  }, [parsed, journalNames]);

  const isOverview = activeDirection === null;
  // 旧格式总览期数（无任何方向专报）：保留 v1「各方向动态」卡片网格
  const showInsightGrid = isOverview && periodDetails.dirs.size === 0 && parsedWithJournals.insights.length > 0;
  const nonPickReviews = parsedWithJournals.reviews.filter((review) => !review.pick);

  // ── 来源期刊筛选（仅方向专报态；口径 = 报告引用的全部文献，与页面卡片一一对应）──
  const reportFilterKey = current ? `${current.kind}|${current.period_start}|${current.direction || "overview"}` : "";
  const journalEntries = useMemo(
    () => (isOverview ? [] : journalEntriesFromIds(refIds, articleMap)),
    [isOverview, refIds, articleMap]
  );
  const hiddenJournalSet = useMemo(
    () => new Set(hiddenJournalsByReport[reportFilterKey] || []),
    [hiddenJournalsByReport, reportFilterKey]
  );
  // 被隐藏期刊命中的文献 id；无元数据/未知期刊的卡片永不隐藏
  const filteredOutIds = useMemo(
    () => (isOverview ? new Set() : hiddenIdsForJournals(refIds, articleMap, hiddenJournalSet)),
    [isOverview, refIds, articleMap, hiddenJournalSet]
  );
  const hiddenJournalCount = journalEntries.filter((entry) => hiddenJournalSet.has(entry.name)).length;
  const visibleNonPick = nonPickReviews.filter((review) => !filteredOutIds.has(review.id));
  function toggleJournalFilter(name) {
    if (!reportFilterKey) return;
    setHiddenJournalsByReport((prev) => {
      const list = prev[reportFilterKey] || [];
      const next = name === null ? [] : (list.includes(name) ? list.filter((item) => item !== name) : [...list, name]);
      return { ...prev, [reportFilterKey]: next };
    });
  }

  // 注意：intro 段落框已按需求移除，因此不计入「有内容」——否则只剩导语时会渲染成一片空白。
  // highlightIds 不再计入「有内容」：对应板块已下线（2026-10-13），否则只剩精选的期数会渲染成空白。
  const hasAnyContent = Boolean(
    current && (parsed.insights.length || nonPickReviews.length || parsed.clusters.length
      || parsed.keywords || parsed.textCards.length || groups.length
      || (isOverview && directionBars(current.stats).length))
  );

  return (
    <section className="reports-view" aria-labelledby="reports-title">
      <CardReader
        open={Boolean(cardReader)}
        onClose={() => setCardReader(null)}
        title={cardReader?.title || ""}
        ids={cardReader?.ids || []}
        briefs={cardReader?.briefs || []}
        canPersonalize={canPersonalize}
        onArticleUpdated={onArticleUpdated}
      />
      <div className="reports-head">
        <div className="reports-head-main">
          <h1 id="reports-title">
            研究速览
            <span className="reports-head-badge"><Sparkles size={12} aria-hidden="true" /> AI 生成</span>
          </h1>
          <p className="reports-head-hint">智能体基于当期入库文献自动生成 · 数字取自数据库统计 · 三字段速评卡/期刊名/主题词均可点击交互</p>
        </div>
        <div className="reports-tabs" role="tablist">
          {KINDS.map((item) => (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={kind === item.key}
              className={`reports-tab${kind === item.key ? " on" : ""}`}
              onClick={() => switchKind(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <p className="reports-loading">正在加载研究速览…</p>
      ) : loadError ? (
        <EmptyState icon={CalendarRange} title="研究速览加载失败" description={loadError} />
      ) : !periods.length ? (
        <EmptyState
          icon={CalendarRange}
          art="reports"
          title="AI 速览生成中"
          description="第一份速览将在每周日晚由 AI 作业生成并自动入库，届时无需刷新即可查看。"
        />
      ) : (
        <>
          <div className="reports-toolbar">
            <div className="reports-toolbar-row">
              <label className="reports-period-select">
                <CalendarRange size={14} aria-hidden="true" />
                <select
                  value={activePeriod || ""}
                  onChange={(event) => setSelectedPeriod((currentValue) => ({ ...currentValue, [kind]: event.target.value }))}
                >
                  {periods.map((period) => (
                    <option key={period.periodStart} value={period.periodStart}>
                      {period.periodStart} ~ {period.periodEnd}（{period.total} 份报告）
                    </option>
                  ))}
                </select>
                <ChevronDown size={13} aria-hidden="true" />
              </label>
            </div>
            <div className="reports-dir-row">
              <div className="reports-dir-chips" role="tablist" aria-label="研究方向切换">
                <button
                  type="button"
                  role="tab"
                  aria-selected={isOverview}
                  className={`reports-dir-chip overview${isOverview ? " on" : ""}`}
                  onClick={() => setSelectedDirection((currentValue) => ({ ...currentValue, [kind]: null }))}
                >
                  总览
                </button>
                {visibleChips.map((chip) => {
                  const available = periodDetails.dirs.has(chip.key) || chip.key === activeDirection;
                  const active = activeDirection === chip.key;
                  return (
                    <span
                      key={chip.key}
                      className={`reports-dir-chip-wrap${dragKey === chip.key ? " is-dragging" : ""}`}
                      draggable
                      onDragStart={() => setDragKey(chip.key)}
                      onDragEnd={() => setDragKey(null)}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => { event.preventDefault(); handleChipDrop(chip.key); }}
                    >
                      <button
                        type="button"
                        role="tab"
                        aria-selected={active}
                        disabled={!available}
                        className={`reports-dir-chip${active ? " on" : ""}`}
                        style={active ? { "--dir-key": directionVar(chip.key) } : undefined}
                        title={`${directionLabel(chip.key)} · 本期 ${chip.count} 篇${available ? "" : "（本期暂无方向专报）"}｜拖拽可调整顺序`}
                        onClick={() => setSelectedDirection((currentValue) => ({ ...currentValue, [kind]: chip.key }))}
                      >
                        <GripVertical className="reports-dir-grip" size={12} aria-hidden="true" />
                        <span className="reports-dir-dot" style={{ "--dir-key": directionVar(chip.key) }} aria-hidden="true" />
                        {directionLabel(chip.key)}
                        <span className="reports-dir-count">{chip.count}</span>
                      </button>
                      <button
                        type="button"
                        className="reports-dir-chip-hide"
                        aria-label={`隐藏方向 ${directionLabel(chip.key)}`}
                        title={`隐藏「${directionLabel(chip.key)}」（可在「管理方向」恢复）`}
                        onClick={() => hideChip(chip.key)}
                      >
                        <X size={10} aria-hidden="true" />
                      </button>
                    </span>
                  );
                })}
              </div>
              <button
                type="button"
                className={`reports-dir-manage-toggle${chipPanelOpen ? " on" : ""}`}
                aria-expanded={chipPanelOpen}
                onClick={() => setChipPanelOpen((value) => !value)}
              >
                <Settings2 size={13} aria-hidden="true" />
                管理方向
                {hiddenChips.length > 0 && <span className="reports-dir-manage-badge">{hiddenChips.length}</span>}
              </button>
            </div>
            {chipPanelOpen && (
              <div className="reports-dir-manage">
                <div className="reports-dir-manage-head">
                  <strong>自定义方向显示</strong>
                  <span>拖拽 chips 调整顺序 · 点 × 隐藏不关心的方向 · 未自定义时按本期文献篇数降序 · 偏好仅保存在本机浏览器</span>
                </div>
                {hiddenChips.length > 0 ? (
                  <div className="reports-dir-manage-row">
                    <span className="reports-dir-manage-label">已隐藏 {hiddenChips.length} 个方向：</span>
                    {hiddenChips.map((chip) => (
                      <button
                        key={chip.key}
                        type="button"
                        className="reports-dir-restore"
                        style={{ "--dir-key": directionVar(chip.key) }}
                        title={`恢复显示「${directionLabel(chip.key)}」`}
                        onClick={() => restoreChip(chip.key)}
                      >
                        <Plus size={11} aria-hidden="true" />
                        {directionLabel(chip.key)}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="reports-dir-manage-empty">暂无隐藏方向。点任意方向 chip 上的 × 即可隐藏，不关心的方向不会再出现在切换栏与分组浏览中。</p>
                )}
                <div className="reports-dir-manage-foot">
                  <button type="button" className="reports-dir-reset" onClick={resetChipPrefs}>
                    <RotateCcw size={12} aria-hidden="true" />
                    恢复默认（顺序 + 显示全部）
                  </button>
                </div>
              </div>
            )}
          </div>

          {loadingDetail ? (
            <p className="reports-loading">正在加载本期报告…</p>
          ) : !current ? (
            <EmptyState
              icon={CalendarRange}
              art="reports"
              title={`${activeDirection ? directionLabel(activeDirection) : "该期"}暂无报告`}
              description={activeDirection
                ? "该方向本期未生成专报，可切回「总览」按方向分组浏览全部文献。"
                : "该期暂无总览报告。"}
            />
          ) : (
            <div className="reports-main reports-main--wide" onClick={handleReportClick}>
              <div className="reports-meta">
                {current.direction ? (
                  <span className="reports-meta-direction" style={{ "--dir-key": directionVar(current.direction) }}>
                    {directionLabel(current.direction)}专报
                  </span>
                ) : (
                  <span className="reports-meta-direction overview">全方向总览</span>
                )}
                <span>本期 <strong>{current.period_start} ~ {current.period_end}</strong></span>
                {typeof current.stats?.total === "number" && (
                  <span>收录 <strong>{current.stats.total}</strong> 篇
                    {typeof current.stats?.previous?.total === "number" && (
                      <span className={current.stats.total >= current.stats.previous.total ? "reports-delta up" : "reports-delta down"}>
                        {" "}（上期 {current.stats.previous.total} 篇）
                      </span>
                    )}
                  </span>
                )}
                {!!current.stats?.unclassified && <span>其中 <strong>{current.stats.unclassified}</strong> 篇待方向标注</span>}
                <span>生成时间 {String(current.generated_at || "").slice(0, 10)}</span>
                {!isOverview && (current.stats?.paperBriefs?.length || 0) > 0 && (
                  <button type="button" className="reports-cardread-btn" onClick={() => openDirectionReader(current)}>
                    <BookOpenCheck size={13} aria-hidden="true" /> 卡片阅读 · {current.stats.paperBriefs.length} 篇
                  </button>
                )}
                {!isOverview && journalEntries.length > 0 && (
                  <div className="reports-meta-journals" role="group" aria-label="来源期刊筛选">
                    <span className="reports-meta-journals-label">
                      来源期刊<span className="reports-meta-journals-count">（{journalEntries.length} 种）</span>
                    </span>
                    {journalEntries.map(({ name, count }) => {
                      const off = hiddenJournalSet.has(name);
                      return (
                        <button
                          key={name}
                          type="button"
                          className={`reports-journal-chip tone-${journalGroup(name)}${off ? " is-off" : ""}`}
                          aria-pressed={!off}
                          title={off ? `已隐藏，点击恢复「${name}」的文献` : `点击隐藏「${name}」的文献`}
                          onClick={() => toggleJournalFilter(name)}
                        >
                          <span className="reports-journal-mark" aria-hidden="true">{journalAbbr(name)}</span>
                          <span className="reports-journal-name">{name}</span>
                          <span className="reports-journal-count">{count} 篇</span>
                        </button>
                      );
                    })}
                    <span className="reports-meta-journals-status">
                      {hiddenJournalCount > 0 ? (
                        <>
                          <span>已隐藏 <strong>{hiddenJournalCount}</strong> 种 · <strong>{filteredOutIds.size}</strong> 篇</span>
                          <button type="button" className="reports-journal-reset" onClick={() => toggleJournalFilter(null)}>
                            全部显示
                          </button>
                        </>
                      ) : (
                        <span className="reports-meta-journals-tip">点击期刊可隐藏其文献</span>
                      )}
                    </span>
                  </div>
                )}
              </div>

              {isOverview && <DirectionBars report={current} />}

              {/* 「本周/本期值得注意」板块已下线（2026-10-13 用户需求）：AI 整理与前端展示均不再产出 */}

              {isOverview && groups.length > 0 && (
                <>
                  <div className="reports-groups-bar">
                    <h2 className="reports-sect">
                      方向分组浏览
                      <span className="reports-sect-hint">每周每种研究方向分类归组 · 点击组头展开/收起 · 「查看全部」列出该方向本期全部文献</span>
                    </h2>
                    <button type="button" className="reports-groups-toggle" onClick={toggleAllGroups}>
                      {anyGroupOpen ? "全部折叠" : "全部展开"}
                    </button>
                  </div>
                  <div className="reports-groups">
                    {groups.map((group) => (
                      <DirectionGroup
                        key={group.key}
                        group={group}
                        open={!collapsedGroups.has(group.key)}
                        onToggle={() => toggleGroup(group.key)}
                        onPreviewOpen={openArticleById}
                        onViewAll={() => openGroupAll(group)}
                        onCardRead={() => openGroupReader(group)}
                      />
                    ))}
                  </div>
                </>
              )}

              {showInsightGrid && (
                <>
                  <h2 className="reports-sect">各方向动态</h2>
                  <InsightGrid insights={parsedWithJournals.insights} />
                </>
              )}

              {!isOverview && parsed.clusters.length > 0 && (
                <>
                  <div className="reports-groups-bar">
                    <h2 className="reports-sect">
                      主题聚类速评
                      <span className="reports-sect-hint">本期该方向的全部主题聚类 · 点击聚类头展开/收起 · 默认全部展开</span>
                    </h2>
                    <button type="button" className="reports-groups-toggle" onClick={toggleAllClusters}>
                      {anyClusterOpen ? "全部折叠" : "全部展开"}
                    </button>
                  </div>
                  <div className="reports-clusters">
                    {parsedWithJournals.clusters.map((cluster) => {
                      const open = !collapsedClusters.has(cluster.name);
                      // 来源期刊筛选在「一行/全部」切片之前生效（「继续加载」的计数也是过滤后的）；
                      // 组内速评卡默认只渲染一行（前 3 条），点「继续加载」看全部。
                      const remainingReviews = cluster.reviews.filter((review) => !filteredOutIds.has(review.id));
                      const hiddenReviewCount = cluster.reviews.length - remainingReviews.length;
                      const reviewsExpanded = expandedClusterReviews.has(cluster.name);
                      const visibleReviews = reviewsExpanded ? remainingReviews : remainingReviews.slice(0, 3);
                      const moreCount = remainingReviews.length - visibleReviews.length;
                      return (
                        <div className={`reports-cluster${open ? " is-open" : ""}`} key={cluster.name}>
                          <button
                            type="button"
                            className="reports-cluster-head"
                            onClick={() => toggleCluster(cluster.name)}
                            aria-expanded={open}
                            title={open ? `收起「${cluster.name}」` : `展开「${cluster.name}」全部 ${cluster.reviews.length} 条速评`}
                          >
                            <span className="reports-cluster-caret" aria-hidden="true">▶</span>
                            <span className="reports-cluster-name">{cluster.name}</span>
                            <span className="reports-cluster-meta">
                              {cluster.reviews.length} 条速评
                              {hiddenReviewCount > 0 && <> · <em className="reports-cluster-hidden">已隐藏 {hiddenReviewCount} 条</em></>}
                              {" · "}{open ? "点击收起" : "点击展开"}
                            </span>
                          </button>
                          <div className="reports-cluster-body">
                            {remainingReviews.length > 0 ? (
                              <div className="reports-brief-grid">
                                {visibleReviews.map((review) => (
                                  <BriefCard
                                    key={review.id}
                                    id={review.id}
                                    article={articleMap.get(review.id) || null}
                                    brief={briefById.get(review.id) || null}
                                    fallbackText={review.text}
                                    onOpen={openArticleById}
                                  />
                                ))}
                              </div>
                            ) : (
                              <p className="reports-filter-hint">本聚类 {cluster.reviews.length} 条速评已按「来源期刊」筛选隐藏，点信息条期刊 chip 或「全部显示」即可恢复。</p>
                            )}
                            {remainingReviews.length > 0 && (
                              <div className="reports-cluster-more">
                                <button
                                  type="button"
                                  className="reports-group-cardread"
                                  onClick={() => openClusterReader(cluster, remainingReviews.map((review) => review.id))}
                                >
                                  <BookOpenCheck size={13} aria-hidden="true" /> 卡片阅读 · {remainingReviews.length} 篇
                                </button>
                                {moreCount > 0 && (
                                  <button
                                    type="button"
                                    className="secondary compact"
                                    onClick={() => setExpandedClusterReviews((current) => {
                                      const next = new Set(current);
                                      next.add(cluster.name);
                                      return next;
                                    })}
                                  >
                                    继续加载全部 {remainingReviews.length} 条速评（还有 {moreCount} 条）
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}

              {nonPickReviews.length > 0 && (
                <>
                  <h2 className="reports-sect">
                    论文速评
                    {visibleNonPick.length < nonPickReviews.length && (
                      <span className="reports-sect-hint is-warn">已隐藏 {nonPickReviews.length - visibleNonPick.length} 篇（来源期刊筛选）</span>
                    )}
                  </h2>
                  {visibleNonPick.length > 0 ? (
                    <div className="reports-brief-grid">
                      {visibleNonPick.map((review) => (
                        <BriefCard
                          key={review.id}
                          id={review.id}
                          article={articleMap.get(review.id) || null}
                          brief={briefById.get(review.id) || null}
                          fallbackText={review.text}
                          onOpen={openArticleById}
                        />
                      ))}
                    </div>
                  ) : (
                    <p className="reports-filter-hint">本节 {nonPickReviews.length} 篇速评已按「来源期刊」筛选隐藏，点信息条期刊 chip 或「全部显示」即可恢复。</p>
                  )}
                </>
              )}

              {/* 「值得精读」板块已下线（2026-10-13 用户需求）：AI 整理与前端展示均不再产出 */}

              {parsed.keywords && (
                <>
                  <h2 className="reports-sect">热点主题</h2>
                  <div className="reports-topics">
                    {parsed.keywords.split(/[、,，;；\n]/).map((raw) => raw.trim().replace(/^[-*\s]+/, "")).filter(Boolean).slice(0, 12).map((topic) => (
                      <button
                        key={topic}
                        type="button"
                        className="topic reports-topic-chip"
                        title={`搜索「${topic.replace(/\(.*?\)/g, "").trim()}」相关文献`}
                        onClick={() => openTopic(topic)}
                      >
                        {topic}
                      </button>
                    ))}
                  </div>
                </>
              )}

              {parsed.textCards.map((card) => (
                <div key={card.title}>
                  <h2 className="reports-sect">{card.title}</h2>
                  <div className="reports-text-card">
                    <div className="reports-md">{renderMarkdown(card.body)}</div>
                  </div>
                </div>
              ))}

              {!hasAnyContent && (
                <div className="reports-md">{renderMarkdown(linkifyJournals(current.content_md, journalNames))}</div>
              )}
            </div>
          )}
        </>
      )}

      {loadingArticle && <p className="reports-loading reports-loading-overlay">正在打开文献详情…</p>}

      {dialogArticle && (
        <ArticleDialog
          article={dialogArticle}
          close={() => setDialogArticle(null)}
          markRead={markRead}
          toggleFavorite={toggleFavorite}
          onArticleUpdated={onArticleUpdated}
          onOpenArticle={setDialogArticle}
          canModerate={canModerate}
        />
      )}

      <JournalArticlesDialog
        journalName={journalName}
        onClose={() => setJournalName(null)}
        onOpenArticle={(article) => setDialogArticle(article)}
      />

      <ArticleListDialog
        title={listDialog?.title || ""}
        markLabel={listDialog?.markLabel || ""}
        subtitle={listDialog?.subtitle || ""}
        items={listDialog?.items || []}
        loading={Boolean(listDialog?.loading)}
        error={listDialog?.error || ""}
        onClose={() => setListDialog(null)}
        onOpenArticle={(article) => setDialogArticle(article)}
      />
    </section>
  );
}

export default ReportsView;
