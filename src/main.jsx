import React, { lazy, StrictMode, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { createPortal } from "react-dom";
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
  CircleUserRound,
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
  Library,
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
        <div className="login-brand"><BrandMark size={26} /><span>电气前沿速递</span></div>
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

// 2026-10-08 导航下拉组面板：portal 到 body —— .nav 是横向滚动的裁剪容器，
// 面板挂在里面会被 overflow 裁掉；因此用 fixed 定位按触发按钮的视口坐标锚定。
// 顶栏本身 fixed，页面滚动不改变按钮位置；窗口 resize / 导航横滚时由 App 关闭。
function NavGroupPanel({ anchorRef, onMouseEnter, onMouseLeave, children }) {
  const rect = anchorRef.current?.getBoundingClientRect();
  if (!rect) return null;
  return createPortal(
    <div
      className="nav-menu"
      role="menu"
      style={{ left: Math.max(12, Math.round(rect.left)), top: Math.round(rect.bottom + 6) }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {children}
    </div>,
    document.body
  );
}

function App() {
  const [articles, setArticles] = useState([]);
  const [articlesHasMore, setArticlesHasMore] = useState(false);
  // 接口返回的「符合当前筛选条件的总数」：列表是分页的，前端加载条数不等于
  // 筛选命中总数，「共 N 篇文献」必须用这个值（需求 13）。
  const [articlesTotal, setArticlesTotal] = useState(0);
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
      // 筛选命中总数只随替换式刷新更新（追加批次不改变总数）。
      setArticlesTotal(Number(page?.total) || 0);
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

  // 2026-10-08 导航分组：顶栏五个入口 = 文献库 / 资讯汇总▾ / 公共讨论 / 使用说明 / 个人中心▾。
  // 下拉组单开互斥：hover 进组即开、离组 200ms 后收，点击切换；
  // 外点 / Esc / 窗口 resize / 导航横滚时关闭（openGroup 非空才挂监听）。
  const [openGroup, setOpenGroup] = useState(null);
  const openGroupRef = useRef(null);
  const groupOpenedAtRef = useRef(0);
  const digestGroupBtnRef = useRef(null);
  const personalGroupBtnRef = useRef(null);
  const groupCloseTimersRef = useRef({});
  const applyOpenGroup = (key) => {
    openGroupRef.current = key;
    setOpenGroup(key);
  };
  const openGroupMenu = (key) => {
    clearTimeout(groupCloseTimersRef.current[key]);
    if (openGroupRef.current !== key) groupOpenedAtRef.current = performance.now();
    applyOpenGroup(key);
  };
  const scheduleCloseGroup = (key) => {
    clearTimeout(groupCloseTimersRef.current[key]);
    groupCloseTimersRef.current[key] = setTimeout(() => {
      if (openGroupRef.current === key) applyOpenGroup(null);
    }, 200);
  };
  const toggleGroup = (key) => {
    clearTimeout(groupCloseTimersRef.current[key]);
    if (openGroupRef.current === key) {
      // hover 刚打开（<400ms）时的点击视为「确认」而不是关闭，避免一闪而过。
      if (performance.now() - groupOpenedAtRef.current < 400) return;
      applyOpenGroup(null);
      return;
    }
    groupOpenedAtRef.current = performance.now();
    applyOpenGroup(key);
  };
  const switchView = (view) => {
    setActiveView(view);
    applyOpenGroup(null);
  };
  useEffect(() => {
    if (openGroup === null) return undefined;
    const close = () => applyOpenGroup(null);
    const onPointerDown = (event) => {
      if (!event.target.closest(".nav-group") && !event.target.closest(".nav-menu")) close();
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", close);
    navRef.current?.addEventListener("scroll", close);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", close);
      navRef.current?.removeEventListener("scroll", close);
    };
  }, [openGroup]);

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
            <span>电气前沿速递</span>
          </div>
          <div className={`nav-wrap${navEdges.left ? " can-left" : ""}${navEdges.right ? " can-right" : ""}`}>
          <nav className="nav" aria-label="主导航" ref={navRef}>
            <button className={activeView === "feed" ? "active" : ""} onClick={() => switchView("feed")}>
              <Library size={16} /> 文献库
              {status?.unreadCount > 0 && <span className="nav-badge" aria-label={`${status.unreadCount} 篇未读`}>{status.unreadCount}</span>}
            </button>
            <div
              className={`nav-group${openGroup === "digest" ? " open" : ""}${["reports", "news", "stats"].includes(activeView) ? " active" : ""}`}
              onMouseEnter={() => openGroupMenu("digest")}
              onMouseLeave={() => scheduleCloseGroup("digest")}
            >
              <button className="group-btn" aria-haspopup="true" aria-expanded={openGroup === "digest"} onClick={() => toggleGroup("digest")} ref={digestGroupBtnRef}>
                <BookOpen size={16} /> 资讯汇总
                <ChevronDown size={14} className="chev" aria-hidden="true" />
              </button>
              {openGroup === "digest" && (
                <NavGroupPanel anchorRef={digestGroupBtnRef} onMouseEnter={() => openGroupMenu("digest")} onMouseLeave={() => scheduleCloseGroup("digest")}>
                  <button className={`nav-menu-item${activeView === "reports" ? " active" : ""}`} role="menuitem" onClick={() => switchView("reports")}>
                    <Sparkles size={16} /> <span className="menu-label">研究速览</span>
                    {activeView === "reports" && <Check size={15} className="menu-check" aria-hidden="true" />}
                  </button>
                  <button className={`nav-menu-item${activeView === "news" ? " active" : ""}`} role="menuitem" onClick={() => switchView("news")}>
                    <Newspaper size={16} /> <span className="menu-label">每日资讯</span>
                    {activeView === "news" && <Check size={15} className="menu-check" aria-hidden="true" />}
                  </button>
                  <button className={`nav-menu-item${activeView === "stats" ? " active" : ""}`} role="menuitem" onClick={() => switchView("stats")}>
                    <BarChart3 size={16} /> <span className="menu-label">关键词统计</span>
                    {activeView === "stats" && <Check size={15} className="menu-check" aria-hidden="true" />}
                  </button>
                </NavGroupPanel>
              )}
            </div>
            <button className={activeView === "feedback" ? "active" : ""} onClick={() => switchView("feedback")}>
              <MessageSquare size={16} /> 公共讨论
            </button>
            <button className={activeView === "help" ? "active" : ""} onClick={() => switchView("help")}>
              <HelpCircle size={16} /> 使用说明
            </button>
            <div
              className={`nav-group${openGroup === "personal" ? " open" : ""}${["favorites", "settings", "account", "admin"].includes(activeView) ? " active" : ""}`}
              onMouseEnter={() => openGroupMenu("personal")}
              onMouseLeave={() => scheduleCloseGroup("personal")}
            >
              <button className="group-btn" aria-haspopup="true" aria-expanded={openGroup === "personal"} onClick={() => toggleGroup("personal")} ref={personalGroupBtnRef}>
                <CircleUserRound size={16} /> 个人中心
                <ChevronDown size={14} className="chev" aria-hidden="true" />
              </button>
              {openGroup === "personal" && (
                <NavGroupPanel anchorRef={personalGroupBtnRef} onMouseEnter={() => openGroupMenu("personal")} onMouseLeave={() => scheduleCloseGroup("personal")}>
                  <button className={`nav-menu-item${activeView === "favorites" ? " active" : ""}`} role="menuitem" onClick={() => switchView("favorites")}>
                    <Star size={16} /> <span className="menu-label">收藏文献</span>
                    {activeView === "favorites" && <Check size={15} className="menu-check" aria-hidden="true" />}
                  </button>
                  <button className={`nav-menu-item${activeView === "settings" ? " active" : ""}`} role="menuitem" onClick={() => switchView("settings")}>
                    <Settings size={16} /> <span className="menu-label">文献推送</span>
                    {activeView === "settings" && <Check size={15} className="menu-check" aria-hidden="true" />}
                  </button>
                  <button className={`nav-menu-item${activeView === "account" ? " active" : ""}`} role="menuitem" onClick={() => switchView("account")}>
                    <UserRound size={16} /> <span className="menu-label">个人账户</span>
                    {account.authenticated && <span className="menu-sub">{account.username}</span>}
                    {activeView === "account" && <Check size={15} className="menu-check" aria-hidden="true" />}
                  </button>
                  {account.is_admin && (
                    <>
                      <div className="nav-menu-sep" role="separator" />
                      <button className={`nav-menu-item${activeView === "admin" ? " active" : ""}`} role="menuitem" onClick={() => switchView("admin")}>
                        <ShieldCheck size={16} /> <span className="menu-label">管理中心</span>
                        {activeView === "admin" && <Check size={15} className="menu-check" aria-hidden="true" />}
                      </button>
                    </>
                  )}
                </NavGroupPanel>
              )}
            </div>
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
            articlesTotal={articlesTotal}
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
            journals={settings.journals}
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
