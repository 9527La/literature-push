import { useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])'
].join(",");

export default function Modal({ open, onClose, labelledBy, className = "", children }) {
  const dialogRef = useRef(null);
  const restoreRef = useRef(null);

  const getFocusable = useCallback(() => {
    const root = dialogRef.current;
    if (!root) return [];
    return Array.from(root.querySelectorAll(FOCUSABLE)).filter((el) => el.offsetParent !== null);
  }, []);

  useEffect(() => {
    if (!open) return undefined;

    restoreRef.current = document.activeElement;
    const { body } = document;
    const prevOverflow = body.style.overflow;
    const prevPaddingRight = body.style.paddingRight;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;

    body.style.overflow = "hidden";
    if (scrollbarWidth > 0) body.style.paddingRight = `${scrollbarWidth}px`;

    const focusTimer = setTimeout(() => {
      const items = getFocusable();
      (items[0] || dialogRef.current)?.focus();
    }, 0);

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const items = getFocusable();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      clearTimeout(focusTimer);
      document.removeEventListener("keydown", handleKeyDown, true);
      body.style.overflow = prevOverflow;
      body.style.paddingRight = prevPaddingRight;
      restoreRef.current?.focus?.();
    };
  }, [open, onClose, getFocusable]);

  if (!open) return null;

  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className={className}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {children}
      </section>
    </div>,
    document.body
  );
}
