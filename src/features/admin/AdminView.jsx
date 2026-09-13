import { useEffect, useState } from "react";
import { Activity, BookOpen, ChevronDown, Database, FileText, Languages, RefreshCw, ShieldCheck, Trash2, UserPlus, Users } from "lucide-react";
import { api } from "../../lib/api.js";
import { formatDate, formatDateTime } from "../../lib/format.js";
import ArticleDialog from "../feed/ArticleDialog.jsx";

/** Batch sizes offered for translation runs. */
const TRANSLATE_BATCH_SIZES = [20, 50, 100];
/** Rounds per click: 1 keeps a single round, 8 drains a backlog in one action. */
const TRANSLATE_ROUND_OPTIONS = [
  { value: 1, label: "1 轮" },
  { value: 8, label: "8 轮（排空）" }
];

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
  const [translateBatchSize, setTranslateBatchSize] = useState(20);
  const [translateRounds, setTranslateRounds] = useState(1);

  async function loadOverview() {
    setOverview(await api.get("/api/admin/overview"));
    setLoading(false);
  }

  useEffect(() => {
    loadOverview().catch((error) => {
      setMessage(error.message);
      setLoading(false);
    });
  }, []);

  async function runDataAction(action) {
    setRunningAction(action);
    setMessage("");
    try {
      if (action === "refresh") {
        const result = await api.post("/api/refresh");
        setMessage(result.status === "success" ? `文献刷新完成，新增 ${result.addedCount || 0} 篇。` : result.message);
      } else if (action === "keywords") {
        const result = await api.post("/api/enrich-keywords");
        const state = result.status === "error" ? "失败" : result.status === "partial" ? "部分完成" : "完成";
        const detail = result.errors?.[0]?.message ? ` 首条失败：${result.errors[0].message}` : "";
        setMessage(`关键词补全${state}：本次处理 ${result.processed || 0} 篇，成功 ${result.enriched || 0} 篇，失败 ${result.failed || 0} 篇；仍有 ${result.remaining || 0} 篇待补全。${detail}`);
      } else if (action === "abstracts") {
        const result = await api.post("/api/enrich-abstracts");
        const state = result.status === "error" ? "失败" : result.status === "partial" ? "部分完成" : "完成";
        const detail = result.errors?.[0]?.message ? ` 首条失败：${result.errors[0].message}` : "";
        setMessage(`摘要补全${state}：本次处理 ${result.processed || 0} 篇，成功 ${result.enriched || 0} 篇，失败 ${result.failed || 0} 篇；仍有 ${result.remaining || 0} 篇待补全。${detail}`);
      } else if (action === "metadata") {
        const result = await api.post("/api/enrich-metadata");
        const state = result.status === "error" ? "失败" : result.status === "partial" ? "部分完成" : "完成";
        const detail = result.errors?.[0]?.message ? ` 首条失败：${result.errors[0].message}` : "";
        setMessage(`摘要和关键词补全${state}：摘要 +${result.enrichedAbstracts || 0}，关键词 +${result.enrichedKeywords || 0}；失败：摘要 ${result.failedAbstracts || 0}、关键词 ${result.failedKeywords || 0}；剩余摘要 ${result.remaining?.abstracts || 0}、关键词 ${result.remaining?.keywords || 0}。${detail}`);
      } else {
        const field = action === "titles" ? "title" : "abstract";
        const label = action === "titles" ? "标题" : "摘要";
        const result = await api.post("/api/admin/translate", {
          field,
          batchSize: translateBatchSize,
          maxBatches: translateRounds
        });
        const state = result.status === "error" ? "失败" : result.status === "partial" ? "部分完成" : "完成";
        // Show several reasons, not just the first: when every provider is dead
        // the first message alone hides which one could be fixed.
        const reasons = (result.errors || []).slice(0, 3).map((item) => item.message).filter(Boolean).join("；");
        const stopNote = result.stoppedReason === "no-progress"
          ? "（本轮没有成功翻译，已提前停止以免反复消耗请求）"
          : "";
        setMessage(`${label}翻译${state}：${result.batches || 1} 轮共处理 ${result.processed || 0} 篇，成功 ${result.translated || 0} 篇，失败 ${result.failed || 0} 篇，API 请求 ${result.requests || 0} 次${stopNote}；仍有 ${result.remaining || 0} 篇待翻译。${reasons ? ` 失败原因：${reasons}` : ""}`);
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
  const budgetLimit = Number(budget?.limit) || 0;
  const budgetUsed = Number(budget?.used) || 0;
  const budgetPercent = budgetLimit > 0 ? Math.min(100, (budgetUsed / budgetLimit) * 100) : 0;
  // Three levels so the indicator answers "am I about to be cut off?" at a
  // glance. Colour is never the only signal — the percentage is always printed.
  const budgetLevel = budget?.exhausted || budgetPercent >= 95 ? "danger" : budgetPercent >= 70 ? "warn" : "ok";
  const formatNumber = (value) => Number(value || 0).toLocaleString("zh-CN");
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

  return (
    <section className="admin-dashboard" aria-labelledby="admin-title">
      <header className="admin-dashboard-hero">
        <div className="admin-seal"><Database size={24} /></div>
        <div><span className="eyebrow">仅最高管理员可见</span><h1 id="admin-title">网站管理中心</h1><p>查看远端数据库的完整度、用户与社区状态，并执行受保护的数据维护。</p></div>
        <div className="admin-command-bar">
          <button className="primary" type="button" disabled={Boolean(runningAction)} onClick={() => runDataAction("refresh")}><RefreshCw size={15} className={runningAction === "refresh" ? "spin" : ""} /> {runningAction === "refresh" ? "刷新中…" : "刷新文献数据"}</button>
          <button className="secondary" type="button" disabled={Boolean(runningAction)} onClick={() => runDataAction("keywords")}><Activity size={15} className={runningAction === "keywords" ? "spin" : ""} /> {runningAction === "keywords" ? "补全中…" : "补全关键词"}</button>
          <button className="secondary" type="button" disabled={Boolean(runningAction)} onClick={() => runDataAction("abstracts")}><FileText size={15} className={runningAction === "abstracts" ? "spin" : ""} /> {runningAction === "abstracts" ? "摘要补全中…" : "补全摘要"}</button>
          <button className="secondary" type="button" disabled={Boolean(runningAction)} onClick={() => runDataAction("metadata")}><Database size={15} className={runningAction === "metadata" ? "spin" : ""} /> {runningAction === "metadata" ? "摘要和关键词补全中…" : "补全摘要和关键词"}</button>
          <button className="secondary" type="button" disabled={Boolean(runningAction)} onClick={() => runDataAction("titles")}><Languages size={15} className={runningAction === "titles" ? "spin" : ""} /> {runningAction === "titles" ? "标题翻译中…" : "翻译标题"}</button>
          <button className="secondary" type="button" disabled={Boolean(runningAction)} onClick={() => runDataAction("translate-abstracts")}><Languages size={15} className={runningAction === "translate-abstracts" ? "spin" : ""} /> {runningAction === "translate-abstracts" ? "摘要翻译中…" : "翻译摘要"}</button>
        </div>
        {/* Translation controls sit next to the buttons that use them: batch size
            covers "how many per round", rounds covers "keep going until done". */}
        <div className="admin-translate-controls">
          <label className="checkline">
            <span>每轮篇数</span>
            <select value={translateBatchSize} onChange={(event) => setTranslateBatchSize(Number(event.target.value))} disabled={Boolean(runningAction)}>
              {TRANSLATE_BATCH_SIZES.map((size) => <option key={size} value={size}>{size} 篇</option>)}
            </select>
          </label>
          <label className="checkline">
            <span>翻译轮次</span>
            <select value={translateRounds} onChange={(event) => setTranslateRounds(Number(event.target.value))} disabled={Boolean(runningAction)}>
              {TRANSLATE_ROUND_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <button className="secondary compact" type="button" disabled={Boolean(runningAction)} onClick={checkTranslationHealth}>
            <ShieldCheck size={14} className={runningAction === "translate-health" ? "spin" : ""} /> {runningAction === "translate-health" ? "体检中…" : "翻译服务体检"}
          </button>
          {budgetLimit > 0 && (
            <div
              className={`translate-quota level-${budgetLevel}`}
              title={`腾讯云文本翻译每月 500 万字符免费，超出按 58 元/百万字符计费。本系统设有本地硬上限 ${formatNumber(budgetLimit)} 字符，触及即停止调用，不会产生费用。`}
            >
              <span className="translate-quota-label">腾讯云翻译额度</span>
              <span
                className="translate-quota-track"
                role="progressbar"
                aria-label="本月翻译额度使用比例"
                aria-valuemin={0}
                aria-valuemax={budgetLimit}
                aria-valuenow={budgetUsed}
                aria-valuetext={`已用 ${budgetPercent.toFixed(1)}%`}
              >
                <span className="translate-quota-fill" style={{ width: `${Math.max(budgetPercent, budgetUsed > 0 ? 1.5 : 0)}%` }} />
              </span>
              <span className="translate-quota-value">
                已用 <strong>{formatNumber(budgetUsed)}</strong> / {formatNumber(budgetLimit)} 字符
                <span className="translate-quota-percent">{budgetPercent < 1 && budgetUsed > 0 ? budgetPercent.toFixed(2) : budgetPercent.toFixed(1)}%</span>
              </span>
              <span className="translate-quota-remaining">
                {budget?.exhausted ? "本月已用尽，已停止调用" : `剩余 ${formatNumber(budget?.remaining ?? Math.max(0, budgetLimit - budgetUsed))} 字符`}
              </span>
            </div>
          )}
          <span className="admin-translate-hint">体检会对每个翻译来源各发一条极短文本（约几个字符）。</span>
        </div>
      </header>
      {message && <div className="admin-notice" role="status">{message}</div>}

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
