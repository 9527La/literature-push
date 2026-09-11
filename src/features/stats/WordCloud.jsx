
function WordCloud({ keywords, maxCount, onSelect, selectedKeyword }) {
  if (!keywords || keywords.length === 0) {
    return <div className="empty">没有关键词数据。</div>;
  }

  const minSize = 12;
  const maxSize = 48;
  
  const getColor = (count, max) => {
    const ratio = count / max;
    if (ratio > 0.7) return "#3157d5";
    if (ratio > 0.4) return "#4f6fd2";
    if (ratio > 0.2) return "#65738d";
    return "#8b94a3";
  };

  return (
    <div className="wordcloud-container">
      <div className="wordcloud">
        {keywords.slice(0, 50).map((item, i) => {
          const ratio = item.count / maxCount;
          const fontSize = minSize + (maxSize - minSize) * ratio;
          const color = getColor(item.count, maxCount);
          const isSelected = selectedKeyword === item.keyword;
          
          return (
            <span
              key={item.keyword}
              className={`wordcloud-word ${isSelected ? "selected" : ""}`}
              style={{
                fontSize: `${fontSize}px`,
                color: isSelected ? "#2848b8" : color,
                fontWeight: ratio > 0.5 ? 700 : ratio > 0.2 ? 600 : 400,
                opacity: 0.6 + ratio * 0.4
              }}
              onClick={() => onSelect(item.keyword)}
              title={`${item.keyword}: ${item.count} 篇`}
            >
              {item.keyword}
            </span>
          );
        })}
      </div>
    </div>
  );
}

export default WordCloud;
