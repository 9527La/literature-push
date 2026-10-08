import { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, Input } from "@tarojs/components";
import Taro, { usePullDownRefresh, useReachBottom, useShareAppMessage } from "@tarojs/taro";
import { api } from "../../lib/api.js";
import { hasLiveSession } from "../../lib/session.js";
import { loadDisplayPrefs, saveDisplayPrefs } from "../../lib/prefs.js";
import { DEFAULT_FILTERS, ARTICLE_PAGE_SIZE } from "../../lib/constants.js";
import ArticleCard from "../../components/ArticleCard.jsx";
import FilterSheet, { JournalGroupChips } from "../../components/FilterSheet.jsx";
import { SkeletonList, Empty, LoadMore } from "../../components/States.jsx";
import { DIRECTIONS } from "../../lib/directions.js";

/**
 * 最新文献（M1 核心阅读动线）：
 * 吸顶搜索 + 筛选入口 → 方向 chips / 期刊组 chips → 卡片流（50/页触底翻页）。
 * 筛选口径与网站一致：display_date 排序、other 方向仅显式选择时出现、
 * 关键词命中任一、未读/收藏标记来自个人账户。
 */
function buildQuery(filters, offset) {
  const params = new URLSearchParams();
  params.set("limit", String(ARTICLE_PAGE_SIZE));
  params.set("offset", String(offset));
  params.set("sort", filters.sort || "desc");
  if (filters.q) params.set("q", filters.q);
  if (filters.journal.length) params.set("journal", filters.journal.join(","));
  if (filters.direction.length) params.set("direction", filters.direction.join(","));
  if (filters.keyword.length) params.set("keyword", filters.keyword.join(","));
  if (filters.unread) params.set("unread", "true");
  if (filters.favorite) params.set("favorite", "true");
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  return `/api/articles?${params.toString()}`;
}

export default function FeedPage() {
  const [articles, setArticles] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [filters, setFilters] = useState({ ...DEFAULT_FILTERS });
  const [sheetOpen, setSheetOpen] = useState(false);
  const [journals, setJournals] = useState([]);
  const [directionCounts, setDirectionCounts] = useState([]);
  const [displayPrefs, setDisplayPrefs] = useState(loadDisplayPrefs());
  const [qDraft, setQDraft] = useState("");
  const requestIdRef = useRef(0);
  const loadingMoreRef = useRef(false);

  useEffect(() => {
    if (!hasLiveSession()) {
      Taro.reLaunch({ url: "/pages/login/index" });
      return;
    }
    api.get("/api/journals").then((data) => setJournals(Array.isArray(data) ? data : [])).catch(() => {});
    api.get("/api/directions").then((data) => setDirectionCounts(Array.isArray(data.directions) ? data.directions : [])).catch(() => {});
  }, []);

  const load = useCallback(async (nextFilters, { append = false } = {}) => {
    const requestId = ++requestIdRef.current;
    if (append) {
      if (loadingMoreRef.current) return;
      loadingMoreRef.current = true;
      setLoadingMore(true);
    } else {
      setLoading(true);
    }
    try {
      const offset = append ? articles.length : 0;
      const data = await api.get(buildQuery(nextFilters, offset));
      if (requestId !== requestIdRef.current) return; // 过期响应丢弃（与网站翻页三规则同源）
      setArticles(append ? [...articles, ...(data.articles || [])] : (data.articles || []));
      setHasMore(Boolean(data.hasMore));
      setTotal(Number(data.total || 0));
    } catch (error) {
      if (requestId === requestIdRef.current && !append) setArticles([]);
      Taro.showToast({ title: error.message || "加载失败", icon: "none" });
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
        setLoadingMore(false);
        loadingMoreRef.current = false;
      }
      Taro.stopPullDownRefresh();
    }
  }, [articles]);

  // 筛选变化 → 重置列表（append=false）
  useEffect(() => {
    load(filters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  // 搜索词 500ms 防抖提交（与网站 debouncedQuery 同语义）
  useEffect(() => {
    setQDraft(filters.q);
  }, [filters.q]);
  useEffect(() => {
    const timer = setTimeout(() => {
      if (qDraft !== filters.q) setFilters((current) => ({ ...current, q: qDraft }));
    }, 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qDraft]);

  usePullDownRefresh(() => {
    load(filters);
  });

  useReachBottom(() => {
    if (hasMore && !loading && !loadingMore) load(filters, { append: true });
  });

  useShareAppMessage(() => ({ title: "电力文献 · 最新文献", path: "/pages/feed/index" }));

  function openArticle(article) {
    if (!article.is_read) {
      api.post(`/api/articles/${article.id}/read`).then(() => {
        setArticles((current) => current.map((item) => (item.id === article.id ? { ...item, is_read: 1 } : item)));
      }).catch(() => {});
    }
    Taro.navigateTo({ url: `/pages/article/index?id=${article.id}` });
  }

  async function toggleRead(article) {
    try {
      await api.post(`/api/articles/${article.id}/read`);
      setArticles((current) => current.map((item) => (item.id === article.id ? { ...item, is_read: item.is_read ? 0 : 1 } : item)));
    } catch (error) {
      Taro.showToast({ title: error.message, icon: "none" });
    }
  }

  async function toggleFavorite(article) {
    try {
      const updated = await api.post(`/api/articles/${article.id}/favorite`, {});
      setArticles((current) => current.map((item) => (item.id === article.id ? { ...item, is_favorite: updated.is_favorite ? 1 : 0 } : item)));
      Taro.showToast({ title: updated.is_favorite ? "已收藏" : "已取消收藏", icon: "none" });
    } catch (error) {
      Taro.showToast({ title: error.message, icon: "none" });
    }
  }

  async function onCardLongPress(article) {
    try {
      const result = await Taro.showActionSheet({
        itemList: [article.is_read ? "标记未读" : "标记已读", article.is_favorite ? "取消收藏" : "收藏"]
      });
      if (result.tapIndex === 0) toggleRead(article);
      if (result.tapIndex === 1) toggleFavorite(article);
    } catch (error) { /* 用户取消 */ }
  }

  function toggleDirectionChip(key) {
    setFilters((current) => ({
      ...current,
      direction: current.direction.includes(key)
        ? current.direction.filter((item) => item !== key)
        : [...current.direction, key]
    }));
  }

  function toggleJournalGroup(groupKey, names, allSelected) {
    setFilters((current) => ({
      ...current,
      journal: allSelected
        ? current.journal.filter((name) => !names.includes(name))
        : Array.from(new Set([...current.journal, ...names]))
    }));
  }

  function changeDisplayPrefs(next) {
    setDisplayPrefs(saveDisplayPrefs(next));
  }

  const activeFilterCount = [
    filters.journal.length, filters.direction.length, filters.keyword.length,
    filters.q ? 1 : 0, filters.unread ? 1 : 0, filters.favorite ? 1 : 0,
    filters.from ? 1 : 0, filters.to ? 1 : 0, filters.sort !== DEFAULT_FILTERS.sort ? 1 : 0
  ].reduce((sum, value) => sum + (value ? 1 : 0), 0);

  return (
    <View className="page-body">
      <View className="row" style={{ gap: "8px", marginBottom: "8px" }}>
        <Input
          className="input grow"
          value={qDraft}
          placeholder="搜索标题 / 作者 / 关键词"
          confirmType="search"
          onInput={(event) => setQDraft(event.detail.value)}
        />
        <Text className="btn btn-primary" onClick={() => setSheetOpen(true)}>筛选{activeFilterCount ? `·${activeFilterCount}` : ""}</Text>
      </View>

      <View style={{ marginBottom: "8px" }}>
        <View className="chip-row">
          {(DIRECTIONS.filter((d) => d.key !== "other").map((d) => (
            <Text
              key={d.key}
              className={`chip${filters.direction.includes(d.key) ? " active" : ""}`}
              onClick={() => toggleDirectionChip(d.key)}
            >
              {d.label}
            </Text>
          )))}
        </View>
      </View>

      <View style={{ marginBottom: "8px" }}>
        <JournalGroupChips journals={journals} filters={filters} onToggleGroup={toggleJournalGroup} />
      </View>

      <View className="row row-between" style={{ marginBottom: "8px" }}>
        <Text className={`chip${filters.sort === "asc" ? " active" : ""}`} onClick={() => setFilters((c) => ({ ...c, sort: c.sort === "asc" ? "desc" : "asc" }))}>
          {filters.sort === "asc" ? "旧 → 新" : "新 → 旧"}
        </Text>
        <Text className={`chip${filters.unread ? " active" : ""}`} onClick={() => setFilters((c) => ({ ...c, unread: !c.unread }))}>仅未读</Text>
        <Text className="hint">{total ? `共 ${total} 篇` : ""}</Text>
      </View>

      {loading ? <SkeletonList /> : (
        articles.length ? (
          <View>
            {articles.map((article) => (
              <ArticleCard
                key={article.id}
                article={article}
                journals={journals}
                displayPrefs={displayPrefs}
                onOpen={openArticle}
                onLongPress={onCardLongPress}
              />
            ))}
            <LoadMore text={loadingMore ? "加载中…" : (hasMore ? "上拉加载更多" : "没有更多了")} />
          </View>
        ) : (
          <Empty title="没有符合条件的文献" hint="试试放宽筛选条件" />
        )
      )}

      {sheetOpen ? (
        <FilterSheet
          open={sheetOpen}
          journals={journals}
          directionCounts={directionCounts}
          filters={filters}
          displayPrefs={displayPrefs}
          onClose={() => setSheetOpen(false)}
          onApply={(next) => { setFilters({ ...DEFAULT_FILTERS, ...next }); setSheetOpen(false); }}
          onDisplayPrefsChange={changeDisplayPrefs}
        />
      ) : null}
    </View>
  );
}
