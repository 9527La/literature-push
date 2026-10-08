import { useState } from "react";
import { View, Text, Input, Switch } from "@tarojs/components";
import Taro from "@tarojs/taro";
import { loginWithCredentials, getSavedUsername } from "../../lib/session.js";
import { WEB_URL } from "../../lib/config.js";

/**
 * 登录页（仅面向网页端注册用户，无游客态）：
 * ① 网页通行证 → X-Passport-Token（全站门禁）
 * ② 个人账户用户名/密码 → X-User-Token
 * 不提供注册入口：注册在网页端完成（复制网址按钮）。
 */
export default function LoginPage() {
  const [passport, setPassport] = useState("");
  const [username, setUsername] = useState(getSavedUsername());
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");

  async function submit() {
    const normalizedPassport = String(passport).normalize("NFKC").trim();
    if (!normalizedPassport || !username.trim() || !password) {
      setMessage("请填写通行证、用户名和密码");
      return;
    }
    setSubmitting(true);
    setMessage("");
    try {
      await loginWithCredentials(normalizedPassport, username, password, remember);
      Taro.switchTab({ url: "/pages/feed/index" });
    } catch (error) {
      setMessage(error.message || "登录失败");
    } finally {
      setSubmitting(false);
    }
  }

  function copyWebUrl() {
    Taro.setClipboardData({ data: WEB_URL });
  }

  return (
    <View className="page-body" style={{ paddingTop: "48px" }}>
      <View className="center" style={{ marginBottom: "24px" }}>
        <View style={{ fontSize: "22px", fontWeight: "700", color: "var(--theme)" }}>电力文献</View>
        <View className="muted mt8">仅面向网页端注册用户 · 需网页通行证 + 个人账户</View>
      </View>

      <View className="card">
        <View className="sheet-group-label">网页通行证（区分大小写，首尾空格自动忽略）</View>
        <Input password className="input" value={passport} placeholder="输入网页通行证" onInput={(event) => { setPassport(event.detail.value); setMessage(""); }} />

        <View className="sheet-group-label mt12">个人账户</View>
        <Input className="input" value={username} placeholder="用户名" onInput={(event) => setUsername(event.detail.value)} />
        <Input password className="input mt8" value={password} placeholder="密码" onInput={(event) => setPassword(event.detail.value)} />

        <View className="cell" style={{ marginTop: "8px" }}>
          <Text className="cell-label">记住登录（本地保存凭据，用于静默续登）</Text>
          <Switch checked={remember} onChange={(event) => setRemember(event.detail.value)} />
        </View>

        <Text className="btn btn-primary btn-block mt12" onClick={submit}>{submitting ? "正在验证…" : "登录"}</Text>
        {message ? <View className="small mt8" style={{ color: "var(--danger)" }}>{message}</View> : null}
      </View>

      <View className="card">
        <View className="small muted">还没有账户？注册请在网页端完成，本小程序不提供注册。</View>
        <Text className="btn btn-ghost btn-block mt8" onClick={copyWebUrl}>复制网页端地址（{WEB_URL}）</Text>
      </View>
    </View>
  );
}
