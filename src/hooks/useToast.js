import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Small toast queue.
 *
 * Every async result used to funnel into one shared `message` string: same
 * styling for success and failure, no manual dismissal, and a later message
 * silently overwrote an earlier one. This keeps up to `max` notices, each with
 * its own type and lifetime, so consecutive actions no longer clobber each
 * other.
 */
export default function useToast({ max = 3 } = {}) {
  const [toasts, setToasts] = useState([]);
  const timersRef = useRef(new Map());
  const nextIdRef = useRef(0);

  const dismiss = useCallback((id) => {
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const notify = useCallback((message, options = {}) => {
    const text = String(message || "").trim();
    if (!text) return null;
    const type = ["success", "error", "info", "warning"].includes(options.type) ? options.type : "info";
    const duration = Number.isFinite(options.duration) ? options.duration : (type === "error" ? 6000 : 4000);
    const id = (nextIdRef.current += 1);

    setToasts((current) => {
      if (current.length < max) return [...current, { id, type, message: text }];
      // Drop the oldest non-error notice first so failures stay on screen.
      const dropIndex = current.findIndex((toast) => toast.type !== "error");
      const next = [...current];
      next.splice(dropIndex === -1 ? 0 : dropIndex, 1, { id, type, message: text });
      return next;
    });

    if (duration > 0) {
      timersRef.current.set(id, setTimeout(() => {
        timersRef.current.delete(id);
        setToasts((current) => current.filter((toast) => toast.id !== id));
      }, duration));
    }
    return id;
  }, [max]);

  useEffect(() => () => {
    timersRef.current.forEach((timer) => clearTimeout(timer));
    timersRef.current.clear();
  }, []);

  return { toasts, notify, dismiss };
}
