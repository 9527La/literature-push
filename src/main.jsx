import React, { lazy, StrictMode, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  ArrowDownUp,
  BarChart3,
  Bell,
  Check,
  CloudDownload,
  CloudUpload,
  CircleStop,
  ChevronDown,
  Database,
  Eye,
  EyeOff,
  FileText,
  Filter,
  FolderPlus,
  Heart,
  HardDrive,
  HelpCircle,
  Mail,
  MessageCircle,
  MessageSquare,
  Newspaper,
  Pencil,
  RefreshCw,
  Save,
  ScrollText,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
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
import "./fonts.css";
import "./styles.css";
import BrandMark from "./components/BrandMark.jsx";
import Modal from "./components/Modal.jsx";
import ErrorBoundary from "./components/ErrorBoundary.jsx";
import InternalUseNotice from "./components/InternalUseNotice.jsx";
import SkeletonList from "./components/SkeletonCard.jsx";
import Toast from "./components/Toast.jsx";
import useToast from "./hooks/useToast.js";
import AccountView from "./features/account/AccountView.jsx";
import FavoritesView from "./features/favorites/FavoritesView.jsx";
import Feed from "./features/feed/Feed.jsx";
import FeedbackView from "./features/feedback/FeedbackView.jsx";
import SettingsView from "./features/settings/SettingsView.jsx";
import { api } from "./lib/api.js";
import { ARTICLE_PAGE_SIZE, ARTICLE_RELEVANCE_PAGE_SIZE, DEFAULT_FILTERS, DISPLAY_PREFERENCES_VERSION } from "./lib/constants.js";
import { renderMarkdown } from "./lib/markdown.jsx";
import { normalizeDisplayPreferences } from "./lib/preferences.js";
import { clearAccountToken, disableAccountAutoLogin, getPassportToken, getUserToken, readAccountLoginSettings, readLocalPersonalization, saveAccountLoginSettings, setAccountToken } from "./lib/storage.js";

const VIEWS = ["feed", "reports", "news", "stats", "favorites", "settings", "feedback", "account", "admin", "help"];

// The hash is the single source of truth for "which view am I on", so browser
// back/forward works and a filtered list can be shared as a link.
function parseHash(hash) {
  const raw = String(hash || "").replace(/^#/, "");
  const [view, query = ""] = raw.split("?");
  return { view, params: new URLSearchParams(query) };
}

function filtersFromParams(params) {
  const next = { ...DEFAULT_FILTERS };
  if (params.has("journal")) next.journal = params.get("journal").split(",").filter(Boolean);
  if (params.has("direction")) next.direction = params.get("direction").split(",").filter(Boolean);
  if (params.has("keyword")) next.keyword = params.get("keyword").split(",").filter(Boolean);
  if (params.has("q")) next.q = params.get("q");
  if (params.has("unread")) next.unread = params.get("unread") === "true";
  if (params.has("favorite")) next.favorite = params.get("favorite") === "true";
  if (params.has("from")) next.from = params.get("from");
  if (params.has("to")) next.to = params.get("to");
  if (params.has("sort")) next.sort = params.get("sort") || DEFAULT_FILTERS.sort;
  return next;
}

// Heavy views load on demand: the admin console, the keyword statistics page
// (word cloud / co-occurrence maths) and the long help document.
const AdminView = lazy(() => import("./features/admin/AdminView.jsx"));
const StatsView = lazy(() => import("./features/stats/StatsView.jsx"));
const ReportsView = lazy(() => import("./features/reports/ReportsView.jsx"));
const DailyNewsView = lazy(() => import("./features/news/DailyNewsView.jsx"));
const HelpView = lazy(() => import("./features/help/HelpView.jsx"));


function UpdateModal({ versionInfo, onClose }) {
  const hasChangelog = versionInfo.changelog && versionInfo.changelog.trim();
  const hasNotes = versionInfo.notes && versionInfo.notes.length > 0;

  return (
    <Modal open onClose={onClose} labelledBy="update-dialog-title" className="update-dialog">
        <header className="update-dialog-header">
          <div>
            <h3 id="update-dialog-title">版本更新</h3>
            <span className="update-version">v{versionInfo.version} · {versionInfo.date}</span>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="关闭版本更新"><X size={20} /></button>
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
    </Modal>
  );
}

// 列表接口查的是本地库，正常都在一秒内返回。这个上限只用来兜住「请求发出后
// 永远不回来」的情况（隧道抖动、连接被中间设备静默丢弃）——没有它的时候
// fetch 会一直挂着，页面上就永远停在「加载中…」。
const ARTICLE_LIST_TIMEOUT_MS = 20000;

// 通行证经常被从聊天窗口整段粘过来，或用全角输入法敲进来。
// 服务端是逐字符严格比对（safeEqualText），首尾空格、换行、全角字符都会判为错误，
// 所以提交前统一做一次归一化：NFKC 把全角折成半角，再去掉首尾空白。
function normalizePassport(value) {
  return String(value || "").normalize("NFKC").trim();
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
      await onAuthenticate(normalizePassport(passport));
    } catch (error) {
      setMessage(error.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-shell">
      <section className="login-panel" aria-labelledby="login-title">
        <div className="login-brand"><BrandMark size={26} /><span>电力文献</span></div>
        <span className="eyebrow">受限访问</span>
        <h1 id="login-title">输入网页通行证</h1>
        <p>通行证用于进入网页。进入后可游客浏览，也可以注册或登录独立的个人账户。</p>
        <InternalUseNotice className="login-use-notice" />
        <form className="auth-form login-form" onSubmit={submit} onInput={() => setMessage("")}>
          <label><span>网页通行证</span><input type="password" value={passport} autoComplete="current-password" maxLength={128} onChange={(event) => setPassport(event.target.value)} required autoFocus /></label>
          <button className="primary" disabled={submitting || !normalizePassport(passport)}>{submitting ? "正在验证" : "进入网页"}</button>
          {message && <div className="inline-msg login-error" role="alert">{message}</div>}
        </form>
        <small>通行证区分大小写（首尾空格会被自动忽略）；管理员通行证可进入管理中心。全站最多允许 20 个不同 IP 同时登录个人账户。</small>
      </section>
    </main>
  );
}

function App() {
  const [articles, setArticles] = useState([]);
  const [articlesHasMore, setArticlesHasMore] = useState(false);
  const [loadingMoreArticles, setLoadingMoreArticles] = useState(false);
  const [settings, setSettings] = useState({ journals: [], refreshCron: "", emailEnabled: false, emailRecipients: [] });
  const [status, setStatus] = useState(null);
  const [availableJournals, setAvailableJournals] = useState([]);
  const [autoSavePersonalization, setAutoSavePersonalization] = useState(() => localStorage.getItem("autoSavePersonalization") === "true");
  const localPersonalization = useMemo(() => localStorage.getItem("autoSavePersonalization") === "true" ? readLocalPersonalization() : null, []);
  const [filters, setFilters] = useState(() => {
    const { view, params } = parseHash(window.location.hash);
    if (view === "feed" && params.toString()) return filtersFromParams(params);
    return { ...DEFAULT_FILTERS, ...(localPersonalization?.filters || {}) };
  });
  const [displayPreferences, setDisplayPreferences] = useState(() => normalizeDisplayPreferences(localPersonalization));
  const [activeView, setActiveView] = useState(() => {
    const { view } = parseHash(window.location.hash);
    return VIEWS.includes(view) ? view : "feed";
  });
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [gateAuthenticated, setGateAuthenticated] = useState(false);
  const [gateRole, setGateRole] = useState("");
  const { toasts, notify, dismiss: dismissToast } = useToast();
  const [versionInfo, setVersionInfo] = useState(null);
  const [account, setAccount] = useState({ authenticated: false, can_register: true, username: "", role: "guest", is_admin: false, passport_authenticated: false, passport_role: "" });
  const autoLoginAttemptRef = useRef("");
  const autoLoginPromiseRef = useRef(null);
  const articleCacheRef = useRef(new Map());
  const articleRequestRef = useRef(0);
  const loadedArticleQueryRef = useRef(null);
  // 列表的同步镜像。追加（翻页）请求是靠 `articles.length` 当 offset 的，
  // 而 state 在 await 之后读到的永远是旧闭包值，所以基线判定必须走 ref，
  // 并且每次写入列表都同步更新它，保证它与 state 不会错开一帧。
  const articlesRef = useRef([]);
  // 飞行中的追加请求。用它而不是 loadingMoreArticles 做并发守卫：
  // state 的更新要等下一次渲染，同一帧里连点两次守卫会同时看到 false。
  const appendInFlightRef = useRef(new Set());
  const commitArticles = useCallback((updater) => {
    const next = typeof updater === "function" ? updater(articlesRef.current) : updater;
    articlesRef.current = next;
    setArticles(next);
    return next;
  }, []);
  const initialLoadStartedRef = useRef(false);
  const accountBootstrapPromiseRef = useRef(null);
  const interactionPendingRef = useRef(new Set());
  const [initialDataLoaded, setInitialDataLoaded] = useState(false);
  const [favoritePicker, setFavoritePicker] = useState(null);
  
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
    localStorage.setItem("personalizationSnapshot", JSON.stringify(getPersonalizationSnapshot()));
  }, [autoSavePersonalization, initialLoading, filters, displayPreferences, settings]);

  // Write the current view (+ feed filters) into the hash. pushState (rather
  // than replaceState) is what makes the browser Back button return to the
  // previous view instead of leaving the site.
  useEffect(() => {
    const suffix = activeView === "feed" && debouncedQuery ? `?${debouncedQuery}` : "";
    const next = `#${activeView}${suffix}`;
    if (window.location.hash === next) return;
    window.history.pushState(null, "", next);
  }, [activeView, debouncedQuery]);

  // Read the hash back: Back/Forward and pasted links both land here.
  useEffect(() => {
    function applyLocation() {
      const { view, params } = parseHash(window.location.hash);
      const nextView = VIEWS.includes(view) ? view : "feed";
      setActiveView((current) => (current === nextView ? current : nextView));
      if (nextView === "feed") setFilters(filtersFromParams(params));
    }
    window.addEventListener("hashchange", applyLocation);
    window.addEventListener("popstate", applyLocation);
    return () => {
      window.removeEventListener("hashchange", applyLocation);
      window.removeEventListener("popstate", applyLocation);
    };
  }, []);

  function dismissVersion() {
    if (versionInfo) localStorage.setItem("dismissedVersion", versionInfo.version);
    setVersionInfo(null);
  }

  async function loadAccountWithAutoLogin() {
    if (autoLoginPromiseRef.current) return autoLoginPromiseRef.current;

    const run = (async () => {
      let current;
      try {
        current = await api.get("/api/account");
      } catch (error) {
        // The account endpoint is intentionally protected by the site gate.
        // During the initial gate/account parallel check, a missing or stale
        // passport is therefore a normal guest result rather than a fatal
        // bootstrap error.
        if (error.status !== 401) throw error;
        current = { authenticated: false, can_register: true, username: "", role: "guest", is_admin: false, passport_authenticated: false, passport_role: "" };
      }
      const loginSettings = readAccountLoginSettings();
      const canAutoLogin = Boolean(
        loginSettings.autoLogin
        && loginSettings.username
        && loginSettings.password
        && loginSettings.rememberPassword
      );
      // /api/auth/* 全部在通行证之后，没通行证时这次登录必然被 401 打回。
      // 那不是「密码不对」，所以先在这里拦掉：既不浪费一次请求，也不会让
      // 用户重新输入通行证后这一次自动登录被跳过。
      if (current.authenticated || !canAutoLogin || !getPassportToken()) return current;

      // A failed stored credential should not be retried on every filter or
      // view change during this page session. A successful manual login clears
      // this marker below, allowing the user to recover immediately.
      const attemptKey = `${loginSettings.username}\u0000${loginSettings.password}`;
      if (autoLoginAttemptRef.current === attemptKey) return current;

      try {
        const result = await api.post("/api/auth/login", {
          username: loginSettings.username,
          password: loginSettings.password
        });
        setAccountToken(result.token, true);
        autoLoginAttemptRef.current = "";
        return result.account || await api.get("/api/auth/session");
      } catch (error) {
        // 只有「用户名或密码确实不对」才值得记下这次失败并放弃重试；通行证
        // 过期、限流、网络抖动都必须留给下一次重试机会——否则重新通过通行证
        // 之后这一次自动登录就永远不会再发生（这就是「自动登录无效」的根因）。
        const message = String(error?.message || "");
        const credentialsRejected = error?.status === 401 && !message.includes("通行证");
        if (!credentialsRejected) return current;
        // 密码已失效，顺手清掉对应的会话令牌；已保存的用户名/密码仍留在账户
        // 表单里，用户可以直接改正后手动登录。
        autoLoginAttemptRef.current = attemptKey;
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

  async function loadMeta(nextAccount) {
    const account = nextAccount || await loadAccountWithAutoLogin();
    const [nextSettings, nextStatus, journals] = await Promise.all([
      api.get("/api/settings"),
      api.get("/api/status"),
      availableJournals.length ? Promise.resolve(availableJournals) : api.get("/api/journals")
    ]);
    setSettings(nextSettings);
    setStatus(nextStatus);
    setAccount(account);
    if (activeView === "admin" && !account.is_admin) setActiveView("feed");
    if (getUserToken() && !account.authenticated) clearAccountToken();
    if (!availableJournals.length) setAvailableJournals(journals);
    return account;
  }

  async function loadArticles({ force = false, append = false, queryString = debouncedQuery, offset = 0 } = {}) {
    const normalizedQuery = String(queryString || "");
    const queryParams = new URLSearchParams(normalizedQuery);
    const pageSize = queryParams.get("sort") === "relevance" ? ARTICLE_RELEVANCE_PAGE_SIZE : ARTICLE_PAGE_SIZE;
    const pageOffset = append ? Math.max(Number(offset) || 0, 0) : 0;
    queryParams.set("limit", String(pageSize));
    queryParams.set("offset", String(pageOffset));
    const cacheKey = `${getUserToken() || "guest"}::${normalizedQuery}::${pageOffset}::${pageSize}`;
    const requestId = ++articleRequestRef.current;
    // 这一批出发时的列表长度。返回时如果长度已经变了，说明中途发生过
    // 替换式刷新（点已读/收藏都会触发 reload），这一批不再连续，直接丢弃。
    const appendBaseLength = append ? articlesRef.current.length : 0;
    if (append) {
      appendInFlightRef.current.add(requestId);
      setLoadingMoreArticles(true);
    }

    try {
      let page = force ? null : articleCacheRef.current.get(cacheKey);
      if (!page) {
        let result;
        try {
          result = await api.get(`/api/articles?${queryParams.toString()}`, {
            signal: AbortSignal.timeout(ARTICLE_LIST_TIMEOUT_MS)
          });
        } catch (error) {
          if (error?.name === "TimeoutError") {
            throw new Error(`列表请求超过 ${ARTICLE_LIST_TIMEOUT_MS / 1000} 秒没有返回，已中止本次加载；请稍后重试。`);
          }
          throw error;
        }
        page = Array.isArray(result)
          ? { articles: result, hasMore: false, total: result.length }
          : result;
        articleCacheRef.current.set(cacheKey, page);
      }

      const nextArticles = Array.isArray(page?.articles) ? page.articles : [];

      if (append) {
        // 查询换了、或列表已经被替换过，本批就不接了；调用方拿到 0 会放开
        // 守卫，用户继续滚动即按新的列表长度重新取。
        if (normalizedQuery !== (loadedArticleQueryRef.current ?? normalizedQuery)) return 0;
        if (articlesRef.current.length !== appendBaseLength) return 0;
        commitArticles((current) => (current.length === appendBaseLength ? [...current, ...nextArticles] : current));
        setArticlesHasMore(Boolean(page?.hasMore));
        return nextArticles.length;
      }

      // 替换式请求仍然是「只有最新的一次算数」，否则旧筛选的结果会盖掉新筛选。
      if (requestId !== articleRequestRef.current) return 0;
      loadedArticleQueryRef.current = normalizedQuery;
      commitArticles(nextArticles);
      setArticlesHasMore(Boolean(page?.hasMore));
      return nextArticles.length;
    } finally {
      // 追加请求的 loading 必须以自己的 id 收尾：只要还有一批在飞就保持
      // loading，最后一批结束一定清掉。这里过去用「自己是不是最新请求」来判断，
      // 一旦期间有别的请求抢先（reload / 改筛选 / 第二批），finally 就会被跳过，
      // 按钮永久停在「加载中…」且再也点不动 —— 这就是"一直卡在加载中"的根因。
      if (append) {
        appendInFlightRef.current.delete(requestId);
        if (appendInFlightRef.current.size === 0) setLoadingMoreArticles(false);
      }
    }
  }

  async function loadAll({ forceArticles = false, accountOverride = null } = {}) {
    // Resolve a remembered account before loading user-specific data. This
    // ensures read/favorite/settings requests carry the restored token.
    const nextAccount = accountOverride || await loadAccountWithAutoLogin();
    await Promise.all([
      loadMeta(nextAccount),
      loadArticles({ force: forceArticles, queryString: debouncedQuery })
    ]);
    setInitialLoading(false);
    return nextAccount;
  }

  async function reloadArticlesAndStatus() {
    const queryString = loadedArticleQueryRef.current ?? debouncedQuery;
    await Promise.all([
      loadArticles({ force: true, queryString }),
      api.get("/api/status").then(setStatus)
    ]);
  }

  function handleDataLoadError(error) {
    if (error.status === 401 || String(error.message).includes("通行证")) {
      localStorage.removeItem("passportToken");
      initialLoadStartedRef.current = false;
      accountBootstrapPromiseRef.current = null;
      setInitialDataLoaded(false);
      setGateAuthenticated(false);
      setGateRole("");
      clearAccountToken();
      setAccount({ authenticated: false, can_register: true, username: "", role: "guest", is_admin: false, passport_authenticated: false, passport_role: "" });
      return;
    }
    notify(error.message, { type: "error" });
  }

  useEffect(() => {
    accountBootstrapPromiseRef.current = loadAccountWithAutoLogin();
    api.get("/api/gate/session")
      .then((session) => {
        setGateAuthenticated(Boolean(session.authenticated));
        setGateRole(session.role || "");
        if (!session.authenticated) {
          localStorage.removeItem("passportToken");
          initialLoadStartedRef.current = false;
          setInitialDataLoaded(false);
          setInitialLoading(false);
        }
      })
      .catch(() => {
        initialLoadStartedRef.current = false;
        setInitialDataLoaded(false);
        setInitialLoading(false);
      });
  }, []);

  useEffect(() => {
    if (!gateAuthenticated || initialLoadStartedRef.current) return;
    initialLoadStartedRef.current = true;
    setInitialLoading(true);
    const accountPromise = accountBootstrapPromiseRef.current || loadAccountWithAutoLogin();
    accountPromise
      .then((nextAccount) => loadAll({ accountOverride: nextAccount }))
      .then(() => setInitialDataLoaded(true))
      .catch((error) => {
        handleDataLoadError(error);
        setInitialLoading(false);
      });
  }, [gateAuthenticated]);

  useEffect(() => {
    if (!gateAuthenticated || !initialDataLoaded) return;
    if (loadedArticleQueryRef.current === debouncedQuery) return;
    setArticlesHasMore(false);
    loadArticles({ queryString: debouncedQuery }).catch(handleDataLoadError);
  }, [debouncedQuery, gateAuthenticated, initialDataLoaded]);

  async function loadMoreArticles() {
    // 并发守卫用 ref：同一帧里按钮和滚动哨兵可能同时触发，读 state 拦不住。
    if (!articlesHasMore || appendInFlightRef.current.size > 0) return 0;
    const queryString = loadedArticleQueryRef.current ?? debouncedQuery;
    try {
      return await loadArticles({
        append: true,
        queryString,
        // offset 也取自 ref，避免两次触发都用同一个旧长度而拉回重复数据。
        offset: articlesRef.current.length
      });
    } catch (error) {
      handleDataLoadError(error);
      return 0;
    }
  }

  async function refresh() {
    setLoading(true);
    try {
      const result = await api.post("/api/refresh");
      const succeeded = result.status === "success";
      notify(
        succeeded ? `刷新完成，新增 ${result.addedCount} 篇文献。` : result.message,
        { type: succeeded ? "success" : "info" }
      );
      articleCacheRef.current.clear();
      await loadAll({ forceArticles: true });
    } catch (error) {
      notify(error.message, { type: "error" });
      await api.get("/api/status").then(setStatus).catch(() => {});
    } finally {
      setLoading(false);
    }
  }

  function updateLocalArticleInteraction(id, patch, statusDelta = {}) {
    articleCacheRef.current.clear();
    commitArticles((current) => current.map((article) => (
      article.id === id ? { ...article, ...patch } : article
    )));
    setStatus((current) => {
      if (!current) return current;
      const next = { ...current };
      for (const [key, delta] of Object.entries(statusDelta)) {
        next[key] = Math.max(0, Number(next[key] || 0) + Number(delta || 0));
      }
      return next;
    });
  }

  function reportInteractionRefreshError(error) {
    if (error.status === 401 || String(error.message || "").includes("通行证")) {
      localStorage.removeItem("passportToken");
      setGateAuthenticated(false);
      setGateRole("");
      clearAccountToken();
      return;
    }
    notify(`状态已保存，但列表刷新失败：${error.message}`, { type: "error" });
  }

  async function markRead(id) {
    if (!account.authenticated) {
      notify("游客模式只能浏览，请先登录个人账户保存阅读状态。", { type: "info" });
      setActiveView("account");
      return;
    }
    const article = articles.find((item) => item.id === id);
    const pendingKey = `${id}:read`;
    if (!article || interactionPendingRef.current.has(pendingKey)) return;

    interactionPendingRef.current.add(pendingKey);
    const previous = Boolean(article.is_read);
    const optimistic = !previous;
    updateLocalArticleInteraction(id, { is_read: Number(optimistic) }, {
      unreadCount: optimistic ? -1 : 1,
      readCount: optimistic ? 1 : -1
    });

    try {
      const result = await api.post(`/api/articles/${id}/read`);
      const confirmed = Boolean(result.isRead);
      if (confirmed !== optimistic) {
        updateLocalArticleInteraction(id, { is_read: Number(confirmed) }, {
          unreadCount: confirmed ? -1 : 1,
          readCount: confirmed ? 1 : -1
        });
      }
      void reloadArticlesAndStatus().catch(reportInteractionRefreshError);
    } catch (error) {
      updateLocalArticleInteraction(id, { is_read: Number(previous) }, {
        unreadCount: previous ? -1 : 1,
        readCount: previous ? 1 : -1
      });
      notify(`阅读状态保存失败：${error.message}`, { type: "error" });
    } finally {
      interactionPendingRef.current.delete(pendingKey);
    }
  }

  async function toggleFavorite(id) {
    if (!account.authenticated) {
      notify("游客模式不能收藏文献，请先登录个人账户。", { type: "info" });
      setActiveView("account");
      return;
    }
    const article = articles.find((item) => item.id === id);
    const pendingKey = `${id}:favorite`;
    if (!article || interactionPendingRef.current.has(pendingKey)) return;

    interactionPendingRef.current.add(pendingKey);
    const previous = Boolean(article.is_favorite);
    if (!previous) {
      try {
        const options = await api.get("/api/favorites/options");
        setFavoritePicker({ article, groups: options.groups || [], groupId: options.defaultGroupId == null ? "ungrouped" : String(options.defaultGroupId), setDefault: false, saving: false, error: "" });
      } catch (error) {
        notify(`无法读取收藏分组：${error.message}`, { type: "error" });
      } finally {
        interactionPendingRef.current.delete(pendingKey);
      }
      return;
    }
    const optimistic = !previous;
    updateLocalArticleInteraction(id, { is_favorite: Number(optimistic) }, {
      favoriteCount: optimistic ? 1 : -1
    });

    try {
      const result = await api.post(`/api/articles/${id}/favorite`);
      const confirmed = Boolean(result.is_favorite);
      if (confirmed !== optimistic) {
        updateLocalArticleInteraction(id, { is_favorite: Number(confirmed) }, {
          favoriteCount: confirmed ? 1 : -1
        });
      }
      void reloadArticlesAndStatus().catch(reportInteractionRefreshError);
    } catch (error) {
      updateLocalArticleInteraction(id, { is_favorite: Number(previous) }, {
        favoriteCount: previous ? 1 : -1
      });
      notify(`收藏状态保存失败：${error.message}`, { type: "error" });
    } finally {
      interactionPendingRef.current.delete(pendingKey);
    }
  }

  async function confirmFavorite() {
    if (!favoritePicker || favoritePicker.saving) return;
    const { article, groupId, setDefault } = favoritePicker;
    setFavoritePicker((current) => ({ ...current, saving: true, error: "" }));
    try {
      const result = await api.post(`/api/articles/${article.id}/favorite`, { groupId: groupId === "ungrouped" ? null : Number(groupId), setDefault });
      updateLocalArticleInteraction(article.id, { is_favorite: Number(Boolean(result.is_favorite)) }, { favoriteCount: 1 });
      setFavoritePicker(null);
      notify(`已加入收藏${result.group_name ? `：${result.group_name}` : "（未分组）"}。`, { type: "success" });
      void reloadArticlesAndStatus().catch(reportInteractionRefreshError);
    } catch (error) {
      setFavoritePicker((current) => ({ ...current, saving: false, error: error.message }));
    }
  }

  async function saveSettings(nextSettings) {
    const saved = await api.put("/api/settings", nextSettings);
    setSettings(saved);
    notify("设置已保存。", { type: "success" });
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
    commitArticles((current) => current.map((article) => (
      updatesById.has(article.id) ? { ...article, ...updatesById.get(article.id) } : article
    )));
  }, [commitArticles]);

  // Memoized article cards compare props by identity, so the interaction
  // callbacks must keep a stable identity while still calling the latest
  // implementation captured in this ref.
  const articleHandlersRef = useRef({});
  articleHandlersRef.current.markRead = markRead;
  articleHandlersRef.current.toggleFavorite = toggleFavorite;
  const stableMarkRead = useCallback((id) => articleHandlersRef.current.markRead(id), []);
  const stableToggleFavorite = useCallback((id) => articleHandlersRef.current.toggleFavorite(id), []);

  function getPersonalizationSnapshot() {
    return { displayPreferencesVersion: DISPLAY_PREFERENCES_VERSION, filters, displayPreferences, settings };
  }

  function savePersonalizationLocal() {
    localStorage.setItem("personalizationSnapshot", JSON.stringify(getPersonalizationSnapshot()));
  }

  async function applyPersonalization(snapshot) {
    if (!snapshot || typeof snapshot !== "object") throw new Error("没有可载入的个性设置");
    if (snapshot.filters) setFilters({ ...DEFAULT_FILTERS, ...snapshot.filters });
    if (snapshot.displayPreferences) setDisplayPreferences(normalizeDisplayPreferences(snapshot));
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
    initialLoadStartedRef.current = false;
    accountBootstrapPromiseRef.current = null;
    setInitialDataLoaded(false);
    setInitialLoading(true);
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
    initialLoadStartedRef.current = false;
    accountBootstrapPromiseRef.current = null;
    setInitialDataLoaded(false);
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

  // 顶部导航横向溢出的可发现性（2026-10-01）：窄窗口下 tabs 被裁剪且滚动条
  // 隐藏，观感是「栏目被遮盖」。边缘渐隐由 .nav-wrap.can-left/can-right 渲染，
  // 滚轮纵向增量转横向滚动（wheel 必须非 passive 才能 preventDefault 阻止页面滚动）。
  const navRef = useRef(null);
  const [navEdges, setNavEdges] = useState({ left: false, right: false });
  useEffect(() => {
    const el = navRef.current;
    if (!el) return undefined;
    const update = () => {
      const max = el.scrollWidth - el.clientWidth;
      setNavEdges({ left: el.scrollLeft > 4, right: el.scrollLeft < max - 4 });
    };
    update();
    const onWheel = (event) => {
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      const max = el.scrollWidth - el.clientWidth;
      if (max <= 0) return;
      const next = Math.max(0, Math.min(max, el.scrollLeft + event.deltaY));
      if (next !== el.scrollLeft) {
        el.scrollLeft = next;
        event.preventDefault();
      }
    };
    el.addEventListener("scroll", update, { passive: true });
    el.addEventListener("wheel", onWheel, { passive: false });
    const observer = new ResizeObserver(update);
    observer.observe(el);
    window.addEventListener("resize", update);
    return () => {
      el.removeEventListener("scroll", update);
      el.removeEventListener("wheel", onWheel);
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
    // nav 在通行证门通过后才挂载；管理员登录会增删 tab（管理中心）影响 scrollWidth。
  }, [gateAuthenticated, account.is_admin]);

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
        <div className="topbar-row-main">
        <div className="topbar-left">
          <div className="brand">
            <BrandMark size={26} />
            <span>电力文献</span>
          </div>
          <div className={`nav-wrap${navEdges.left ? " can-left" : ""}${navEdges.right ? " can-right" : ""}`}>
          <nav className="nav" aria-label="主导航" ref={navRef}>
            <button className={activeView === "feed" ? "active" : ""} onClick={() => setActiveView("feed")}>
              <Bell size={16} /> 最新文献
              {status?.unreadCount > 0 && <span className="nav-badge" aria-label={`${status.unreadCount} 篇未读`}>{status.unreadCount}</span>}
            </button>
            <button className={activeView === "reports" ? "active" : ""} onClick={() => setActiveView("reports")}>
              <Sparkles size={16} /> 研究速览
            </button>
            <button className={activeView === "news" ? "active" : ""} onClick={() => setActiveView("news")}>
              <Newspaper size={16} /> 每日资讯
            </button>
            <button className={activeView === "stats" ? "active" : ""} onClick={() => setActiveView("stats")}>
              <BarChart3 size={16} /> 关键词统计
            </button>
            <button className={activeView === "favorites" ? "active" : ""} onClick={() => setActiveView("favorites")}>
              <Star size={16} /> 收藏文献
              {status?.favoriteCount > 0 && <span className="nav-badge" aria-label={`${status.favoriteCount} 篇收藏文献`}>{status.favoriteCount}</span>}
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
        </div>
        <div className="topbar-right">
          {account.is_admin && <button className="primary" onClick={refresh} disabled={loading}>
            <RefreshCw size={16} className={loading ? "spin" : ""} />
            {loading ? "刷新中" : "立即刷新"}
          </button>}
          <button className="secondary topbar-exit" type="button" onClick={leaveWebsite}>退出网页</button>
        </div>
        </div>
        {/* 顶栏统计胶囊已移入管理中心（2026-09-28 用户要求）：数据源仍为 /api/status。 */}
      </header>

      <Toast toasts={toasts} onDismiss={dismissToast} />

      <main className="main" id="main-content">
        <ErrorBoundary>
        <Suspense fallback={<SkeletonList count={6} />}>
        {initialLoading ? (
          <SkeletonList count={6} />
        ) : activeView === "feed" ? (
          <Feed
            articles={articles}
            subscribedJournals={settings.journals.map((j) => j.name)}
            journals={settings.journals}
            filters={filters}
            setFilters={setFilters}
            markRead={stableMarkRead}
            toggleFavorite={stableToggleFavorite}
            displayPreferences={displayPreferences}
            onDisplayPreferencesChange={setDisplayPreferences}
            onArticleUpdated={updateArticleInList}
            canPersonalize={account.authenticated}
            canModerate={account.is_admin}
            onLoadMore={loadMoreArticles}
            hasMoreArticles={articlesHasMore}
            loadingMoreArticles={loadingMoreArticles}
            queryKey={debouncedQuery}
            notify={notify}
            onRefresh={account.is_admin ? refresh : null}
            refreshing={loading}
            onDataChanged={() => loadAll({ forceArticles: true })}
          />
        ) : activeView === "settings" ? (
          <SettingsView
            settings={settings}
            availableJournals={availableJournals}
            status={status}
            onSave={saveSettings}
            canEdit={account.authenticated}
          />
        ) : activeView === "favorites" ? (
          <FavoritesView
            canPersonalize={account.authenticated}
            markRead={markRead}
            toggleFavorite={toggleFavorite}
            onArticleUpdated={updateArticleInList}
            onDataChanged={() => loadAll({ forceArticles: true })}
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
        ) : activeView === "reports" ? (
          <ReportsView
            canPersonalize={account.authenticated}
            markRead={markRead}
            toggleFavorite={toggleFavorite}
            onArticleUpdated={updateArticleInList}
            canModerate={account.is_admin}
          />
        ) : activeView === "news" ? (
          <DailyNewsView />
        ) : (
          <StatsView journals={settings.journals} markRead={markRead} toggleFavorite={toggleFavorite} />
        )}
        </Suspense>
        </ErrorBoundary>
      </main>

      {favoritePicker && (
        <Modal
          open
          onClose={() => !favoritePicker.saving && setFavoritePicker(null)}
          labelledBy="favorite-picker-title"
          className="favorite-picker"
        >
            <header><div><span className="eyebrow">选择收藏位置</span><h2 id="favorite-picker-title">收藏到分组</h2></div><button className="icon-button" type="button" aria-label="关闭" onClick={() => setFavoritePicker(null)} disabled={favoritePicker.saving}><X size={18} /></button></header>
            <p className="favorite-picker-title-text">{favoritePicker.article.title}</p>
            <div className="favorite-picker-groups" role="radiogroup" aria-label="收藏分组">
              {favoritePicker.groups.map((group) => { const value = group.id === null ? "ungrouped" : String(group.id); return <label className={favoritePicker.groupId === value ? "selected" : ""} key={value}><input type="radio" name="favorite-group" value={value} checked={favoritePicker.groupId === value} onChange={() => setFavoritePicker((current) => ({ ...current, groupId: value }))} /><span>{group.name}</span><small>{group.count || 0} 篇</small></label>; })}
            </div>
            <label className="favorite-default-choice"><input type="checkbox" checked={favoritePicker.setDefault} onChange={(event) => setFavoritePicker((current) => ({ ...current, setDefault: event.target.checked }))} /><span><strong>设为默认收藏夹</strong><small>下次收藏时会预选此分组，仍可临时更改。</small></span></label>
            {favoritePicker.error && <div className="inline-msg" role="alert">{favoritePicker.error}</div>}
            <footer><button className="secondary" type="button" disabled={favoritePicker.saving} onClick={() => setFavoritePicker(null)}>取消</button><button className="primary" type="button" disabled={favoritePicker.saving} onClick={confirmFavorite}><Star size={16} /> {favoritePicker.saving ? "保存中" : "确认收藏"}</button></footer>
        </Modal>
      )}

      {versionInfo && (
        <UpdateModal versionInfo={versionInfo} onClose={dismissVersion} />
      )}
    </div>
  );
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
);
