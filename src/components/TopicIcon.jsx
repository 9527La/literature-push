/**
 * Topic glyphs, drawn as single-hue line art on a 24×24 grid so they can sit at
 * 16px next to a card's keywords without competing with the title.
 */
const GLYPHS = {
  storage: (
    <>
      <rect x="2" y="7" width="16" height="10" rx="2.5" />
      <path d="M21 10.5v3" />
      <path d="M7 10.5v3M11 10.5v3" />
    </>
  ),
  renewable: (
    <>
      <path d="M12 12v9" />
      <path d="M12 12 6.5 5.5" />
      <path d="M12 12l6.5-6.5" />
      <path d="M12 12V3.5" />
      <circle cx="12" cy="12" r="1.4" />
      <path d="M7.5 21h9" />
    </>
  ),
  grid: (
    <>
      <path d="M3 8h18" />
      <path d="M8 8v12M16 8v12" />
      <circle cx="8" cy="16" r="1.6" />
      <circle cx="16" cy="16" r="1.6" />
      <circle cx="12" cy="4.5" r="1.6" />
      <path d="M12 6.1v1.9" />
    </>
  ),
  electronics: (
    <>
      <path d="M3 16V8h6v8h6V8h6" />
      <path d="M3 20h18" />
    </>
  ),
  market: (
    <>
      <path d="M4 20V13M9.5 20V9M15 20v-5M20.5 20V6" />
      <path d="M4 8.5 9.5 5l5.5 3.5L20.5 3.5" />
    </>
  ),
  voltage: (
    <>
      <path d="M13 2 5.5 13H11l-1 9 8.5-11H13z" />
    </>
  )
};

function TopicIcon({ topic, size = 16, className = "" }) {
  const glyph = GLYPHS[topic];
  if (!glyph) return null;
  return (
    <svg
      className={`topic-icon ${className}`.trim()}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {glyph}
    </svg>
  );
}

export default TopicIcon;
