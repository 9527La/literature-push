import Modal from "./Modal.jsx";

/**
 * 确认对话框（R2）。
 *
 * 破坏性操作（删除用户等）此前靠「再点一次同一按钮」的隐式确认，没有统一
 * 的阻断式确认组件。这里基于既有 Modal（焦点陷阱 / Esc / 滚动锁 / 焦点
 * 归还全都复用）补一个薄封装，全站破坏性操作共用同一套交互与文案结构。
 */
export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "确认",
  cancelLabel = "取消",
  danger = false,
  busy = false,
  onConfirm,
  onCancel
}) {
  if (!open) return null;
  return (
    <Modal open onClose={busy ? () => {} : onCancel} labelledBy="confirm-dialog-title" className="confirm-dialog">
      <header className="confirm-dialog-head">
        <div>
          <span className="eyebrow">请确认</span>
          <h2 id="confirm-dialog-title">{title}</h2>
        </div>
      </header>
      <div className="confirm-dialog-body">
        {typeof message === "string" ? <p>{message}</p> : message}
      </div>
      <footer className="confirm-dialog-actions">
        <button className="secondary" type="button" disabled={busy} onClick={onCancel}>{cancelLabel}</button>
        <button
          className={danger ? "danger-button" : "primary"}
          type="button"
          disabled={busy}
          onClick={onConfirm}
        >
          {busy ? "处理中…" : confirmLabel}
        </button>
      </footer>
    </Modal>
  );
}
