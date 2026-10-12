/**
 * 统一数据三态渲染（S3/U6）。
 *
 * loading → skeleton（由调用方给定形状）；error → 保留旧数据 + 重试按钮
 * （不再静默失败）；empty → EmptyState。三者全站一致。
 */
export default function AsyncState({
  loading,
  error = "",
  empty = false,
  skeleton = null,
  emptyState = null,
  onRetry = null,
  children
}) {
  if (loading) return skeleton || null;
  if (error) {
    return (
      <div className="async-error" role="alert">
        <strong>数据加载失败</strong>
        <p>{error}</p>
        {onRetry && (
          <button className="secondary compact" type="button" onClick={onRetry}>重试</button>
        )}
      </div>
    );
  }
  if (empty) return emptyState || null;
  return children;
}
