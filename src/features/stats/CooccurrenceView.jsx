import EmptyState from "../../components/EmptyState.jsx";

const MAX_ROWS = 30;

/**
 * 关键词共现面板（A2/A3/U6）。
 *
 * A2：条形图容器补 role="img" + 摘要 aria-label，并提供数据表切换——
 * 此前 aria=0，屏幕阅读器读不到任何结论。
 * A3：标题 h4 → h3（StatsView 已有 h1/h2，不再跳级）。
 * U6：加载/空状态从裸 div 换成全站统一的 EmptyState。
 */
function CooccurrenceView({ data, loading }) {
  if (loading) {
    return (
      <EmptyState
        art="keywords"
        title="正在统计关键词共现"
        description="按所选期刊与时间范围计算中，请稍候。"
      />
    );
  }

  const items = Array.isArray(data?.cooccurrences) ? data.cooccurrences.slice(0, MAX_ROWS) : [];
  if (!items.length) {
    return (
      <EmptyState
        art="keywords"
        title="没有共现数据"
        description="所选期刊与时间范围还没有可统计的关键词对。放宽条件后再试一次。"
      />
    );
  }

  const maxCoCount = items[0]?.count || 1;
  const summary = items
    .slice(0, 3)
    .map((item) => `${item.keyword1} 与 ${item.keyword2} 共现 ${item.count} 次`)
    .join("；");

  return (
    <div className="cooccurrence-container">
      <div className="cooccurrence-header">
        <h3>关键词共现分析</h3>
        <span className="cooccurrence-hint">显示频率最高的 {items.length} 个关键词对</span>
      </div>
      <div
        className="cooccurrence-list"
        role="img"
        aria-label={`关键词共现条形图，最高三对：${summary}。完整数据见下方数据表。`}
      >
        {items.map((item, i) => (
          <div key={`${item.keyword1}-${item.keyword2}`} className="cooccurrence-item">
            <span className="cooccurrence-rank">{i + 1}</span>
            <div className="cooccurrence-keywords">
              <span className="cooccurrence-keyword">{item.keyword1}</span>
              <span className="cooccurrence-link" aria-hidden="true">↔</span>
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
      <details className="datatable">
        <summary>查看数据表（屏幕阅读器友好）</summary>
        <table className="mini">
          <thead><tr><th>#</th><th>关键词对</th><th style={{ textAlign: "right" }}>共现次数</th></tr></thead>
          <tbody>
            {items.map((item, i) => (
              <tr key={`${item.keyword1}-${item.keyword2}`}>
                <td>{i + 1}</td>
                <td>{item.keyword1} ↔ {item.keyword2}</td>
                <td className="num">{item.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

export default CooccurrenceView;
