import { useState } from "react";
import BrandMark from "../../components/BrandMark.jsx";
import InternalUseNotice from "../../components/InternalUseNotice.jsx";

// 通行证经常被从聊天窗口整段粘过来，或用全角输入法敲进来。
// 服务端是逐字符严格比对（safeEqualText），首尾空格、换行、全角字符都会判为错误，
// 所以提交前统一做一次归一化：NFKC 把全角折成半角，再去掉首尾空白。
export function normalizePassport(value) {
  return String(value || "").normalize("NFKC").trim();
}

/** 通行证门（S1：自 main.jsx 拆出）。 */
export default function LoginGate({ onAuthenticate }) {
  const [passport, setPassport] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setSubmitting(true);
    setMessage("");
    try {
      await onAuthenticate(normalizePassport(passport));
    } catch (error) {
      setMessage(error.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-shell">
      <section className="login-panel" aria-labelledby="login-title">
        <div className="login-brand"><BrandMark size={26} /><span>电气前沿速递</span></div>
        <span className="eyebrow">受限访问</span>
        <h1 id="login-title">输入网页通行证</h1>
        <p>通行证用于进入网页。进入后可游客浏览，也可以注册或登录独立的个人账户。</p>
        <InternalUseNotice className="login-use-notice" />
        <form className="auth-form login-form" onSubmit={submit} onInput={() => setMessage("")}>
          <label><span>网页通行证</span><input type="password" value={passport} autoComplete="current-password" maxLength={128} onChange={(event) => setPassport(event.target.value)} required autoFocus /></label>
          <button className="primary" disabled={submitting || !normalizePassport(passport)}>{submitting ? "正在验证" : "进入网页"}</button>
          {message && <div className="inline-msg login-error" role="alert">{message}</div>}
        </form>
        <small>通行证区分大小写（首尾空格会被自动忽略）；管理员通行证可进入管理中心。全站最多允许 20 个不同 IP 同时登录个人账户。</small>
      </section>
    </main>
  );
}
