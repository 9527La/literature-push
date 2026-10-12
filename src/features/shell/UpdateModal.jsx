import { X } from "lucide-react";
import Modal from "../../components/Modal.jsx";
import { renderMarkdown } from "../../lib/markdown.jsx";

/** 版本更新弹窗（S1：自 main.jsx 拆出）。 */
export default function UpdateModal({ versionInfo, onClose }) {
  const hasChangelog = versionInfo.changelog && versionInfo.changelog.trim();
  const hasNotes = versionInfo.notes && versionInfo.notes.length > 0;

  return (
    <Modal open onClose={onClose} labelledBy="update-dialog-title" className="update-dialog">
        <header className="update-dialog-header">
          <div>
            <h2 id="update-dialog-title">版本更新</h2>
            <span className="update-version">v{versionInfo.version} · {versionInfo.date}</span>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="关闭版本更新"><X size={20} /></button>
        </header>
        <div className="update-notes">
          {hasChangelog ? (
            <div className="update-markdown">{renderMarkdown(versionInfo.changelog)}</div>
          ) : hasNotes ? (
            <ul>{versionInfo.notes.map((note, i) => <li key={i}>{note}</li>)}</ul>
          ) : (
            <p className="update-empty">本次为常规更新，包含问题修复和性能优化。</p>
          )}
        </div>
        <footer className="update-actions">
          <button className="primary" onClick={onClose}>知道了</button>
        </footer>
    </Modal>
  );
}
