import { useEffect } from "react";

export default function useListShortcuts({
  enabled,
  count,
  index,
  setIndex,
  onOpen,
  onToggleRead,
  onToggleFavorite,
  onFocusSearch
}) {
  useEffect(() => {
    if (!enabled) return undefined;

    function isTyping(target) {
      return target instanceof HTMLElement
        && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
    }

    function handle(event) {
      if (isTyping(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
      switch (event.key) {
        case "j":
        case "ArrowDown":
          event.preventDefault();
          setIndex((current) => Math.min(count - 1, current + 1));
          break;
        case "k":
        case "ArrowUp":
          event.preventDefault();
          setIndex((current) => Math.max(0, current - 1));
          break;
        case "Enter":
          if (index >= 0) {
            event.preventDefault();
            onOpen?.(index);
          }
          break;
        case "r":
        case "R":
          if (index >= 0) {
            event.preventDefault();
            onToggleRead?.(index);
          }
          break;
        case "f":
        case "F":
          if (index >= 0) {
            event.preventDefault();
            onToggleFavorite?.(index);
          }
          break;
        case "/":
          event.preventDefault();
          onFocusSearch?.();
          break;
        case "Escape":
          setIndex(-1);
          break;
        default:
          break;
      }
    }

    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [enabled, count, index, setIndex, onOpen, onToggleRead, onToggleFavorite, onFocusSearch]);
}
