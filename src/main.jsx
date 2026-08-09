import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowDownUp,
  BarChart3,
  Bell,
  BookOpen,
  Check,
  CloudDownload,
  CloudUpload,
  ExternalLink,
  Eye,
  EyeOff,
  Filter,
  Heart,
  HardDrive,
  HelpCircle,
  Mail,
  MessageSquare,
  RefreshCw,
  Save,
  ScrollText,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Star,
  Languages,
  LogOut,
  Trash2,
  UserRound,
  X
} from "lucide-react";
import "./styles.css";

function getAdminToken() {
  return localStorage.getItem("adminToken") || "";
}

function getUserToken() {
  return localStorage.getItem("userToken") || "";
}

async function parseResponse(response) {
  if (response.ok) return response.json();
  const text = await response.text();
  try {
    const data = JSON.parse(text);
    throw new Error(data.error || text);
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error(text || `请求失败（${response.status}）`);
    throw error;
  }
}

function requestHeaders(hasBody = false) {
  const headers = {};
  if (hasBody) headers["Content-Type"] = "application/json";
  const token = getAdminToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const userToken = getUserToken();
  if (userToken) headers["X-User-Token"] = userToken;
  return headers;
}

const DEFAULT_FILTERS = { journal: [], q: "", keyword: [], unread: false, favorite: false, from: "", to: "", sort: "desc" };
const DEFAULT_DISPLAY = { authors: true, keywords: true, abstract: true, bilingual: true };

function readLocalPersonalization() {
  try {
    return JSON.parse(localStorage.getItem("personalizationSnapshot") || "null");
  } catch {
    return null;
  }
}

const api = {
  async get(path) {
    return parseResponse(await fetch(path, { headers: requestHeaders() }));
  },
  async post(path, body) {
    return parseResponse(await fetch(path, {
      method: "POST",
      headers: requestHeaders(Boolean(body)),
      body: body ? JSON.stringify(body) : undefined
    }));
  },
  async put(path, body) {
    return parseResponse(await fetch(path, {
      method: "PUT",
      headers: requestHeaders(true),
      body: JSON.stringify(body)
    }));
  },
  async delete(path) {
    return parseResponse(await fetch(path, { method: "DELETE", headers: requestHeaders() }));
  }
};

function formatDate(value) {
  if (!value) return "未知日期";
  if (/^\d{8}$/.test(value)) return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6)}`;
  return String(value).slice(0, 10);
}

function Highlight({ text, terms }) {
  if (!text || !terms || !terms.length) return <>{text}</>;
  const escaped = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).filter(Boolean);
  if (!escaped.length) return <>{text}</>;
  const regex = new RegExp(`(${escaped.join("|")})`, "gi");
  const parts = String(text).split(regex);
  return (
    <>
      {parts.map((part, i) =>
        regex.test(part) ? (
          <mark key={i}>{part}</mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

function renderInlineMarkdown(text) {
  const parts = [];
  const re = /(\*\*.*?\*\*)|(\*.*?\*)|(`[^`]+`)|(\[([^\]]+)\]\(([^)]+)\))/g;
  let lastIdx = 0, m, key = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > lastIdx) parts.push(text.slice(lastIdx, m.index));
    if (m[1]) parts.push(<strong key={key++}>{m[1].slice(2, -2)}</strong>);
    else if (m[2]) parts.push(<em key={key++}>{m[2].slice(1, -1)}</em>);
    else if (m[3]) parts.push(<code key={key++}>{m[3].slice(1, -1)}</code>);
    else if (m[4]) parts.push(<a key={key++} href={m[6]} target="_blank" rel="noopener noreferrer">{m[5]}</a>);
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < text.length) parts.push(text.slice(lastIdx));
  return parts.length ? parts : text;
}

function renderMarkdown(md) {
  if (!md) return null;
  const lines = md.split("\n");
  const blocks = [];
  let listItems = [], bKey = 0;
  function flushList() {
    if (listItems.length) {
      blocks.push(<ul key={bKey++}>{listItems.map((item, i) => <li key={i}>{renderInlineMarkdown(item)}</li>)}</ul>);
      listItems = [];
    }
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed.startsWith("### ")) {
      flushList();
      blocks.push(<h5 key={bKey++}>{renderInlineMarkdown(trimmed.slice(4))}</h5>);
    } else if (trimmed.startsWith("## ")) {
      flushList();
      blocks.push(<h4 key={bKey++}>{renderInlineMarkdown(trimmed.slice(3))}</h4>);
    } else if (trimmed.startsWith("# ")) {
      flushList();
      blocks.push(<h3 key={bKey++}>{renderInlineMarkdown(trimmed.slice(2))}</h3>);
    } else if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
      listItems.push(trimmed.slice(2));
    } else if (trimmed === "") {
      flushList();
    } else {
      flushList();
      blocks.push(<p key={bKey++}>{renderInlineMarkdown(trimmed)}</p>);
    }
  }
  flushList();
  return blocks;
}

function UpdateModal({ versionInfo, onClose }) {
  const hasChangelog = versionInfo.changelog && versionInfo.changelog.trim();
  const hasNotes = versionInfo.notes && versionInfo.notes.length > 0;

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section className="update-dialog" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <header className="update-dialog-header">
          <div>
            <h3>版本更新</h3>
            <span className="update-version">v{versionInfo.version} · {versionInfo.date}</span>
          </div>
          <button className="icon-button" onClick={onClose}><X size={20} /></button>
        </header>
        <div className="update-notes">
          {hasChangelog ? (
            <div className="update-markdown">{renderMarkdown(versionInfo.changelog)}</div>
          ) : hasNotes ? (
            <ul>{versionInfo.notes.map((note, i) => <li key={i}>{note}</li>)}</ul>
          ) : (
            <p className="update-empty">本次为常规更新，包含问题修复和性能优化。</p>
          )}
        </div>
        <footer className="update-actions">
          <button className="primary" onClick={onClose}>知道了</button>
        </footer>
      </section>
    </div>
  );
}

function HelpView() {
  return (
    <div className="help-view">
      <section className="help-section">
        <h3><BookOpen size={18} /> 系统简介</h3>
        <p>本系统自动订阅电力系统领域期刊的最新文献，提供文献浏览、关键词统计、邮件推送、公共反馈和账户个性设置同步。</p>
      </section>

      <section className="help-section">
        <h3><Bell size={18} /> 最新文献</h3>
        <p>展示所有已订阅期刊的最新论文，支持以下操作：</p>
        <ul>
          <li><strong>搜索</strong>：在顶部搜索框输入关键词，可搜索标题、作者、摘要和关键词内容。匹配的文本会高亮显示。</li>
          <li><strong>筛选</strong>：左侧面板提供多维度筛选条件，包括期刊（多选）、关键词频次（多选）、时间范围、仅未读、仅收藏。不同筛选条件之间为"且"关系，同一条件内多选为"或"关系。</li>
          <li><strong>排序</strong>：支持按发布时间（升序/降序）和按相关性排序。相关性排序根据搜索词在标题（权重 3）、关键词（权重 2）、摘要（权重 1）中出现的次数计算。</li>
          <li><strong>收藏与阅读</strong>：点击心形图标收藏文献，点击文献卡片可展开查看详情，同时自动标记为已读。</li>
          <li><strong>显示控制</strong>：可通过主页面顶部开关控制作者、关键词、摘要以及中英文标题的可见性。</li>
        </ul>
      </section>

      <section className="help-section">
        <h3><BarChart3 size={18} /> 关键词统计</h3>
        <p>汇总所有文献中出现的关键词及其频次，帮助了解研究热点趋势。</p>
        <ul>
          <li>可按期刊和时间范围筛选关键词统计结果。</li>
          <li>点击某个关键词下方的文献卡片可展开查看论文详情。</li>
        </ul>
      </section>

      <section className="help-section">
        <h3><Mail size={18} /> 文献推送</h3>
        <p>管理邮件订阅和系统设置：</p>
        <ul>
          <li><strong>周报邮箱</strong>：填写您的邮箱地址并保存，系统将按账户配置的频率推送最新文献。点击“发送测试邮箱”可收到一封测试邮件。</li>
          <li><strong>订阅期刊</strong>：勾选需要关注的期刊，只有已订阅期刊的文献会出现在最新文献页和推送中。</li>
          <li><strong>补全关键词</strong>：对缺失关键词的文献自动补全，提升关键词统计的完整性。</li>
          <li><strong>推送设置</strong>：可选择每天、每周或每月推送，设置发送时间（时:分），自定义邮件内容（附件、摘要、关键词、翻译），指定推送期刊范围。</li>
        </ul>
      </section>

      <section className="help-section">
        <h3><UserRound size={18} /> 账户与个性设置</h3>
        <ul>
          <li><strong>注册限制</strong>：每个 IP 地址只能注册一个账号，已有账号可在其他设备登录。</li>
          <li><strong>账户资料</strong>：可保存姓名、入学年份、学历和周报邮箱。</li>
          <li><strong>本机保存</strong>：开启自动保存后，筛选、列表显示、期刊订阅和推送配置会保存在当前浏览器。</li>
          <li><strong>远端同步</strong>：登录后可手动上传当前设置，也可从远端账户载入。</li>
          <li><strong>公共反馈</strong>：反馈直接公开展示，不发送邮件；管理员可回复或删除。</li>
        </ul>
      </section>

      <section className="help-section">
        <h3><RefreshCw size={18} /> 数据刷新</h3>
        <p>系统支持两种刷新方式：</p>
        <ul>
          <li><strong>手动刷新</strong>：点击页面右上角"立即刷新"按钮，即时拉取最新文献。</li>
          <li><strong>定时刷新</strong>：在周报递送页面中设置 Cron 表达式，系统将按计划自动获取新文献。默认每天凌晨执行一次。</li>
        </ul>
      </section>

      <section className="help-section">
        <h3><HelpCircle size={18} /> 常见问题</h3>
        <ul>
          <li><strong>局域网访问</strong>：同一 Wi-Fi 下的其他设备可通过浏览器输入本机显示的局域网地址访问本系统。</li>
          <li><strong>版本更新</strong>：系统更新后会弹出更新说明，可选择"知道了"关闭，下次更新前不再重复提示。</li>
          <li><strong>数据同步</strong>：管理员执行一键部署后，所有用户刷新页面即可获取最新版本和数据。</li>
        </ul>
      </section>
    </div>
  );
}

function App() {
  const [articles, setArticles] = useState([]);
  const [settings, setSettings] = useState({ journals: [], refreshCron: "", emailEnabled: false, emailRecipients: [] });
  const [status, setStatus] = useState(null);
  const [availableJournals, setAvailableJournals] = useState([]);
  const [autoSavePersonalization, setAutoSavePersonalization] = useState(() => localStorage.getItem("autoSavePersonalization") === "true");
  const localPersonalization = useMemo(() => localStorage.getItem("autoSavePersonalization") === "true" ? readLocalPersonalization() : null, []);
  const [filters, setFilters] = useState(() => ({ ...DEFAULT_FILTERS, ...(localPersonalization?.filters || {}) }));
  const [displayPreferences, setDisplayPreferences] = useState(() => ({ ...DEFAULT_DISPLAY, ...(localPersonalization?.displayPreferences || {}) }));
  const [activeView, setActiveView] = useState(() => {
    const requested = window.location.hash.slice(1);
    return ["feed", "stats", "settings", "feedback", "account", "help"].includes(requested) ? requested : "feed";
  });
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [versionInfo, setVersionInfo] = useState(null);
  const [account, setAccount] = useState({ email: "", name: "", enrollment_year: null, degree: "", authenticated: false, can_register: true, username: "" });
  const [isAdmin, setIsAdmin] = useState(false);
  
  // Debounced search
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [debouncedFilters, setDebouncedFilters] = useState(filters);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedFilters(filters), 300);
    return () => clearTimeout(timer);
  }, [filters]);

  useEffect(() => {
    const params = new URLSearchParams();
    Object.entries(debouncedFilters).forEach(([key, value]) => {
      if (Array.isArray(value)) {
        if (value.length) params.set(key, value.join(","));
      } else if (value) {
        params.set(key, String(value));
      }
    });
    setDebouncedQuery(params.toString());
  }, [debouncedFilters]);

  useEffect(() => {
    fetch("/version.json")
      .then((r) => r.json())
      .then((data) => {
        const dismissed = localStorage.getItem("dismissedVersion");
        if (data.version && dismissed !== data.version) {
          setVersionInfo(data);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!autoSavePersonalization || initialLoading) return;
    localStorage.setItem("personalizationSnapshot", JSON.stringify({ filters, displayPreferences, settings }));
  }, [autoSavePersonalization, initialLoading, filters, displayPreferences, settings]);

  useEffect(() => {
    window.history.replaceState(null, "", `#${activeView}`);
  }, [activeView]);

  useEffect(() => {
    if (!getAdminToken()) return;
    api.get("/api/admin/session").then((session) => {
      setIsAdmin(Boolean(session.isAdmin));
      if (!session.isAdmin) localStorage.removeItem("adminToken");
    }).catch(() => {
      localStorage.removeItem("adminToken");
      setIsAdmin(false);
    });
  }, []);

  function dismissVersion() {
    if (versionInfo) localStorage.setItem("dismissedVersion", versionInfo.version);
    setVersionInfo(null);
  }

  const query = useMemo(() => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (Array.isArray(value)) {
        if (value.length) params.set(key, value.join(","));
      } else if (value) {
        params.set(key, String(value));
      }
    });
    return params.toString();
  }, [filters]);

  async function loadAll() {
    const [nextSettings, nextStatus, nextArticles, journals, nextAccount] = await Promise.all([
      api.get("/api/settings"),
      api.get("/api/status"),
      api.get(`/api/articles${debouncedQuery ? `?${debouncedQuery}` : ""}`),
      availableJournals.length ? Promise.resolve(availableJournals) : api.get("/api/journals"),
      api.get("/api/account")
    ]);
    setSettings(nextSettings);
    setStatus(nextStatus);
    setArticles(nextArticles);
    setAccount(nextAccount);
    if (getUserToken() && !nextAccount.authenticated) localStorage.removeItem("userToken");
    if (!availableJournals.length) setAvailableJournals(journals);
    setInitialLoading(false);
  }

  useEffect(() => {
    loadAll().catch((error) => setMessage(error.message));
  }, [debouncedQuery]);

  async function refresh() {
    setLoading(true);
    setMessage("");
    try {
      const result = await api.post("/api/refresh");
      setMessage(result.status === "success" ? `刷新完成，新增 ${result.addedCount} 篇文献。` : result.message);
      setTimeout(() => setMessage(""), 3000);
      await loadAll();
    } catch (error) {
      setMessage(error.message);
      setTimeout(() => setMessage(""), 5000);
      await api.get("/api/status").then(setStatus).catch(() => {});
    } finally {
      setLoading(false);
    }
  }

  async function markRead(id) {
    await api.post(`/api/articles/${id}/read`);
    await loadAll();
  }

  async function toggleFavorite(id) {
    await api.post(`/api/articles/${id}/favorite`);
    await loadAll();
  }

  async function saveSettings(nextSettings) {
    const saved = await api.put("/api/settings", nextSettings);
    setSettings(saved);
    setMessage("设置已保存。");
  }

  async function saveAccount(nextAccount) {
    const saved = await api.put("/api/account", nextAccount);
    setAccount(saved);
    setMessage("账户信息已保存。");
    return saved;
  }

  function getPersonalizationSnapshot() {
    return { filters, displayPreferences, settings };
  }

  function savePersonalizationLocal() {
    localStorage.setItem("personalizationSnapshot", JSON.stringify(getPersonalizationSnapshot()));
  }

  async function applyPersonalization(snapshot) {
    if (!snapshot || typeof snapshot !== "object") throw new Error("没有可载入的个性设置");
    if (snapshot.filters) setFilters({ ...DEFAULT_FILTERS, ...snapshot.filters });
    if (snapshot.displayPreferences) setDisplayPreferences({ ...DEFAULT_DISPLAY, ...snapshot.displayPreferences });
    if (snapshot.settings) {
      const saved = await api.put("/api/settings", snapshot.settings);
      setSettings(saved);
    }
  }

  async function authenticate(mode, credentials) {
    const result = await api.post(`/api/auth/${mode}`, credentials);
    localStorage.setItem("userToken", result.token);
    await loadAll();
  }

  function logoutUser() {
    localStorage.removeItem("userToken");
    setAccount({ email: "", name: "", enrollment_year: null, degree: "", authenticated: false, can_register: false, username: "" });
    loadAll().catch((error) => setMessage(error.message));
  }

  async function uploadPersonalization() {
    const result = await api.put("/api/auth/preferences", { preferences: getPersonalizationSnapshot() });
    setAccount((current) => ({ ...current, preferences_updated_at: result.updated_at }));
    return result;
  }

  async function loadRemotePersonalization() {
    const result = await api.get("/api/auth/preferences");
    if (!result.preferences) throw new Error("远端尚未保存个性设置");
    await applyPersonalization(result.preferences);
    return result;
  }

  function setAutoSave(enabled) {
    setAutoSavePersonalization(enabled);
    localStorage.setItem("autoSavePersonalization", String(enabled));
    if (enabled) savePersonalizationLocal();
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">跳到主要内容</a>
      <header className="topbar">
        <div className="topbar-left">
          <div className="brand">
            <BookOpen size={22} />
            <span>电力文献</span>
          </div>
          <nav className="nav">
            <button className={activeView === "feed" ? "active" : ""} onClick={() => setActiveView("feed")}>
              <Bell size={16} /> 最新文献
              {status?.unreadCount > 0 && <span className="nav-badge" aria-label={`${status.unreadCount} 篇未读`}>{status.unreadCount}</span>}
            </button>
            <button className={activeView === "stats" ? "active" : ""} onClick={() => setActiveView("stats")}>
              <BarChart3 size={16} /> 关键词统计
            </button>
            <button className={activeView === "settings" ? "active" : ""} onClick={() => setActiveView("settings")}>
              <Settings size={16} /> 文献推送
            </button>
            <button className={activeView === "feedback" ? "active" : ""} onClick={() => setActiveView("feedback")}>
              <MessageSquare size={16} /> 公共反馈
            </button>
            <button className={activeView === "account" ? "active" : ""} onClick={() => setActiveView("account")}>
              <UserRound size={16} /> {account.authenticated ? account.username : "登录账户"}
            </button>
            <button className={activeView === "help" ? "active" : ""} onClick={() => setActiveView("help")}>
              <HelpCircle size={16} /> 使用说明
            </button>
          </nav>
        </div>
        <div className="topbar-right">
          <div className="topbar-stats">
            <span>总文献 <strong>{status?.articleCount ?? 0}</strong></span>
            {status?.unreadCount > 0 && (
              <span className="stat-badge stat-badge-unread">未读 <strong>{status.unreadCount}</strong></span>
            )}
            {status?.readCount > 0 && (
              <span>已读 <strong>{status.readCount}</strong></span>
            )}
            {status?.favoriteCount > 0 && (
              <span className="stat-badge stat-badge-fav">收藏 <strong>{status.favoriteCount}</strong></span>
            )}
          </div>
          <button className="primary" onClick={refresh} disabled={loading}>
            <RefreshCw size={16} className={loading ? "spin" : ""} />
            {loading ? "刷新中" : "立即刷新"}
          </button>
        </div>
      </header>

      {message && <div className="message">{message}</div>}

      <main className="main" id="main-content">
        {initialLoading ? (
          <div className="loading-skeleton">
            <div className="skeleton" style={{ height: 40, marginBottom: 16 }} />
            <div className="skeleton" style={{ height: 120, marginBottom: 12 }} />
            <div className="skeleton" style={{ height: 120, marginBottom: 12 }} />
            <div className="skeleton" style={{ height: 120 }} />
          </div>
        ) : activeView === "feed" ? (
          <Feed
            articles={articles}
            subscribedJournals={settings.journals.map((j) => j.name)}
            journals={settings.journals}
            filters={filters}
            setFilters={setFilters}
            markRead={markRead}
            toggleFavorite={toggleFavorite}
            displayPreferences={displayPreferences}
            onDisplayPreferencesChange={setDisplayPreferences}
          />
        ) : activeView === "settings" ? (
          <SettingsView
            settings={settings}
            availableJournals={availableJournals}
            status={status}
            onSave={saveSettings}
          />
        ) : activeView === "help" ? (
          <HelpView />
        ) : activeView === "account" ? (
          <AccountView
            account={account}
            onSave={saveAccount}
            onAuthenticate={authenticate}
            onLogout={logoutUser}
            autoSavePersonalization={autoSavePersonalization}
            onAutoSaveChange={setAutoSave}
            onSaveLocal={savePersonalizationLocal}
            onLoadLocal={() => applyPersonalization(readLocalPersonalization())}
            onUploadRemote={uploadPersonalization}
            onLoadRemote={loadRemotePersonalization}
          />
        ) : activeView === "feedback" ? (
          <FeedbackView
            account={account}
            isAdmin={isAdmin}
            onAdminChange={setIsAdmin}
          />
        ) : (
          <StatsView journals={settings.journals} markRead={markRead} toggleFavorite={toggleFavorite} />
        )}
      </main>

      {versionInfo && (
        <UpdateModal versionInfo={versionInfo} onClose={dismissVersion} />
      )}
    </div>
  );
}

function formatEmailRecipients(recipients = []) {
  return recipients.join("\n");
}

function parseEmailRecipients(text) {
  return text
    .split(/[\n,;]+/)
    .map((email) => email.trim())
    .filter(Boolean);
}

function AccountView({
  account,
  onSave,
  onAuthenticate,
  onLogout,
  autoSavePersonalization,
  onAutoSaveChange,
  onSaveLocal,
  onLoadLocal,
  onUploadRemote,
  onLoadRemote
}) {
  const [form, setForm] = useState(account);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [authMode, setAuthMode] = useState("login");
  const [credentials, setCredentials] = useState({ username: "", password: "", confirmPassword: "" });
  const currentYear = new Date().getFullYear();

  useEffect(() => setForm(account), [account]);

  async function submitProfile(event) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    try {
      await onSave(form);
      setMessage("账户资料已保存。");
    } catch (error) {
      setMessage(error.message);
    } finally {
      setSaving(false);
    }
  }

  async function submitAuth(event) {
    event.preventDefault();
    if (authMode === "register" && credentials.password !== credentials.confirmPassword) {
      setMessage("两次输入的密码不一致");
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      await onAuthenticate(authMode, { username: credentials.username, password: credentials.password });
      setCredentials({ username: "", password: "", confirmPassword: "" });
      setMessage(authMode === "register" ? "账户已注册并登录。" : "登录成功。");
    } catch (error) {
      setMessage(error.message);
    } finally {
      setSaving(false);
    }
  }

  async function runSettingAction(action, successMessage) {
    setSaving(true);
    setMessage("");
    try {
      await Promise.resolve(action());
      setMessage(successMessage);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setSaving(false);
    }
  }

  if (!account.authenticated) {
    return (
      <section className="profile-layout" aria-labelledby="account-title">
        <div className="page-intro">
          <span className="eyebrow">账户身份</span>
          <h1 id="account-title">登录或注册</h1>
          <p>登录后可维护个人资料，并在不同设备之间上传和载入个性设置。每个 IP 地址只能注册一个账号。</p>
        </div>
        <div className="auth-card">
          <div className="auth-tabs" role="tablist">
            <button type="button" className={authMode === "login" ? "active" : ""} onClick={() => setAuthMode("login")}>登录</button>
            <button type="button" className={authMode === "register" ? "active" : ""} onClick={() => setAuthMode("register")} disabled={!account.can_register}>注册</button>
          </div>
          <form onSubmit={submitAuth} className="auth-form">
            <label><span>用户名</span><input value={credentials.username} minLength={3} maxLength={32} autoComplete="username" onChange={(e) => setCredentials({ ...credentials, username: e.target.value })} placeholder="3–32 个字符" required /></label>
            <label><span>密码</span><input type="password" value={credentials.password} minLength={8} maxLength={72} autoComplete={authMode === "login" ? "current-password" : "new-password"} onChange={(e) => setCredentials({ ...credentials, password: e.target.value })} placeholder="至少 8 个字符" required /></label>
            {authMode === "register" && <label><span>确认密码</span><input type="password" value={credentials.confirmPassword} minLength={8} maxLength={72} autoComplete="new-password" onChange={(e) => setCredentials({ ...credentials, confirmPassword: e.target.value })} required /></label>}
            {!account.can_register && <p className="auth-note">当前 IP 已注册过账号，如需使用请直接登录。</p>}
            <button className="primary" disabled={saving}>{saving ? "处理中" : authMode === "login" ? "登录账户" : "注册并登录"}</button>
            {message && <div className="inline-msg" role="status">{message}</div>}
          </form>
        </div>
      </section>
    );
  }

  return (
    <section className="profile-layout" aria-labelledby="account-title">
      <div className="page-intro account-heading">
        <div><span className="eyebrow">已登录 · {account.username}</span><h1 id="account-title">我的账户</h1><p>维护个人资料，并决定个性设置保存在本机还是同步至远端账户。</p></div>
        <button className="secondary" type="button" onClick={onLogout}><LogOut size={15} /> 退出登录</button>
      </div>

      <div className="account-grid">
        <form className="profile-card" onSubmit={submitProfile}>
          <div className="profile-mark" aria-hidden="true">{(form.name || account.username || "用").slice(0, 1)}</div>
          <div className="form-grid">
            <label><span>姓名</span><input value={form.name || ""} maxLength={40} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="请输入姓名" required /></label>
            <label><span>入学年份</span><select value={form.enrollment_year || ""} onChange={(e) => setForm({ ...form, enrollment_year: Number(e.target.value) })} required><option value="">请选择</option>{Array.from({ length: currentYear - 1979 }, (_, i) => currentYear - i).map((year) => <option key={year} value={year}>{year}级</option>)}</select></label>
            <label><span>学历</span><select value={form.degree || ""} onChange={(e) => setForm({ ...form, degree: e.target.value })} required><option value="">请选择</option><option value="硕士">硕士</option><option value="博士">博士</option></select></label>
            <label><span>周报接收邮箱</span><input type="email" value={form.email || ""} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="name@example.com" /></label>
          </div>
          <div className="form-footer"><span>{message && <span className="inline-msg" role="status">{message}</span>}</span><button className="primary" type="submit" disabled={saving}><Save size={16} /> {saving ? "保存中" : "保存账户资料"}</button></div>
        </form>

        <section className="sync-card" aria-labelledby="sync-title">
          <span className="eyebrow">个性设置</span>
          <h2 id="sync-title">保存与同步</h2>
          <p>包含文献筛选、列表内容显示、订阅期刊和推送配置。</p>
          <label className="preference-row sync-toggle"><span><strong>自动保存在本机</strong><small>设置变化后自动写入当前浏览器。</small></span><input type="checkbox" checked={autoSavePersonalization} onChange={(e) => onAutoSaveChange(e.target.checked)} /></label>
          <div className="sync-actions">
            <button className="secondary" type="button" disabled={saving} onClick={() => runSettingAction(onSaveLocal, "当前个性设置已保存到本机。") }><HardDrive size={15} /> 保存到本机</button>
            <button className="secondary" type="button" disabled={saving} onClick={() => runSettingAction(onLoadLocal, "已从本机载入个性设置。") }><HardDrive size={15} /> 从本机载入</button>
            <button className="primary" type="button" disabled={saving} onClick={() => runSettingAction(onUploadRemote, "当前个性设置已上传到远端账户。") }><CloudUpload size={15} /> 上传远端</button>
            <button className="secondary" type="button" disabled={saving} onClick={() => runSettingAction(onLoadRemote, "已从远端账户载入个性设置。") }><CloudDownload size={15} /> 从远端载入</button>
          </div>
          {account.preferences_updated_at && <small className="sync-time">远端最近保存：{formatDate(account.preferences_updated_at)}</small>}
        </section>
      </div>
    </section>
  );
}

function FeedbackView({ account, isAdmin, onAdminChange }) {
  const [items, setItems] = useState([]);
  const [content, setContent] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [anonymous, setAnonymous] = useState(false);
  const [password, setPassword] = useState("");
  const [loginMessage, setLoginMessage] = useState("");
  const [replyDrafts, setReplyDrafts] = useState({});
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);

  async function loadFeedback() {
    setItems(await api.get("/api/feedback"));
  }

  useEffect(() => { loadFeedback().catch((error) => setMessage(error.message)); }, []);

  async function submitFeedback(event) {
    event.preventDefault();
    if (!content.trim()) return;
    setSending(true);
    setMessage("");
    try {
      await api.post("/api/feedback", { content, anonymous: !account.authenticated || anonymous });
      setContent("");
      setMessage("反馈已公开发布，不会发送邮件。");
      await loadFeedback();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setSending(false);
    }
  }

  async function login(event) {
    event.preventDefault();
    setLoginMessage("");
    try {
      const result = await api.post("/api/admin/login", { password });
      localStorage.setItem("adminToken", result.token);
      setPassword("");
      onAdminChange(true);
      setLoginMessage(`管理员会话已启用，有效期 ${result.expiresInHours} 小时。`);
    } catch (error) {
      setLoginMessage(error.message);
    }
  }

  function logout() {
    localStorage.removeItem("adminToken");
    onAdminChange(false);
    setLoginMessage("已退出管理员会话。");
  }

  async function submitReply(id) {
    const reply = String(replyDrafts[id] || "").trim();
    if (!reply) return;
    try {
      await api.post(`/api/admin/feedback/${id}/reply`, { reply });
      setReplyDrafts({ ...replyDrafts, [id]: "" });
      await loadFeedback();
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function removeFeedback(id) {
    if (deleteConfirmId !== id) {
      setDeleteConfirmId(id);
      return;
    }
    try {
      await api.delete(`/api/admin/feedback/${id}`);
      setDeleteConfirmId(null);
      await loadFeedback();
    } catch (error) {
      setMessage(error.message);
    }
  }

  return (
    <section className="feedback-layout" aria-labelledby="feedback-title">
      <header className="feedback-hero">
        <div>
          <span className="eyebrow">公开交流</span>
          <h1 id="feedback-title">意见反馈</h1>
          <p>每条建议都会直接展示在这里，所有访问者都能看到；系统不会再向管理员发送反馈邮件。</p>
        </div>
        <div className={`admin-status ${isAdmin ? "active" : ""}`}>
          <ShieldCheck size={18} /> {isAdmin ? "管理员模式" : "公开浏览"}
        </div>
      </header>

      <div className="feedback-grid">
        <div>
          <form className="feedback-composer" onSubmit={submitFeedback}>
            <div className="composer-author">
              <div className="mini-avatar">{(!account.authenticated || anonymous ? "匿" : account.name || account.username || "用").slice(0, 1)}</div>
              <span><strong>{!account.authenticated || anonymous ? "匿名用户" : account.name || account.username}</strong><small>{!account.authenticated || anonymous ? "不会展示账户资料" : account.enrollment_year ? `${account.enrollment_year}级${account.degree ? ` ${account.degree}` : ""}` : "未填写入学年份"}</small></span>
            </div>
            {account.authenticated && <fieldset className="identity-choice"><legend>发布身份</legend><label><input type="radio" name="feedbackIdentity" checked={!anonymous} onChange={() => setAnonymous(false)} /> 实名反馈</label><label><input type="radio" name="feedbackIdentity" checked={anonymous} onChange={() => setAnonymous(true)} /> 匿名反馈</label></fieldset>}
            <textarea value={content} onChange={(e) => setContent(e.target.value)} maxLength={2000} rows={5} placeholder="写下功能建议、数据问题或使用体验……" />
            <div className="composer-footer"><span>{content.length}/2000 · 每小时可提交一次</span><button className="primary" disabled={sending || !content.trim()}><Send size={15} /> {sending ? "发布中" : "公开发布"}</button></div>
            {message && <div className="inline-msg" role="status">{message}</div>}
          </form>

          <div className="feedback-stream" aria-live="polite">
            {items.length === 0 ? <div className="empty">还没有公开反馈，欢迎发布第一条建议。</div> : items.map((item) => (
              <article className="feedback-item" key={item.id}>
                <header>
                  <div className="mini-avatar">{item.author_name.slice(0, 1)}</div>
                  <div><strong>{item.author_name}</strong><span>{item.author_grade || "用户"} · {formatDate(item.created_at)}</span></div>
                </header>
                <p>{item.content}</p>
                {item.admin_reply && <div className="admin-reply"><strong><ShieldCheck size={14} /> 管理员回复</strong><p>{item.admin_reply}</p><time>{formatDate(item.replied_at)}</time></div>}
                {isAdmin && <div className="moderation-tools">
                  <textarea rows={2} maxLength={2000} value={replyDrafts[item.id] || ""} onChange={(e) => setReplyDrafts({ ...replyDrafts, [item.id]: e.target.value })} placeholder={item.admin_reply ? "更新管理员回复" : "输入管理员回复"} />
                  <button className="secondary" type="button" onClick={() => submitReply(item.id)} disabled={!String(replyDrafts[item.id] || "").trim()}>回复</button>
                  <button className="danger-button" type="button" onClick={() => removeFeedback(item.id)}><Trash2 size={14} /> {deleteConfirmId === item.id ? "再次点击确认删除" : "删除"}</button>
                </div>}
              </article>
            ))}
          </div>
        </div>

        <aside className="admin-panel">
          <span className="eyebrow">管理入口</span>
          <h2>反馈管理</h2>
          <p>{isAdmin ? "你可以公开回复或删除不适合保留的内容。" : "管理员登录后可回复和删除反馈，普通用户只能浏览与发布。"}</p>
          {isAdmin ? <button className="secondary" type="button" onClick={logout}><LogOut size={15} /> 退出管理员</button> : <form onSubmit={login}>
            <label><span>管理员密码</span><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></label>
            <button className="primary" disabled={!password}><ShieldCheck size={15} /> 登录</button>
          </form>}
          {loginMessage && <div className="inline-msg" role="status">{loginMessage}</div>}
        </aside>
      </div>
    </section>
  );
}

function Feed({ articles, subscribedJournals, journals, filters, setFilters, markRead, toggleFavorite, displayPreferences, onDisplayPreferencesChange }) {
  const [selectedArticle, setSelectedArticle] = useState(null);
  const [topKeywords, setTopKeywords] = useState([]);
  const [visibleCount, setVisibleCount] = useState(50);

  useEffect(() => {
    api.get("/api/keyword-stats").then((data) => {
      setTopKeywords(data.keywords || []);
    }).catch(() => {});
  }, []);

  useEffect(() => setVisibleCount(50), [filters]);

  function toggleDisplay(field) {
    onDisplayPreferencesChange({ ...displayPreferences, [field]: !displayPreferences[field] });
  }

  // Only show articles from subscribed journals
  const filteredArticles = articles.filter((article) =>
    subscribedJournals.length === 0 || subscribedJournals.includes(article.journal)
  );

  const highlightTerms = useMemo(() => {
    const terms = [];
    if (filters.q && filters.q.trim()) terms.push(filters.q.trim());
    if (filters.keyword && filters.keyword.length) terms.push(...filters.keyword);
    return terms;
  }, [filters.q, filters.keyword]);

  const sortedArticles = useMemo(() => {
    if (filters.sort !== "relevance" || !highlightTerms.length) return filteredArticles;
    const countMatches = (text, terms) => {
      if (!text) return 0;
      const lower = text.toLowerCase();
      let count = 0;
      for (const t of terms) {
        const tl = t.toLowerCase();
        let pos = 0;
        while ((pos = lower.indexOf(tl, pos)) !== -1) { count++; pos += tl.length; }
      }
      return count;
    };
    return [...filteredArticles].map((a) => {
      const titleCount = countMatches(a.title, highlightTerms);
      const keywordCount = countMatches(a.keywords, highlightTerms);
      const abstractCount = countMatches(a.abstract, highlightTerms);
      const score = titleCount * 3 + keywordCount * 2 + abstractCount;
      return { ...a, _score: score, _total: titleCount + keywordCount + abstractCount };
    }).sort((a, b) => b._score - a._score || b._total - a._total);
  }, [filteredArticles, filters.sort, highlightTerms]);

  return (
    <div className="content-layout">
      <aside className="filter-panel">
        <div className="filter-group">
          <h4><Search size={14} /> 搜索</h4>
          <input
            className="search-input"
            value={filters.q}
            onChange={(event) => setFilters({ ...filters, q: event.target.value })}
            placeholder="搜索标题、摘要、作者或关键词"
          />
        </div>
        <div className="filter-group">
          <h4>期刊</h4>
          <div className="keyword-filter-list">
            {journals.map((j) => (
              <button
                key={j.name}
                className={`keyword-filter-chip ${filters.journal.includes(j.name) ? "active" : ""}`}
                onClick={() => {
                  const next = filters.journal.includes(j.name)
                    ? filters.journal.filter((k) => k !== j.name)
                    : [...filters.journal, j.name];
                  setFilters({ ...filters, journal: next });
                }}
                title={j.name}
              >
                <span className="kw-name">{j.name}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="filter-group">
          <h4>时间范围</h4>
          <input
            type="date"
            value={filters.from}
            onChange={(event) => setFilters({ ...filters, from: event.target.value })}
            aria-label="开始日期"
          />
          <input
            type="date"
            value={filters.to}
            onChange={(event) => setFilters({ ...filters, to: event.target.value })}
            aria-label="结束日期"
          />
        </div>
        <div className="filter-group">
          <h4>筛选</h4>
          <div className="filter-row">
            <label className="checkline">
              <input
                type="checkbox"
                checked={filters.unread}
                onChange={(event) => setFilters({ ...filters, unread: event.target.checked })}
              />
              仅未读
            </label>
            <label className="checkline">
              <input
                type="checkbox"
                checked={filters.favorite}
                onChange={(event) => setFilters({ ...filters, favorite: event.target.checked })}
              />
              仅收藏
            </label>
          </div>
        </div>
        <div className="filter-group">
          <h4>关键词</h4>
          <div className="keyword-filter-list">
            {topKeywords.map((item) => (
              <button
                key={item.keyword}
                className={`keyword-filter-chip ${filters.keyword.includes(item.keyword) ? "active" : ""}`}
                onClick={() => {
                  const next = filters.keyword.includes(item.keyword)
                    ? filters.keyword.filter((k) => k !== item.keyword)
                    : [...filters.keyword, item.keyword];
                  setFilters({ ...filters, keyword: next });
                }}
                title={item.keyword}
              >
                <span className="kw-name">{item.keyword}</span>
                <span className="kw-count">{item.count}</span>
              </button>
            ))}
            {topKeywords.length === 0 && <span style={{ fontSize: 12, color: "var(--text-muted)" }}>暂无数据</span>}
          </div>
        </div>
        <div className="filter-group">
          <h4>排序</h4>
          <label className="sort-select">
            <ArrowDownUp size={14} />
            <select
              value={filters.sort}
              onChange={(event) => setFilters({ ...filters, sort: event.target.value })}
            >
              <option value="desc">最新优先</option>
              <option value="asc">最早优先</option>
              <option value="relevance">按相关性</option>
            </select>
          </label>
        </div>
      </aside>
      <section className="content-main">
        <div className="display-toggles">
          <span className="display-toggles-label">显示内容</span>
          <button type="button" className={`display-toggle ${displayPreferences.authors ? "active" : ""}`} onClick={() => toggleDisplay("authors")}>
            {displayPreferences.authors ? <Eye size={14} /> : <EyeOff size={14} />} 作者
          </button>
          <button type="button" className={`display-toggle ${displayPreferences.keywords ? "active" : ""}`} onClick={() => toggleDisplay("keywords")}>
            {displayPreferences.keywords ? <Eye size={14} /> : <EyeOff size={14} />} 关键词
          </button>
          <button type="button" className={`display-toggle ${displayPreferences.abstract ? "active" : ""}`} onClick={() => toggleDisplay("abstract")}>
            {displayPreferences.abstract ? <Eye size={14} /> : <EyeOff size={14} />} 摘要
          </button>
          <button type="button" className={`display-toggle ${displayPreferences.bilingual ? "active" : ""}`} onClick={() => toggleDisplay("bilingual")}>
            <Languages size={14} /> 中英文标题
          </button>
        </div>

        <div className="article-count">
          共 <strong>{sortedArticles.length}</strong> 篇文献
          {sortedArticles.filter(a => a.is_read).length > 0 && <>，已读 <strong>{sortedArticles.filter(a => a.is_read).length}</strong> 篇</>}
          {sortedArticles.filter(a => a.is_favorite).length > 0 && <>，收藏 <strong>{sortedArticles.filter(a => a.is_favorite).length}</strong> 篇</>}
        </div>

        <div className="article-list">
          {sortedArticles.length === 0 ? (
            <div className="empty">暂无文献。点击刷新从公开数据源获取，或调整筛选条件。</div>
          ) : (
            sortedArticles.slice(0, visibleCount).map((article) => (
              <article className={`article ${article.is_read ? "read" : "unread"} ${article.is_favorite ? "favorited" : ""}`} key={article.id}>
                <div className="article-main">
                  <div className="article-meta">
                    <span>{article.journal || "未知期刊"}</span>
                    <span>{formatDate(article.published_at)}</span>
                    {article.year && <span>{article.year}</span>}
                    {article.is_read ? <span className="article-status-badge read-badge"><Check size={11} /> 已读</span> : <span className="article-status-badge unread-badge">未读</span>}
                    {article.is_favorite ? <span className="article-status-badge fav-badge"><Star size={11} /> 收藏</span> : null}
                  </div>
                  <button className="title-button" onClick={() => setSelectedArticle(article)}>
                    <Highlight text={article.title} terms={highlightTerms} />
                  </button>
                  {displayPreferences.bilingual && article.translated_title && article.translated_title !== article.title && (
                    <p className="translated-title"><Languages size={14} /> {article.translated_title}</p>
                  )}
                  {displayPreferences.authors && article.authors && <p className="authors"><Highlight text={article.authors} terms={highlightTerms} /></p>}
                  {displayPreferences.keywords && article.keywords && (
                    <div className="keywords">
                      {article.keywords.split(/[;；]/).map((kw, i) => kw.trim()).filter(Boolean).map((kw, i) => (
                        <span className={`keyword-tag ${highlightTerms.some((t) => kw.toLowerCase().includes(t.toLowerCase())) ? "keyword-tag-highlight" : ""}`} key={i}>
                          <Highlight text={kw} terms={highlightTerms} />
                        </span>
                      ))}
                    </div>
                  )}
                  {displayPreferences.abstract && article.abstract && <p className="abstract"><Highlight text={article.abstract} terms={highlightTerms} /></p>}
                </div>
                <div className="article-actions">
                  <button title="查看摘要" onClick={() => setSelectedArticle(article)}>
                    <ScrollText size={18} />
                  </button>
                  <button title={article.is_read ? "取消已读" : "标记已读"} className={`action-read ${article.is_read ? "action-done" : ""}`} onClick={() => markRead(article.id)}>
                    <Check size={18} />
                  </button>
                  <button
                    title={article.is_favorite ? "取消收藏" : "收藏"}
                    className={article.is_favorite ? "selected" : ""}
                    onClick={() => toggleFavorite(article.id)}
                  >
                    {article.is_favorite ? <Star size={18} /> : <Heart size={18} />}
                  </button>
                  {article.url && (
                    <a title="打开原文" href={article.url} target="_blank" rel="noreferrer">
                      <ExternalLink size={18} />
                    </a>
                  )}
                </div>
              </article>
            ))
          )}
        </div>
        {visibleCount < sortedArticles.length && <div className="load-more"><button className="secondary" type="button" onClick={() => setVisibleCount((count) => count + 50)}>继续显示下一批文献（剩余 {sortedArticles.length - visibleCount} 篇）</button></div>}
      </section>
      {selectedArticle && (
        <ArticleDialog
          article={selectedArticle}
          close={() => setSelectedArticle(null)}
          markRead={markRead}
          toggleFavorite={toggleFavorite}
        />
      )}
    </div>
  );
}

function ArticleDialog({ article, close, markRead, toggleFavorite }) {
  const [detail, setDetail] = useState(article);
  const [enriching, setEnriching] = useState(!article.abstract);
  const [enrichError, setEnrichError] = useState("");
  const [translation, setTranslation] = useState(null);
  const [translating, setTranslating] = useState("");
  const [translationError, setTranslationError] = useState("");

  useEffect(() => {
    let ignore = false;
    setDetail(article);
    setEnrichError("");
    setTranslation(null);
    setTranslationError("");
    if (article.abstract) {
      setEnriching(false);
      return () => {
        ignore = true;
      };
    }

    setEnriching(true);
    api.get(`/api/articles/${article.id}/enrich`)
      .then((nextArticle) => {
        if (!ignore) setDetail(nextArticle);
      })
      .catch((error) => {
        if (!ignore) setEnrichError(error.message);
      })
      .finally(() => {
        if (!ignore) setEnriching(false);
      });

    return () => {
      ignore = true;
    };
  }, [article]);

  async function translate(targetLanguage) {
    setTranslating(targetLanguage);
    setTranslationError("");
    try {
      const nextTranslation = await api.post(`/api/articles/${detail.id}/translate`, { targetLanguage });
      setTranslation(nextTranslation);
    } catch (error) {
      setTranslationError(error.message);
    } finally {
      setTranslating("");
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={close}>
      <section className="article-dialog" role="dialog" aria-modal="true" aria-label="文献摘要" onClick={(event) => event.stopPropagation()}>
        <header className="dialog-header">
          <div>
            <div className="article-meta">
              <span>{detail.journal || "未知期刊"}</span>
              <span>{formatDate(detail.published_at)}</span>
              {detail.year && <span>{detail.year}</span>}
            </div>
            <h3>{detail.title}</h3>
          </div>
          <button className="icon-button" title="关闭" onClick={close}>
            <X size={20} />
          </button>
        </header>
        {detail.authors && <p className="dialog-authors">{detail.authors}</p>}
        <dl className="paper-fields">
          {detail.doi && (
            <>
              <dt>DOI</dt>
              <dd>{detail.doi}</dd>
            </>
          )}
          {(detail.volume || detail.issue) && (
            <>
              <dt>卷期</dt>
              <dd>{[detail.volume && `Vol. ${detail.volume}`, detail.issue && `No. ${detail.issue}`].filter(Boolean).join(" · ")}</dd>
            </>
          )}
        </dl>
        {detail.keywords && (
          <div className="keywords-panel">
            <h4>关键词 / Keywords</h4>
            <div className="keywords">
              {detail.keywords.split(/[;；]/).map((kw, i) => kw.trim()).filter(Boolean).map((kw, i) => (
                <span className="keyword-tag" key={i}>{kw}</span>
              ))}
            </div>
            {translation?.keywords && (
              <>
                <h4 style={{ marginTop: "12px" }}>{translation.target_language === "en" ? "English Keywords" : "中文关键词"}</h4>
                <div className="keywords">
                  {translation.keywords.split(/[;；]/).map((kw, i) => kw.trim()).filter(Boolean).map((kw, i) => (
                    <span className="keyword-tag keyword-tag-translated" key={i}>{kw}</span>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
        <div className="abstract-panel">
          <h4>摘要</h4>
          {enriching ? (
            <p>正在从公开页面补全摘要...</p>
          ) : (
            <p>{detail.abstract || "公开数据源和页面爬取都暂未提供该文献摘要，可通过原文链接查看。"}</p>
          )}
          {enrichError && <p className="crawl-note">爬取补全未成功：{enrichError}</p>}
        </div>
        <div className="translation-tools">
          <button className="secondary" onClick={() => translate("zh")} disabled={Boolean(translating)}>
            <Languages size={18} /> {translating === "zh" ? "翻译中" : "译为中文"}
          </button>
          <button className="secondary" onClick={() => translate("en")} disabled={Boolean(translating)}>
            <Languages size={18} /> {translating === "en" ? "Translating" : "译为英文"}
          </button>
        </div>
        {translationError && <p className="crawl-note">翻译未成功：{translationError}</p>}
        {translation && (
          <div className="translation-panel">
            <h4>{translation.target_language === "zh" ? "中文翻译" : "English Translation"}</h4>
            {translation.title && <strong>{translation.title}</strong>}
            {translation.abstract && <p>{translation.abstract}</p>}
          </div>
        )}
        <footer className="dialog-actions">
          <button className="secondary" onClick={() => markRead(detail.id)}>
            <Check size={18} /> 标记已读
          </button>
          <button className="secondary" onClick={() => toggleFavorite(detail.id)}>
            {detail.is_favorite ? <Star size={18} /> : <Heart size={18} />} 收藏
          </button>
          {detail.url && (
            <a className="primary" href={detail.url} target="_blank" rel="noreferrer">
              <ExternalLink size={18} /> 打开原文
            </a>
          )}
        </footer>
      </section>
    </div>
  );
}

function WordCloud({ keywords, maxCount, onSelect, selectedKeyword }) {
  if (!keywords || keywords.length === 0) {
    return <div className="empty">没有关键词数据。</div>;
  }

  const minSize = 12;
  const maxSize = 48;
  
  const getColor = (count, max) => {
    const ratio = count / max;
    if (ratio > 0.7) return "#0d9488";
    if (ratio > 0.4) return "#d97706";
    if (ratio > 0.2) return "#5a6070";
    return "#8b919e";
  };

  return (
    <div className="wordcloud-container">
      <div className="wordcloud">
        {keywords.slice(0, 50).map((item, i) => {
          const ratio = item.count / maxCount;
          const fontSize = minSize + (maxSize - minSize) * ratio;
          const color = getColor(item.count, maxCount);
          const isSelected = selectedKeyword === item.keyword;
          
          return (
            <span
              key={item.keyword}
              className={`wordcloud-word ${isSelected ? "selected" : ""}`}
              style={{
                fontSize: `${fontSize}px`,
                color: isSelected ? "#0d9488" : color,
                fontWeight: ratio > 0.5 ? 700 : ratio > 0.2 ? 600 : 400,
                opacity: 0.6 + ratio * 0.4
              }}
              onClick={() => onSelect(item.keyword)}
              title={`${item.keyword}: ${item.count} 篇`}
            >
              {item.keyword}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function CooccurrenceView({ data, loading }) {
  if (loading) {
    return <div className="empty">加载中...</div>;
  }
  
  if (!data || !data.cooccurrences || data.cooccurrences.length === 0) {
    return <div className="empty">没有共现数据。</div>;
  }

  const maxCoCount = data.cooccurrences[0]?.count || 1;

  return (
    <div className="cooccurrence-container">
      <div className="cooccurrence-header">
        <h4>关键词共现分析</h4>
        <span className="cooccurrence-hint">显示频率最高的 {data.cooccurrences.length} 个关键词对</span>
      </div>
      <div className="cooccurrence-list">
        {data.cooccurrences.slice(0, 30).map((item, i) => (
          <div key={`${item.keyword1}-${item.keyword2}`} className="cooccurrence-item">
            <span className="cooccurrence-rank">{i + 1}</span>
            <div className="cooccurrence-keywords">
              <span className="cooccurrence-keyword">{item.keyword1}</span>
              <span className="cooccurrence-link">↔</span>
              <span className="cooccurrence-keyword">{item.keyword2}</span>
            </div>
            <div className="cooccurrence-bar-wrap">
              <div 
                className="cooccurrence-bar" 
                style={{ width: `${(item.count / maxCoCount) * 100}%` }}
              />
            </div>
            <span className="cooccurrence-count">{item.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatsView({ journals, markRead, toggleFavorite }) {
  const [filters, setFilters] = useState({ journal: "", from: "", to: "" });
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [selectedKeyword, setSelectedKeyword] = useState(null);
  const [selectedArticle, setSelectedArticle] = useState(null);
  const [keywordSearch, setKeywordSearch] = useState("");
  const [viewMode, setViewMode] = useState("list");
  const [cooccurrenceData, setCooccurrenceData] = useState(null);

  async function fetchStats() {
    setLoading(true);
    setSelectedKeyword(null);
    try {
      const params = new URLSearchParams();
      if (filters.journal) params.set("journal", filters.journal);
      if (filters.from) params.set("from", filters.from);
      if (filters.to) params.set("to", filters.to);
      const result = await api.get(`/api/keyword-stats?${params}`);
      setStats(result);
      
      const coResult = await api.get(`/api/keyword-cooccurrence?${params}`);
      setCooccurrenceData(coResult);
    } catch {
      setStats(null);
      setCooccurrenceData(null);
    } finally {
      setLoading(false);
    }
  }

  async function openArticle(article) {
    try {
      const full = await api.get(`/api/articles/${article.id}/enrich`);
      setSelectedArticle(full);
    } catch {
      setSelectedArticle(article);
    }
  }

  useEffect(() => {
    fetchStats();
  }, []);

  const maxCount = stats?.keywords?.[0]?.count || 1;
  
  const filteredKeywords = useMemo(() => {
    if (!stats?.keywords) return [];
    if (!keywordSearch.trim()) return stats.keywords;
    const search = keywordSearch.toLowerCase();
    return stats.keywords.filter((item) => item.keyword.toLowerCase().includes(search));
  }, [stats?.keywords, keywordSearch]);

  return (
    <div className="stats-view">
      <section className="stats-filters">
        <label>
          <Filter size={16} />
          <select
            value={filters.journal}
            onChange={(e) => setFilters({ ...filters, journal: e.target.value })}
          >
            <option value="">全部期刊</option>
            {journals.map((j) => (
              <option value={j.name} key={j.name}>{j.name}</option>
            ))}
          </select>
        </label>
        <input
          type="date"
          value={filters.from}
          onChange={(e) => setFilters({ ...filters, from: e.target.value })}
          aria-label="开始日期"
        />
        <input
          type="date"
          value={filters.to}
          onChange={(e) => setFilters({ ...filters, to: e.target.value })}
          aria-label="结束日期"
        />
        <button className="primary" onClick={fetchStats} disabled={loading}>
          <BarChart3 size={16} /> {loading ? "统计中..." : "统计"}
        </button>
      </section>

      {stats && (
        <>
          <div className="stats-summary">
            共 <strong>{stats.totalArticles}</strong> 篇文献，提取出 <strong>{stats.keywords.length}</strong> 个不重复关键词
            {keywordSearch && <>，匹配 <strong>{filteredKeywords.length}</strong> 个</>}
          </div>

          <div className="stats-view-toggle">
            <button 
              className={`stats-view-btn ${viewMode === "list" ? "active" : ""}`}
              onClick={() => setViewMode("list")}
            >
              <BarChart3 size={14} /> 列表
            </button>
            <button 
              className={`stats-view-btn ${viewMode === "wordcloud" ? "active" : ""}`}
              onClick={() => setViewMode("wordcloud")}
            >
              <span style={{fontSize: '14px'}}>☁</span> 词云
            </button>
            <button 
              className={`stats-view-btn ${viewMode === "cooccurrence" ? "active" : ""}`}
              onClick={() => setViewMode("cooccurrence")}
            >
              <span style={{fontSize: '14px'}}>🔗</span> 共现
            </button>
          </div>

          <div className="stats-layout">
            <div className="keyword-freq-list">
              <div className="keyword-search-box">
                <Search size={14} />
                <input
                  type="text"
                  placeholder="搜索关键词..."
                  value={keywordSearch}
                  onChange={(e) => setKeywordSearch(e.target.value)}
                />
                {keywordSearch && (
                  <button className="keyword-search-clear" onClick={() => setKeywordSearch("")}>
                    <X size={12} />
                  </button>
                )}
              </div>
              
              {viewMode === "wordcloud" ? (
                <WordCloud 
                  keywords={filteredKeywords} 
                  maxCount={maxCount}
                  onSelect={setSelectedKeyword}
                  selectedKeyword={selectedKeyword}
                />
              ) : viewMode === "cooccurrence" ? (
                <CooccurrenceView data={cooccurrenceData} loading={loading} />
              ) : (
                filteredKeywords.length === 0 ? (
                  <div className="empty">所选条件下没有关键词数据。</div>
                ) : (
                  filteredKeywords.map((item, i) => (
                    <button
                      key={item.keyword}
                      className={`keyword-freq-item ${selectedKeyword === item.keyword ? "selected" : ""}`}
                      onClick={() => setSelectedKeyword(selectedKeyword === item.keyword ? null : item.keyword)}
                    >
                      <span className="keyword-freq-rank">{i + 1}</span>
                      <span className="keyword-freq-name">{item.keyword}</span>
                      <div className="keyword-freq-bar-wrap">
                        <div
                          className="keyword-freq-bar"
                          style={{ width: `${(item.count / maxCount) * 100}%` }}
                        />
                      </div>
                      <span className="keyword-freq-count">{item.count}</span>
                    </button>
                  ))
                )
              )}
            </div>

            {selectedKeyword && (
              <div className="keyword-articles-panel">
                <div className="keyword-articles-header">
                  <h3>{selectedKeyword}</h3>
                  <span className="keyword-articles-count">
                    {(stats.keywords.find((k) => k.keyword === selectedKeyword)?.articles || []).length} 篇文献
                  </span>
                  <button className="icon-button" onClick={() => setSelectedKeyword(null)}>
                    <X size={18} />
                  </button>
                </div>
                <div className="keyword-articles-list">
                  {(stats.keywords.find((k) => k.keyword === selectedKeyword)?.articles || []).map((article) => (
                    <button className="keyword-article-card" key={article.id} onClick={() => openArticle(article)}>
                      <div className="keyword-article-meta">
                        <span>{article.journal}</span>
                        <span>{formatDate(article.published_at)}</span>
                      </div>
                      <div className="keyword-article-title">{article.title}</div>
                      {article.url && (
                        <a
                          href={article.url}
                          target="_blank"
                          rel="noreferrer"
                          className="keyword-article-link"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <ExternalLink size={12} /> 原文链接
                        </a>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {selectedArticle && (
        <ArticleDialog
          article={selectedArticle}
          close={() => setSelectedArticle(null)}
          markRead={markRead}
          toggleFavorite={toggleFavorite}
        />
      )}
    </div>
  );
}

function SettingsView({ settings, availableJournals, status, onSave }) {
  const [selectedJournalNames, setSelectedJournalNames] = useState(
    new Set(settings.journals.map((j) => j.name))
  );
  const [refreshCron, setRefreshCron] = useState(settings.refreshCron);
  const [enriching, setEnriching] = useState(false);
  const [enrichMessage, setEnrichMessage] = useState("");

  const [userEmail, setUserEmail] = useState("");
  const [savedEmail, setSavedEmail] = useState("");
  const [emailMsg, setEmailMsg] = useState("");
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState("");

  // Push settings
  const [pushEnabled, setPushEnabled] = useState(settings.pushEnabled || false);
  const [pushFrequency, setPushFrequency] = useState(settings.pushFrequency || "weekly");
  const [pushCron, setPushCron] = useState(settings.pushCron || "0 8 * * 1");
  const [pushDays, setPushDays] = useState(settings.pushDays || 7);
  const [pushIncludeFile, setPushIncludeFile] = useState(settings.pushIncludeFile !== false);
  const [pushIncludeAbstract, setPushIncludeAbstract] = useState(settings.pushIncludeAbstract !== false);
  const [pushIncludeKeywords, setPushIncludeKeywords] = useState(settings.pushIncludeKeywords !== false);
  const [pushIncludeTranslation, setPushIncludeTranslation] = useState(settings.pushIncludeTranslation !== false);
  const [pushJournalFilter, setPushJournalFilter] = useState(settings.pushJournalFilter || "");
  const [pushSelectedJournals, setPushSelectedJournals] = useState(new Set());
  const [sending, setSending] = useState(false);
  const [pushMsg, setPushMsg] = useState("");
  const [pushEditing, setPushEditing] = useState(false);
  
  // Cron time selection state
  const [pushHour, setPushHour] = useState("8");
  const [pushMinute, setPushMinute] = useState("0");
  const [pushWeekday, setPushWeekday] = useState("1");
  const [pushMonthDay, setPushMonthDay] = useState("1");
  
  // Generate Cron expression from selections
  function generateCron() {
    const minute = pushMinute || "0";
    const hour = pushHour || "8";
    if (pushFrequency === "daily") return `${minute} hour * * *`.replace("hour", hour);
    if (pushFrequency === "weekly") return `${minute} hour * * ${pushWeekday}`.replace("hour", hour);
    if (pushFrequency === "monthly") return `${minute} hour ${pushMonthDay} * *`.replace("hour", hour);
    return `${minute} hour * * 1`.replace("hour", hour);
  }
  
  // Parse Cron expression to populate selections
  function parseCron(cronStr) {
    const parts = (cronStr || "0 8 * * 1").split(" ");
    if (parts.length >= 5) {
      setPushMinute(parts[0] === "*" ? "0" : parts[0]);
      setPushHour(parts[1] === "*" ? "8" : parts[1]);
      setPushWeekday(parts[4] === "*" ? "1" : parts[4]);
      setPushMonthDay(parts[2] === "*" ? "1" : parts[2]);
    }
  }
  
  // Initialize from settings
  useEffect(() => {
    if (settings.pushCron) parseCron(settings.pushCron);
  }, [settings.pushCron]);

  useEffect(() => {
    setSelectedJournalNames(new Set(settings.journals.map((j) => j.name)));
    setRefreshCron(settings.refreshCron);
    setPushEnabled(settings.pushEnabled || false);
    setPushFrequency(settings.pushFrequency || "weekly");
    setPushCron(settings.pushCron || "0 8 * * 1");
    setPushDays(settings.pushDays || 7);
    setPushIncludeFile(settings.pushIncludeFile !== false);
    setPushIncludeAbstract(settings.pushIncludeAbstract !== false);
    setPushIncludeKeywords(settings.pushIncludeKeywords !== false);
    setPushIncludeTranslation(settings.pushIncludeTranslation !== false);
    setPushJournalFilter(settings.pushJournalFilter || "");
    // Parse pushJournalFilter to Set for checkbox selection
    if (settings.pushJournalFilter) {
      setPushSelectedJournals(new Set(settings.pushJournalFilter.split(",").map((s) => s.trim()).filter(Boolean)));
    } else {
      setPushSelectedJournals(new Set());
    }
    if (settings.pushCron) parseCron(settings.pushCron);
    // If push is already enabled, start in view mode (not editing)
    if (settings.pushEnabled) {
      setPushEditing(false);
    }
  }, [settings]);

  useEffect(() => {
    api.get("/api/user-email").then((data) => {
      setUserEmail(data.email || "");
      setSavedEmail(data.email || "");
    }).catch(() => {});
  }, []);

  function toggleJournal(name) {
    const next = new Set(selectedJournalNames);
    next.has(name) ? next.delete(name) : next.add(name);
    setSelectedJournalNames(next);
  }

  function togglePushJournal(name) {
    const next = new Set(pushSelectedJournals);
    next.has(name) ? next.delete(name) : next.add(name);
    setPushSelectedJournals(next);
    setPushJournalFilter([...next].join(", "));
  }

  async function saveEmail() {
    setEmailMsg("");
    try {
      await api.post("/api/user-email", { email: userEmail });
      setSavedEmail(userEmail);
      setEmailMsg("邮箱已保存");
    } catch (e) { setEmailMsg(e.message); }
  }

  async function testEmail() {
    setTesting(true); setTestMsg("");
    try {
      const res = await api.post("/api/test-email");
      setTestMsg(res.sent ? `测试邮件已发送至 ${res.email}` : "发送失败，请检查 SMTP 配置");
    } catch (e) { setTestMsg(e.message); }
    finally { setTesting(false); }
  }

  async function enrichKeywords() {
    setEnriching(true); setEnrichMessage("正在批量补全关键词...");
    try {
      const res = await api.post("/api/enrich-keywords");
      setEnrichMessage(`补全完成：成功 ${res.enriched} 篇${res.failed ? `，失败 ${res.failed} 篇` : ""}`);
    } catch (e) { setEnrichMessage(`补全失败：${e.message}`); }
    finally { setEnriching(false); }
  }

  async function sendPush() {
    setSending(true); setPushMsg("");
    try {
      const res = await api.post("/api/push/send");
      setPushMsg(res.sent ? `推送成功，共 ${res.count} 篇文献` : "推送失败，请检查 SMTP 配置");
    } catch (e) { setPushMsg(e.message); }
    finally { setSending(false); }
  }

  function submit(event) {
    event.preventDefault();
    const journals = availableJournals.filter((j) => selectedJournalNames.has(j.name));
    const generatedCron = generateCron();
    onSave({ 
      journals, 
      refreshCron, 
      emailEnabled: settings.emailEnabled, 
      emailRecipients: settings.emailRecipients,
      pushEnabled,
      pushFrequency,
      pushCron: generatedCron,
      pushDays,
      pushIncludeFile,
      pushIncludeAbstract,
      pushIncludeKeywords,
      pushIncludeTranslation,
      pushJournalFilter
    });
    setPushCron(generatedCron);
    setPushEditing(false);
  }

  return (
    <div className="settings-view">
      <div className="settings-columns">
        {/* Left Column: Email + Push Settings */}
        <div className="settings-left">
          <section className="settings-section">
            <h4><Mail size={15} /> 我的周报邮箱</h4>
            <p className="section-hint">填写后系统将每周推送最新文献到此邮箱。</p>
            <div className="saved-email-status">
              {savedEmail ? (
                <span>已保存：<strong>{savedEmail}</strong>{userEmail !== savedEmail && <span className="unsaved-hint">（已修改，未保存）</span>}</span>
              ) : (
                <span className="no-email-hint">尚未保存邮箱</span>
              )}
            </div>
            <div className="email-row">
              <input
                type="email"
                value={userEmail}
                onChange={(e) => setUserEmail(e.target.value)}
                placeholder="your@email.com"
              />
              <button className="primary" type="button" onClick={saveEmail}><Save size={14} /> 保存</button>
            </div>
            {emailMsg && <div className="inline-msg">{emailMsg}</div>}
            <button className="secondary" type="button" onClick={testEmail} disabled={testing || !savedEmail} style={{ marginTop: 8 }}>
              <Send size={14} /> {testing ? "发送中..." : "发送测试邮箱"}
            </button>
            {testMsg && <div className="inline-msg">{testMsg}</div>}
          </section>

          <form className="settings-section" onSubmit={submit}>
            <h4><Send size={15} /> 文献推送</h4>
            <p className="section-hint">配置自动推送文献到邮箱的设置。</p>
            
            <div className="push-settings">
              <label className="checkline">
                <input
                  type="checkbox"
                  checked={pushEnabled}
                  onChange={(e) => {
                    setPushEnabled(e.target.checked);
                    if (e.target.checked) setPushEditing(true);
                  }}
                />
                启用自动推送
              </label>

              {pushEnabled && !pushEditing && (
                <div className="push-summary">
                  <div className="push-summary-grid">
                    <div className="push-summary-item">
                      <span className="push-summary-label">推送频率</span>
                      <span className="push-summary-value">
                        {pushFrequency === "daily" ? "每天" : pushFrequency === "weekly" ? "每周" : "每月"}
                      </span>
                    </div>
                    <div className="push-summary-item">
                      <span className="push-summary-label">发送时间</span>
                      <span className="push-summary-value">
                        {pushHour.padStart(2, '0')}:{pushMinute}
                        {pushFrequency === "weekly" && ` 周${["日","一","二","三","四","五","六"][pushWeekday]}`}
                        {pushFrequency === "monthly" && ` 每月${pushMonthDay}日`}
                      </span>
                    </div>
                    <div className="push-summary-item">
                      <span className="push-summary-label">邮件内容</span>
                      <span className="push-summary-value">
                        {[pushIncludeFile && "附件", pushIncludeAbstract && "摘要", pushIncludeKeywords && "关键词", pushIncludeTranslation && "翻译"].filter(Boolean).join("、")}
                      </span>
                    </div>
                    <div className="push-summary-item">
                      <span className="push-summary-label">推送期刊</span>
                      <span className="push-summary-value">
                        {pushJournalFilter ? pushSelectedJournals.size + " 本期刊" : "全部已订阅"}
                      </span>
                    </div>
                  </div>
                  <div className="push-actions">
                    <button className="secondary" type="button" onClick={() => setPushEditing(true)}>
                      <Settings size={16} /> 修改推送设置
                    </button>
                    <button className="secondary" type="button" onClick={sendPush} disabled={sending || !savedEmail}>
                      <Send size={16} /> {sending ? "发送中..." : "立即发送"}
                    </button>
                  </div>
                  {pushMsg && <div className="inline-msg">{pushMsg}</div>}
                </div>
              )}

              {pushEnabled && pushEditing && (
                <>
                  <div className="push-frequency">
                    <span className="settings-label">推送频率</span>
                    <div className="radio-group">
                      <label className="radio-item">
                        <input
                          type="radio"
                          name="pushFrequency"
                          value="daily"
                          checked={pushFrequency === "daily"}
                          onChange={(e) => setPushFrequency(e.target.value)}
                        />
                        每天
                      </label>
                      <label className="radio-item">
                        <input
                          type="radio"
                          name="pushFrequency"
                          value="weekly"
                          checked={pushFrequency === "weekly"}
                          onChange={(e) => setPushFrequency(e.target.value)}
                        />
                        每周
                      </label>
                      <label className="radio-item">
                        <input
                          type="radio"
                          name="pushFrequency"
                          value="monthly"
                          checked={pushFrequency === "monthly"}
                          onChange={(e) => setPushFrequency(e.target.value)}
                        />
                        每月
                      </label>
                    </div>
                  </div>

                  <div className="push-time-selector">
                    <span className="settings-label">发送时间</span>
                    <div className="time-selector-row">
                      <div className="time-select-group">
                        <select value={pushHour} onChange={(e) => setPushHour(e.target.value)}>
                          {Array.from({ length: 24 }, (_, i) => (
                            <option key={i} value={String(i)}>{String(i).padStart(2, '0')} 时</option>
                          ))}
                        </select>
                        <span className="time-separator">:</span>
                        <select value={pushMinute} onChange={(e) => setPushMinute(e.target.value)}>
                          {["00", "15", "30", "45"].map((m) => (
                            <option key={m} value={m}>{m} 分</option>
                          ))}
                        </select>
                      </div>
                      
                      {pushFrequency === "weekly" && (
                        <div className="time-select-group">
                          <select value={pushWeekday} onChange={(e) => setPushWeekday(e.target.value)}>
                            <option value="1">周一</option>
                            <option value="2">周二</option>
                            <option value="3">周三</option>
                            <option value="4">周四</option>
                            <option value="5">周五</option>
                            <option value="6">周六</option>
                            <option value="0">周日</option>
                          </select>
                        </div>
                      )}
                      
                      {pushFrequency === "monthly" && (
                        <div className="time-select-group">
                          <select value={pushMonthDay} onChange={(e) => setPushMonthDay(e.target.value)}>
                            {Array.from({ length: 28 }, (_, i) => (
                              <option key={i + 1} value={String(i + 1)}>每月 {i + 1} 日</option>
                            ))}
                            <option value="28">每月 28 日</option>
                          </select>
                        </div>
                      )}
                    </div>
                    <p className="field-hint">当前设置：{generateCron()}</p>
                  </div>

                  <div className="push-content-options">
                    <span className="settings-label">邮件内容</span>
                    <div className="checkbox-group">
                      <label className="checkline">
                        <input
                          type="checkbox"
                          checked={pushIncludeFile}
                          onChange={(e) => setPushIncludeFile(e.target.checked)}
                        />
                        附件文件
                      </label>
                      <label className="checkline">
                        <input
                          type="checkbox"
                          checked={pushIncludeAbstract}
                          onChange={(e) => setPushIncludeAbstract(e.target.checked)}
                        />
                        摘要
                      </label>
                      <label className="checkline">
                        <input
                          type="checkbox"
                          checked={pushIncludeKeywords}
                          onChange={(e) => setPushIncludeKeywords(e.target.checked)}
                        />
                        关键词
                      </label>
                      <label className="checkline">
                        <input
                          type="checkbox"
                          checked={pushIncludeTranslation}
                          onChange={(e) => setPushIncludeTranslation(e.target.checked)}
                        />
                        翻译
                      </label>
                    </div>
                  </div>

                  <div className="push-journal-filter">
                    <span className="settings-label">推送期刊范围</span>
                    <p className="field-hint">勾选需要推送的期刊，不勾选则推送所有已订阅期刊</p>
                    <div className="push-journal-list">
                      <label className="checkline push-journal-all">
                        <input
                          type="checkbox"
                          checked={pushSelectedJournals.size === 0}
                          onChange={() => {
                            setPushSelectedJournals(new Set());
                            setPushJournalFilter("");
                          }}
                        />
                        全部已订阅期刊
                      </label>
                      {availableJournals.map((j) => (
                        <label className="checkline" key={j.name}>
                          <input
                            type="checkbox"
                            checked={pushSelectedJournals.has(j.name)}
                            onChange={() => togglePushJournal(j.name)}
                          />
                          {j.name}
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="push-actions">
                    <button className="primary" type="submit"><Save size={16} /> 保存推送设置</button>
                    <button className="secondary" type="button" onClick={() => setPushEditing(false)}>
                      取消
                    </button>
                    <button className="secondary" type="button" onClick={sendPush} disabled={sending || !savedEmail}>
                      <Send size={16} /> {sending ? "发送中..." : "立即发送"}
                    </button>
                  </div>
                  {pushMsg && <div className="inline-msg">{pushMsg}</div>}
                </>
              )}
            </div>
          </form>
        </div>

        {/* Right Column: Journals */}
        <div className="settings-right">
          <form className="settings-section" onSubmit={submit}>
            <h4>订阅期刊</h4>
            <div className="journal-compact-header">
              <span className="section-hint">勾选订阅期刊，最新文献仅展示已订阅的论文。</span>
              <div>
                <button type="button" className="link-button" onClick={() => setSelectedJournalNames(new Set(availableJournals.map((j) => j.name)))}>全选</button>
                <button type="button" className="link-button" onClick={() => setSelectedJournalNames(new Set())}>清空</button>
              </div>
            </div>
            <div className="journal-list-compact">
              {availableJournals.map((j) => (
                <label className="journal-item" key={j.name}>
                  <input type="checkbox" checked={selectedJournalNames.has(j.name)} onChange={() => toggleJournal(j.name)} />
                  <span>{j.name}</span>
                </label>
              ))}
            </div>
            <div className="settings-actions">
              <button className="primary" type="submit"><Save size={16} /> 保存设置</button>
              <button className="secondary" type="button" onClick={enrichKeywords} disabled={enriching}>
                <RefreshCw size={16} className={enriching ? "spin" : ""} /> {enriching ? "补全中..." : "补全关键词"}
              </button>
            </div>
            {enrichMessage && <div className="inline-msg">{enrichMessage}</div>}
          </form>

        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
