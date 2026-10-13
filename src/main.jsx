import React, { StrictMode, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./fonts.css";
import "./styles.css";
import ErrorBoundary from "./components/ErrorBoundary.jsx";
import SkeletonList from "./components/SkeletonCard.jsx";
import Toast from "./components/Toast.jsx";
import useToast from "./hooks/useToast.js";
import useArticleFeed from "./hooks/useArticleFeed.js";
import LoginGate from "./features/auth/LoginGate.jsx";
import TopNav from "./features/shell/TopNav.jsx";
import UpdateModal from "./features/shell/UpdateModal.jsx";
import FavoriteGroupPicker from "./features/favorites/FavoriteGroupPicker.jsx";
import AccountView from "./features/account/AccountView.jsx";
import FavoritesView from "./features/favorites/FavoritesView.jsx";
import Feed from "./features/feed/Feed.jsx";
import FeedbackView from "./features/feedback/FeedbackView.jsx";
import SettingsView from "./features/settings/SettingsView.jsx";
import { api } from "./lib/api.js";
import { DEFAULT_FILTERS, DISPLAY_PREFERENCES_VERSION } from "./lib/constants.js";
import { normalizeDisplayPreferences } from "./lib/preferences.js";
import { clearAccountToken, disableAccountAutoLogin, getPassportToken, getUserToken, readAccountLoginSettings, readLocalPersonalization, saveAccountLoginSettings, setAccountToken } from "./lib/storage.js";

const VIEWS = ["feed", "reports", "news", "stats", "favorites", "settings", "feedback", "account", "admin", "help"];

// Heavy views load on demand (P1): the admin console, the keyword statistics
// page (word cloud / co-occurrence maths), reports, news, help and every
// secondary account view live in their own chunk. TopNav hovers/focuses
// prefetch them, so switching feels instant while the first paint stays lean.
// Feed stays eager: it is the landing view and lazy would flash a skeleton.
const AdminView = React.lazy(() => import("./features/admin/AdminView.jsx"));
const StatsView = React.lazy(() => import("./features/stats/StatsView.jsx"));
const ReportsView = React.lazy(() => import("./features/reports/ReportsView.jsx"));
const DailyNewsView = React.lazy(() => import("./features/news/DailyNewsView.jsx"));
const HelpView = React.lazy(() => import("./features/help/HelpView.jsx"));
const FavoritesViewLazy = React.lazy(() => import("./features/favorites/FavoritesView.jsx"));
const SettingsViewLazy = React.lazy(() => import("./features/settings/SettingsView.jsx"));
const AccountViewLazy = React.lazy(() => import("./features/account/AccountView.jsx"));
const FeedbackViewLazy = React.lazy(() => import("./features/feedback/FeedbackView.jsx"));

// The hash is the single source of truth for "which view am I on", so browser
// back/forward works and a filtered list can be shared as a link.
function parseHash(hash) {
  const raw = String(hash || "").replace(/^#/, "");
  const [view, query = ""] = raw.split("?");
  return { view, params: new URLSearchParams(query) };
}

// 文献库筛选参数白名单：hash 回写时只认这些键，其余参数（如卡片阅读的 reader=1）
// 原样保留 —— 保证 #feed?reader=1 这类分享/书签链接在启动与导航中不被抹掉。
const FILTER_PARAM_KEYS = new Set(["journal", "direction", "keyword", "q", "unread", "read", "favorite", "from", "to", "sort"]);

function filtersFromParams(params) {
  const next = { ...DEFAULT_FILTERS };
  if (params.has("journal")) next.journal = params.get("journal").split(",").filter(Boolean);
  if (params.has("direction")) next.direction = params.get("direction").split(",").filter(Boolean);
  if (params.has("keyword")) next.keyword = params.get("keyword").split(",").filter(Boolean);
  if (params.has("q")) next.q = params.get("q");
  if (params.has("unread")) next.unread = params.get("unread") === "true";
  if (params.has("read")) next.read = params.get("read") === "true";
  if (params.has("favorite")) next.favorite = params.get("favorite") === "true";
  if (params.has("from")) next.from = params.get("from");
  if (params.has("to")) next.to = params.get("to");
  if (params.has("sort")) next.sort = params.get("sort") || DEFAULT_FILTERS.sort;
  return next;
}

function App() {
  const [settings, setSettings] = useState({ journals: [], refreshCron: "", emailEnabled: false, emailRecipients: [] });
  const [status, setStatus] = useState(null);
  const [availableJournals, setAvailableJournals] = useState([]);
  const [autoSavePersonalization, setAutoSavePersonalization] = useState(() => localStorage.getItem("autoSavePersonalization") === "true");
  const localPersonalization = useMemo(() => localStorage.getItem("autoSavePersonalization") === "true" ? readLocalPersonalization() : null, []);
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
  const initialLoadStartedRef = useRef(false);
  const accountBootstrapPromiseRef = useRef(null);
  const interactionPendingRef = useRef(new Set());
  const [initialDataLoaded, setInitialDataLoaded] = useState(false);
  const [favoritePicker, setFavoritePicker] = useState(null);

  // ── 文献信息流数据层（S1）────────────────────────────────────────────
  const feed = useArticleFeed({
    enabled: gateAuthenticated && initialDataLoaded,
    localPersonalization,
    onError: handleFeedError
  });
  const {
    articles, articlesHasMore, articlesTotal, loadingMoreArticles, articlesUpdating,
    filters, setFilters, debouncedQuery, commitArticles,
    loadArticles, loadMoreArticles, reloadArticles, updateArticleInList, clearArticleCache
  } = feed;

  function handleFeedError(error) {
    if (error.status === 401 || String(error.message || "").includes("通行证")) {
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

  // ── P5：文献库/研究速览常驻（切走仅隐藏），返回零请求、状态不丢 ──────
  const [reportsMounted, setReportsMounted] = useState(false);
  useEffect(() => {
    if (activeView === "reports") setReportsMounted(true);
  }, [activeView]);
  // 滚动位置跟随：在文献库时持续记录 scrollY（而不是在「离开瞬间」读——那时
  // 浏览器可能已把短页的 scrollY 钳位，读回来是个假位置）；返回时双 rAF +
  // 兜底定时恢复，等隐藏容器解除、布局稳定后再滚。
  const feedScrollRef = useRef(0);
  useEffect(() => {
    if (activeView !== "feed") return undefined;
    const onScroll = () => { feedScrollRef.current = window.scrollY; };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [activeView]);
  useEffect(() => {
    if (activeView !== "feed") return undefined;
    const y = feedScrollRef.current;
    if (y <= 0) return undefined;
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => window.scrollTo(0, y));
    });
    const timer = setTimeout(() => window.scrollTo(0, y), 90);
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      clearTimeout(timer);
    };
  }, [activeView]);

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
    let next = `#${activeView}`;
    if (activeView === "feed") {
      const params = new URLSearchParams(debouncedQuery || "");
      const currentQuery = String(window.location.hash || "").split("?")[1] || "";
      for (const [key, value] of new URLSearchParams(currentQuery)) {
        if (!params.has(key) && !FILTER_PARAM_KEYS.has(key)) params.set(key, value);
      }
      const text = params.toString();
      if (text) next += `?${text}`;
    }
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

  async function loadAll({ forceArticles = false, accountOverride = null } = {}) {
    // Resolve a remembered account before loading user-specific data. This
    // ensures read/favorite/settings requests carry the restored token.
    const nextAccount = accountOverride || await loadAccountWithAutoLogin();
    await Promise.all([
      loadMeta(nextAccount),
      loadArticles({ force: forceArticles })
    ]);
    setInitialLoading(false);
    return nextAccount;
  }

  async function reloadArticlesAndStatus() {
    await Promise.all([
      reloadArticles(),
      api.get("/api/status").then(setStatus)
    ]);
  }

  // P2：单次已读/收藏交互成功后只补一次 /api/status（列表已本地 patch、
  // 缓存已失效），不再整页重拉——每次交互从 3 个请求降为 1 个。
  async function refreshStatusOnly() {
    try {
      const next = await api.get("/api/status");
      setStatus(next);
    } catch (error) {
      reportInteractionRefreshError(error);
    }
  }

  // 视图侧 onDataChanged：批量操作/管理动作后的整页刷新（保留原语义）。
  const loadAllForViews = useCallback(() => loadAll({ forceArticles: true }), []);

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
        handleFeedError(error);
        setInitialLoading(false);
      });
  }, [gateAuthenticated]);

  async function refresh() {
    setLoading(true);
    try {
      const result = await api.post("/api/refresh");
      const succeeded = result.status === "success";
      notify(
        succeeded ? `刷新完成，新增 ${result.addedCount} 篇文献。` : result.message,
        { type: succeeded ? "success" : "info" }
      );
      clearArticleCache();
      await loadAll({ forceArticles: true });
    } catch (error) {
      notify(error.message, { type: "error" });
      await api.get("/api/status").then(setStatus).catch(() => {});
    } finally {
      setLoading(false);
    }
  }

  function updateLocalArticleInteraction(id, patch, statusDelta = {}) {
    clearArticleCache();
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

  async function markRead(id, articleOverride) {
    if (!account.authenticated) {
      notify("游客模式只能浏览，请先登录个人账户保存阅读状态。", { type: "info" });
      setActiveView("account");
      return;
    }
    // 弹窗场景（速览/统计等）文献可能不在主列表：用调用方传入的完整对象兜底
    const article = articles.find((item) => item.id === id) || articleOverride || null;
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
      void refreshStatusOnly();
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

  async function toggleFavorite(id, articleOverride) {
    if (!account.authenticated) {
      notify("游客模式不能收藏文献，请先登录个人账户。", { type: "info" });
      setActiveView("account");
      return;
    }
    // 同 markRead：弹窗场景用完整对象兜底，收藏分组选择框（picker）照常弹出
    const article = articles.find((item) => item.id === id) || articleOverride || null;
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
      void refreshStatusOnly();
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
      // 广播给打开中的详情弹窗：收藏确认后立即同步心形/徽章（速览等页面的文献不在主列表）
      window.dispatchEvent(new CustomEvent("app:article-interaction", {
        detail: { id: article.id, is_favorite: Number(Boolean(result.is_favorite)) }
      }));
      setFavoritePicker(null);
      notify(`已加入收藏${result.group_name ? `：${result.group_name}` : "（未分组）"}。`, { type: "success" });
      void refreshStatusOnly();
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
    clearArticleCache();
    const session = result.account || await api.get("/api/auth/session");
    setAccount(session);
    await loadAll();
  }

  async function logoutUser() {
    await api.post("/api/auth/logout").catch(() => {});
    clearAccountToken();
    disableAccountAutoLogin();
    clearArticleCache();
    setAccount({ email: "", name: "", enrollment_year: null, degree: "", authenticated: false, can_register: true, username: "", role: "guest", is_admin: gateRole === "admin", passport_authenticated: gateAuthenticated, passport_role: gateRole });
    setActiveView("feed");
    await loadAll().catch(() => {});
  }

  async function leaveWebsite() {
    await api.post("/api/auth/logout").catch(() => {});
    clearAccountToken();
    disableAccountAutoLogin();
    clearArticleCache();
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

  if (initialLoading && !gateAuthenticated) {    return <div className="login-shell"><div className="login-loading" aria-label="正在检查登录状态" /></div>;
  }

  if (!gateAuthenticated) {
    return <LoginGate onAuthenticate={authenticate} />;
  }

  return (
    <div className="app-shell">
      {/* U5：列表后台更新时的顶部细进度条（stale-while-revalidate 的可视信号） */}
      <div className="route-progress" data-active={articlesUpdating ? "true" : "false"} aria-hidden="true"><span /></div>
      <a className="skip-link" href="#main-content">跳到主要内容</a>
      {/* A5：文献库视图追加筛选/列表跳转链接（其他视图下这两个目标不存在） */}
      {activeView === "feed" && !initialLoading && (
        <>
          <a className="skip-link" href="#feed-filters">跳到筛选面板</a>
          <a className="skip-link" href="#article-list">跳到文献列表</a>
        </>
      )}
      <TopNav
        activeView={activeView}
        account={account}
        status={status}
        loading={loading}
        onSwitchView={setActiveView}
        onRefresh={refresh}
        onLeaveWebsite={leaveWebsite}
      />

      <Toast toasts={toasts} onDismiss={dismissToast} />

      <main className="main" id="main-content">
        <ErrorBoundary>
        <Suspense fallback={<SkeletonList count={6} />}>
        {initialLoading ? (
          <SkeletonList count={6} />
        ) : (
          <>
            {/* P5：文献库常驻。切走仅 [hidden] 隐藏——翻页进度、滚动位置、
                面板折叠态与 keyword-stats/directions 请求全部保留，返回零请求。 */}
            <div className="view-keep" hidden={activeView !== "feed"}>
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
                listUpdating={articlesUpdating}
                queryKey={debouncedQuery}
                notify={notify}
                onRefresh={account.is_admin ? refresh : null}
                refreshing={loading}
                onDataChanged={loadAllForViews}
              />
            </div>
            {activeView === "settings" && (
              <SettingsViewLazy
                settings={settings}
                availableJournals={availableJournals}
                status={status}
                onSave={saveSettings}
                canEdit={account.authenticated}
              />
            )}
            {activeView === "favorites" && (
              <FavoritesViewLazy
                canPersonalize={account.authenticated}
                markRead={markRead}
                toggleFavorite={toggleFavorite}
                onArticleUpdated={updateArticleInList}
                onDataChanged={loadAllForViews}
                journals={settings.journals}
              />
            )}
            {activeView === "help" && <HelpView />}
            {activeView === "account" && (
              <AccountViewLazy
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
            )}
            {activeView === "feedback" && <FeedbackViewLazy account={account} />}
            {activeView === "admin" && account.is_admin && <AdminView onDataChanged={loadAllForViews} />}
            {/* P5：研究速览首次访问后同样常驻（chunk 已加载，隐藏不耗请求） */}
            <div className="view-keep" hidden={activeView !== "reports"}>
              {(reportsMounted || activeView === "reports") && (
                <ReportsView
                  canPersonalize={account.authenticated}
                  markRead={markRead}
                  toggleFavorite={toggleFavorite}
                  onArticleUpdated={updateArticleInList}
                  canModerate={account.is_admin}
                />
              )}
            </div>
            {activeView === "news" && <DailyNewsView />}
            {activeView === "stats" && (
              <StatsView journals={settings.journals} markRead={markRead} toggleFavorite={toggleFavorite} />
            )}
          </>
        )}
        </Suspense>
        </ErrorBoundary>
      </main>

      <FavoriteGroupPicker
        picker={favoritePicker}
        onChange={(patch) => setFavoritePicker((current) => ({ ...current, ...patch }))}
        onConfirm={confirmFavorite}
        onClose={() => setFavoritePicker(null)}
      />

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
