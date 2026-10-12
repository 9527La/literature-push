/**
 * Shared empty state.
 *
 * The previous markup was a single sentence with no way out. An empty state
 * that ends in a dead end is a bug: whenever the emptiness is caused by a
 * filter we offer one click back to a populated list.
 *
 * `art` swaps the 20px line icon for a small piece of line art (single accent
 * hue, dashed outer ring) so an empty panel reads as a deliberate state instead
 * of a page that failed to load. Callers that pass only `icon` keep working.
 */
const RING = { cx: 60, cy: 50, r: 38 };

const ART = {
  /* Filtering found nothing: a page that came up blank, under a lens. */
  search: (
    <g>
      <rect x="34" y="20" width="42" height="54" rx="5" fill="#ffffff" stroke="#378add" strokeWidth="1.6" />
      <line x1="43" y1="34" x2="67" y2="34" stroke="#85b7eb" strokeWidth="1.6" />
      <line x1="43" y1="45" x2="67" y2="45" stroke="#85b7eb" strokeWidth="1.6" />
      <line x1="43" y1="56" x2="57" y2="56" stroke="#85b7eb" strokeWidth="1.6" />
      <circle cx="74" cy="62" r="14" fill="#ffffff" stroke="#378add" strokeWidth="1.6" />
      <line x1="84" y1="72" x2="92" y2="80" stroke="#378add" strokeWidth="2.4" strokeLinecap="round" />
    </g>
  ),
  /* Nothing collected yet: an open tray waiting for records. */
  inbox: (
    <g>
      <path d="M38 30h44v12l-6 26H44l-6-26z" fill="#ffffff" stroke="#378add" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M38 42h12l4 8h12l4-8h12" fill="none" stroke="#378add" strokeWidth="1.6" strokeLinejoin="round" />
      <line x1="48" y1="24" x2="72" y2="24" stroke="#85b7eb" strokeWidth="1.6" strokeLinecap="round" />
      <line x1="54" y1="17" x2="66" y2="17" stroke="#85b7eb" strokeWidth="1.6" strokeLinecap="round" />
    </g>
  ),
  /* No keywords to count: a distribution with nothing to weigh yet. */
  keywords: (
    <g>
      <line x1="40" y1="74" x2="40" y2="60" stroke="#378add" strokeWidth="4" strokeLinecap="round" />
      <line x1="52" y1="74" x2="52" y2="48" stroke="#378add" strokeWidth="4" strokeLinecap="round" />
      <line x1="64" y1="74" x2="64" y2="38" stroke="#85b7eb" strokeWidth="4" strokeLinecap="round" />
      <line x1="76" y1="74" x2="76" y2="54" stroke="#85b7eb" strokeWidth="4" strokeLinecap="round" />
      <line x1="34" y1="74" x2="82" y2="74" stroke="#378add" strokeWidth="1.6" strokeLinecap="round" />
    </g>
  ),
  /* Nothing saved yet: a star waiting to be filed, next to a bookmark. */
  favorites: (
    <g>
      <path d="M60 26l7.2 14.6 16.1 2.3-11.7 11.4 2.8 16.1L60 63.2 45.6 70.4l2.8-16.1L36.7 42.9l16.1-2.3z" fill="#ffffff" stroke="#378add" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M84 30v14l-4-3.4-4 3.4V30" fill="none" stroke="#85b7eb" strokeWidth="1.6" strokeLinejoin="round" />
    </g>
  ),
  /* No report yet: a calendar with a spark, waiting for the weekly run. */
  reports: (
    <g>
      <rect x="38" y="26" width="44" height="48" rx="5" fill="#ffffff" stroke="#378add" strokeWidth="1.6" />
      <line x1="38" y1="38" x2="82" y2="38" stroke="#378add" strokeWidth="1.6" />
      <line x1="48" y1="22" x2="48" y2="31" stroke="#378add" strokeWidth="1.6" strokeLinecap="round" />
      <line x1="72" y1="22" x2="72" y2="31" stroke="#378add" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="50" cy="49" r="2.2" fill="#85b7eb" />
      <circle cx="60" cy="49" r="2.2" fill="#85b7eb" />
      <circle cx="70" cy="49" r="2.2" fill="#c3d6f4" />
      <circle cx="50" cy="59" r="2.2" fill="#85b7eb" />
      <circle cx="60" cy="59" r="2.2" fill="#c3d6f4" />
      <circle cx="70" cy="59" r="2.2" fill="#c3d6f4" />
      <path d="M84 60l2 4.4 4.4 2-4.4 2-2 4.4-2-4.4-4.4-2 4.4-2z" fill="#ffffff" stroke="#378add" strokeWidth="1.4" strokeLinejoin="round" />
    </g>
  ),
  /* No daily brief yet: a newspaper page with lines of copy. */
  news: (
    <g>
      <rect x="44" y="22" width="38" height="50" rx="4" fill="#ffffff" stroke="#85b7eb" strokeWidth="1.4" />
      <rect x="34" y="28" width="42" height="50" rx="4" fill="#ffffff" stroke="#378add" strokeWidth="1.6" />
      <line x1="42" y1="40" x2="62" y2="40" stroke="#378add" strokeWidth="2.2" strokeLinecap="round" />
      <line x1="42" y1="50" x2="68" y2="50" stroke="#85b7eb" strokeWidth="1.6" />
      <line x1="42" y1="58" x2="68" y2="58" stroke="#85b7eb" strokeWidth="1.6" />
      <line x1="42" y1="66" x2="58" y2="66" stroke="#85b7eb" strokeWidth="1.6" />
    </g>
  )
};

function EmptyState({ icon: Icon, art = "", title, description, action = null }) {
  const artContent = art ? ART[art] : null;
  return (
    <div className={`empty${artContent ? " has-art" : ""}`}>
      {artContent ? (
        <svg className="empty-art" viewBox="0 0 120 100" role="presentation" aria-hidden="true" focusable="false">
          <circle cx={RING.cx} cy={RING.cy} r={RING.r} fill="none" stroke="#c9d2e0" strokeWidth="1" strokeDasharray="5 5" />
          {artContent}
        </svg>
      ) : Icon ? (
        <span className="empty-state-icon" aria-hidden="true"><Icon size={20} /></span>
      ) : null}
      {title && <p className="empty-state-title">{title}</p>}
      {description && <p className="empty-state-description">{description}</p>}
      {action && <div className="empty-state-action">{action}</div>}
    </div>
  );
}

export default EmptyState;
