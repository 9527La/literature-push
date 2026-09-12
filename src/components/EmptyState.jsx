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
