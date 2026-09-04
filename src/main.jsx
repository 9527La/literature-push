import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  ArrowDownUp,
  BarChart3,
  Bell,
  BookOpen,
  Check,
  CloudDownload,
  CloudUpload,
  CircleStop,
  Database,
  ExternalLink,
  Eye,
  EyeOff,
  FileText,
  Filter,
  Heart,
  HardDrive,
  HelpCircle,
  Mail,
  MessageCircle,
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
  ThumbsUp,
  Users,
  UserPlus,
  UserRound,
  X
} from "lucide-react";
import "./styles.css";

function getUserToken() {
  return localStorage.getItem("userToken") || sessionStorage.getItem("userToken") || "";
}

const ACCOUNT_LOGIN_SETTINGS_KEY = "accountLoginSettings";

function readAccountLoginSettings() {
  try {
    const value = JSON.parse(localStorage.getItem(ACCOUNT_LOGIN_SETTINGS_KEY) || "null");
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

function saveAccountLoginSettings({ username, password, rememberPassword, autoLogin }) {
  const next = {
    username: String(username || "").trim(),
    rememberPassword: Boolean(rememberPassword),
    autoLogin: Boolean(autoLogin)
  };
  if (rememberPassword && password) next.password = String(password);
  localStorage.setItem(ACCOUNT_LOGIN_SETTINGS_KEY, JSON.stringify(next));
}

function setAccountToken(token, persistent) {
  localStorage.removeItem("userToken");
  sessionStorage.removeItem("userToken");
  (persistent ? localStorage : sessionStorage).setItem("userToken", token);
}

function clearAccountToken() {
  localStorage.removeItem("userToken");
  sessionStorage.removeItem("userToken");
}

function disableAccountAutoLogin() {
  const settings = readAccountLoginSettings();
  localStorage.setItem(ACCOUNT_LOGIN_SETTINGS_KEY, JSON.stringify({
    ...settings,
    autoLogin: false
  }));
}

function getPassportToken() {
  return localStorage.getItem("passportToken") || "";
}

async function parseResponse(response) {
  if (response.ok) return response.json();
  const text = await response.text();
  try {
    const data = JSON.parse(text);
    const error = new Error(data.error || text);
    error.status = response.status;
    throw error;
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error(text || `请求失败（${response.status}）`);
    throw error;
  }
}

function requestHeaders(hasBody = false) {
  const headers = {};
  if (hasBody) headers["Content-Type"] = "application/json";
  const passportToken = getPassportToken();
  if (passportToken) headers["X-Passport-Token"] = passportToken;
  const userToken = getUserToken();
  if (userToken) headers["X-User-Token"] = userToken;
  return headers;
}

const DEFAULT_FILTERS = { journal: [], q: "", keyword: [], unread: false, favorite: false, from: "", to: "", sort: "desc" };
const DEFAULT_DISPLAY = { authors: true, keywords: true, abstract: true, bilingual: true, translatedAbstract: true };

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
        <p>本系统自动订阅电力系统领域期刊的最新文献，提供文献浏览、关键词统计、邮件推送、公共讨论和账户个性设置同步。</p>
      </section>

      <section className="help-section">
        <h3><Bell size={18} /> 最新文献</h3>
        <p>展示所有已订阅期刊的最新论文，支持以下操作：</p>
        <ul>
          <li><strong>搜索</strong>：在顶部搜索框输入关键词，可搜索标题、作者、摘要和关键词内容。匹配的文本会高亮显示。</li>
          <li><strong>筛选</strong>：左侧面板提供多维度筛选条件，包括期刊（多选）、关键词频次（多选）、时间范围、仅未读、仅收藏。不同筛选条件之间为"且"关系，同一条件内多选为"或"关系。</li>
          <li><strong>排序</strong>：支持按发布时间（升序/降序）和按相关性排序。相关性排序根据搜索词在标题（权重 3）、关键词（权重 2）、摘要（权重 1）中出现的次数计算。</li>
          <li><strong>收藏与阅读</strong>：点击心形图标收藏文献，点击文献卡片可展开查看详情，同时自动标记为已读。</li>
          <li><strong>显示控制</strong>：可通过主页面顶部开关控制作者、关键词、摘要以及中文标题的可见性。</li>
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
          <li><strong>网页通行证</strong>：先使用管理员或用户通行证进入网页；通行证与个人账户相互独立。</li>
          <li><strong>个人账户</strong>：可自行注册，用户名唯一。游客可以浏览，但不能参与公共讨论或保存个人阅读、收藏和推送设置。</li>
          <li><strong>账户资料</strong>：可保存姓名、入学年份、学历和周报邮箱。</li>
          <li><strong>本机保存</strong>：开启自动保存后，筛选、列表显示、期刊订阅和推送配置会保存在当前浏览器。</li>
          <li><strong>远端同步</strong>：登录后可手动上传当前设置，也可从远端账户载入。</li>
          <li><strong>公共讨论</strong>：登录个人账户后可设置发言名称、发布主题、评论和点赞；公开标签按账户固定，不使用 IP 作为新账户身份。</li>
        </ul>
      </section>

      <section className="help-section">
        <h3><RefreshCw size={18} /> 数据刷新</h3>
        <p>系统支持两种刷新方式：</p>
        <ul>
          <li><strong>手动维护</strong>：最高管理员可在“管理中心”即时拉取最新文献、补全摘要和关键词，或批量翻译缺失的标题和摘要。</li>
          <li><strong>定时刷新</strong>：在周报递送页面中设置 Cron 表达式，系统将按计划自动获取新文献。默认每天凌晨执行一次。</li>
        </ul>
      </section>

      <section className="help-section">
        <h3><HelpCircle size={18} /> 常见问题</h3>
        <ul>
          <li><strong>局域网访问</strong>：同一 Wi-Fi 下的其他设备可通过浏览器输入本机显示的局域网地址访问本系统。</li>
          <li><strong>版本更新</strong>：系统更新后会弹出更新说明，可选择"知道了"关闭，下次更新前不再重复提示。</li>
          <li><strong>管理中心</strong>：只有管理员网页通行证可查看网站统计、用户、期刊完整度和刷新记录，并执行数据维护。</li>
        </ul>
      </section>
    </div>
  );
}

function LoginGate({ onAuthenticate }) {
  const [passport, setPassport] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setSubmitting(true);
    setMessage("");
    try {
      await onAuthenticate(passport);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-shell">
      <section className="login-panel" aria-labelledby="login-title">
        <div className="login-brand"><BookOpen size={26} /><span>电力文献</span></div>
        <span className="eyebrow">受限访问</span>
        <h1 id="login-title">输入网页通行证</h1>
        <p>通行证用于进入网页。进入后可游客浏览，也可以注册或登录独立的个人账户。</p>
        <form className="auth-form login-form" onSubmit={submit} onInput={() => setMessage("")}>
          <label><span>网页通行证</span><input type="password" value={passport} autoComplete="current-password" maxLength={128} onChange={(event) => setPassport(event.target.value)} required autoFocus /></label>
          <button className="primary" disabled={submitting || !passport}>{submitting ? "正在验证" : "进入网页"}</button>
          {message && <div className="inline-msg login-error" role="alert">{message}</div>}
        </form>
        <small>管理员通行证可进入管理中心；全站最多允许 20 个不同 IP 同时登录个人账户。</small>
      </section>
    </main>
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
    return ["feed", "stats", "settings", "feedback", "account", "admin", "help"].includes(requested) ? requested : "feed";
  });
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [gateAuthenticated, setGateAuthenticated] = useState(false);
  const [gateRole, setGateRole] = useState("");
  const [message, setMessage] = useState("");
  const [versionInfo, setVersionInfo] = useState(null);
  const [account, setAccount] = useState({ authenticated: false, can_register: true, username: "", role: "guest", is_admin: false, passport_authenticated: false, passport_role: "" });
  const autoLoginAttemptRef = useRef("");
  const autoLoginPromiseRef = useRef(null);
  const articleCacheRef = useRef(new Map());
  
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

  async function loadAccountWithAutoLogin() {
    if (autoLoginPromiseRef.current) return autoLoginPromiseRef.current;

    const run = (async () => {
      const current = await api.get("/api/account");
      const loginSettings = readAccountLoginSettings();
      const hasStoredToken = Boolean(getUserToken());
      const canAutoLogin = Boolean(
        loginSettings.autoLogin
        && loginSettings.username
        && loginSettings.password
        && loginSettings.rememberPassword
      );
      if (current.authenticated || (!canAutoLogin && hasStoredToken)) return current;
      if (!canAutoLogin) return current;

      // A failed stored credential should not be retried on every filter or
      // view change during this page session. A successful manual login clears
      // this marker below, allowing the user to recover immediately.
      const attemptKey = `${loginSettings.username}\u0000${loginSettings.password}`;
      if (autoLoginAttemptRef.current === attemptKey) return current;
      autoLoginAttemptRef.current = attemptKey;

      try {
        const result = await api.post("/api/auth/login", {
          username: loginSettings.username,
          password: loginSettings.password
        });
        setAccountToken(result.token, true);
        autoLoginAttemptRef.current = "";
        return result.account || await api.get("/api/auth/session");
      } catch {
        // A stale password should not prevent the site itself from opening.
        // Clear only the session token; keep the saved username/password visible
        // in the account form so the user can correct it manually.
        clearAccountToken();
        return current;
      }
    })();

    autoLoginPromiseRef.current = run;
    try {
      return await run;
    } finally {
      if (autoLoginPromiseRef.current === run) autoLoginPromiseRef.current = null;
    }
  }

  async function loadAll({ forceArticles = false } = {}) {
    // Resolve a remembered account before loading user-specific data. This
    // ensures read/favorite/settings requests carry the restored token.
    const nextAccount = await loadAccountWithAutoLogin();
    const articleCacheKey = `${getUserToken() || "guest"}::${debouncedQuery}`;
    const cachedArticles = !forceArticles && articleCacheRef.current.get(articleCacheKey);
    const articlesPromise = cachedArticles
      ? Promise.resolve(cachedArticles)
      : api.get(`/api/articles${debouncedQuery ? `?${debouncedQuery}` : ""}`).then((result) => {
        articleCacheRef.current.set(articleCacheKey, result);
        return result;
      });
    const [nextSettings, nextStatus, nextArticles, journals] = await Promise.all([
      api.get("/api/settings"),
      api.get("/api/status"),
      articlesPromise,
      availableJournals.length ? Promise.resolve(availableJournals) : api.get("/api/journals")
    ]);
    setSettings(nextSettings);
    setStatus(nextStatus);
    setArticles(nextArticles);
    setAccount(nextAccount);
    if (activeView === "admin" && !nextAccount.is_admin) setActiveView("feed");
    if (getUserToken() && !nextAccount.authenticated) clearAccountToken();
    if (!availableJournals.length) setAvailableJournals(journals);
    setInitialLoading(false);
  }

  useEffect(() => {
    api.get("/api/gate/session")
      .then((session) => {
        setGateAuthenticated(Boolean(session.authenticated));
        setGateRole(session.role || "");
        if (!session.authenticated) {
          localStorage.removeItem("passportToken");
          setInitialLoading(false);
        }
      })
      .catch(() => setInitialLoading(false));
  }, []);

  useEffect(() => {
    if (!gateAuthenticated) return;
    loadAll().catch((error) => {
      if (error.status === 401 || String(error.message).includes("通行证")) {
        localStorage.removeItem("passportToken");
        setGateAuthenticated(false);
        setGateRole("");
        clearAccountToken();
        setAccount({ authenticated: false, can_register: true, username: "", role: "guest", is_admin: false, passport_authenticated: false, passport_role: "" });
      } else {
        setMessage(error.message);
      }
      setInitialLoading(false);
    });
  }, [debouncedQuery, gateAuthenticated]);

  async function refresh() {
    setLoading(true);
    setMessage("");
    try {
      const result = await api.post("/api/refresh");
      setMessage(result.status === "success" ? `刷新完成，新增 ${result.addedCount} 篇文献。` : result.message);
      setTimeout(() => setMessage(""), 3000);
      articleCacheRef.current.clear();
      await loadAll({ forceArticles: true });
    } catch (error) {
      setMessage(error.message);
      setTimeout(() => setMessage(""), 5000);
      await api.get("/api/status").then(setStatus).catch(() => {});
    } finally {
      setLoading(false);
    }
  }

  async function markRead(id) {
    if (!account.authenticated) {
      setMessage("游客模式只能浏览，请先登录个人账户保存阅读状态。");
      setActiveView("account");
      return;
    }
    await api.post(`/api/articles/${id}/read`);
    articleCacheRef.current.clear();
    await loadAll();
  }

  async function toggleFavorite(id) {
    if (!account.authenticated) {
      setMessage("游客模式不能收藏文献，请先登录个人账户。");
      setActiveView("account");
      return;
    }
    await api.post(`/api/articles/${id}/favorite`);
    articleCacheRef.current.clear();
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
    return saved;
  }

  const updateArticleInList = useCallback((nextArticles) => {
    const updates = (Array.isArray(nextArticles) ? nextArticles : [nextArticles]).filter((article) => article?.id);
    if (!updates.length) return;
    articleCacheRef.current.clear();
    const updatesById = new Map(updates.map((article) => [article.id, article]));
    setArticles((current) => current.map((article) => (
      updatesById.has(article.id) ? { ...article, ...updatesById.get(article.id) } : article
    )));
  }, []);

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

  async function authenticate(passport) {
    const result = await api.post("/api/gate/login", { passport });
    localStorage.setItem("passportToken", result.token);
    setGateAuthenticated(true);
    setGateRole(result.role || "");
    setInitialLoading(true);
    await loadAll();
  }

  async function authenticateAccount(mode, credentials, loginOptions = {}) {
    const result = await api.post(`/api/auth/${mode}`, credentials);
    const shouldAutoLogin = Boolean(loginOptions.autoLogin);
    setAccountToken(result.token, shouldAutoLogin);
    saveAccountLoginSettings({
      username: credentials.username,
      password: credentials.password,
      rememberPassword: loginOptions.rememberPassword,
      autoLogin: shouldAutoLogin
    });
    autoLoginAttemptRef.current = "";
    articleCacheRef.current.clear();
    const session = result.account || await api.get("/api/auth/session");
    setAccount(session);
    await loadAll();
  }

  async function logoutUser() {
    await api.post("/api/auth/logout").catch(() => {});
    clearAccountToken();
    disableAccountAutoLogin();
    articleCacheRef.current.clear();
    setAccount({ email: "", name: "", enrollment_year: null, degree: "", authenticated: false, can_register: true, username: "", role: "guest", is_admin: gateRole === "admin", passport_authenticated: gateAuthenticated, passport_role: gateRole });
    setActiveView("feed");
    await loadAll().catch(() => {});
  }

  async function leaveWebsite() {
    await api.post("/api/auth/logout").catch(() => {});
    clearAccountToken();
    disableAccountAutoLogin();
    articleCacheRef.current.clear();
    localStorage.removeItem("passportToken");
    setGateAuthenticated(false);
    setGateRole("");
    setAccount({ authenticated: false, can_register: true, username: "", role: "guest", is_admin: false, passport_authenticated: false, passport_role: "" });
    setInitialLoading(false);
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

  if (initialLoading && !gateAuthenticated) {
    return <div className="login-shell"><div className="login-loading" aria-label="正在检查登录状态" /></div>;
  }

  if (!gateAuthenticated) {
    return <LoginGate onAuthenticate={authenticate} />;
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
              <MessageSquare size={16} /> 公共讨论
            </button>
            <button className={activeView === "account" ? "active" : ""} onClick={() => setActiveView("account")}>
              <UserRound size={16} /> {account.authenticated ? account.username : "游客账户"}
            </button>
            {account.is_admin && <button className={activeView === "admin" ? "active" : ""} onClick={() => setActiveView("admin")}>
              <ShieldCheck size={16} /> 管理中心
            </button>}
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
          {account.is_admin && <button className="primary" onClick={refresh} disabled={loading}>
            <RefreshCw size={16} className={loading ? "spin" : ""} />
            {loading ? "刷新中" : "立即刷新"}
          </button>}
          <button className="secondary topbar-exit" type="button" onClick={leaveWebsite}>退出网页</button>
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
            onArticleUpdated={updateArticleInList}
            canPersonalize={account.authenticated}
          />
        ) : activeView === "settings" ? (
          <SettingsView
            settings={settings}
            availableJournals={availableJournals}
            status={status}
            onSave={saveSettings}
            canEdit={account.authenticated}
          />
        ) : activeView === "help" ? (
          <HelpView />
        ) : activeView === "account" ? (
          <AccountView
            account={account}
            onSave={saveAccount}
            onAuthenticate={authenticateAccount}
            onLogout={logoutUser}
            autoSavePersonalization={autoSavePersonalization}
            onAutoSaveChange={setAutoSave}
            onSaveLocal={savePersonalizationLocal}
            onLoadLocal={() => applyPersonalization(readLocalPersonalization())}
            onUploadRemote={uploadPersonalization}
            onLoadRemote={loadRemotePersonalization}
          />
        ) : activeView === "feedback" ? (
          <FeedbackView account={account} />
        ) : activeView === "admin" && account.is_admin ? (
          <AdminView onDataChanged={loadAll} />
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

function PersonalAccountAuth({ onAuthenticate }) {
  const [mode, setMode] = useState("login");
  const [credentials, setCredentials] = useState(() => {
    const saved = readAccountLoginSettings();
    return {
      username: String(saved.username || ""),
      password: saved.rememberPassword ? String(saved.password || "") : ""
    };
  });
  const [rememberPassword, setRememberPassword] = useState(() => {
    const saved = readAccountLoginSettings();
    return Boolean(saved.rememberPassword && saved.password);
  });
  const [autoLogin, setAutoLogin] = useState(() => {
    const saved = readAccountLoginSettings();
    // Keep the previous behavior convenient for first-time users while
    // respecting an explicit opt-out saved by logout or the form.
    return saved.autoLogin === undefined ? true : Boolean(saved.autoLogin);
  });
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function switchMode(nextMode) {
    setMode(nextMode);
    setMessage("");
    if (nextMode !== "login") {
      setCredentials({ username: "", password: "" });
      return;
    }
    const saved = readAccountLoginSettings();
    setCredentials({
      username: String(saved.username || ""),
      password: saved.rememberPassword ? String(saved.password || "") : ""
    });
    setRememberPassword(Boolean(saved.rememberPassword && saved.password));
    setAutoLogin(saved.autoLogin === undefined ? true : Boolean(saved.autoLogin));
  }

  async function submit(event) {
    event.preventDefault();
    setSubmitting(true);
    setMessage("");
    try {
      await onAuthenticate(mode, credentials, { rememberPassword, autoLogin });
    } catch (error) {
      setMessage(error.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="profile-layout" aria-labelledby="personal-account-title">
      <div className="page-intro account-heading">
        <div><span className="eyebrow">游客模式</span><h1 id="personal-account-title">个人账户</h1><p>网页通行证只负责进入站点；注册个人账户后，才能跨设备保存自己的阅读、收藏、推送和讨论身份。</p></div>
      </div>
      <div className="account-auth-card">
        <div className="auth-tabs" role="tablist" aria-label="个人账户操作">
          <button type="button" role="tab" aria-selected={mode === "login"} className={mode === "login" ? "active" : ""} onClick={() => switchMode("login")}>登录个人账户</button>
          <button type="button" role="tab" aria-selected={mode === "register"} className={mode === "register" ? "active" : ""} onClick={() => switchMode("register")}>注册个人账户</button>
        </div>
        <form className="auth-form" onSubmit={submit} onInput={() => setMessage("")}>
          <label><span>用户名</span><input value={credentials.username} autoComplete={mode === "login" ? "username" : "new-username"} maxLength={32} onChange={(event) => setCredentials({ ...credentials, username: event.target.value })} required autoFocus /></label>
          <label><span>密码</span><input type="password" value={credentials.password} autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={mode === "register" ? 8 : 1} maxLength={72} onChange={(event) => setCredentials({ ...credentials, password: event.target.value })} required /></label>
          <div className="auth-options" role="group" aria-label="登录选项">
            <label className="auth-option">
              <input type="checkbox" checked={rememberPassword} onChange={(event) => setRememberPassword(event.target.checked)} />
              <span><strong>记住密码</strong><small>在此浏览器保存用户名和密码，方便下次登录。</small></span>
            </label>
            <label className="auth-option">
              <input type="checkbox" checked={autoLogin} onChange={(event) => setAutoLogin(event.target.checked)} />
              <span><strong>自动登录</strong><small>同一 IP 下优先恢复有效登录状态，无需重复输入。</small></span>
            </label>
          </div>
          <button className="primary" disabled={submitting || !credentials.username || !credentials.password}>{submitting ? "处理中" : mode === "login" ? "登录个人账户" : "注册并登录"}</button>
          {message && <div className="inline-msg login-error" role="alert">{message}</div>}
        </form>
        <p className="auth-note">用户名必须唯一；最多注册 40 个个人账户。每个账户同一时间只能在一个 IP 上保持登录，但之后可从其他 IP 再次登录。记住密码会将密码保存在当前浏览器，请只在可信设备上启用。</p>
      </div>
    </section>
  );
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
  const messageTimerRef = useRef(null);
  const currentYear = new Date().getFullYear();

  useEffect(() => setForm(account), [account]);

  useEffect(() => () => {
    if (messageTimerRef.current) clearTimeout(messageTimerRef.current);
  }, []);

  function showTemporaryMessage(text) {
    if (messageTimerRef.current) clearTimeout(messageTimerRef.current);
    setMessage(text);
    messageTimerRef.current = setTimeout(() => {
      setMessage("");
      messageTimerRef.current = null;
    }, 3000);
  }

  function clearAccountMessage() {
    if (messageTimerRef.current) {
      clearTimeout(messageTimerRef.current);
      messageTimerRef.current = null;
    }
    setMessage("");
  }

  async function submitProfile(event) {
    event.preventDefault();
    setSaving(true);
    clearAccountMessage();
    try {
      await onSave(form);
      showTemporaryMessage("账户资料已保存。");
    } catch (error) {
      setMessage(error.message);
    } finally {
      setSaving(false);
    }
  }

  async function runSettingAction(action, successMessage) {
    setSaving(true);
    clearAccountMessage();
    try {
      await Promise.resolve(action());
      showTemporaryMessage(successMessage);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setSaving(false);
    }
  }

  if (!account.authenticated) {
    return <PersonalAccountAuth onAuthenticate={onAuthenticate} />;
  }

  return (
    <section className="profile-layout" aria-labelledby="account-title">
      <div className="page-intro account-heading">
        <div><span className="eyebrow">已登录 · {account.username}</span><h1 id="account-title">我的账户</h1><p>维护个人资料，并决定个性设置保存在本机还是同步至远端账户。</p></div>
        <button className="secondary" type="button" onClick={onLogout}><LogOut size={15} /> 退出登录</button>
      </div>

      <div className="account-grid">
        <form className="profile-card" onSubmit={submitProfile} onInput={clearAccountMessage}>
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

function AdminView({ onDataChanged }) {
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [runningAction, setRunningAction] = useState("");
  const [message, setMessage] = useState("");
  const [showCreateUser, setShowCreateUser] = useState(false);
  const [userForm, setUserForm] = useState({ username: "", password: "", name: "", email: "" });
  const [userSubmitting, setUserSubmitting] = useState(false);
  const [deleteUserId, setDeleteUserId] = useState(null);

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
      } else {
        const field = action === "titles" ? "title" : "abstract";
        const label = action === "titles" ? "标题" : "摘要";
        const result = await api.post("/api/admin/translate", { field, limit: 20 });
        const state = result.status === "error" ? "失败" : result.status === "partial" ? "部分完成" : "完成";
        const detail = result.errors?.[0]?.message ? ` 首条失败：${result.errors[0].message}` : "";
        setMessage(`${label}翻译${state}：本次处理 ${result.processed || 0} 篇，成功 ${result.translated || 0} 篇，失败 ${result.failed || 0} 篇；仍有 ${result.remaining || 0} 篇待翻译。${detail}`);
      }
      await Promise.all([loadOverview(), onDataChanged()]);
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
    ["原文摘要", coverage.abstracts],
    ["原文关键词", coverage.keywords],
    ["中文标题", coverage.translatedTitles],
    ["中文摘要", coverage.translatedAbstracts]
  ];
  const taskLabels = {
    refresh: "刷新文献",
    abstracts: "补全摘要",
    keywords: "补全关键词",
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
          <button className="secondary" type="button" disabled={Boolean(runningAction)} onClick={() => runDataAction("titles")}><Languages size={15} className={runningAction === "titles" ? "spin" : ""} /> {runningAction === "titles" ? "标题翻译中…" : "翻译标题"}</button>
          <button className="secondary" type="button" disabled={Boolean(runningAction)} onClick={() => runDataAction("translate-abstracts")}><Languages size={15} className={runningAction === "translate-abstracts" ? "spin" : ""} /> {runningAction === "translate-abstracts" ? "摘要翻译中…" : "翻译摘要"}</button>
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
          <div className="coverage-list">{coverageRows.map(([label, value]) => <div className="coverage-row" key={label}><div><span>{label}</span><strong>{Number(value || 0).toFixed(1)}%</strong></div><div className="coverage-track"><span style={{ width: `${Math.min(Number(value || 0), 100)}%` }} /></div></div>)}</div>
          <div className="coverage-pending" role="status"><span>当前待补全</span><strong>摘要 {pending.abstracts || 0} 篇 · 关键词 {pending.keywords || 0} 篇</strong></div>
        </section>

        <section className="admin-panel-card refresh-panel">
          <header><div><span className="eyebrow">任务记录</span><h2>最近任务</h2></div><RefreshCw size={19} /></header>
          <div className="refresh-ledger">
            {overview.recentRefreshes.length ? overview.recentRefreshes.map((run, index) => (
              <div key={`${run.started_at}-${index}`}>
                <span className={`run-state ${run.status}`}>{taskStatusLabels[run.status] || run.status}</span>
                <div className="run-details">
                  <div className="run-heading"><strong>{taskLabels[run.task_type] || "数据维护"}</strong><time>{formatDate(run.started_at)}</time></div>
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
    </section>
  );
}

function FeedbackView({ account }) {
  const isAdmin = Boolean(account.is_admin);
  const canDiscuss = Boolean(account.authenticated);
  const [items, setItems] = useState([]);
  const [content, setContent] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [discussionProfile, setDiscussionProfile] = useState({ displayName: "", publicTag: "" });
  const [displayNameDraft, setDisplayNameDraft] = useState("");
  const [replyDrafts, setReplyDrafts] = useState({});
  const [commentDrafts, setCommentDrafts] = useState({});
  const [openCommentComposerId, setOpenCommentComposerId] = useState(null);
  const [openAdminReplyId, setOpenAdminReplyId] = useState(null);
  const [closeConfirmId, setCloseConfirmId] = useState(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);

  async function loadFeedback() {
    setItems(await api.get("/api/feedback"));
  }

  async function loadDiscussionProfile() {
    const profile = await api.get("/api/feedback/profile");
    setDiscussionProfile(profile);
    setDisplayNameDraft(profile.displayName || "");
  }

  useEffect(() => {
    Promise.all([loadFeedback(), loadDiscussionProfile()]).catch((error) => setMessage(error.message));
  }, [canDiscuss]);

  async function saveDiscussionName(event) {
    event.preventDefault();
    try {
      const profile = await api.put("/api/feedback/profile", { displayName: displayNameDraft });
      setDiscussionProfile(profile);
      setMessage("发言名称已保存。");
      await loadFeedback();
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function submitFeedback(event) {
    event.preventDefault();
    if (!content.trim()) return;
    setSending(true);
    setMessage("");
    try {
      await api.post("/api/feedback", { content });
      setContent("");
      setMessage("讨论已公开发布。");
      await loadFeedback();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setSending(false);
    }
  }

  async function submitReply(id) {
    const reply = String(replyDrafts[id] || "").trim();
    if (!reply) return;
    try {
      await api.post(`/api/admin/feedback/${id}/reply`, { reply });
      setReplyDrafts({ ...replyDrafts, [id]: "" });
      setOpenAdminReplyId(null);
      await loadFeedback();
    } catch (error) {
      setMessage(error.message);
    }
  }

  function openAdminReply(item) {
    setOpenAdminReplyId((current) => current === item.id ? null : item.id);
    setReplyDrafts((current) => ({ ...current, [item.id]: current[item.id] ?? item.admin_reply ?? "" }));
  }

  async function closeTopic(id) {
    if (closeConfirmId !== id) {
      setCloseConfirmId(id);
      return;
    }
    try {
      await api.post(`/api/admin/feedback/${id}/close`);
      setCloseConfirmId(null);
      setOpenAdminReplyId(null);
      setOpenCommentComposerId(null);
      await loadFeedback();
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function submitComment(id) {
    const comment = String(commentDrafts[id] || "").trim();
    if (!comment) return;
    try {
      await api.post(`/api/feedback/${id}/comments`, {
        content: comment
      });
      setCommentDrafts((current) => ({ ...current, [id]: "" }));
      setOpenCommentComposerId(null);
      await loadFeedback();
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function toggleDiscussionLike(id) {
    try {
      const result = await api.post(`/api/feedback/${id}/like`);
      setItems((current) => current.map((item) => item.id === id
        ? { ...item, liked_by_me: result.liked, like_count: result.count }
        : item));
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function toggleCommentLike(discussionId, commentId) {
    try {
      const result = await api.post(`/api/feedback/comments/${commentId}/like`);
      setItems((current) => current.map((item) => item.id === discussionId
        ? { ...item, comments: item.comments.map((comment) => comment.id === commentId ? { ...comment, liked_by_me: result.liked, like_count: result.count } : comment) }
        : item));
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function removeFeedback(id) {
    const confirmationKey = `discussion-${id}`;
    if (deleteConfirmId !== confirmationKey) {
      setDeleteConfirmId(confirmationKey);
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

  async function removeComment(id) {
    const confirmationKey = `comment-${id}`;
    if (deleteConfirmId !== confirmationKey) {
      setDeleteConfirmId(confirmationKey);
      return;
    }
    try {
      await api.delete(`/api/admin/feedback/comments/${id}`);
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
          <span className="eyebrow">面向所有人的研究社区</span>
          <h1 id="feedback-title">公共讨论区</h1>
          <p>发布改进建议、补充使用经验，也可以评论和点赞已有讨论。这里的内容公开展示，不通过邮件转发。</p>
        </div>
      </header>

      <div className="feedback-grid">
        <div>
          {canDiscuss ? (
            <form className="feedback-composer" onSubmit={submitFeedback}>
              <div className="composer-author">
                <div className="mini-avatar">{(discussionProfile.displayName || "用").slice(0, 1)}</div>
                <span><strong>{discussionProfile.displayName || "请先设置发言名称"}</strong><small>账户标签 · {discussionProfile.publicTag || "读取中"}</small></span>
              </div>
              <div className="discussion-name-row">
                <label htmlFor="discussion-name">发言名称</label>
                <div><input id="discussion-name" value={displayNameDraft} maxLength={24} onChange={(event) => setDisplayNameDraft(event.target.value)} placeholder="设置你在讨论区的名称" /><button className="secondary" type="button" onClick={saveDiscussionName} disabled={!displayNameDraft.trim()}><Save size={14} /> 保存名称</button></div>
              </div>
              <textarea value={content} onChange={(e) => setContent(e.target.value)} maxLength={2000} rows={5} placeholder="发起一个讨论：描述问题、建议或希望大家补充的经验……" />
              <div className="composer-footer"><span>{content.length}/2000 · 每小时可发起 1 个讨论</span><button className="primary" disabled={sending || !content.trim() || !discussionProfile.displayName}><Send size={15} /> {sending ? "发布中" : "发起讨论"}</button></div>
              {message && <div className="inline-msg" role="status">{message}</div>}
            </form>
          ) : (
            <div className="guest-prompt discussion-guest-prompt"><UserRound size={20} /><div><strong>游客可以阅读公开讨论</strong><p>注册或登录个人账户后，才能设置发言名称、发布主题、评论和点赞。</p></div></div>
          )}

          <div className="feedback-stream" aria-live="polite">
            {items.length === 0 ? <div className="empty">还没有讨论。可以从一个具体的问题或改进建议开始。</div> : items.map((item) => (
              <article className="feedback-item" key={item.id}>
                <header>
                  <div className="mini-avatar">{item.author_name.slice(0, 1)}</div>
                  <div><strong>{item.author_name}</strong><span>公开标签 · {item.author_tag} · {formatDate(item.created_at)}</span></div>
                  {Boolean(item.is_closed) && <span className="topic-closed-badge"><CircleStop size={13} /> 已结束</span>}
                </header>
                <p>{item.content}</p>
                <div className="discussion-actions">
                  <button className={item.liked_by_me ? "is-liked" : ""} type="button" onClick={() => toggleDiscussionLike(item.id)} disabled={!canDiscuss} aria-pressed={Boolean(item.liked_by_me)}><ThumbsUp size={15} /> {item.like_count || 0}</button>
                  <button type="button" disabled={!canDiscuss || Boolean(item.is_closed)} onClick={() => setOpenCommentComposerId((current) => current === item.id ? null : item.id)} aria-expanded={openCommentComposerId === item.id} aria-controls={`comment-composer-${item.id}`}><MessageCircle size={15} /> {item.is_closed ? "话题已结束" : "评论"} · {item.comment_count || 0}</button>
                </div>
                {item.admin_reply && <div className="admin-reply"><strong><ShieldCheck size={14} /> 管理员回复</strong><p>{item.admin_reply}</p><time>{formatDate(item.replied_at)}</time></div>}
                {isAdmin && <div className="admin-topic-toolbar" aria-label="管理员话题操作">
                  <span>话题操作</span>
                  <button className="secondary" type="button" disabled={Boolean(item.is_closed)} onClick={() => openAdminReply(item)}><MessageSquare size={14} /> 评论话题</button>
                  <button className="secondary" type="button" disabled={Boolean(item.is_closed)} onClick={() => closeTopic(item.id)}><CircleStop size={14} /> {closeConfirmId === item.id ? "确认结束话题" : item.is_closed ? "话题已结束" : "结束话题"}</button>
                  <button className="danger-button" type="button" onClick={() => removeFeedback(item.id)}><Trash2 size={14} /> {deleteConfirmId === `discussion-${item.id}` ? "确认删除话题" : "删除话题"}</button>
                </div>}
                {isAdmin && openAdminReplyId === item.id && !item.is_closed && <div className="admin-reply-composer">
                  <label htmlFor={`admin-reply-${item.id}`}>{item.admin_reply ? "更新管理员评论" : "以管理员身份评论话题"}</label>
                  <textarea id={`admin-reply-${item.id}`} rows={3} maxLength={2000} value={replyDrafts[item.id] || ""} onChange={(event) => setReplyDrafts((current) => ({ ...current, [item.id]: event.target.value }))} placeholder="输入公开显示的管理员评论" />
                  <div><button className="secondary" type="button" onClick={() => setOpenAdminReplyId(null)}>取消</button><button className="primary" type="button" onClick={() => submitReply(item.id)} disabled={!String(replyDrafts[item.id] || "").trim()}><Send size={14} /> 发布评论</button></div>
                </div>}
                <section className="discussion-comments" aria-label="讨论评论">
                  {item.comments.map((comment) => (
                    <article className="discussion-comment" key={comment.id}>
                      <div className="comment-rail" aria-hidden="true"><span>{comment.author_name.slice(0, 1)}</span></div>
                      <div className="comment-body">
                        <header><strong>{comment.author_name}</strong><span>公开标签 · {comment.author_tag} · {formatDate(comment.created_at)}</span></header>
                        <p>{comment.content}</p>
                        <div className="comment-actions">
                          <button className={comment.liked_by_me ? "is-liked" : ""} type="button" onClick={() => toggleCommentLike(item.id, comment.id)} disabled={!canDiscuss} aria-pressed={Boolean(comment.liked_by_me)}><ThumbsUp size={13} /> {comment.like_count || 0}</button>
                          {isAdmin && <button className="comment-delete" type="button" onClick={() => removeComment(comment.id)}><Trash2 size={13} /> {deleteConfirmId === `comment-${comment.id}` ? "确认删除" : "删除"}</button>}
                        </div>
                      </div>
                    </article>
                  ))}
                  {openCommentComposerId === item.id && !item.is_closed && <div className="comment-composer" id={`comment-composer-${item.id}`}>
                    <textarea rows={2} maxLength={1000} value={commentDrafts[item.id] || ""} onChange={(event) => setCommentDrafts((current) => ({ ...current, [item.id]: event.target.value }))} placeholder="补充你的看法或使用经验" />
                    <div>
                      <span className="comment-identity">{discussionProfile.displayName} · {discussionProfile.publicTag}</span>
                      <button className="secondary" type="button" disabled={!String(commentDrafts[item.id] || "").trim()} onClick={() => submitComment(item.id)}><Send size={14} /> 发表评论</button>
                    </div>
                  </div>}
                </section>
              </article>
            ))}
          </div>
        </div>

      </div>
    </section>
  );
}

function Feed({ articles, subscribedJournals, journals, filters, setFilters, markRead, toggleFavorite, displayPreferences, onDisplayPreferencesChange, onArticleUpdated, canPersonalize }) {
  const [selectedArticle, setSelectedArticle] = useState(null);
  const [topKeywords, setTopKeywords] = useState([]);
  const [visibleCount, setVisibleCount] = useState(50);
  const [preparation, setPreparation] = useState({ active: false, total: 0, completed: 0, enriched: 0, enrichedAbstract: 0, enrichedKeywords: 0, translated: 0, failed: 0, failedAbstract: 0, failedKeywords: 0, message: "" });
  const attemptedPreparationIdsRef = useRef(new Set());
  const preparationJobRef = useRef("");
  const preparationTimerRef = useRef(null);
  const preparationMountedRef = useRef(true);

  useEffect(() => {
    api.get("/api/keyword-stats").then((data) => {
      setTopKeywords(data.keywords || []);
    }).catch(() => {});
  }, []);

  useEffect(() => setVisibleCount(50), [filters]);

  useEffect(() => {
    preparationMountedRef.current = true;
    return () => {
      preparationMountedRef.current = false;
      preparationJobRef.current = "";
      if (preparationTimerRef.current) clearTimeout(preparationTimerRef.current);
    };
  }, []);

  function toggleDisplay(field) {
    onDisplayPreferencesChange({ ...displayPreferences, [field]: !displayPreferences[field] });
  }

  function handleArticleUpdated(nextArticles) {
    const updates = (Array.isArray(nextArticles) ? nextArticles : [nextArticles]).filter((article) => article?.id);
    onArticleUpdated(updates);
    setSelectedArticle((current) => {
      if (!current) return current;
      const update = updates.find((article) => article.id === current.id);
      return update ? { ...current, ...update } : current;
    });
  }

  function articleNeedsPreparation(article) {
    return !article.abstract?.trim()
      || !article.keywords?.trim()
      || !article.translated_title?.trim()
      || (Boolean(article.abstract?.trim()) && !article.translated_abstract?.trim());
  }

  async function pollPreparationJob(jobId) {
    if (!preparationMountedRef.current || preparationJobRef.current !== jobId) return;
    try {
      const job = await api.get(`/api/articles/prepare/${jobId}`);
      if (job.results?.length) handleArticleUpdated(job.results);
      const finished = job.status === "complete";
      setPreparation({
        active: !finished,
        total: job.total,
        completed: job.completed,
        enriched: job.enriched,
        enrichedAbstract: job.enrichedAbstract,
        enrichedKeywords: job.enrichedKeywords,
        translated: job.translated,
        failed: job.failed,
        failedAbstract: job.failedAbstract,
        failedKeywords: job.failedKeywords,
        message: finished
          ? `后台补全完成：摘要 +${job.enrichedAbstract || 0}，关键词 +${job.enrichedKeywords || 0}，翻译 +${job.translated || 0}；失败：摘要 ${job.failedAbstract || 0}，关键词 ${job.failedKeywords || 0}，其他 ${Math.max((job.failed || 0) - (job.failedAbstract || 0) - (job.failedKeywords || 0), 0)}。`
          : "已有内容已从本地数据库直接显示，正在后台补全缺失的摘要、关键词和中文翻译。"
      });
      if (finished) {
        preparationJobRef.current = "";
        preparationTimerRef.current = setTimeout(() => {
          if (preparationMountedRef.current) setPreparation((current) => ({ ...current, message: "" }));
        }, 6000);
        return;
      }
      preparationTimerRef.current = setTimeout(() => pollPreparationJob(jobId), 1500);
    } catch (error) {
      preparationJobRef.current = "";
      setPreparation((current) => ({ ...current, active: false, message: `批量补全暂未完成：${error.message}` }));
    }
  }

  async function startArticlePreparation(ids, { force = false } = {}) {
    if (preparationJobRef.current) return;
    const uniqueIds = [...new Set(ids.map(Number).filter((id) => Number.isInteger(id) && id > 0))];
    const selectedIds = force
      ? uniqueIds
      : uniqueIds.filter((id) => !attemptedPreparationIdsRef.current.has(id));
    if (!selectedIds.length) return;
    selectedIds.forEach((id) => attemptedPreparationIdsRef.current.add(id));
    setPreparation({ active: true, total: selectedIds.length, completed: 0, enriched: 0, enrichedAbstract: 0, enrichedKeywords: 0, translated: 0, failed: 0, failedAbstract: 0, failedKeywords: 0, message: `已从本地数据库直接显示已有内容，正在创建 ${selectedIds.length} 篇缺失内容的补全任务…` });
    try {
      const job = await api.post("/api/articles/prepare", { ids: selectedIds });
      preparationJobRef.current = job.jobId;
      setPreparation((current) => ({ ...current, total: job.total, message: "已有内容已从本地数据库直接显示，正在后台补全缺失的摘要、关键词和中文翻译。" }));
      await pollPreparationJob(job.jobId);
    } catch (error) {
      setPreparation((current) => ({ ...current, active: false, message: `无法启动批量补全：${error.message}` }));
    }
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

  const visibleArticles = sortedArticles.slice(0, visibleCount);
  const visibleTranslatedCount = visibleArticles.filter((article) => (
    article.translated_title && article.translated_title !== article.title
  )).length;
  const visibleAbstractCount = visibleArticles.filter((article) => Boolean(article.abstract?.trim())).length;
  const visibleTranslatedAbstractCount = visibleArticles.filter((article) => Boolean(article.translated_abstract?.trim())).length;
  const visiblePendingArticles = visibleArticles.filter(articleNeedsPreparation);
  const visibleReadyCount = visibleArticles.length - visiblePendingArticles.length;
  const visiblePendingCount = visiblePendingArticles.length;
  const visiblePreparationKey = visibleArticles.map((article) => [
    article.id,
    Boolean(article.abstract?.trim()),
    Boolean(article.keywords?.trim()),
    Boolean(article.translated_title?.trim()),
    Boolean(article.translated_abstract?.trim())
  ].join(":" )).join("|");

  useEffect(() => {
    if (preparationJobRef.current) return;
    const missingIds = visiblePendingArticles.map((article) => article.id);
    if (missingIds.length) void startArticlePreparation(missingIds);
  }, [visiblePreparationKey, preparation.active]);

  useEffect(() => {
    // A completion notice belongs to the page that started the job. Clear it
    // when the user switches to a different journal/filter so it is not
    // mistaken for another round of background loading.
    if (!preparation.active && preparation.message) {
      setPreparation((current) => ({ ...current, message: "" }));
    }
  }, [visiblePreparationKey]);

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
          <div className="keyword-filter-list journal-filter-list">
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
          <button
            type="button"
            className={`display-toggle ${displayPreferences.bilingual ? "active" : ""}`}
            aria-pressed={displayPreferences.bilingual}
            aria-label={displayPreferences.bilingual ? "隐藏中文标题" : "显示中文标题"}
            title={displayPreferences.bilingual ? "隐藏中文标题" : "显示中文标题"}
            onClick={() => toggleDisplay("bilingual")}
          >
            {displayPreferences.bilingual ? <Eye size={14} /> : <EyeOff size={14} />}
            中文标题
          </button>
          <button type="button" className={`display-toggle ${displayPreferences.translatedAbstract ? "active" : ""}`} onClick={() => toggleDisplay("translatedAbstract")}>
            {displayPreferences.translatedAbstract ? <Eye size={14} /> : <EyeOff size={14} />} 中文摘要
          </button>
          <span className="display-summary" role="status">
            {`数据库已载入 ${visibleReadyCount} 篇`}
            {visiblePendingCount > 0 && ` · ${visiblePendingCount} 篇待补全`}
            {displayPreferences.bilingual && ` · ${visibleTranslatedCount} 篇有中文标题`}
            {displayPreferences.abstract && ` · ${visibleAbstractCount} 篇有摘要`}
            {displayPreferences.translatedAbstract && ` · ${visibleTranslatedAbstractCount} 篇有中文摘要`}
          </span>
        </div>

        {(preparation.active || preparation.message) && (
          <div className={`preparation-bar ${preparation.active ? "active" : ""}`} role="status" aria-live="polite">
            <div className="preparation-copy">
              <strong>{preparation.active ? "正在补全当前页面缺失内容" : "当前页面后台补全结果"}</strong>
              <span>{preparation.message || "已有内容直接来自本地数据库，仅对缺失的摘要、关键词和翻译进行补全。"}</span>
            </div>
            {preparation.active && (
              <div className="preparation-progress">
                <progress max={Math.max(preparation.total, 1)} value={preparation.completed} />
                <span>{preparation.completed}/{preparation.total}</span>
              </div>
            )}
            {visiblePendingCount > 0 && (
              <button
                className="secondary compact"
                type="button"
                disabled={preparation.active}
                onClick={() => startArticlePreparation(visiblePendingArticles.map((article) => article.id), { force: true })}
              >
                <RefreshCw size={14} className={preparation.active ? "spin" : ""} /> 批量补全当前批次
              </button>
            )}
          </div>
        )}

        <div className="article-count">
          共 <strong>{sortedArticles.length}</strong> 篇文献
          {sortedArticles.filter(a => a.is_read).length > 0 && <>，已读 <strong>{sortedArticles.filter(a => a.is_read).length}</strong> 篇</>}
          {sortedArticles.filter(a => a.is_favorite).length > 0 && <>，收藏 <strong>{sortedArticles.filter(a => a.is_favorite).length}</strong> 篇</>}
        </div>

        <div className="article-list">
          {sortedArticles.length === 0 ? (
            <div className="empty">暂无文献。点击刷新从公开数据源获取，或调整筛选条件。</div>
          ) : (
            visibleArticles.map((article) => (
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
                  {displayPreferences.bilingual && !article.translated_title && (
                    <button type="button" className="translation-missing" disabled={preparation.active} onClick={() => startArticlePreparation([article.id], { force: true })}>
                      <Languages size={13} /> 获取中文翻译
                    </button>
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
                  {displayPreferences.abstract && (
                    article.abstract
                      ? <p className="abstract"><Highlight text={article.abstract} terms={highlightTerms} /></p>
                      : <button type="button" className="abstract-missing" disabled={preparation.active} onClick={() => startArticlePreparation([article.id], { force: true })}>获取摘要与中文翻译</button>
                  )}
                  {displayPreferences.translatedAbstract && article.translated_abstract && (
                    <div className="translated-abstract"><span>中文摘要</span><p>{article.translated_abstract}</p></div>
                  )}
                  {displayPreferences.translatedAbstract && article.abstract && !article.translated_abstract && (
                    <button type="button" className="translation-missing" disabled={preparation.active} onClick={() => startArticlePreparation([article.id], { force: true })}>
                      <Languages size={13} /> 获取中文摘要
                    </button>
                  )}
                </div>
                <div className="article-actions">
                  <button title="查看摘要" onClick={() => setSelectedArticle(article)}>
                    <ScrollText size={18} />
                  </button>
                  <button title={canPersonalize ? (article.is_read ? "取消已读" : "标记已读") : "登录个人账户后可标记已读"} className={`action-read ${article.is_read ? "action-done" : ""}`} onClick={() => markRead(article.id)} disabled={!canPersonalize}>
                    <Check size={18} />
                  </button>
                  <button
                    title={canPersonalize ? (article.is_favorite ? "取消收藏" : "收藏") : "登录个人账户后可收藏"}
                    className={article.is_favorite ? "selected" : ""}
                    onClick={() => toggleFavorite(article.id)}
                    disabled={!canPersonalize}
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
          onArticleUpdated={handleArticleUpdated}
        />
      )}
    </div>
  );
}

function ArticleDialog({ article, close, markRead, toggleFavorite, onArticleUpdated }) {
  const [detail, setDetail] = useState(article);
  const [enriching, setEnriching] = useState(!article.abstract || !article.keywords);
  const [enrichError, setEnrichError] = useState("");
  const [translation, setTranslation] = useState(() => article.translated_title ? {
    target_language: "zh",
    title: article.translated_title,
    abstract: article.translated_abstract || ""
  } : null);
  const [translating, setTranslating] = useState("");
  const [translationError, setTranslationError] = useState("");

  useEffect(() => {
    let ignore = false;
    setDetail(article);
    setEnrichError("");
    setTranslation(article.translated_title ? {
      target_language: "zh",
      title: article.translated_title,
      abstract: article.translated_abstract || ""
    } : null);
    setTranslationError("");
    if (article.abstract && article.keywords) {
      setEnriching(false);
      return () => {
        ignore = true;
      };
    }

    setEnriching(true);
    api.get(`/api/articles/${article.id}/enrich`)
      .then((nextArticle) => {
        if (!ignore) {
          const mergedArticle = { ...article, ...nextArticle };
          setDetail(mergedArticle);
          if (nextArticle.enrichment_error) setEnrichError(nextArticle.enrichment_error);
          onArticleUpdated?.(mergedArticle);
        }
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
  }, [article.id]);

  async function translate(targetLanguage) {
    setTranslating(targetLanguage);
    setTranslationError("");
    try {
      const nextTranslation = await api.post(`/api/articles/${detail.id}/translate`, { targetLanguage });
      setTranslation(nextTranslation);
      if (targetLanguage === "zh" && nextTranslation.title) {
        const translatedArticle = {
          ...detail,
          translated_title: nextTranslation.title,
          translated_abstract: nextTranslation.abstract || ""
        };
        setDetail(translatedArticle);
        onArticleUpdated?.(translatedArticle);
      }
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
          </div>
        )}
        <div className="abstract-panel">
          <h4>摘要</h4>
          {enriching ? (
            <p>正在从公开页面补全摘要和关键词...</p>
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
    if (ratio > 0.7) return "#3157d5";
    if (ratio > 0.4) return "#4f6fd2";
    if (ratio > 0.2) return "#65738d";
    return "#8b94a3";
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
                color: isSelected ? "#2848b8" : color,
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

function SettingsView(props) {
  if (!props.canEdit) return <GuestSettingsView />;
  return <SettingsEditor {...props} />;
}

function GuestSettingsView() {
  return (
    <section className="profile-layout" aria-labelledby="settings-account-title">
      <div className="page-intro account-heading">
        <div><span className="eyebrow">游客模式</span><h1 id="settings-account-title">文献推送设置</h1><p>游客可以浏览文献，但邮箱、订阅期刊和推送计划需要绑定到个人账户。</p></div>
      </div>
      <div className="guest-prompt"><UserRound size={20} /><div><strong>登录个人账户后管理自己的设置</strong><p>前往“游客账户”注册或登录，不会影响网页通行证。</p></div></div>
    </section>
  );
}

function SettingsEditor({ settings, availableJournals, status, onSave }) {
  const [selectedJournalNames, setSelectedJournalNames] = useState(
    new Set(settings.journals.map((j) => j.name))
  );
  const [refreshCron, setRefreshCron] = useState(settings.refreshCron);

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
            </div>
          </form>

        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
