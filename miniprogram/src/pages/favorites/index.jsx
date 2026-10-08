import { useCallback, useEffect, useState } from "react";
import { View, Text, ScrollView } from "@tarojs/components";
import Taro, { usePullDownRefresh, useShareAppMessage } from "@tarojs/taro";
import { api } from "../../lib/api.js";
import { hasLiveSession } from "../../lib/session.js";
import ArticleCard from "../../components/ArticleCard.jsx";
import { SkeletonList, Empty } from "../../components/States.jsx";
import { DEFAULT_DISPLAY } from "../../lib/constants.js";

/**
 * 收藏文献：分组 chips（全部 / 未分组 / 各分组）+ 收藏卡流。
 * 长按卡片 → 移动分组 / 取消收藏（「未分组」是虚拟行，不自动建组）。
 */
export default function FavoritesPage() {
  const [groups, setGroups] = useState([]);
  const [favorites, setFavorites] = useState([]);
  const [total, setTotal] = useState(0);
  const [selectedGroup, setSelectedGroup] = useState("all");
  const [loading, setLoading] = useState(true);
  const [journals, setJournals] = useState([]);

  useEffect(() => {
    if (!hasLiveSession()) {
      Taro.reLaunch({ url: "/pages/login/index" });
      return;
    }
    api.get("/api/journals").then((data) => setJournals(Array.isArray(data) ? data : [])).catch(() => {});
  }, []);

  const load = useCallback(async (group = selectedGroup) => {
    setLoading(true);
    try {
      const query = group === "all" ? "" : `?group=${encodeURIComponent(group)}`;
      const data = await api.get(`/api/favorites${query}`);
      setGroups(Array.isArray(data.groups) ? data.groups : []);
      setFavorites(Array.isArray(data.favorites) ? data.favorites : []);
      setTotal(Number(data.total || 0));
    } catch (error) {
      Taro.showToast({ title: error.message, icon: "none" });
    } finally {
      setLoading(false);
      Taro.stopPullDownRefresh();
    }
  }, [selectedGroup]);

  useEffect(() => {
    load(selectedGroup);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedGroup]);

  usePullDownRefresh(() => load());

  useShareAppMessage(() => ({ title: "电力文献 · 我的收藏", path: "/pages/favorites/index" }));

  function openArticle(article) {
    Taro.navigateTo({ url: `/pages/article/index?id=${article.id}` });
  }

  async function moveGroup(article) {
    const options = ["未分组", ...groups.filter((group) => group.id !== null).map((group) => group.name)];
    try {
      const result = await Taro.showActionSheet({ itemList: options });
      const targetId = result.tapIndex === 0 ? null : groups.filter((group) => group.id !== null)[result.tapIndex - 1].id;
      await api.put(`/api/favorites/${article.id}`, { groupId: targetId, note: article.note || "" });
      Taro.showToast({ title: "已移动", icon: "none" });
      load();
    } catch (error) { /* 用户取消或失败 */ }
  }

  async function unfavorite(article) {
    try {
      await api.post(`/api/articles/${article.id}/favorite`, {});
      Taro.showToast({ title: "已取消收藏", icon: "none" });
      load();
    } catch (error) {
      Taro.showToast({ title: error.message, icon: "none" });
    }
  }

  async function onCardLongPress(article) {
    try {
      const result = await Taro.showActionSheet({ itemList: ["移动到分组", "取消收藏"] });
      if (result.tapIndex === 0) moveGroup(article);
      if (result.tapIndex === 1) unfavorite(article);
    } catch (error) { /* 用户取消 */ }
  }

  const chips = [
    { key: "all", label: `全部${total ? ` ${total}` : ""}` },
    { key: "ungrouped", label: "未分组" },
    ...groups.filter((group) => group.id !== null).map((group) => ({ key: String(group.id), label: group.name }))
  ];

  return (
    <View className="page-body">
      <View style={{ marginBottom: "8px" }}>
        <ScrollView scrollX className="hscroll" enhanced showScrollbar={false}>
          <View className="chip-row">
            {chips.map((chip) => (
              <Text
                key={chip.key}
                className={`chip hscroll-item${selectedGroup === chip.key ? " active" : ""}`}
                onClick={() => setSelectedGroup(chip.key)}
              >
                {chip.label}
              </Text>
            ))}
          </View>
        </ScrollView>
      </View>

      {loading ? <SkeletonList /> : (
        favorites.length ? (
          <View>
            {favorites.map((article) => (
              <ArticleCard
                key={article.id}
                article={article}
                journals={journals}
                displayPrefs={DEFAULT_DISPLAY}
                onOpen={openArticle}
                onLongPress={onCardLongPress}
              />
            ))}
          </View>
        ) : (
          <Empty title="该分组还没有收藏" hint="在文献列表或详情页长按/点击收藏" />
        )
      )}
    </View>
  );
}
