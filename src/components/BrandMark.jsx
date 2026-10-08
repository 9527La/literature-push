/**
 * The one brand mark.
 *
 * The same glyph (a double four-point sparkle on the brand-blue tile) is used by
 * the favicon (`public/favicon.svg`), the masthead, the login card, the email
 * header and the PDF header. Keeping a single React component means the browser
 * chrome and the page can never drift apart, and the email/PDF templates only
 * have to reproduce the same geometry.
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
      <path d="M29 14C31 26 35 30 46 32C35 34 31 38 29 50C27 38 23 34 13 32C23 30 27 26 29 14Z" fill="#ffffff" />
      <path d="M45 13C46 18 47.5 19.5 52 20.5C47.5 21.5 46 23 45 28C44 23 42.5 21.5 38 20.5C42.5 19.5 44 18 45 13Z" fill="#ffffff" />
    </svg>
  );
}

export default BrandMark;
