/**
 * Copy helper with a fallback.
 *
 * The app is also served over plain HTTP on the LAN, where
 * `navigator.clipboard` is unavailable because the context is not secure.
 * The textarea + execCommand path covers those clients.
 */
export async function copyText(value) {
  const text = String(value ?? "");
  if (!text) return false;

  try {
    if (window.isSecureContext && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the legacy path below.
  }

  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.top = "-1000px";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  } catch {
    return false;
  }
}
