import { useEffect, useState } from "react";
import { View, Text, Textarea } from "@tarojs/components";
import Taro, { useShareAppMessage } from "@tarojs/taro";
import { api } from "../../lib/api.js";
import { SkeletonList, Empty } from "../../components/States.jsx";

/**
 * 公共讨论（反馈板）：发帖 + 评论 + 点赞。发言要求登录（小程序天然已登录）。
 * ⚠️ M3 合规项：正式环境发帖/评论前需在服务端接微信 msgSecCheck 内容安全校验
 * （本端只调既有 /api/feedback 接口，不改服务端口径）。
 */
export default function FeedbackPage() {
  const [items, setItems] = useState([]);
  const [profile, setProfile] = useState({ displayName: "", publicTag: "" });
  const [content, setContent] = useState("");
  const [commentDraft, setCommentDraft] = useState({});
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);

  async function loadAll() {
    try {
      const [feedbackData, profileData] = await Promise.all([
        api.get("/api/feedback"),
        api.get("/api/feedback/profile").catch(() => ({ displayName: "", publicTag: "" }))
      ]);
      setItems(Array.isArray(feedbackData) ? feedbackData : (feedbackData.items || []));
      setProfile(profileData || {});
    } catch (error) {
      Taro.showToast({ title: error.message, icon: "none" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  useShareAppMessage(() => ({ title: "电力文献 · 公共讨论", path: "/pages/feedback/index" }));

  async function submit() {
    if (!content.trim()) return;
    setSending(true);
    try {
      await api.post("/api/feedback", { content });
      setContent("");
      Taro.showToast({ title: "已发布", icon: "none" });
      await loadAll();
    } catch (error) {
      Taro.showToast({ title: error.message, icon: "none" });
    } finally {
      setSending(false);
    }
  }

  async function submitComment(itemId) {
    const comment = String(commentDraft[itemId] || "").trim();
    if (!comment) return;
    try {
      await api.post(`/api/feedback/${itemId}/comments`, { content: comment });
      setCommentDraft((current) => ({ ...current, [itemId]: "" }));
      await loadAll();
    } catch (error) {
      Taro.showToast({ title: error.message, icon: "none" });
    }
  }

  async function like(itemId) {
    try {
      await api.post(`/api/feedback/${itemId}/like`);
      await loadAll();
    } catch (error) {
      Taro.showToast({ title: error.message, icon: "none" });
    }
  }

  if (loading) return <View className="page-body"><SkeletonList count={3} /></View>;

  return (
    <View className="page-body">
      <View className="card">
        <View className="sheet-group-label">
          以「{profile.displayName || "匿名用户"}」发言{profile.publicTag ? ` · ${profile.publicTag}` : ""}
        </View>
        <Textarea className="textarea" value={content} maxlength={500} placeholder="分享阅读心得、提问或建议（500 字内）" onInput={(event) => setContent(event.detail.value)} />
        <Text className="btn btn-primary btn-block mt8" onClick={submit} disabled={sending}>{sending ? "发布中…" : "发布讨论"}</Text>
      </View>

      {items.length ? items.map((item) => (
        <View className="card" key={item.id}>
          <View className="row row-between">
            <Text className="small muted">{item.display_name || item.username || "匿名用户"} · {String(item.created_at || "").slice(0, 16).replace("T", " ")}</Text>
            {item.status === "closed" ? <Text className="badge badge-read">已关闭</Text> : null}
          </View>
          <View className="mt8" style={{ whiteSpace: "pre-wrap" }}>{item.content}</View>
          {item.admin_reply ? (
            <View className="acard-ta mt8">
              <View className="acard-ta-label">管理员回复</View>
              <View className="small">{item.admin_reply}</View>
            </View>
          ) : null}

          {(item.comments || []).length ? (
            <View className="mt8">
              {(item.comments || []).map((comment) => (
                <View key={comment.id} className="small" style={{ padding: "6px 0", borderBottom: "1px solid var(--line)" }}>
                  <Text className="muted">{comment.display_name || comment.username || "匿名用户"}：</Text>
                  {comment.content}
                </View>
              ))}
            </View>
          ) : null}

          <View className="row mt8" style={{ gap: "8px" }}>
            <Text className="chip" onClick={() => like(item.id)}>👍 {item.likes || 0}</Text>
          </View>
          <View className="row mt8" style={{ gap: "8px" }}>
            <Textarea
              className="textarea grow"
              style={{ minHeight: "40px" }}
              value={commentDraft[item.id] || ""}
              placeholder="写评论…"
              maxlength={300}
              onInput={(event) => setCommentDraft((current) => ({ ...current, [item.id]: event.detail.value }))}
            />
            <Text className="btn" onClick={() => submitComment(item.id)}>发送</Text>
          </View>
        </View>
      )) : (
        <Empty title="还没有讨论" hint="发布第一条讨论吧" />
      )}
    </View>
  );
}
