/**
 * Client-side reference export.
 *
 * A PC-first list is expected to hand results off to a reference manager, and
 * that needs no server round trip.
 */
function authorsOf(article) {
  return String(article.authors || "")
    .split(/[;；,，]/)
    .map((name) => name.trim())
    .filter(Boolean);
}

function yearOf(article) {
  if (article.year) return String(article.year);
  const date = String(article.published_at || "");
  return /^\d{4}/.test(date) ? date.slice(0, 4) : "";
}

export function toRis(articles) {
  return (Array.isArray(articles) ? articles : []).map((article) => {
    const lines = ["TY  - JOUR"];
    if (article.title) lines.push(`TI  - ${article.title}`);
    authorsOf(article).forEach((name) => lines.push(`AU  - ${name}`));
    if (article.journal) lines.push(`JO  - ${article.journal}`);
    const year = yearOf(article);
    if (year) lines.push(`PY  - ${year}`);
    if (article.volume) lines.push(`VL  - ${article.volume}`);
    if (article.issue) lines.push(`IS  - ${article.issue}`);
    if (article.doi) lines.push(`DO  - ${article.doi}`);
    if (article.url) lines.push(`UR  - ${article.url}`);
    if (article.abstract) lines.push(`AB  - ${String(article.abstract).replace(/\s+/g, " ").trim()}`);
    String(article.keywords || "").split(/[;；,，]/).map((k) => k.trim()).filter(Boolean)
      .forEach((keyword) => lines.push(`KW  - ${keyword}`));
    lines.push("ER  - ");
    return lines.join("\n");
  }).join("\n\n") + "\n";
}

export function toBibtex(articles) {
  const used = new Set();
  return (Array.isArray(articles) ? articles : []).map((article) => {
    const firstAuthor = (authorsOf(article)[0] || "anon").split(/\s+/).pop().replace(/[^\w]/g, "").toLowerCase();
    const year = yearOf(article) || "0000";
    let key = `${firstAuthor || "anon"}${year}`;
    let suffix = 0;
    while (used.has(key)) {
      suffix += 1;
      key = `${firstAuthor || "anon"}${year}${String.fromCharCode(96 + suffix)}`;
    }
    used.add(key);

    const fields = [
      ["title", article.title],
      ["author", authorsOf(article).join(" and ")],
      ["journal", article.journal],
      ["year", year],
      ["volume", article.volume],
      ["number", article.issue],
      ["doi", article.doi],
      ["url", article.url]
    ].filter(([, value]) => Boolean(value));

    const body = fields
      .map(([name, value]) => `  ${name} = {${String(value).replace(/[{}]/g, "")}}`)
      .join(",\n");
    return `@article{${key},\n${body}\n}`;
  }).join("\n\n") + "\n";
}

export function downloadTextFile(filename, text) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Give the browser a tick to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
