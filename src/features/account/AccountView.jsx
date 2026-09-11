import { useEffect, useRef, useState } from "react";
import { CloudDownload, CloudUpload, HardDrive, LogOut, Save } from "lucide-react";
import { formatDate } from "../../lib/format.js";
import PersonalAccountAuth from "./PersonalAccountAuth.jsx";

function AccountView({
  account,
  onSave,
  onAuthenticate,
  onLogout,
  autoSavePersonalization,
  onAutoSaveChange,
  onSaveLocal,
  onLoadLocal,
  onUploadRemote,
  onLoadRemote
}) {
  const [form, setForm] = useState(account);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const messageTimerRef = useRef(null);
  const currentYear = new Date().getFullYear();

  useEffect(() => setForm(account), [account]);

  useEffect(() => () => {
    if (messageTimerRef.current) clearTimeout(messageTimerRef.current);
  }, []);

  function showTemporaryMessage(text) {
    if (messageTimerRef.current) clearTimeout(messageTimerRef.current);
    setMessage(text);
    messageTimerRef.current = setTimeout(() => {
      setMessage("");
      messageTimerRef.current = null;
    }, 3000);
  }

  function clearAccountMessage() {
    if (messageTimerRef.current) {
      clearTimeout(messageTimerRef.current);
      messageTimerRef.current = null;
    }
    setMessage("");
  }

  async function submitProfile(event) {
    event.preventDefault();
    setSaving(true);
    clearAccountMessage();
    try {
      await onSave(form);
      showTemporaryMessage("账户资料已保存。");
    } catch (error) {
      setMessage(error.message);
    } finally {
      setSaving(false);
    }
  }

  async function runSettingAction(action, successMessage) {
    setSaving(true);
    clearAccountMessage();
    try {
      await Promise.resolve(action());
      showTemporaryMessage(successMessage);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setSaving(false);
    }
  }

  if (!account.authenticated) {
    return <PersonalAccountAuth onAuthenticate={onAuthenticate} />;
  }

  return (
    <section className="profile-layout" aria-labelledby="account-title">
      <div className="page-intro account-heading">
        <div><span className="eyebrow">已登录 · {account.username}</span><h1 id="account-title">我的账户</h1><p>维护个人资料，并决定个性设置保存在本机还是同步至远端账户。</p></div>
        <button className="secondary" type="button" onClick={onLogout}><LogOut size={15} /> 退出登录</button>
      </div>

      <div className="account-grid">
        <form className="profile-card" onSubmit={submitProfile} onInput={clearAccountMessage}>
          <div className="profile-mark" aria-hidden="true">{(form.name || account.username || "用").slice(0, 1)}</div>
          <div className="form-grid">
            <label><span>姓名</span><input value={form.name || ""} maxLength={40} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="请输入姓名" required /></label>
            <label><span>入学年份</span><select value={form.enrollment_year || ""} onChange={(e) => setForm({ ...form, enrollment_year: Number(e.target.value) })} required><option value="">请选择</option>{Array.from({ length: currentYear - 1979 }, (_, i) => currentYear - i).map((year) => <option key={year} value={year}>{year}级</option>)}</select></label>
            <label><span>学历</span><select value={form.degree || ""} onChange={(e) => setForm({ ...form, degree: e.target.value })} required><option value="">请选择</option><option value="硕士">硕士</option><option value="博士">博士</option></select></label>
            <label><span>周报接收邮箱</span><input type="email" value={form.email || ""} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="name@example.com" /></label>
          </div>
          <div className="form-footer"><span>{message && <span className="inline-msg" role="status">{message}</span>}</span><button className="primary" type="submit" disabled={saving}><Save size={16} /> {saving ? "保存中" : "保存账户资料"}</button></div>
        </form>

        <section className="sync-card" aria-labelledby="sync-title">
          <span className="eyebrow">个性设置</span>
          <h2 id="sync-title">保存与同步</h2>
          <p>包含文献筛选、列表内容显示、订阅期刊和推送配置。</p>
          <label className="preference-row sync-toggle"><span><strong>自动保存在本机</strong><small>设置变化后自动写入当前浏览器。</small></span><input type="checkbox" checked={autoSavePersonalization} onChange={(e) => onAutoSaveChange(e.target.checked)} /></label>
          <div className="sync-actions">
            <button className="secondary" type="button" disabled={saving} onClick={() => runSettingAction(onSaveLocal, "当前个性设置已保存到本机。") }><HardDrive size={15} /> 保存到本机</button>
            <button className="secondary" type="button" disabled={saving} onClick={() => runSettingAction(onLoadLocal, "已从本机载入个性设置。") }><HardDrive size={15} /> 从本机载入</button>
            <button className="primary" type="button" disabled={saving} onClick={() => runSettingAction(onUploadRemote, "当前个性设置已上传到远端账户。") }><CloudUpload size={15} /> 上传远端</button>
            <button className="secondary" type="button" disabled={saving} onClick={() => runSettingAction(onLoadRemote, "已从远端账户载入个性设置。") }><CloudDownload size={15} /> 从远端载入</button>
          </div>
          {account.preferences_updated_at && <small className="sync-time">远端最近保存：{formatDate(account.preferences_updated_at)}</small>}
        </section>
      </div>
    </section>
  );
}

export default AccountView;
