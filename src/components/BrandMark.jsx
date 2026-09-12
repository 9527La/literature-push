/**
 * The one brand mark.
 *
 * The same glyph is used by the favicon (`public/favicon.svg`), the masthead, the
 * login card, the email header and the PDF header. Keeping a single React
 * component means the browser chrome and the page can never drift apart, and the
 * email/PDF templates only have to reproduce the same geometry.
 */
function BrandMark({ size = 26, title = "", className = "" }) {
  return (
    <svg
      className={`brand-mark ${className}`.trim()}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role={title ? "img" : "presentation"}
      aria-hidden={title ? undefined : "true"}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      <rect width="64" height="64" rx="14" fill="#3157d5" />
      <path d="M22 47V23a3 3 0 0 1 3-3h14a3 3 0 0 1 3 3v24" fill="none" stroke="#ffffff" strokeWidth="3.4" strokeLinecap="round" />
      <path d="M16 47h32" fill="none" stroke="#ffffff" strokeWidth="3.4" strokeLinecap="round" />
      <path d="M28 20v-4h8v4" fill="none" stroke="#ffffff" strokeWidth="3.4" strokeLinecap="round" />
      <path d="M29 28h6M29 34h6M29 40h6" stroke="#ffffff" strokeWidth="3.2" strokeLinecap="round" />
    </svg>
  );
}

export default BrandMark;
