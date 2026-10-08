import { useEffect, useState } from "react";
import { View, Text } from "@tarojs/components";
import Taro, { usePullDownRefresh, useShareAppMessage } from "@tarojs/taro";
import { api } from "../../lib/api.js";
import { hasLiveSession } from "../../lib/session.js";
import { ReportCard } from "../../components/BriefCard.jsx";
import { SkeletonList, Empty } from "../../components/States.jsx";

/**
 * 研究速览列表（meta 模式，轻量行）：
 * kind 切换一周速览/月度趋势；总览（direction IS NULL）在前，方向专报在后。
 * 正文与 paperBriefs 在详情页懒加载（/api/reports/detail）。
 */
const KINDS = [
  { key: "weekly", label: "一周速览" },
  { key: "monthly", label: "月度趋势" }
];

export default function ReportListPage() {
  const [kind, setKind] = useState("weekly");
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!hasLiveSession()) {
      Taro.reLaunch({ url: "/pages/login/index" });
      return;
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    api.get(`/api/reports?kind=${kind}&limit=60`).then((data) => {
      setReports(Array.isArray(data.reports) ? data.reports : []);
      setError("");
    }).catch((err) => setError(err.message || "加载失败")).finally(() => setLoading(false));
  }, [kind]);

  usePullDownRefresh(() => {
    api.get(`/api/reports?kind=${kind}&limit=60`).then((data) => setReports(Array.isArray(data.reports) ? data.reports : [])).catch(() => {});
    Taro.stopPullDownRefresh();
  });

  useShareAppMessage(() => ({ title: "电力文献 · 研究速览", path: "/pages/report/index" }));

  const overviews = reports.filter((report) => !report.direction);
  const specials = reports.filter((report) => report.direction);

  return (
    <View className="page-body">
      <View className="row" style={{ marginBottom: "10px", gap: "6px" }}>
        {KINDS.map((item) => (
          <Text key={item.key} className={`chip${kind === item.key ? " active" : ""}`} onClick={() => setKind(item.key)}>{item.label}</Text>
        ))}
      </View>

      {loading ? <SkeletonList count={4} /> : (
        reports.length ? (
          <View>
            {overviews.length ? <View className="sheet-group-label">期度总览</View> : null}
            {overviews.map((report) => (
              <ReportCard key={report.id} report={report} onOpen={(item) => Taro.navigateTo({ url: `/pages/report-detail/index?id=${item.id}` })} />
            ))}
            {specials.length ? <View className="sheet-group-label mt12">方向专报</View> : null}
            {specials.map((report) => (
              <ReportCard key={report.id} report={report} onOpen={(item) => Taro.navigateTo({ url: `/pages/report-detail/index?id=${item.id}` })} />
            ))}
          </View>
        ) : (
          <Empty title="暂无报告" hint={error || "报告由定时任务按周/月生成"} />
        )
      )}
    </View>
  );
}
