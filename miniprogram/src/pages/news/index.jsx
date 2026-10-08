import { useEffect, useState } from "react";
import { View, Text } from "@tarojs/components";
import Taro, { usePullDownRefresh, useShareAppMessage } from "@tarojs/taro";
import { api } from "../../lib/api.js";
import { hasLiveSession } from "../../lib/session.js";
import { SkeletonList, Empty } from "../../components/States.jsx";

/**
 * 每日资讯：GET /api/daily-news → {items:[{date,title,groups,total}]}。
 * groups 为概览分组（政策/新闻等）及条数。
 */
export default function NewsListPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!hasLiveSession()) {
      Taro.reLaunch({ url: "/pages/login/index" });
      return;
    }
    api.get("/api/daily-news").then((data) => setItems(Array.isArray(data.items) ? data.items : []))
      .catch((error) => Taro.showToast({ title: error.message, icon: "none" }))
      .finally(() => setLoading(false));
  }, []);

  usePullDownRefresh(() => {
    api.get("/api/daily-news").then((data) => setItems(Array.isArray(data.items) ? data.items : [])).catch(() => {});
    Taro.stopPullDownRefresh();
  });

  useShareAppMessage(() => ({ title: "电力文献 · 每日资讯", path: "/pages/news/index" }));

  if (loading) return <View className="page-body"><SkeletonList count={4} /></View>;

  return (
    <View className="page-body">
      {items.length ? items.map((item) => (
        <View
          key={item.date}
          className="card"
          onClick={() => Taro.navigateTo({ url: `/pages/news-detail/index?date=${item.date}` })}
        >
          <View className="bold">{item.title || `${item.date} 电力能源资讯`}</View>
          <View className="row mt8" style={{ gap: "6px", flexWrap: "wrap" }}>
            <Text className="chip">{item.date}</Text>
            {(item.groups || []).map((group) => (
              <Text key={group.name} className="chip">{group.name} {group.count}</Text>
            ))}
            {item.total ? <Text className="hint">共 {item.total} 条</Text> : null}
          </View>
        </View>
      )) : (
        <Empty title="暂无资讯" hint="资讯由定时任务每个工作日生成" />
      )}
    </View>
  );
}
