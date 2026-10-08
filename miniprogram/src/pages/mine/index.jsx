import { useEffect, useState } from "react";
import { View, Text } from "@tarojs/components";
import Taro, { useShareAppMessage } from "@tarojs/taro";
import { api } from "../../lib/api.js";
import { getSavedUsername, logout } from "../../lib/session.js";
import { WEB_URL } from "../../lib/config.js";

/**
 * 我的：账户卡（登录态）+ 库存统计胶囊 + 菜单（推送设置/公共讨论/使用说明）
 * + 注册引导（网页端完成）+ 版本与缓存。
 * 关键词统计按确认不纳入小程序，统计入口仅保留网页端。
 */
export default function MinePage() {
  const [username, setUsername] = useState(getSavedUsername());
  const [status, setStatus] = useState(null);
  const [version, setVersion] = useState("");

  useEffect(() => {
    setUsername(getSavedUsername());
    api.get("/api/status").then(setStatus).catch(() => {});
    api.get("/version.json").then((data) => setVersion(data?.version ? `v${data.version}` : "")).catch(() => {});
  }, []);

  useShareAppMessage(() => ({ title: "电力文献", path: "/pages/feed/index" }));

  async function onLogout() {
    const result = await Taro.showModal({ title: "退出登录", content: "将清除本机的登录凭据。" });
    if (!result.confirm) return;
    await logout();
    Taro.reLaunch({ url: "/pages/login/index" });
  }

  function clearCache() {
    try {
      Taro.removeStorageSync("mp_display_prefs");
      Taro.removeStorageSync("mp_chip_prefs");
    } catch (error) { /* ignore */ }
    Taro.showToast({ title: "本地偏好已清除", icon: "none" });
  }

  function copyWebUrl() {
    Taro.setClipboardData({ data: WEB_URL });
  }

  const menu = [
    { key: "settings", label: "文献推送设置", url: "/pages/settings/index" },
    { key: "feedback", label: "公共讨论", url: "/pages/feedback/index" },
    { key: "help", label: "使用说明", url: "/pages/help/index" }
  ];

  return (
    <View className="page-body">
      <View className="card">
        <View className="row row-between">
          <View>
            <View className="bold" style={{ fontSize: "16px" }}>{username || "已登录用户"}</View>
            <View className="hint mt8">网页端注册用户 · 登录状态同步通行证</View>
          </View>
          <Text className="btn btn-ghost" onClick={onLogout}>退出登录</Text>
        </View>
        {status ? (
          <View className="row mt12" style={{ gap: "8px", flexWrap: "wrap" }}>
            <Text className="chip">库存 {status.articleCount ?? "-"} 篇</Text>
            <Text className="chip">近 7 日 +{status.newArticleCount7d ?? "-"}</Text>
            <Text className="chip">未读 {status.unreadCount ?? "-"}</Text>
            <Text className="chip">收藏 {status.favoriteCount ?? "-"}</Text>
          </View>
        ) : null}
      </View>

      <View className="card" style={{ padding: "4px 12px" }}>
        {menu.map((item, index) => (
          <View
            key={item.key}
            className={`cell${index === menu.length - 1 ? " cell-last" : ""}`}
            onClick={() => Taro.navigateTo({ url: item.url })}
          >
            <Text className="cell-label">{item.label}</Text>
            <Text className="hint">›</Text>
          </View>
        ))}
      </View>

      <View className="card">
        <View className="small muted">注册新账户、关键词统计、管理中心请使用网页端。</View>
        <Text className="btn btn-ghost btn-block mt8" onClick={copyWebUrl}>复制网页端地址</Text>
      </View>

      <View className="card" onClick={clearCache}>
        <View className="row row-between">
          <Text className="cell-label">清除本地偏好（显示开关 / chips 排序）</Text>
          <Text className="hint">{version}</Text>
        </View>
      </View>
    </View>
  );
}
