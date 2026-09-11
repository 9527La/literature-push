/**
 * Placeholder that mirrors the real article card box model (colour bar, meta
 * row, title, abstract lines, right-hand action rail).
 *
 * The previous skeleton was three full-width grey blocks, so the swap to real
 * content collapsed the layout. Matching the real shape keeps CLS near zero.
 */
export function SkeletonCard() {
  return (
    <article className="article skeleton-card" aria-hidden="true">
      <div className="article-main">
        <div className="skeleton skeleton-meta" />
        <div className="skeleton skeleton-title" />
        <div className="skeleton skeleton-text" />
        <div className="skeleton skeleton-text skeleton-text-short" />
      </div>
      <div className="article-actions skeleton-rail">
        <span className="skeleton skeleton-action" />
        <span className="skeleton skeleton-action" />
        <span className="skeleton skeleton-action" />
      </div>
    </article>
  );
}

export default function SkeletonList({ count = 6 }) {
  return (
    <div className="article-list" aria-busy="true" aria-label="正在载入文献列表">
      {Array.from({ length: count }, (_, index) => <SkeletonCard key={index} />)}
    </div>
  );
}
