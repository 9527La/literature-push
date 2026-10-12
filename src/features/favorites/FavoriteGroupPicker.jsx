import { Star, X } from "lucide-react";
import Modal from "../../components/Modal.jsx";

/**
 * 收藏分组选择框（R2：自 main.jsx 内联 200 行弹窗拆出）。
 *
 * 行为原样保留：单选分组、可设默认、保存中禁用关闭、失败错误内嵌。
 */
export default function FavoriteGroupPicker({ picker, onChange, onConfirm, onClose }) {
  if (!picker) return null;
  const { article, groups, groupId, setDefault, saving, error } = picker;
  return (
    <Modal
      open
      onClose={() => !saving && onClose()}
      labelledBy="favorite-picker-title"
      className="favorite-picker"
    >
        <header><div><span className="eyebrow">选择收藏位置</span><h2 id="favorite-picker-title">收藏到分组</h2></div><button className="icon-button" type="button" aria-label="关闭" onClick={onClose} disabled={saving}><X size={18} /></button></header>
        <p className="favorite-picker-title-text">{article.title}</p>
        <div className="favorite-picker-groups" role="radiogroup" aria-label="收藏分组">
          {groups.map((group) => { const value = group.id === null ? "ungrouped" : String(group.id); return <label className={groupId === value ? "selected" : ""} key={value}><input type="radio" name="favorite-group" value={value} checked={groupId === value} onChange={() => onChange({ groupId: value })} /><span>{group.name}</span><small>{group.count || 0} 篇</small></label>; })}
        </div>
        <label className="favorite-default-choice"><input type="checkbox" checked={setDefault} onChange={(event) => onChange({ setDefault: event.target.checked })} /><span><strong>设为默认收藏夹</strong><small>下次收藏时会预选此分组，仍可临时更改。</small></span></label>
        {error && <div className="inline-msg" role="alert">{error}</div>}
        <footer><button className="secondary" type="button" disabled={saving} onClick={onClose}>取消</button><button className="primary" type="button" disabled={saving} onClick={onConfirm}><Star size={16} /> {saving ? "保存中" : "确认收藏"}</button></footer>
    </Modal>
  );
}
