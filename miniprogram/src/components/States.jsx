import { View, Text } from "@tarojs/components";

export function SkeletonList({ count = 4 }) {
  return (
    <View>
      {Array.from({ length: count }).map((_, index) => <View className="skeleton-card" key={index} />)}
    </View>
  );
}

export function Empty({ title = "暂无内容", hint = "" }) {
  return (
    <View className="state-box">
      <Text className="state-title">{title}</Text>
      {hint ? <Text className="state-hint">{hint}</Text> : null}
    </View>
  );
}

export function LoadMore({ text = "" }) {
  if (!text) return null;
  return <View className="load-more">{text}</View>;
}
