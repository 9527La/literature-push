import { useEffect, useState } from "react";
import { Activity, BookOpen, ChevronDown, Database, FileText, Languages, RefreshCw, ShieldCheck, Square, Trash2, UserPlus, Users } from "lucide-react";
import { api } from "../../lib/api.js";
import { formatDate, formatDateTime } from "../../lib/format.js";
import ArticleDialog from "../feed/ArticleDialog.jsx";

/** One-click maintenance entry points; the server decides the batching. */
const MAINTENANCE_ACTIONS = [
  { task: "abstracts", label: "补全摘要", runningLabel: "摘要补全中…", icon: FileText },
  { task: "keywords", label: "补全关键词", runningLabel: "关键词补全中…", icon: Activity },
  { task: "metadata", label: "补全摘要和关键词", runningLabel: "摘要和关键词补全中…", icon: Database },
  { task: "translate_title", label: "翻译标题", runningLabel: "标题翻译中…", icon: Languages },
  { task: "translate_abstract", label: "翻译摘要", runningLabel: "摘要翻译中…", icon: Languages }
];

const MAINTENANCE_STATUS_LABELS = {
  running: "进行中",
  success: "已完成",
  partial: "部分完成",
  error: "失败"
};

const formatNumber = (value) => Number(value || 0).toLocaleString("zh-CN");

/**
 * One provider's monthly allowance. Colour answers "am I about to be cut off?"
 * at a glance, but never alone — the percentage is always printed next to it.
 */
function TranslationQuota({ title, budget, hint }) {
  const limit = Number(budget?.limit) || 0;
  if (limit <= 0) return null;
  const used = Number(budget?.used) || 0;
  const percent = Math.min(100, (used / limit) * 100);
  const level = budget?.exhausted || percent >= 95 ? "danger" : percent >= 70 ? "warn" : "ok";
  return (
    <div className={`translate-quota level-${level}`} title={hint}>
      <span className="translate-quota-label">{title}</span>
      <span
        className="translate-quota-track"
        role="progressbar"
        aria-label={`${title}使用比例`}
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-valuenow={used}
        aria-valuetext={`已用 ${percent.toFixed(1)}%`}
      >
        <span className="translate-quota-fill" style={{ width: `${Math.max(percent, used > 0 ? 1.5 : 0)}%` }} />
      </span>
      <span className="translate-quota-value">
        已用 <strong>{formatNumber(used)}</strong> / {formatNumber(limit)} 字符
        <span className="translate-quota-percent">{percent < 1 && used > 0 ? percent.toFixed(2) : percent.toFixed(1)}%</span>
      </span>
      <span className="translate-quota-remaining">
        {budget?.exhausted ? "本月已用尽，已停止调用" : `剩余 ${formatNumber(budget?.remaining ?? Math.max(0, limit - used))} 字符`}
      </span>
    </div>
  );
}

/** Seconds → a compact Chinese duration; null means "not enough data yet". */
function formatEta(seconds) {
  if (seconds === null || seconds === undefined) return "计算中";
  const total = Math.max(0, Math.round(seconds));
  if (total <= 0) return "即将完成";
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours > 0) return `${hours} 小时 ${minutes} 分`;
  if (minutes > 0) return `${minutes} 分 ${total % 60} 秒`;
  return `${total} 秒`;
}

function AdminView({ onDataChanged }) {
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [runningAction, setRunningAction] = useState("");
  const [message, setMessage] = useState("");
  const [showCreateUser, setShowCreateUser] = useState(false);
  const [userForm, setUserForm] = useState({ username: "", password: "", name: "", email: "" });
  const [userSubmitting, setUserSubmitting] = useState(false);
  const [deleteUserId, setDeleteUserId] = useState(null);
  const [expandedCoverageKey, setExpandedCoverageKey] = useState(null);
  const [selectedCoverageArticle, setSelectedCoverageArticle] = useState(null);
  const [maintenance, setMaintenance] = useState(null);

  async function loadOverview() {
    const next = await api.get("/api/admin/overview");
    setOverview(next);
    // The overview carries the current job so a reloaded page resumes its
    // progress bar instead of waiting a poll cycle to find out it is running.
    if (next?.maintenance !== undefined) setMaintenance(next.maintenance);
    setLoading(false);
    return next;
  }

  useEffect(() => {
    loadOverview().catch((error) => {
      setMessage(error.message);
      setLoading(false);
    });
  }, []);

  // Poll the job while it runs. A maintenance drain is a long-lived server-side
  // loop now, so the progress bar and the remaining-time estimate come from the
  // server's own counters rather than from an open HTTP request.
  useEffect(() => {
    if (!maintenance?.running) return undefined;
    let cancelled = false;
    const timer = setInterval(async () => {
      try {
        const { state } = await api.get("/api/admin/maintenance");
        if (cancelled) return;
        setMaintenance(state);
        if (state && !state.running) {
          clearInterval(timer);
          setMessage(state.message || "");
          await Promise.all([loadOverview(), onDataChanged()]);
        }
      } catch (error) {
        if (!cancelled) setMessage(error.message);
      }
    }, 2000);
    return () => { cancelled = true; clearInterval(timer); };
    // `maintenance.running` alone drives it: the interval body must not be
    // recreated by every progress tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maintenance?.running]);

  /** Start a one-click drain. The response is immediate; progress arrives by poll. */
  async function startMaintenance(task) {
    setRunningAction(task);
    setMessage("");
    try {
      const result = await api.post("/api/admin/maintenance", { task });
      setMaintenance(result.state);
      if (!result.started) setMessage(result.error || "已有补全任务在运行。");
    } catch (error) {
      setMessage(error.message);
    } finally {
      setRunningAction("");
    }
  }

  async function stopMaintenance() {
    setRunningAction("maintenance-stop");
    try {
      const result = await api.post("/api/admin/maintenance/stop");
      if (result.state) setMaintenance(result.state);
      setMessage(result.stopped ? "已请求停止，当前这一小批处理完就会停下。" : "当前没有正在运行的任务。");
    } catch (error) {
      setMessage(error.message);
    } finally {
      setRunningAction("");
    }
  }

  async function runDataAction(action) {
    setRunningAction(action);
    setMessage("");
    try {
      if (action === "refresh") {
        const result = await api.post("/api/refresh");
        setMessage(result.status === "success" ? `文献刷新完成，新增 ${result.addedCount || 0} 篇。` : result.message);
      }
      await Promise.all([loadOverview(), onDataChanged()]);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setRunningAction("");
    }
  }

  /**
   * Probe every configured translation provider with one tiny request each.
   * Without this an administrator only learns that "translation failed" after a
   * whole batch has already been spent on a dead key.
   */
  async function checkTranslationHealth() {
    setRunningAction("translate-health");
    setMessage("");
    try {
      const result = await api.get("/api/admin/translate/health");
      const parts = (result.providers || []).map((provider) => (
        provider.ok
          ? `${provider.provider} 可用（示例：${provider.sample}）`
          : `${provider.provider} 不可用——${provider.error || "未知错误"}`
      ));
      setMessage(`翻译服务体检：${parts.join("；") || "没有配置任何翻译来源"}。`);
      // The probe spends a few characters, so refresh the allowance readout.
      await loadOverview();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setRunningAction("");
    }
  }

  async function createUser(event) {
    event.preventDefault();
    setUserSubmitting(true);
    setMessage("");
    try {
      const result = await api.post("/api/admin/users", userForm);
      setMessage(`已新增用户 ${result.user?.username || userForm.username}。`);
      setUserForm({ username: "", password: "", name: "", email: "" });
      setShowCreateUser(false);
      await loadOverview();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setUserSubmitting(false);
    }
  }

  async function removeUser(user) {
    if (deleteUserId !== user.id) {
      setDeleteUserId(user.id);
      setMessage(`再次点击“确认删除”才会删除用户 ${user.username}。`);
      return;
    }
    setUserSubmitting(true);
    setMessage("");
    try {
      await api.delete(`/api/admin/users/${user.id}`);
      setMessage(`用户 ${user.username} 已删除，其会话和个人数据也已清理。`);
      setDeleteUserId(null);
      await loadOverview();
    } catch (error) {
      setMessage(error.message);
      setDeleteUserId(null);
    } finally {
      setUserSubmitting(false);
    }
  }

  if (loading) return <div className="loading-skeleton"><div className="skeleton" style={{ height: 150, marginBottom: 16 }} /><div className="skeleton" style={{ height: 320 }} /></div>;
  if (!overview) return <div className="empty">无法读取管理数据。{message}</div>;

  const counts = overview.counts || {};
  const coverage = overview.coverage || {};
  const pending = overview.pending || {};
  const metrics = [
    ["文献记录", counts.articles],
    ["原文摘要", counts.abstracts],
    ["翻译记录", counts.translations],
    ["注册账户", counts.users],
    ["讨论主题", counts.discussions],
    ["评论 / 点赞", `${counts.comments || 0} / ${counts.likes || 0}`]
  ];
  const coverageRows = [
    { key: "abstracts", label: "原文摘要", value: coverage.abstracts },
    { key: "keywords", label: "原文关键词", value: coverage.keywords },
    { key: "translatedTitles", label: "中文标题", value: coverage.translatedTitles },
    { key: "translatedAbstracts", label: "中文摘要", value: coverage.translatedAbstracts }
  ];
  const coverageDetails = overview.coverageDetails || {};
  const recentRefreshes = Array.isArray(overview.recentRefreshes) ? overview.recentRefreshes.slice(0, 10) : [];
  const budget = overview.translationBudget || null;
  const baiduBudget = overview.baiduTranslationBudget || null;
  const providerOrder = Array.isArray(overview.translationProviders) ? overview.translationProviders : [];
  const taskLabels = {
    refresh: "刷新文献",
    abstracts: "补全摘要",
    keywords: "补全关键词",
    metadata: "补全摘要和关键词",
    translate_title: "翻译标题",
    translate_abstract: "翻译摘要"
  };
  const taskStatusLabels = {
    success: "完成",
    partial: "部分完成",
    error: "失败",
    running: "进行中"
  };
  // A running drain owns the buttons: a second click would only be answered with
  // "already running", and two overlapping crawls fetch the same records twice.
  const maintenanceRunning = Boolean(maintenance?.running);
  const maintenanceStatusLabel = maintenance ? (MAINTENANCE_STATUS_LABELS[maintenance.status] || maintenance.status) : "";
  const maintenancePercent = Number(maintenance?.percent || 0);
  const maintenanceEta = maintenanceRunning || maintenance?.status === "partial"
    ? formatEta(maintenance?.etaSeconds)
    : "—";
  const plan = maintenance?.plan || null;
  const busy = Boolean(runningAction) || maintenanceRunning;

  return (
    <section className="admin-dashboard" aria-labelledby="admin-title">
      <header className="admin-dashboard-hero">
        <div className="admin-seal"><Database size={24} /></div>
        <div><span className="eyebrow">仅最高管理员可见</span><h1 id="admin-title">网站管理中心</h1><p>查看远端数据库的完整度、用户与社区状态，并执行受保护的数据维护。</p></div>
        <div className="admin-command-bar">
          <button className="primary" type="button" disabled={busy} onClick={() => runDataAction("refresh")}><RefreshCw size={15} className={runningAction === "refresh" ? "spin" : ""} /> {runningAction === "refresh" ? "刷新中…" : "刷新文献数据"}</button>
          {MAINTENANCE_ACTIONS.map(({ task, label, runningLabel, icon: Icon }) => (
            <button
              className="secondary"
              type="button"
              key={task}
              disabled={busy}
              title={`一次点击跑到排空：服务端会一小批一小批地处理，直到没有可处理的条目或连续多轮没有进展。`}
              onClick={() => startMaintenance(task)}
            >
              <Icon size={15} className={runningAction === task ? "spin" : ""} />
              {" "}
              {runningAction === task ? "启动中…" : (maintenanceRunning && maintenance?.task === task ? runningLabel : `一键${label}`)}
            </button>
          ))}
        </div>
        {/* Batch sizes and round counts are gone: the server drains the whole
            backlog in one go and sizes translation runs to the remaining
            allowance, so there is nothing left for the administrator to guess. */}
        <div className="admin-translate-controls">
          <button className="secondary compact" type="button" disabled={busy} onClick={checkTranslationHealth}>
            <ShieldCheck size={14} className={runningAction === "translate-health" ? "spin" : ""} /> {runningAction === "translate-health" ? "体检中…" : "翻译服务体检"}
          </button>
          <TranslationQuota
            title="腾讯云翻译额度"
            budget={budget}
            hint="腾讯云文本翻译每月 500 万字符免费，超出按 58 元/百万字符计费。本系统设有本地硬上限，触及即停止调用，不会产生费用。用量取自接口返回的计费字符数。"
          />
          <TranslationQuota
            title="百度翻译额度"
            budget={baiduBudget}
            hint="百度没有额度查询接口（控制台用量每 5 分钟才刷新），这里是本系统按提交字符数自己统计的月度用量，上限由 .env 的 BAIDU_MONTHLY_CHAR_LIMIT 决定：标准版 5 万 / 高级版 100 万 / 尊享版 200 万，0 表示只统计不限制。"
          />
          <span className="admin-translate-hint">体检会对每个翻译来源各发一条极短文本（约几个字符）。翻译按每请求 10 条 / 1800 字符分包，额度不足时会自动停在可负担的篇数上。</span>
          {providerOrder.length > 0 && (
            <span className="admin-translate-hint">
              当前翻译链路：<strong>{providerOrder.join(" → ")}</strong>
              （火山引擎、LibreTranslate、MyMemory 已暂停；如需临时启用，改 .env 的 TRANSLATION_PROVIDERS 或 TRANSLATION_PROVIDER）
            </span>
          )}
          {baiduBudget?.lastError && (
            <span className="admin-translate-hint">
              百度上次调用失败：{baiduBudget.lastError.message}
              {baiduBudget.lastErrorHint ? `（${baiduBudget.lastErrorHint}）` : ""}
            </span>
          )}
        </div>
      </header>
      {message && <div className="admin-notice" role="status">{message}</div>}

      {maintenance && (
        <section className={`admin-panel-card admin-maintenance status-${maintenance.status}`} aria-label="补全任务进度">
          <header>
            <div>
              <span className="eyebrow">{maintenanceRunning ? "进行中" : "最近一次补全"}</span>
              <h2>{maintenance.label}</h2>
            </div>
            {maintenanceRunning ? (
              <button className="secondary compact" type="button" disabled={runningAction === "maintenance-stop"} onClick={stopMaintenance}>
                <Square size={13} /> {runningAction === "maintenance-stop" ? "停止中…" : "停止"}
              </button>
            ) : (
              <span className={`run-state ${maintenance.status}`}>{maintenanceStatusLabel}</span>
            )}
          </header>
          <span
            className="maintenance-track"
            role="progressbar"
            aria-label={`${maintenance.label}进度`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(maintenancePercent)}
            aria-valuetext={`已完成 ${maintenancePercent.toFixed(1)}%，剩余 ${maintenance.remaining} 篇`}
          >
            <span className="maintenance-fill" style={{ width: `${Math.max(maintenancePercent, maintenance.done > 0 ? 1 : 0)}%` }} />
          </span>
          <div className="maintenance-metrics">
            <div><span>进度</span><strong>{maintenancePercent.toFixed(1)}%</strong></div>
            <div><span>已处理</span><strong>{formatNumber(maintenance.processed)} / {formatNumber(maintenance.total)}</strong></div>
            <div><span>成功</span><strong>{formatNumber(maintenance.succeeded)}</strong></div>
            <div><span>剩余</span><strong>{formatNumber(maintenance.remaining)}</strong></div>
            <div><span>速率</span><strong>{maintenance.ratePerMinute > 0 ? `${Math.round(maintenance.ratePerMinute)} 篇/分` : "计算中"}</strong></div>
            <div><span>预计剩余时间</span><strong>{maintenanceEta}</strong></div>
          </div>
          {plan && (
            <p className="maintenance-note">
              本次队列约 {formatNumber(maintenance.total)} 篇，按样本估算需 <strong>{formatNumber(plan.estimatedChars)}</strong> 字符
              （平均每篇 {formatNumber(plan.avgCharsPerArticle)} 字符）。
              {plan.budgetExhausted
                ? " 腾讯与百度的本月额度都已用尽，暂时无法继续翻译。"
                : plan.budgetLimited
                  ? ` 两家合计剩余额度只够约 ${formatNumber(plan.affordableCount)} 篇，将在额度允许处停止；调高 .env 的 TENCENT_MONTHLY_CHAR_BUDGET 或 BAIDU_MONTHLY_CHAR_LIMIT 可继续。`
                  : " 两家合计额度足够翻完整个队列。"}
            </p>
          )}
          {!maintenanceRunning && (maintenance.stopReasonLabel || maintenance.message) && (
            <p className="maintenance-note">
              {maintenance.stopReasonLabel && <strong>{maintenance.stopReasonLabel}</strong>}
              {maintenance.stopReasonLabel && maintenance.message ? " · " : ""}
              {maintenance.message}
            </p>
          )}
          {maintenanceRunning && maintenance.remainingBacklog && (
            <p className="maintenance-note">
              {maintenance.kind === "translate"
                ? `待翻译 ${formatNumber(maintenance.remainingBacklog.translation || 0)} 篇`
                : `待补全：摘要 ${formatNumber(maintenance.remainingBacklog.abstracts || 0)} 篇 · 关键词 ${formatNumber(maintenance.remainingBacklog.keywords || 0)} 篇`}
            </p>
          )}
        </section>
      )}

      <section className="admin-ledger" aria-label="网站总览">
        <header><span>远端数据总账</span><small>实时读取</small></header>
        <div className="ledger-metrics">{metrics.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value ?? 0}</strong></div>)}</div>
      </section>

      <div className="admin-dashboard-grid">
        <section className="admin-panel-card coverage-panel">
          <header><div><span className="eyebrow">数据健康</span><h2>内容完整度</h2></div><Activity size={19} /></header>
          <div className="coverage-list">
            {coverageRows.map(({ key, label, value }) => {
              const detail = coverageDetails[key] || {};
              const journals = Array.isArray(detail.journals) ? detail.journals : [];
              const missingCount = Number(detail.missingCount || 0);
              const expanded = expandedCoverageKey === key;
              const detailId = `coverage-detail-${key}`;
              return (
                <div className={`coverage-row ${expanded ? "expanded" : ""}`} key={key}>
                  <button
                    className="coverage-row-button"
                    type="button"
                    aria-expanded={expanded}
                    aria-controls={detailId}
                    onClick={() => setExpandedCoverageKey(expanded ? null : key)}
                  >
                    <span className="coverage-row-copy">
                      <span>{label}</span>
                      <small>{missingCount ? `缺少 ${missingCount} 篇` : "全部完整"}</small>
                    </span>
                    <span className="coverage-row-value"><strong>{Number(value || 0).toFixed(1)}%</strong><ChevronDown size={15} aria-hidden="true" /></span>
                  </button>
                  <div className="coverage-track"><span style={{ width: `${Math.min(Number(value || 0), 100)}%` }} /></div>
                  {expanded && (
                    <div className="coverage-details" id={detailId}>
                      <div className="coverage-detail-summary"><span>不完整文献</span><strong>{missingCount} 篇 · {journals.length} 个期刊</strong></div>
                      {journals.length ? (
                        <div className="coverage-journal-list">
                          {journals.map((group) => (
                            <section className="coverage-journal-group" key={group.journal}>
                              <header><strong>{group.journal || "未标记期刊"}</strong><span>{group.count || 0} 篇</span></header>
                              <div className="coverage-article-list">
                                {(group.articles || []).map((article) => (
                                  <button className="coverage-article-button" type="button" key={article.id} onClick={() => setSelectedCoverageArticle(article)}>
                                    <span className="coverage-article-title">{article.title || "未命名文献"}</span>
                                    <span className="coverage-article-meta">{article.year || formatDate(article.published_at)}{article.doi ? ` · DOI ${article.doi}` : ""}</span>
                                  </button>
                                ))}
                              </div>
                            </section>
                          ))}
                        </div>
                      ) : <p className="coverage-empty">当前没有不完整文献。</p>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="coverage-pending" role="status"><span>当前待补全</span><strong>摘要 {pending.abstracts || 0} 篇 · 关键词 {pending.keywords || 0} 篇</strong></div>
        </section>

        <section className="admin-panel-card refresh-panel">
          <header><div><span className="eyebrow">任务记录</span><h2>最近任务</h2></div><RefreshCw size={19} /></header>
          <div className="refresh-ledger">
            {recentRefreshes.length ? recentRefreshes.map((run, index) => (
              <div key={`${run.started_at}-${index}`}>
                <span className={`run-state ${run.status}`}>{taskStatusLabels[run.status] || run.status}</span>
                <div className="run-details">
                   <div className="run-heading"><strong>{taskLabels[run.task_type] || "数据维护"}</strong><time dateTime={run.started_at} title={run.finished_at ? `完成：${formatDateTime(run.finished_at)}` : "仍在进行"}>开始 {formatDateTime(run.started_at)}{run.finished_at && <> · 完成 {formatDateTime(run.finished_at)}</>}</time></div>
                  <small>文献 +{run.added_count || 0} · 摘要 +{run.enriched_abstract_count || 0} · 关键词 +{run.enriched_keyword_count || 0} · 翻译 +{run.translated_count || 0}</small>
                  {(run.translation_unit_count || run.translation_request_count || run.translated_title_count || run.translated_abstract_count) && <small>翻译单元 {run.translation_unit_count || 0}（标题 {run.translated_title_count || 0} · 摘要 {run.translated_abstract_count || 0}） · API 请求 {run.translation_request_count || 0} 次</small>}
                  <small className="run-failures">失败：文献 {run.failed_article_count || 0} · 摘要 {run.failed_abstract_count || 0} · 关键词 {run.failed_keyword_count || 0} · 翻译 {run.failed_translation_count || 0}</small>
                  <small className="run-pending">待补全：摘要 {run.remaining_abstract_count ?? pending.abstracts ?? 0} · 关键词 {run.remaining_keyword_count ?? pending.keywords ?? 0}</small>
                  {(run.task_type === "translate_title" || run.task_type === "translate_abstract") && <small className="run-pending">待翻译：{run.remaining_translation_count ?? 0} 篇</small>}
                  {run.message && <small className="run-message">{run.message}</small>}
                </div>
              </div>
            )) : <p className="empty-compact">暂无刷新记录</p>}
          </div>
        </section>
      </div>

      <section className="admin-panel-card admin-table-card">
        <header>
          <div><span className="eyebrow">账户权限</span><h2>用户管理</h2></div>
          <div className="admin-section-actions">
            <button className="secondary compact" type="button" aria-expanded={showCreateUser} onClick={() => { setShowCreateUser((current) => !current); setMessage(""); setDeleteUserId(null); }}>
              <UserPlus size={15} /> {showCreateUser ? "取消新增" : "新增用户"}
            </button>
            <Users size={19} />
          </div>
        </header>
        {showCreateUser && (
          <form className="admin-user-form" onSubmit={createUser}>
            <div className="admin-user-form-grid">
              <label><span>用户名</span><input value={userForm.username} autoComplete="username" maxLength={32} onChange={(event) => setUserForm({ ...userForm, username: event.target.value })} required /></label>
              <label><span>初始密码</span><input type="password" value={userForm.password} autoComplete="new-password" minLength={8} maxLength={72} onChange={(event) => setUserForm({ ...userForm, password: event.target.value })} required /></label>
              <label><span>显示名称（可选）</span><input value={userForm.name} maxLength={40} onChange={(event) => setUserForm({ ...userForm, name: event.target.value })} /></label>
              <label><span>邮箱（可选）</span><input type="email" value={userForm.email} onChange={(event) => setUserForm({ ...userForm, email: event.target.value })} /></label>
            </div>
            <div className="admin-user-form-actions">
              <small>新账户默认为普通用户；密码长度须为 8 至 72 个字符。</small>
              <button className="primary" type="submit" disabled={userSubmitting || !userForm.username || !userForm.password}><UserPlus size={15} /> {userSubmitting ? "创建中…" : "创建用户"}</button>
            </div>
          </form>
        )}
        <div className="admin-table-wrap"><table><thead><tr><th>用户</th><th>账户角色</th><th>学籍</th><th>邮箱</th><th>注册日期</th><th>操作</th></tr></thead><tbody>{overview.users.map((user) => <tr key={user.id}><td><strong>{user.name || user.username}</strong><small>@{user.username}</small></td><td><span className={`role-chip ${user.role}`}>{user.role === "super_admin" ? "最高管理员" : "普通用户"}</span></td><td>{user.enrollment_year ? `${user.enrollment_year}级 ${user.degree || ""}` : "—"}</td><td>{user.email || "—"}</td><td>{formatDate(user.created_at)}</td><td className="user-actions">{user.role === "super_admin" ? <small>受保护</small> : <button className="danger-button compact" type="button" disabled={userSubmitting} onClick={() => removeUser(user)}><Trash2 size={14} /> {deleteUserId === user.id ? "确认删除" : "删除"}</button>}</td></tr>)}</tbody></table></div>
      </section>

      <section className="admin-panel-card admin-table-card">
        <header><div><span className="eyebrow">期刊数据</span><h2>文献分布</h2></div><BookOpen size={19} /></header>
        <div className="admin-table-wrap"><table><thead><tr><th>期刊</th><th>文献数量</th><th>带摘要</th><th>摘要覆盖率</th></tr></thead><tbody>{overview.journals.map((journal) => <tr key={journal.journal}><td><strong>{journal.journal || "未标记期刊"}</strong></td><td>{journal.count}</td><td>{journal.abstract_count}</td><td>{journal.count ? (journal.abstract_count * 100 / journal.count).toFixed(1) : "0.0"}%</td></tr>)}</tbody></table></div>
      </section>
      {selectedCoverageArticle && (
        <ArticleDialog
          article={selectedCoverageArticle}
          close={() => setSelectedCoverageArticle(null)}
          showActions={false}
        />
      )}
    </section>
  );
}

export default AdminView;
