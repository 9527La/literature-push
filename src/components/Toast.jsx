import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";

const ICONS = {
  success: CheckCircle2,
  error: AlertTriangle,
  warning: AlertTriangle,
  info: Info
};

/**
 * Toast region.
 *
 * The polite/assertive live regions are rendered permanently (even while
 * empty) so assistive technology reliably announces notices that appear later.
 */
export default function Toast({ toasts, onDismiss }) {
  const errors = toasts.filter((toast) => toast.type === "error");
  const others = toasts.filter((toast) => toast.type !== "error");

  const render = (toast) => {
    const Icon = ICONS[toast.type] || Info;
    return (
      <div className={`toast toast-${toast.type}`} key={toast.id}>
        <Icon size={16} className="toast-icon" aria-hidden="true" />
        <span className="toast-text">{toast.message}</span>
        <button
          type="button"
          className="toast-close"
          aria-label="关闭提示"
          onClick={() => onDismiss(toast.id)}
        >
          <X size={14} />
        </button>
      </div>
    );
  };

  return (
    <div className="toast-region">
      <div className="toast-stack" role="alert" aria-live="assertive">{errors.map(render)}</div>
      <div className="toast-stack" role="status" aria-live="polite">{others.map(render)}</div>
    </div>
  );
}
