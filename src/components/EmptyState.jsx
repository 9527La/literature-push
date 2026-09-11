/**
 * Shared empty state.
 *
 * The previous markup was a single sentence with no way out. An empty state
 * that ends in a dead end is a bug: whenever the emptiness is caused by a
 * filter we offer one click back to a populated list.
 */
function EmptyState({ icon: Icon, title, description, action = null }) {
  return (
    <div className="empty">
      {Icon && <span className="empty-state-icon" aria-hidden="true"><Icon size={20} /></span>}
      {title && <p className="empty-state-title">{title}</p>}
      {description && <p className="empty-state-description">{description}</p>}
      {action && <div className="empty-state-action">{action}</div>}
    </div>
  );
}

export default EmptyState;
