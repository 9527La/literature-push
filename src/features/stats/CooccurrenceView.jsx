
function CooccurrenceView({ data, loading }) {
  if (loading) {
    return <div className="empty">加载中...</div>;
  }
  
  if (!data || !data.cooccurrences || data.cooccurrences.length === 0) {
    return <div className="empty">没有共现数据。</div>;
  }

  const maxCoCount = data.cooccurrences[0]?.count || 1;

  return (
    <div className="cooccurrence-container">
      <div className="cooccurrence-header">
        <h4>关键词共现分析</h4>
        <span className="cooccurrence-hint">显示频率最高的 {data.cooccurrences.length} 个关键词对</span>
      </div>
      <div className="cooccurrence-list">
        {data.cooccurrences.slice(0, 30).map((item, i) => (
          <div key={`${item.keyword1}-${item.keyword2}`} className="cooccurrence-item">
            <span className="cooccurrence-rank">{i + 1}</span>
            <div className="cooccurrence-keywords">
              <span className="cooccurrence-keyword">{item.keyword1}</span>
              <span className="cooccurrence-link">↔</span>
              <span className="cooccurrence-keyword">{item.keyword2}</span>
            </div>
            <div className="cooccurrence-bar-wrap">
              <div 
                className="cooccurrence-bar" 
                style={{ width: `${(item.count / maxCoCount) * 100}%` }}
              />
            </div>
            <span className="cooccurrence-count">{item.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default CooccurrenceView;
