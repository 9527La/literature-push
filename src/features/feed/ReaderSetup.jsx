import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, BookOpenCheck, CalendarRange, Loader2, RotateCcw, Sparkles } from "lucide-react";
import { api } from "../../lib/api.js";
import { filtersToQuery } from "../../hooks/useArticleFeed.js";
import { journalAbbr, journalGroup } from "../../lib/journal.js";
import { DIRECTIONS, directionLabel, directionVar } from "../../lib/directions.js";
import { articleDate, formatDate } from "../../lib/format.js";
// 专题（主题聚类）解析与速览页共用同一解析器（报告 content_md → clusters）
import { parseReportContent } from "../../lib/report-content.js";

/**
 * 文献库 · 「卡片阅读」子模块（2026-10-13）：
 * ① 选择范围（两种方式，尽量多筛选条件）→ ② 目录确认 → ③ 交给 CardReader 全屏阅读。
 *
 * - 方式一「按速览选」：周报 / 月报 + 期 + 方向（含速评，速评版可读）；
 * - 方式二「自定义筛选」：来源期刊（多选）+ 研究方向（多选）+ 时间范围 + 阅读状态 +
 *   排序 + 数量上限（该方式无速评，卡片自动落到摘要版）。
 */

const TIME_OPTIONS = [
  { key: "all", label: "全部时间" },
  { key: "7", label: "近 7 日" },
  { key: "30", label: "近 30 日" },
  { key: "month", label: "本月" }
];
const READ_OPTIONS = [
  { key: "all", label: "全部" },
  { key: "unread", label: "未读" },
  { key: "read", label: "已读" }
];
const LIMIT_OPTIONS = [50, 100, 200];

function dateInputValue(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
function quickRange(key) {
  const now = new Date();
  const to = dateInputValue(now);
  if (key === "month") return { from: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`, to };
  if (key === "7" || key === "30") {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (key === "7" ? 6 : 29));
    return { from: dateInputValue(start), to };
  }
  return { from: "", to: "" };
}

export default function ReaderSetup({ journals = [], onStart, onExit = null }) {
  const [step, setStep] = useState("setup");
  const [mode, setMode] = useState("period");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // ── 方式一：按速览选 ──
  const [reportRows, setReportRows] = useState({ weekly: [], monthly: [] });
  const [kind, setKind] = useState("weekly");
  const [periodStart, setPeriodStart] = useState("");
  const [direction, setDirection] = useState("");
  const [reportDetail, setReportDetail] = useState(null);
  const [topicOptions, setTopicOptions] = useState([]);
  const [topicKey, setTopicKey] = useState("all");
  const [topicsLoading, setTopicsLoading] = useState(false);

  // ── 方式二：自定义筛选 ──
  const [pickedJournals, setPickedJournals] = useState([]);
  const [pickedDirs, setPickedDirs] = useState([]);
  const [timeKey, setTimeKey] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [readState, setReadState] = useState("all");
  const [sort, setSort] = useState("desc");
  // limit：50/100/200 数字或 "all"（无上限）；customLimit 非空 = 自定义数值优先
  const [limit, setLimit] = useState(100);
  const [customLimit, setCustomLimit] = useState("");

  const clampLimit = (value) => Math.min(Math.max(Math.floor(Number(value) || 0), 1), 300);

  // ── 目录 ──
  const [catalog, setCatalog] = useState(null); // { title, articles, briefs }

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.get("/api/reports?kind=weekly&limit=30").catch(() => ({ reports: [] })),
      api.get("/api/reports?kind=monthly&limit=30").catch(() => ({ reports: [] }))
    ]).then(([weekly, monthly]) => {
      if (cancelled) return;
      setReportRows({ weekly: weekly.reports || [], monthly: monthly.reports || [] });
    });
    return () => { cancelled = true; };
  }, []);

  const periodOptions = useMemo(() => {
    const rows = reportRows[kind] || [];
    return [...new Set(rows.map((row) => row.period_start))];
  }, [reportRows, kind]);

  const directionOptions = useMemo(() => {
    if (!periodStart) return [];
    const rows = (reportRows[kind] || []).filter((row) => row.period_start === periodStart && row.direction);
    return rows.map((row) => ({ key: row.direction, count: row.stats?.total || 0 }));
  }, [reportRows, kind, periodStart]);

  // 选定期 + 方向后预取报告详情：供「专题（主题聚类）」选项与生成目录共用
  useEffect(() => {
    if (mode !== "period" || !periodStart || !direction) {
      setReportDetail(null);
      setTopicOptions([]);
      setTopicKey("all");
      return undefined;
    }
    let cancelled = false;
    setTopicsLoading(true);
    api.get(`/api/reports/detail?kind=${kind}&period_start=${periodStart}&direction=${direction}`)
      .then((data) => {
        if (cancelled) return;
        const report = data.report || null;
        setReportDetail(report);
        const parsed = parseReportContent(report?.content_md || "");
        setTopicOptions((parsed.clusters || [])
          .map((cluster) => ({ key: cluster.name, count: cluster.reviews?.length || 0 }))
          .filter((item) => item.count > 0));
        setTopicKey("all");
      })
      .catch(() => {
        if (!cancelled) { setReportDetail(null); setTopicOptions([]); }
      })
      .finally(() => {
        if (!cancelled) setTopicsLoading(false);
      });
    return () => { cancelled = true; };
  }, [mode, kind, periodStart, direction]);

  const toggleFrom = (list, setList, value) => {
    setList(list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);
  };

  function pickTime(key) {
    setTimeKey(key);
    const range = quickRange(key);
    setFrom(range.from);
    setTo(range.to);
  }

  function resetCustom() {
    setPickedJournals([]);
    setPickedDirs([]);
    setTimeKey("all");
    setFrom("");
    setTo("");
    setReadState("all");
    setSort("desc");
    setLimit(100);
  }

  async function fetchArticlesByIds(ids) {
    const chunks = [];
    for (let index = 0; index < ids.length; index += 100) chunks.push(ids.slice(index, index + 100));
    const results = await Promise.all(chunks.map((chunk) => api.get(`/api/articles?ids=${chunk.join(",")}&limit=100`)));
    const map = new Map();
    for (const data of results) for (const article of data.articles || []) map.set(article.id, article);
    return ids.map((id) => map.get(id)).filter(Boolean);
  }

  async function buildCatalog() {
    setBusy(true);
    setError("");
    try {
      if (mode === "period") {
        if (!periodStart || !direction) throw new Error("请先选择期次与方向");
        const matchesCurrent = reportDetail && reportDetail.period_start === periodStart && reportDetail.direction === direction;
        const detailReport = matchesCurrent
          ? reportDetail
          : (await api.get(`/api/reports/detail?kind=${kind}&period_start=${periodStart}&direction=${direction}`)).report;
        const briefs = detailReport?.stats?.paperBriefs || [];
        if (!briefs.length) throw new Error("该方向本期没有可阅读的速评文献");
        let ids = briefs.map((brief) => brief.id);
        let briefsForSession = briefs;
        let topicLabel = "";
        if (topicKey !== "all") {
          const parsed = parseReportContent(detailReport?.content_md || "");
          const cluster = (parsed.clusters || []).find((item) => item.name === topicKey);
          const reviewIds = (cluster?.reviews || [])
            .map((review) => Number(review.id))
            .filter((id) => Number.isInteger(id) && id > 0);
          if (!reviewIds.length) throw new Error("该专题没有可阅读的文献，请换一个专题");
          ids = reviewIds;
          const idSet = new Set(reviewIds);
          briefsForSession = briefs.filter((brief) => idSet.has(brief.id));
          topicLabel = ` · ${topicKey}`;
        }
        const articles = await fetchArticlesByIds(ids);
        if (!articles.length) throw new Error("文献元数据加载失败，请重试");
        const periodLabel = kind === "weekly" ? "周报" : "月报";
        setCatalog({ title: `${directionLabel(direction)}${topicLabel} · ${periodLabel} ${periodStart}`, articles, briefs: briefsForSession });
      } else {
        // 无上限：翻页拉全（服务端单页上限 500，安全封顶 20000 篇）
        const effectiveLimit = limit === "all" ? Infinity : clampLimit(limit);
        const query = filtersToQuery({
          journal: pickedJournals,
          direction: pickedDirs,
          from,
          to,
          unread: readState === "unread" ? true : "",
          read: readState === "read" ? true : "",
          sort
        });
        const articles = [];
        let offset = 0;
        while (articles.length < effectiveLimit && offset < 20000) {
          const pageSize = Math.min(500, effectiveLimit - articles.length);
          const data = await api.get(`/api/articles?${query}&limit=${pageSize}&offset=${offset}`);
          const batch = data.articles || [];
          articles.push(...batch);
          if (!data.hasMore || !batch.length) break;
          offset += batch.length;
        }
        if (!articles.length) throw new Error("当前条件下没有匹配的文献");
        setCatalog({ title: `自定义范围 · ${articles.length} 篇`, articles, briefs: [] });
      }
      setStep("catalog");
    } catch (buildError) {
      setError(buildError.message);
    } finally {
      setBusy(false);
    }
  }

  function beginReading() {
    if (!catalog) return;
    onStart?.({
      title: catalog.title,
      ids: catalog.articles.map((article) => article.id),
      briefs: catalog.briefs
    });
  }

  // ─────────────────────────── 目录步骤 ───────────────────────────
  if (step === "catalog" && catalog) {
    const journalsInList = new Set(catalog.articles.map((article) => article.journal).filter(Boolean));
    const readCount = catalog.articles.filter((article) => article.is_read).length;
    const dates = catalog.articles.map((article) => articleDate(article)).filter(Boolean).sort();
    return (
      <section className="reader-setup">
        <header className="reader-setup-head">
          <div>
            <span className="eyebrow">卡片阅读 · 目录确认</span>
            <h2>{catalog.title}</h2>
            <p className="reader-setup-summary">
              共 <strong>{catalog.articles.length}</strong> 篇 · 覆盖 <strong>{journalsInList.size}</strong> 种期刊
              {dates.length > 0 && <> · 时间 {dates[0]} ~ {dates[dates.length - 1]}</>}
              {readCount > 0 && <> · 其中已读 <strong>{readCount}</strong> 篇</>}
            </p>
          </div>
          <div className="reader-setup-actions">
            {onExit && <button type="button" className="secondary" onClick={onExit}><ArrowLeft size={14} /> 返回文献总览</button>}
            <button type="button" className="secondary" onClick={() => setStep("setup")}><RotateCcw size={14} /> 返回调整</button>
            <button type="button" className="primary" onClick={beginReading}><BookOpenCheck size={15} /> 开始卡片阅读</button>
          </div>
        </header>
        <ol className="reader-catalog">
          {catalog.articles.map((article, index) => {
            const tone = journalGroup(article.journal);
            return (
              <li key={article.id} className={`reader-catalog-row tone-${tone}${article.is_read ? " is-read" : ""}`}>
                <span className="reader-catalog-index">{index + 1}</span>
                <span className="reader-catalog-mark">{journalAbbr(article.journal)}</span>
                <span className="reader-catalog-title" title={article.translated_title || article.title}>
                  {article.translated_title || article.title || "未命名文献"}
                </span>
                <span className="reader-catalog-journal">{article.journal || ""}</span>
                <span className="reader-catalog-date">{formatDate(articleDate(article))}</span>
                {article.is_read ? <span className="reader-catalog-read">已读</span> : <span className="reader-catalog-read is-unread">未读</span>}
              </li>
            );
          })}
        </ol>
      </section>
    );
  }

  // ─────────────────────────── 范围选择步骤 ───────────────────────────
  return (
    <section className="reader-setup">
      <header className="reader-setup-head">
        <div>
          <span className="eyebrow">卡片阅读</span>
          <h2>选择阅读范围</h2>
          <p className="reader-setup-summary">确定范围后先给出文献目录，确认无误再进入卡片式阅读；阅读中可随时切换卡片版本。</p>
        </div>
        {onExit && (
          <div className="reader-setup-actions">
            <button type="button" className="secondary" onClick={onExit}><ArrowLeft size={14} /> 返回文献总览</button>
          </div>
        )}
      </header>

      <div className="reader-mode-tabs" role="tablist" aria-label="选择方式">
        <button type="button" role="tab" aria-selected={mode === "period"} className={mode === "period" ? "on" : ""} onClick={() => setMode("period")}>
          <CalendarRange size={14} aria-hidden="true" /> 按速览期选择
        </button>
        <button type="button" role="tab" aria-selected={mode === "custom"} className={mode === "custom" ? "on" : ""} onClick={() => setMode("custom")}>
          <Sparkles size={14} aria-hidden="true" /> 自定义筛选
        </button>
      </div>

      {mode === "period" ? (
        <div className="reader-setup-panel">
          <div className="reader-field">
            <span className="reader-field-label">报告类型</span>
            <div className="reader-chip-row">
              {[{ key: "weekly", label: "周报" }, { key: "monthly", label: "月报" }].map((item) => (
                <button key={item.key} type="button" className={`reader-chip${kind === item.key ? " on" : ""}`} aria-pressed={kind === item.key} onClick={() => { setKind(item.key); setPeriodStart(""); setDirection(""); }}>
                  {item.label}
                </button>
              ))}
            </div>
          </div>
          <div className="reader-field">
            <span className="reader-field-label">期次</span>
            <div className="reader-chip-row">
              {periodOptions.map((period) => (
                <button key={period} type="button" className={`reader-chip${periodStart === period ? " on" : ""}`} aria-pressed={periodStart === period} onClick={() => { setPeriodStart(period); setDirection(""); }}>
                  {period}
                </button>
              ))}
              {periodOptions.length === 0 && <span className="reader-field-hint">正在加载期次…</span>}
            </div>
          </div>
          {periodStart && (
            <div className="reader-field">
              <span className="reader-field-label">研究方向（主题）</span>
              <div className="reader-chip-row">
                {directionOptions.map((item) => (
                  <button key={item.key} type="button" className={`reader-chip reader-chip--dir${direction === item.key ? " on" : ""}`} style={{ "--dir-key": directionVar(item.key) }} aria-pressed={direction === item.key} onClick={() => setDirection(item.key)}>
                    <span className="direction-dot" aria-hidden="true" />
                    {directionLabel(item.key)}
                    <span className="reader-chip-count">{item.count}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {periodStart && direction && (
            <div className="reader-field">
              <span className="reader-field-label">专题（主题聚类）</span>
              <div className="reader-chip-row">
                <button type="button" className={`reader-chip${topicKey === "all" ? " on" : ""}`} aria-pressed={topicKey === "all"} onClick={() => setTopicKey("all")}>
                  全部专题
                </button>
                {topicOptions.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    className={`reader-chip${topicKey === item.key ? " on" : ""}`}
                    aria-pressed={topicKey === item.key}
                    title={item.key}
                    onClick={() => setTopicKey(item.key)}
                  >
                    {item.key}
                    <span className="reader-chip-count">{item.count}</span>
                  </button>
                ))}
                {topicsLoading && <span className="reader-chip-row-hint">正在读取专题…</span>}
                {!topicsLoading && topicOptions.length === 0 && <span className="reader-chip-row-hint">本期该方向报告未含主题聚类，按全方向阅读</span>}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="reader-setup-panel">
          <div className="reader-field">
            <span className="reader-field-label">来源期刊（可多选）</span>
            <div className="reader-chip-row">
              {journals.map((journal) => {
                const name = journal.name || journal;
                const on = pickedJournals.includes(name);
                return (
                  <button key={name} type="button" className={`reader-chip tone-${journalGroup(name)}${on ? " on-solid" : ""}`} title={name} aria-pressed={on} onClick={() => toggleFrom(pickedJournals, setPickedJournals, name)}>
                    {journalAbbr(name)}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="reader-field">
            <span className="reader-field-label">研究方向（可多选）</span>
            <div className="reader-chip-row">
              {DIRECTIONS.map((item) => {
                const on = pickedDirs.includes(item.key);
                return (
                  <button key={item.key} type="button" className={`reader-chip reader-chip--dir${on ? " on" : ""}`} style={{ "--dir-key": directionVar(item.key) }} aria-pressed={on} onClick={() => toggleFrom(pickedDirs, setPickedDirs, item.key)}>
                    <span className="direction-dot" aria-hidden="true" />
                    {item.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="reader-field">
            <span className="reader-field-label">时间范围</span>
            <div className="reader-chip-row">
              {TIME_OPTIONS.map((item) => (
                <button key={item.key} type="button" className={`reader-chip${timeKey === item.key ? " on" : ""}`} aria-pressed={timeKey === item.key} onClick={() => pickTime(item.key)}>
                  {item.label}
                </button>
              ))}
              <span className="reader-date-range">
                <input type="date" value={from} onChange={(event) => { setTimeKey("custom"); setFrom(event.target.value); }} />
                <span>~</span>
                <input type="date" value={to} onChange={(event) => { setTimeKey("custom"); setTo(event.target.value); }} />
              </span>
            </div>
          </div>
          <div className="reader-field">
            <span className="reader-field-label">阅读状态</span>
            <div className="reader-chip-row">
              {READ_OPTIONS.map((item) => (
                <button key={item.key} type="button" className={`reader-chip${readState === item.key ? " on" : ""}`} aria-pressed={readState === item.key} onClick={() => setReadState(item.key)}>
                  {item.label}
                </button>
              ))}
            </div>
          </div>
          <div className="reader-field">
            <span className="reader-field-label">排序</span>
            <div className="reader-chip-row">
              {[{ key: "desc", label: "最新优先" }, { key: "asc", label: "最早优先" }].map((item) => (
                <button key={item.key} type="button" className={`reader-chip${sort === item.key ? " on" : ""}`} aria-pressed={sort === item.key} onClick={() => setSort(item.key)}>
                  {item.label}
                </button>
              ))}
            </div>
          </div>
          <div className="reader-field">
            <span className="reader-field-label">数量上限</span>
            <div className="reader-chip-row">
              {LIMIT_OPTIONS.map((value) => (
                <button
                  key={value}
                  type="button"
                  className={`reader-chip${customLimit === "" && limit === value ? " on" : ""}`}
                  aria-pressed={customLimit === "" && limit === value}
                  onClick={() => { setLimit(value); setCustomLimit(""); }}
                >
                  {value} 篇
                </button>
              ))}
              <button
                type="button"
                className={`reader-chip${customLimit === "" && limit === "all" ? " on" : ""}`}
                aria-pressed={customLimit === "" && limit === "all"}
                title="不限数量，纳入全部符合条件的文献（长列表生成稍慢）"
                onClick={() => { setLimit("all"); setCustomLimit(""); }}
              >
                无上限
              </button>
              <label className="reader-limit-custom">
                自定义
                <input
                  type="number"
                  className="reader-limit-input"
                  min="1"
                  max="300"
                  placeholder="1–300"
                  aria-label="自定义数量上限（1–300 篇）"
                  value={customLimit}
                  onChange={(event) => {
                    const raw = event.target.value;
                    setCustomLimit(raw);
                    if (raw !== "" && Number.isFinite(Number(raw))) setLimit(clampLimit(raw));
                  }}
                />
                篇
              </label>
            </div>
          </div>
        </div>
      )}

      {error && <p className="reader-setup-error" role="alert">{error}</p>}

      <div className="reader-setup-foot">
        <button type="button" className="secondary" onClick={resetCustom} disabled={mode === "period"}><RotateCcw size={14} /> 重置条件</button>
        <button type="button" className="primary" onClick={buildCatalog} disabled={busy}>
          {busy ? <Loader2 size={15} className="spin" /> : <BookOpenCheck size={15} />}
          {busy ? "正在生成目录…" : "生成文献目录"}
        </button>
      </div>
    </section>
  );
}
