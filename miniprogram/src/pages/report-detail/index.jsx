import { useEffect, useState } from "react";
import { View, Text, RichText } from "@tarojs/components";
import Taro, { useShareAppMessage } from "@tarojs/taro";
import { api } from "../../lib/api.js";
import BriefCard from "../../components/BriefCard.jsx";
import { SkeletonList, Empty } from "../../components/States.jsx";
import { markdownToNodes } from "../../lib/md.js";
import { directionLabel } from "../../lib/directions.js";

/**
 * 速览详情（懒加载 /api/reports/detail?id=）：
 * 顶部 BriefCard 三字段速评卡（paperBriefs v2 契约），下方 markdown 正文。
 */
export default function ReportDetailPage() {
  const id = Taro.getCurrentInstance().router.params.id;
  const [report, setReport] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    api.get(`/api/reports/detail?id=${encodeURIComponent(id)}`).then((data) => {
      setReport(data.report || null);
      setError(data.report ? "" : "报告不存在");
    }).catch((err) => setError(err.message || "加载失败")).finally(() => setLoading(false));
  }, [id]);

  useShareAppMessage(() => report ? {
    title: `研究速览 · ${report.period_start} 起`,
    path: `/pages/report-detail/index?id=${report.id}`
  } : { title: "电力文献 · 研究速览", path: "/pages/report/index" });

  if (loading) return <View className="page-body"><SkeletonList count={4} /></View>;
  if (!report) return <View className="page-body"><Empty title="报告不存在" hint={error} /></View>;

  const briefs = Array.isArray(report.stats?.paperBriefs) ? report.stats.paperBriefs : [];
  const title = report.direction ? `方向专报 · ${directionLabel(report.direction) || report.direction}` : (report.kind === "monthly" ? "月度趋势总览" : "一周速览总览");

  return (
    <View className="page-body">
      <View className="card">
        <View className="row row-between">
          <Text className="bold">{title}</Text>
          <Text className="hint">{report.kind === "monthly" ? "月度" : "周度"}</Text>
        </View>
        <View className="small muted mt8">{report.period_start} ~ {report.period_end} · 生成于 {String(report.generated_at || "").slice(0, 10)}</View>
      </View>

      {briefs.length ? (
        <View className="mt8">
          <View className="sheet-group-label">本期速评（{briefs.length} 篇）</View>
          {briefs.map((brief) => <BriefCard key={brief.id} brief={brief} />)}
        </View>
      ) : null}

      {report.content_md ? (
        <View className="card mt12">
          <RichText nodes={markdownToNodes(report.content_md)} />
        </View>
      ) : null}
    </View>
  );
}
