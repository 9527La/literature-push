import { useEffect, useState } from "react";
import { CircleStop, MessageCircle, MessageSquare, Save, Send, ShieldCheck, ThumbsUp, Trash2, UserRound } from "lucide-react";
import { api } from "../../lib/api.js";
import { formatDate } from "../../lib/format.js";

function FeedbackView({ account }) {
  const isAdmin = Boolean(account.is_admin);
  const canDiscuss = Boolean(account.authenticated);
  const [items, setItems] = useState([]);
  const [content, setContent] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [discussionProfile, setDiscussionProfile] = useState({ displayName: "", publicTag: "" });
  const [displayNameDraft, setDisplayNameDraft] = useState("");
  const [replyDrafts, setReplyDrafts] = useState({});
  const [commentDrafts, setCommentDrafts] = useState({});
  const [openCommentComposerId, setOpenCommentComposerId] = useState(null);
  const [openAdminReplyId, setOpenAdminReplyId] = useState(null);
  const [closeConfirmId, setCloseConfirmId] = useState(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);

  async function loadFeedback() {
    setItems(await api.get("/api/feedback"));
  }

  async function loadDiscussionProfile() {
    const profile = await api.get("/api/feedback/profile");
    setDiscussionProfile(profile);
    setDisplayNameDraft(profile.displayName || "");
  }

  useEffect(() => {
    Promise.all([loadFeedback(), loadDiscussionProfile()]).catch((error) => setMessage(error.message));
  }, [canDiscuss]);

  async function saveDiscussionName(event) {
    event.preventDefault();
    try {
      const profile = await api.put("/api/feedback/profile", { displayName: displayNameDraft });
      setDiscussionProfile(profile);
      setMessage("发言名称已保存。");
      await loadFeedback();
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function submitFeedback(event) {
    event.preventDefault();
    if (!content.trim()) return;
    setSending(true);
    setMessage("");
    try {
      await api.post("/api/feedback", { content });
      setContent("");
      setMessage("讨论已公开发布。");
      await loadFeedback();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setSending(false);
    }
  }

  async function submitReply(id) {
    const reply = String(replyDrafts[id] || "").trim();
    if (!reply) return;
    try {
      await api.post(`/api/admin/feedback/${id}/reply`, { reply });
      setReplyDrafts({ ...replyDrafts, [id]: "" });
      setOpenAdminReplyId(null);
      await loadFeedback();
    } catch (error) {
      setMessage(error.message);
    }
  }

  function openAdminReply(item) {
    setOpenAdminReplyId((current) => current === item.id ? null : item.id);
    setReplyDrafts((current) => ({ ...current, [item.id]: current[item.id] ?? item.admin_reply ?? "" }));
  }

  async function closeTopic(id) {
    if (closeConfirmId !== id) {
      setCloseConfirmId(id);
      return;
    }
    try {
      await api.post(`/api/admin/feedback/${id}/close`);
      setCloseConfirmId(null);
      setOpenAdminReplyId(null);
      setOpenCommentComposerId(null);
      await loadFeedback();
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function submitComment(id) {
    const comment = String(commentDrafts[id] || "").trim();
    if (!comment) return;
    try {
      await api.post(`/api/feedback/${id}/comments`, {
        content: comment
      });
      setCommentDrafts((current) => ({ ...current, [id]: "" }));
      setOpenCommentComposerId(null);
      await loadFeedback();
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function toggleDiscussionLike(id) {
    try {
      const result = await api.post(`/api/feedback/${id}/like`);
      setItems((current) => current.map((item) => item.id === id
        ? { ...item, liked_by_me: result.liked, like_count: result.count }
        : item));
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function toggleCommentLike(discussionId, commentId) {
    try {
      const result = await api.post(`/api/feedback/comments/${commentId}/like`);
      setItems((current) => current.map((item) => item.id === discussionId
        ? { ...item, comments: item.comments.map((comment) => comment.id === commentId ? { ...comment, liked_by_me: result.liked, like_count: result.count } : comment) }
        : item));
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function removeFeedback(id) {
    const confirmationKey = `discussion-${id}`;
    if (deleteConfirmId !== confirmationKey) {
      setDeleteConfirmId(confirmationKey);
      return;
    }
    try {
      await api.delete(`/api/admin/feedback/${id}`);
      setDeleteConfirmId(null);
      await loadFeedback();
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function removeComment(id) {
    const confirmationKey = `comment-${id}`;
    if (deleteConfirmId !== confirmationKey) {
      setDeleteConfirmId(confirmationKey);
      return;
    }
    try {
      await api.delete(`/api/admin/feedback/comments/${id}`);
      setDeleteConfirmId(null);
      await loadFeedback();
    } catch (error) {
      setMessage(error.message);
    }
  }

  return (
    <section className="feedback-layout" aria-labelledby="feedback-title">
      <header className="feedback-hero">
        <div>
          <span className="eyebrow">面向所有人的研究社区</span>
          <h1 id="feedback-title">公共讨论区</h1>
          <p>发布改进建议、补充使用经验，也可以评论和点赞已有讨论。这里的内容公开展示，不通过邮件转发。</p>
        </div>
      </header>

      <div className="feedback-grid">
        <div>
          {canDiscuss ? (
            <form className="feedback-composer" onSubmit={submitFeedback}>
              <div className="composer-author">
                <div className="mini-avatar">{(discussionProfile.displayName || "用").slice(0, 1)}</div>
                <span><strong>{discussionProfile.displayName || "请先设置发言名称"}</strong><small>账户标签 · {discussionProfile.publicTag || "读取中"}</small></span>
              </div>
              <div className="discussion-name-row">
                <label htmlFor="discussion-name">发言名称</label>
                <div><input id="discussion-name" value={displayNameDraft} maxLength={24} onChange={(event) => setDisplayNameDraft(event.target.value)} placeholder="设置你在讨论区的名称" /><button className="secondary" type="button" onClick={saveDiscussionName} disabled={!displayNameDraft.trim()}><Save size={14} /> 保存名称</button></div>
              </div>
              <textarea value={content} onChange={(e) => setContent(e.target.value)} maxLength={2000} rows={5} placeholder="发起一个讨论：描述问题、建议或希望大家补充的经验……" />
              <div className="composer-footer"><span>{content.length}/2000 · 每小时可发起 1 个讨论</span><button className="primary" disabled={sending || !content.trim() || !discussionProfile.displayName}><Send size={15} /> {sending ? "发布中" : "发起讨论"}</button></div>
              {message && <div className="inline-msg" role="status">{message}</div>}
            </form>
          ) : (
            <div className="guest-prompt discussion-guest-prompt"><UserRound size={20} /><div><strong>游客可以阅读公开讨论</strong><p>注册或登录个人账户后，才能设置发言名称、发布主题、评论和点赞。</p></div></div>
          )}

          <div className="feedback-stream" aria-live="polite">
            {items.length === 0 ? <div className="empty">还没有讨论。可以从一个具体的问题或改进建议开始。</div> : items.map((item) => (
              <article className="feedback-item" key={item.id}>
                <header>
                  <div className="mini-avatar">{item.author_name.slice(0, 1)}</div>
                  <div><strong>{item.author_name}</strong><span>公开标签 · {item.author_tag} · {formatDate(item.created_at)}</span></div>
                  {Boolean(item.is_closed) && <span className="topic-closed-badge"><CircleStop size={13} /> 已结束</span>}
                </header>
                <p>{item.content}</p>
                <div className="discussion-actions">
                  <button className={item.liked_by_me ? "is-liked" : ""} type="button" onClick={() => toggleDiscussionLike(item.id)} disabled={!canDiscuss} aria-pressed={Boolean(item.liked_by_me)}><ThumbsUp size={15} /> {item.like_count || 0}</button>
                  <button type="button" disabled={!canDiscuss || Boolean(item.is_closed)} onClick={() => setOpenCommentComposerId((current) => current === item.id ? null : item.id)} aria-expanded={openCommentComposerId === item.id} aria-controls={`comment-composer-${item.id}`}><MessageCircle size={15} /> {item.is_closed ? "话题已结束" : "评论"} · {item.comment_count || 0}</button>
                </div>
                {item.admin_reply && <div className="admin-reply"><strong><ShieldCheck size={14} /> 管理员回复</strong><p>{item.admin_reply}</p><time>{formatDate(item.replied_at)}</time></div>}
                {isAdmin && <div className="admin-topic-toolbar" aria-label="管理员话题操作">
                  <span>话题操作</span>
                  <button className="secondary" type="button" disabled={Boolean(item.is_closed)} onClick={() => openAdminReply(item)}><MessageSquare size={14} /> 评论话题</button>
                  <button className="secondary" type="button" disabled={Boolean(item.is_closed)} onClick={() => closeTopic(item.id)}><CircleStop size={14} /> {closeConfirmId === item.id ? "确认结束话题" : item.is_closed ? "话题已结束" : "结束话题"}</button>
                  <button className="danger-button" type="button" onClick={() => removeFeedback(item.id)}><Trash2 size={14} /> {deleteConfirmId === `discussion-${item.id}` ? "确认删除话题" : "删除话题"}</button>
                </div>}
                {isAdmin && openAdminReplyId === item.id && !item.is_closed && <div className="admin-reply-composer">
                  <label htmlFor={`admin-reply-${item.id}`}>{item.admin_reply ? "更新管理员评论" : "以管理员身份评论话题"}</label>
                  <textarea id={`admin-reply-${item.id}`} rows={3} maxLength={2000} value={replyDrafts[item.id] || ""} onChange={(event) => setReplyDrafts((current) => ({ ...current, [item.id]: event.target.value }))} placeholder="输入公开显示的管理员评论" />
                  <div><button className="secondary" type="button" onClick={() => setOpenAdminReplyId(null)}>取消</button><button className="primary" type="button" onClick={() => submitReply(item.id)} disabled={!String(replyDrafts[item.id] || "").trim()}><Send size={14} /> 发布评论</button></div>
                </div>}
                <section className="discussion-comments" aria-label="讨论评论">
                  {item.comments.map((comment) => (
                    <article className="discussion-comment" key={comment.id}>
                      <div className="comment-rail" aria-hidden="true"><span>{comment.author_name.slice(0, 1)}</span></div>
                      <div className="comment-body">
                        <header><strong>{comment.author_name}</strong><span>公开标签 · {comment.author_tag} · {formatDate(comment.created_at)}</span></header>
                        <p>{comment.content}</p>
                        <div className="comment-actions">
                          <button className={comment.liked_by_me ? "is-liked" : ""} type="button" onClick={() => toggleCommentLike(item.id, comment.id)} disabled={!canDiscuss} aria-pressed={Boolean(comment.liked_by_me)}><ThumbsUp size={13} /> {comment.like_count || 0}</button>
                          {isAdmin && <button className="comment-delete" type="button" onClick={() => removeComment(comment.id)}><Trash2 size={13} /> {deleteConfirmId === `comment-${comment.id}` ? "确认删除" : "删除"}</button>}
                        </div>
                      </div>
                    </article>
                  ))}
                  {openCommentComposerId === item.id && !item.is_closed && <div className="comment-composer" id={`comment-composer-${item.id}`}>
                    <textarea rows={2} maxLength={1000} value={commentDrafts[item.id] || ""} onChange={(event) => setCommentDrafts((current) => ({ ...current, [item.id]: event.target.value }))} placeholder="补充你的看法或使用经验" />
                    <div>
                      <span className="comment-identity">{discussionProfile.displayName} · {discussionProfile.publicTag}</span>
                      <button className="secondary" type="button" disabled={!String(commentDrafts[item.id] || "").trim()} onClick={() => submitComment(item.id)}><Send size={14} /> 发表评论</button>
                    </div>
                  </div>}
                </section>
              </article>
            ))}
          </div>
        </div>

      </div>
    </section>
  );
}

export default FeedbackView;
