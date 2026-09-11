import { useState } from "react";
import { LogOut, Users } from "lucide-react";
import InternalUseNotice from "../../components/InternalUseNotice.jsx";
import { readAccountLoginSettings } from "../../lib/storage.js";

function PersonalAccountAuth({ onAuthenticate }) {
  const [mode, setMode] = useState("login");
  const [credentials, setCredentials] = useState(() => {
    const saved = readAccountLoginSettings();
    return {
      username: String(saved.username || ""),
      password: saved.rememberPassword ? String(saved.password || "") : ""
    };
  });
  const [rememberPassword, setRememberPassword] = useState(() => {
    const saved = readAccountLoginSettings();
    return Boolean(saved.rememberPassword && saved.password);
  });
  const [autoLogin, setAutoLogin] = useState(() => {
    const saved = readAccountLoginSettings();
    // Keep the previous behavior convenient for first-time users while
    // respecting an explicit opt-out saved by logout or the form.
    return saved.autoLogin === undefined ? true : Boolean(saved.autoLogin);
  });
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function switchMode(nextMode) {
    setMode(nextMode);
    setMessage("");
    if (nextMode !== "login") {
      setCredentials({ username: "", password: "" });
      return;
    }
    const saved = readAccountLoginSettings();
    setCredentials({
      username: String(saved.username || ""),
      password: saved.rememberPassword ? String(saved.password || "") : ""
    });
    setRememberPassword(Boolean(saved.rememberPassword && saved.password));
    setAutoLogin(saved.autoLogin === undefined ? true : Boolean(saved.autoLogin));
  }

  async function submit(event) {
    event.preventDefault();
    setSubmitting(true);
    setMessage("");
    try {
      await onAuthenticate(mode, credentials, { rememberPassword, autoLogin });
    } catch (error) {
      setMessage(error.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="profile-layout" aria-labelledby="personal-account-title">
      <div className="page-intro account-heading">
        <div><span className="eyebrow">游客模式</span><h1 id="personal-account-title">个人账户</h1><p>网页通行证只负责进入站点；注册个人账户后，才能跨设备保存自己的阅读、收藏、推送和讨论身份。</p></div>
      </div>
      <div className="account-auth-card">
        <div className="auth-tabs" role="tablist" aria-label="个人账户操作">
          <button type="button" role="tab" aria-selected={mode === "login"} className={mode === "login" ? "active" : ""} onClick={() => switchMode("login")}>登录个人账户</button>
          <button type="button" role="tab" aria-selected={mode === "register"} className={mode === "register" ? "active" : ""} onClick={() => switchMode("register")}>注册个人账户</button>
        </div>
        <InternalUseNotice className="account-use-notice" />
        <form className="auth-form" onSubmit={submit} onInput={() => setMessage("")}>
          <label><span>用户名</span><input value={credentials.username} autoComplete={mode === "login" ? "username" : "new-username"} maxLength={32} onChange={(event) => setCredentials({ ...credentials, username: event.target.value })} required autoFocus /></label>
          <label><span>密码</span><input type="password" value={credentials.password} autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={mode === "register" ? 8 : 1} maxLength={72} onChange={(event) => setCredentials({ ...credentials, password: event.target.value })} required /></label>
          <div className="auth-options" role="group" aria-label="登录选项">
            <label className="auth-option">
              <input type="checkbox" checked={rememberPassword} onChange={(event) => setRememberPassword(event.target.checked)} />
              <span><strong>记住密码</strong><small>在此浏览器保存用户名和密码，方便下次登录。</small></span>
            </label>
            <label className="auth-option">
              <input type="checkbox" checked={autoLogin} onChange={(event) => setAutoLogin(event.target.checked)} />
              <span><strong>自动登录</strong><small>同一 IP 下优先恢复有效登录状态，无需重复输入。</small></span>
            </label>
          </div>
          <button className="primary" disabled={submitting || !credentials.username || !credentials.password}>{submitting ? "处理中" : mode === "login" ? "登录个人账户" : "注册并登录"}</button>
          {message && <div className="inline-msg login-error" role="alert">{message}</div>}
        </form>
        <p className="auth-note">用户名必须唯一；最多注册 40 个个人账户。每个账户同一时间只能在一个 IP 上保持登录，但之后可从其他 IP 再次登录。记住密码会将密码保存在当前浏览器，请只在可信设备上启用。</p>
      </div>
    </section>
  );
}

export default PersonalAccountAuth;
