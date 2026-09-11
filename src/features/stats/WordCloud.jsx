import { useMemo, useState } from "react";
import { RefreshCw, Search } from "lucide-react";
import EmptyState from "../../components/EmptyState.jsx";

const MIN_SIZE = 12;
const MAX_SIZE = 48;
const SIZES = [50, 100, 200];

function bucketOf(ratio) {
  if (ratio > 0.7) return "w1";
  if (ratio > 0.4) return "w2";
  if (ratio > 0.2) return "w3";
  return "w4";
}

function WordCloud({ keywords, maxCount, onSelect, selectedKeyword }) {
  const [limit, setLimit] = useState(50);
  const [sortMode, setSortMode] = useState("count");

  const items = useMemo(() => {
    const list = [...(keywords || [])];
    if (sortMode === "alpha") list.sort((a, b) => String(a.keyword).localeCompare(String(b.keyword), "zh-Hans-CN"));
    else list.sort((a, b) => b.count - a.count);
    return list.slice(0, limit);
  }, [keywords, limit, sortMode]);

  if (!keywords || keywords.length === 0) {
    return (
      <EmptyState
        icon={Search}
        title="没有关键词数据"
        description="所选期刊与时间范围内还没有可统计的关键词。放宽条件后再试一次。"
      />
    );
  }

  return (
    <div className="wordcloud-container">
      <div className="wordcloud-controls">
        <span>显示数量</span>
        {SIZES.map((size) => (
          <button
            key={size}
            type="button"
            className={limit === size ? "active" : ""}
            aria-pressed={limit === size}
            onClick={() => setLimit(size)}
          >
            前 {size}
          </button>
        ))}
        <span>排序</span>
        <button type="button" className={sortMode === "count" ? "active" : ""} aria-pressed={sortMode === "count"} onClick={() => setSortMode("count")}>按频次</button>
        <button type="button" className={sortMode === "alpha" ? "active" : ""} aria-pressed={sortMode === "alpha"} onClick={() => setSortMode("alpha")}>按首字</button>
      </div>
      <div className="wordcloud">
        {items.map((item, index) => {
          const ratio = Math.min(1, item.count / (maxCount || 1));
          const isSelected = selectedKeyword === item.keyword;
          // Deterministic scatter: the same word keeps the same tilt between
          // renders, so the cloud does not shuffle while the user reads it.
          const tilt = ((index * 37) % 7) - 3;
          const drop = ((index * 53) % 5) - 2;
          return (
            <button
              key={item.keyword}
              type="button"
              className={`wordcloud-word ${bucketOf(ratio)}${isSelected ? " selected" : ""}`}
              style={{
                fontSize: `${MIN_SIZE + (MAX_SIZE - MIN_SIZE) * ratio}px`,
                transform: `translateY(${drop}px) rotate(${tilt}deg)`
              }}
              aria-pressed={isSelected}
              title={`${item.keyword}：${item.count} 篇`}
              onClick={() => onSelect(isSelected ? null : item.keyword)}
            >
              {item.keyword}
            </button>
          );
        })}
      </div>
      {keywords.length > limit && (
        <p className="wordcloud-more">
          共 {keywords.length} 个关键词，当前显示前 {limit} 个。
          <button type="button" className="link-button" onClick={() => setLimit(SIZES.find((size) => size > limit) || keywords.length)}>
            <RefreshCw size={12} /> 显示更多
          </button>
        </p>
      )}
    </div>
  );
}

export default WordCloud;
