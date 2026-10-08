import { useEffect, useState } from "react";
import { View, RichText } from "@tarojs/components";
import Taro, { useShareAppMessage } from "@tarojs/taro";
import { api } from "../../lib/api.js";
import { SkeletonList, Empty } from "../../components/States.jsx";
import { markdownToNodes } from "../../lib/md.js";

/** 资讯详情：GET /api/daily-news/detail?date=YYYY-MM-DD → {date,title,markdown,...} */
export default function NewsDetailPage() {
  const date = Taro.getCurrentInstance().router.params.date;
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!date) return;
    api.get(`/api/daily-news/detail?date=${encodeURIComponent(date)}`)
      .then((data) => setDetail(data))
      .catch((err) => setError(err.message || "加载失败"))
      .finally(() => setLoading(false));
  }, [date]);

  useShareAppMessage(() => detail ? {
    title: detail.title || `${detail.date} 电力能源资讯`,
    path: `/pages/news-detail/index?date=${detail.date}`
  } : { title: "电力文献 · 每日资讯", path: "/pages/news/index" });

  if (loading) return <View className="page-body"><SkeletonList count={4} /></View>;
  if (!detail) return <View className="page-body"><Empty title="资讯不存在" hint={error} /></View>;

  return (
    <View className="page-body">
      <View className="bold" style={{ fontSize: "17px", lineHeight: 1.5, marginBottom: "8px" }}>
        {detail.title || `${detail.date} 电力能源资讯`}
      </View>
      <View className="card">
        <RichText nodes={markdownToNodes(detail.markdown)} />
      </View>
    </View>
  );
}
