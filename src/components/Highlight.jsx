import { highlightParts } from "../lib/highlight.js";

export default function Highlight({ text, terms }) {
  const parts = highlightParts(text, terms);
  if (!parts) return <>{text}</>;
  return (
    <>
      {parts.map((part, index) => (
        part.matched ? <mark key={index}>{part.value}</mark> : part.value
      ))}
    </>
  );
}
