import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api.js";
import { ARTICLE_PAGE_SIZE, ARTICLE_RELEVANCE_PAGE_SIZE, DEFAULT_FILTERS } from "../lib/constants.js";
import { getUserToken } from "../lib/storage.js";

// 列表接口查的是本地库，正常都在一秒内返回。这个上限只用来兜住「请求发出后
// 永远不回来」的情况（隧道抖动、连接被中间设备静默丢弃）——没有它的时候
// fetch 会一直挂着，页面上就永远停在「加载中…」。
const ARTICLE_LIST_TIMEOUT_MS = 20000;

export function filtersToQuery(filters) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      if (value.length) params.set(key, value.join(","));
    } else if (value) {
      params.set(key, String(value));
    }
  });
  return params.toString();
}

/**
 * 文献信息流数据层（S1：自 main.jsx 拆出）。
 *
 * 收编：filters 状态（hash/本地个性化初始化）、300ms 防抖（P3：原来
 * filters→debouncedFilters→序列化→debouncedQuery 四步两段 effect，合并为
 * 一段）、列表请求与分页（含 20s 超时兜底与并发守卫）、追加批次的
 * requestId/基线判定、查询缓存与失效、替换式请求的「只有最新一次算数」。
 *
 * U5/P3：articlesUpdating 标记「列表正在后台更新」——请求期间旧列表照常
 * 驻留（stale-while-revalidate），顶栏进度条与「正在更新」胶囊由它驱动；
 * 计数用 ref，多个在飞请求不会互相清掉对方的标志。
 */
export default function useArticleFeed({
  enabled = false,
  localPersonalization = null,
  onError = () => {}
}) {
  const [articles, setArticles] = useState([]);
  const [articlesHasMore, setArticlesHasMore] = useState(false);
  // 接口返回的「符合当前筛选条件的总数」：列表是分页的，前端加载条数不等于
  // 筛选命中总数，「共 N 篇文献」必须用这个值（需求 13）。
  const [articlesTotal, setArticlesTotal] = useState(0);
  const [loadingMoreArticles, setLoadingMoreArticles] = useState(false);
  const [filters, setFilters] = useState(() => {
    const { view, params } = (() => {
      const raw = String(window.location.hash || "").replace(/^#/, "");
      const [v, query = ""] = raw.split("?");
      return { view: v, params: new URLSearchParams(query) };
    })();
    if (view === "feed" && params.toString()) {
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
    return { ...DEFAULT_FILTERS, ...(localPersonalization?.filters || {}) };
  });
  const [articlesUpdating, setArticlesUpdating] = useState(false);
  // P3：防抖与 URL 序列化合并为一段。debouncedQuery 同时驱动 hash 同步与拉取。
  const [debouncedQuery, setDebouncedQuery] = useState(() => filtersToQuery(filters));

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
  const updatingCountRef = useRef(0);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(filtersToQuery(filters)), 300);
    return () => clearTimeout(timer);
  }, [filters]);

  const commitArticles = useCallback((updater) => {
    const next = typeof updater === "function" ? updater(articlesRef.current) : updater;
    articlesRef.current = next;
    setArticles(next);
    return next;
  }, []);

  const beginUpdate = useCallback(() => {
    updatingCountRef.current += 1;
    setArticlesUpdating(true);
  }, []);
  const endUpdate = useCallback(() => {
    updatingCountRef.current = Math.max(0, updatingCountRef.current - 1);
    if (updatingCountRef.current === 0) setArticlesUpdating(false);
  }, []);

  const clearArticleCache = useCallback(() => {
    articleCacheRef.current.clear();
  }, []);

  const loadArticles = useCallback(async ({
    force = false,
    append = false,
    queryString = debouncedQuery,
    offset = 0
  } = {}) => {
    const normalizedQuery = String(queryString || "");
    const queryParams = new URLSearchParams(normalizedQuery);
    const pageSize = queryParams.get("sort") === "relevance" ? ARTICLE_RELEVANCE_PAGE_SIZE : ARTICLE_PAGE_SIZE;
    const pageOffset = append ? Math.max(Number(offset) || 0, 0) : 0;
    queryParams.set("limit", String(pageSize));
    queryParams.set("offset", String(pageOffset));
    const cacheKey = `${getUserKey()}::${normalizedQuery}::${pageOffset}::${pageSize}`;
    const requestId = ++articleRequestRef.current;
    // 这一批出发时的列表长度。返回时如果长度已经变了，说明中途发生过
    // 替换式刷新（点已读/收藏都会触发 reload），这一批不再连续，直接丢弃。
    const appendBaseLength = append ? articlesRef.current.length : 0;
    if (append) {
      appendInFlightRef.current.add(requestId);
      setLoadingMoreArticles(true);
    } else {
      // 替换式请求：旧列表驻留，只置「正在更新」标志（P3/U5）。
      if (!articleCacheRef.current.has(cacheKey) || force) beginUpdate();
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
      } else {
        endUpdate();
      }
    }
  }, [beginUpdate, commitArticles, debouncedQuery, endUpdate]);

  const loadMoreArticles = useCallback(async () => {
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
      onError(error);
      return 0;
    }
  }, [articlesHasMore, debouncedQuery, loadArticles, onError]);

  // 替换式刷新跟随防抖后的查询；enabled 由 App 在通行证门通过且首屏数据
  // 就绪后打开，避免门通过前就发起列表请求。
  useEffect(() => {
    if (!enabled) return;
    if (loadedArticleQueryRef.current === debouncedQuery) return;
    setArticlesHasMore(false);
    loadArticles({ queryString: debouncedQuery }).catch(onError);
  }, [debouncedQuery, enabled, loadArticles, onError]);

  const reloadArticles = useCallback(async (queryString) => {
    const qs = queryString ?? loadedArticleQueryRef.current ?? debouncedQuery;
    await loadArticles({ force: true, queryString: qs });
  }, [debouncedQuery, loadArticles]);

  const updateArticleInList = useCallback((nextArticles) => {
    const updates = (Array.isArray(nextArticles) ? nextArticles : [nextArticles]).filter((article) => article?.id);
    if (!updates.length) return;
    clearArticleCache();
    const updatesById = new Map(updates.map((article) => [article.id, article]));
    commitArticles((current) => current.map((article) => (
      updatesById.has(article.id) ? { ...article, ...updatesById.get(article.id) } : article
    )));
  }, [clearArticleCache, commitArticles]);

  return {
    articles,
    articlesHasMore,
    articlesTotal,
    loadingMoreArticles,
    articlesUpdating,
    filters,
    setFilters,
    debouncedQuery,
    commitArticles,
    loadArticles,
    loadMoreArticles,
    reloadArticles,
    updateArticleInList,
    clearArticleCache
  };
}

// 列表缓存按「登录态 + 查询 + 偏移 + 页大小」分键；游客与登录用户不串味。
function getUserKey() {
  return getUserToken() || "guest";
}
