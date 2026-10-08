import { View, Text } from "@tarojs/components";
import { directionLabel } from "../lib/directions.js";

/**
 * 速评卡（paperBriefs v2 三字段契约）：
 * {id, object≤30字, method≤40字, finding≤50字, topic?≤12}
 */
export default function BriefCard({ brief }) {
  if (!brief) return null;
  return (
    <View className="brief-card">
      {brief.topic ? <Text className="brief-topic">{brief.topic}</Text> : null}
      <View className="brief-row"><Text className="brief-key">对象</Text><Text className="brief-val">{brief.object}</Text></View>
      <View className="brief-row"><Text className="brief-key">方法</Text><Text className="brief-val">{brief.method}</Text></View>
      <View className="brief-row"><Text className="brief-key">结论</Text><Text className="brief-val">{brief.finding}</Text></View>
    </View>
  );
}

/** 报告卡片头（期报/专报通用）。 */
export function ReportCard({ report, onOpen }) {
  const isSpecial = Boolean(report.direction);
  const directionText = isSpecial ? directionLabel(report.direction) || report.direction : "期度总览";
  const briefCount = Array.isArray(report.stats?.paperBriefs) ? report.stats.paperBriefs.length : null;
  return (
    <View className="card" onClick={() => onOpen?.(report)}>
      <View className="row row-between">
        <Text className={`dir-chip dir-${report.direction || "other"}`}>{directionText}</Text>
        <Text className="hint">{report.kind === "monthly" ? "月度趋势" : "一周速览"}</Text>
      </View>
      <View className="bold mt8">{report.period_start} ~ {report.period_end}</View>
      <View className="row row-between mt8">
        <Text className="hint">{briefCount !== null ? `速评 ${briefCount} 篇` : ""}</Text>
        <Text className="hint">{String(report.generated_at || "").slice(0, 10)}</Text>
      </View>
    </View>
  );
}
