import { useCallback, useEffect, useState } from "react";
import { Check, FolderPlus, Languages, Pencil, Save, Star, Trash2, X } from "lucide-react";
import { api } from "../../lib/api.js";
import { formatDate, isChineseJournalArticle } from "../../lib/format.js";
import ArticleDialog from "../feed/ArticleDialog.jsx";

function FavoritesView({ canPersonalize, markRead, toggleFavorite, onArticleUpdated, onDataChanged }) {
  const [data, setData] = useState({ groups: [], favorites: [] });
  const [selectedGroup, setSelectedGroup] = useState("all");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [newGroupName, setNewGroupName] = useState("");
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [editingGroupId, setEditingGroupId] = useState(null);
  const [editingGroupName, setEditingGroupName] = useState("");
  const [savingArticleId, setSavingArticleId] = useState(null);
  const [noteDrafts, setNoteDrafts] = useState({});
  const [selectedArticle, setSelectedArticle] = useState(null);

  const loadFavorites = useCallback(async (group = selectedGroup) => {
    setLoading(true);
    setMessage("");
    try {
      const query = group === "all" ? "" : `?group=${encodeURIComponent(group)}`;
      const result = await api.get(`/api/favorites${query}`);
      const favorites = Array.isArray(result.favorites) ? result.favorites : [];
      setData({ groups: Array.isArray(result.groups) ? result.groups : [], favorites });
      setNoteDrafts(Object.fromEntries(favorites.map((article) => [article.id, article.note || ""])));
      setSelectedArticle((current) => {
        if (!current) return current;
        return favorites.find((article) => article.id === current.id) || current;
      });
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }, [selectedGroup]);

  useEffect(() => {
    if (!canPersonalize) {
      setLoading(false);
      return;
    }
    void loadFavorites(selectedGroup);
  }, [canPersonalize, selectedGroup, loadFavorites]);

  useEffect(() => {
    setSelectedArticle((current) => {
      if (!current) return current;
      const latest = data.favorites.find((article) => article.id === current.id);
      return latest ? { ...current, ...latest } : current;
    });
  }, [data.favorites]);

  const allGroups = data.groups || [];
  const selectedGroupData = selectedGroup === "all"
    ? { name: "全部收藏", count: data.favorites.length }
    : allGroups.find((group) => String(group.id === null ? "ungrouped" : group.id) === selectedGroup)
      || { name: selectedGroup === "ungrouped" ? "未分组" : "收藏分组", count: data.favorites.length };

  async function createGroup(event) {
    event.preventDefault();
    if (!newGroupName.trim()) return;
    setCreatingGroup(true);
    setMessage("");
    try {
      const group = await api.post("/api/favorites/groups", { name: newGroupName.trim() });
      setNewGroupName("");
      setSelectedGroup(String(group.id));
      setMessage(`已创建收藏分组“${group.name}”。`);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setCreatingGroup(false);
    }
  }

  function startRenameGroup(group) {
    setEditingGroupId(group.id);
    setEditingGroupName(group.name || "");
    setMessage("");
  }

  function cancelRenameGroup() {
    setEditingGroupId(null);
    setEditingGroupName("");
  }

  async function renameGroup(event, group) {
    event.preventDefault();
    if (!editingGroupName.trim()) {
      setMessage("收藏分组名称不能为空。");
      return;
    }
    try {
      await api.patch(`/api/favorites/groups/${group.id}`, { name: editingGroupName.trim() });
      cancelRenameGroup();
      await loadFavorites(selectedGroup);
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function removeGroup(group) {
    if (!window.confirm(`删除分组“${group.name}”？其中的文献会保留在“未分组”。`)) return;
    try {
      await api.delete(`/api/favorites/groups/${group.id}`);
      if (selectedGroup === String(group.id)) setSelectedGroup("all");
      else await loadFavorites(selectedGroup);
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function saveFavorite(article, changes = {}) {
    setSavingArticleId(article.id);
    setMessage("");
    try {
      const result = await api.put(`/api/favorites/${article.id}`, {
        note: changes.note === undefined ? (noteDrafts[article.id] ?? article.note ?? "") : changes.note,
        groupId: changes.groupId === undefined ? (article.group_id ?? null) : changes.groupId
      });
      setData((current) => ({
        ...current,
        favorites: current.favorites.map((item) => item.id === article.id ? { ...item, ...result } : item)
      }));
      setNoteDrafts((current) => ({ ...current, [article.id]: result.note || "" }));
      if (changes.groupId !== undefined) await loadFavorites(selectedGroup);
      setMessage("收藏备注和分组已保存。");
    } catch (error) {
      setMessage(error.message);
    } finally {
      setSavingArticleId(null);
    }
  }

  async function removeFavorite(article) {
    setSavingArticleId(article.id);
    setMessage("");
    try {
      await api.post(`/api/articles/${article.id}/favorite`);
      setSelectedArticle((current) => current?.id === article.id ? null : current);
      await Promise.all([loadFavorites(selectedGroup), onDataChanged?.()]);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setSavingArticleId(null);
    }
  }

  async function markFavoriteRead(id) {
    try {
      await api.post(`/api/articles/${id}/read`);
      await Promise.all([loadFavorites(selectedGroup), onDataChanged?.()]);
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function toggleFavoriteFromDialog(id) {
    await removeFavorite({ id });
  }

  function mergeUpdatedArticle(nextArticle) {
    if (!nextArticle?.id) return;
    onArticleUpdated?.(nextArticle);
    setData((current) => ({
      ...current,
      favorites: current.favorites.map((item) => item.id === nextArticle.id ? { ...item, ...nextArticle } : item)
    }));
    setSelectedArticle((current) => current?.id === nextArticle.id ? { ...current, ...nextArticle } : current);
  }

  if (!canPersonalize) {
    return (
      <section className="profile-layout favorites-view" aria-labelledby="favorites-title">
        <div className="page-intro account-heading">
          <div><span className="eyebrow">游客模式</span><h1 id="favorites-title">收藏文献</h1><p>登录个人账户后，收藏、分组和备注会自动同步到你的账户。</p></div>
        </div>
        <div className="guest-prompt"><Star size={20} /><div><strong>登录个人账户后管理收藏</strong><p>网页通行证只负责进入站点，个人收藏不会与其他用户混用。</p></div></div>
      </section>
    );
  }

  return (
    <section className="profile-layout favorites-view" aria-labelledby="favorites-title">
      <div className="page-intro account-heading">
        <div><span className="eyebrow">个人账户 · 自动同步</span><h1 id="favorites-title">收藏文献</h1><p>把重要文献集中保存，按研究方向分组，并为每篇文献记录自己的备注。</p></div>
        <div className="favorites-total"><Star size={17} fill="currentColor" /> <strong>{data.favorites.length}</strong> 篇收藏</div>
      </div>
      {message && <div className="admin-notice favorites-notice" role="status">{message}</div>}
      <div className="favorites-layout">
        <aside className="favorites-sidebar" aria-label="收藏分组">
          <div className="favorites-sidebar-header"><div><span className="eyebrow">我的收藏</span><h2>分组</h2></div><Star size={18} /></div>
          <div className="favorites-group-list">
            <button className={`favorites-group-button ${selectedGroup === "all" ? "active" : ""}`} type="button" onClick={() => setSelectedGroup("all")}>
              <span>全部收藏</span><strong>{data.groups.reduce((total, group) => total + Number(group.count || 0), 0)}</strong>
            </button>
            {allGroups.map((group) => {
              const value = group.id === null ? "ungrouped" : String(group.id);
              const editing = group.id !== null && editingGroupId === group.id;
              return (
                <div className="favorites-group-row" key={value}>
                  {editing ? (
                    <form className="favorites-rename-form" onSubmit={(event) => renameGroup(event, group)}>
                      <input value={editingGroupName} maxLength={40} onChange={(event) => setEditingGroupName(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); cancelRenameGroup(); } }} autoFocus />
                      <button className="icon-button" type="submit" title="保存分组名称" aria-label="保存分组名称" disabled={!editingGroupName.trim()}><Check size={15} /></button>
                      <button className="icon-button" type="button" title="取消重命名" aria-label="取消重命名" onClick={cancelRenameGroup}><X size={15} /></button>
                    </form>
                  ) : (
                    <>
                      <button className={`favorites-group-button ${selectedGroup === value ? "active" : ""}`} type="button" onClick={() => setSelectedGroup(value)}>
                        <span>{group.name}</span><strong>{group.count || 0}</strong>
                      </button>
                      {group.id !== null && <div className="favorites-group-actions">
                        <button className="icon-button" type="button" title="重命名分组" aria-label={`重命名分组 ${group.name}`} onClick={() => startRenameGroup(group)}><Pencil size={13} /></button>
                        <button className="icon-button" type="button" title="删除分组" aria-label={`删除分组 ${group.name}`} onClick={() => removeGroup(group)}><Trash2 size={13} /></button>
                      </div>}
                    </>
                  )}
                </div>
              );
            })}
          </div>
          <form className="favorites-create-form" onSubmit={createGroup}>
            <label htmlFor="new-favorite-group">新建分组</label>
            <div><input id="new-favorite-group" value={newGroupName} maxLength={40} onChange={(event) => setNewGroupName(event.target.value)} placeholder="例如：储能方向" /><button className="secondary compact" type="submit" disabled={creatingGroup || !newGroupName.trim()}><FolderPlus size={14} /> 新建</button></div>
          </form>
        </aside>
        <section className="favorites-content" aria-live="polite">
          <header className="favorites-content-header"><div><span className="eyebrow">收藏列表</span><h2>{selectedGroupData.name}</h2></div><span>{selectedGroupData.count || 0} 篇</span></header>
          {loading ? <div className="loading-skeleton"><div className="skeleton" style={{ height: 140, marginBottom: 12 }} /><div className="skeleton" style={{ height: 140 }} /></div> : data.favorites.length ? (
            <div className="favorites-list">
              {data.favorites.map((article) => {
                const selectedValue = article.group_id === null || article.group_id === undefined ? "ungrouped" : String(article.group_id);
                const note = noteDrafts[article.id] ?? article.note ?? "";
                return (
                  <article className="favorite-card" key={article.id}>
                    <header><div className="article-meta"><span>{article.journal || "未知期刊"}</span><span>{formatDate(article.published_at)}</span>{article.is_read ? <span className="article-status-badge read-badge"><Check size={11} /> 已读</span> : <span className="article-status-badge unread-badge">未读</span>}</div><button className="icon-button favorite-remove-button" type="button" title="取消收藏" aria-label={`取消收藏：${article.title}`} disabled={savingArticleId === article.id} onClick={() => removeFavorite(article)}><Star size={18} fill="currentColor" /></button></header>
                    <button className="favorite-card-title" type="button" onClick={() => setSelectedArticle(article)}>{article.title || "未命名文献"}</button>
                    {article.translated_title && article.translated_title !== article.title && <p className="translated-title"><Languages size={14} /> {article.translated_title}</p>}
                    {article.authors && <p className="authors">{article.authors}</p>}
                    <div className="favorite-card-meta">
                      <label><span>分组</span><select value={selectedValue} onChange={(event) => saveFavorite(article, { groupId: event.target.value === "ungrouped" ? null : event.target.value })}><option value="ungrouped">未分组</option>{allGroups.filter((group) => group.id !== null).map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
                      <label className="favorite-note-field"><span>备注</span><textarea rows={2} maxLength={2000} value={note} onChange={(event) => setNoteDrafts((current) => ({ ...current, [article.id]: event.target.value }))} placeholder="记录阅读重点、研究方向或后续行动" /></label>
                      <button className="secondary compact favorite-save-button" type="button" disabled={savingArticleId === article.id || note === (article.note || "")} onClick={() => saveFavorite(article)}><Save size={14} /> 保存备注</button>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : <div className="empty favorites-empty"><Star size={22} /><strong>这个分组还没有收藏文献</strong><p>在最新文献页面点击星标即可加入收藏。</p></div>}
        </section>
      </div>
      {selectedArticle && <ArticleDialog article={selectedArticle} close={() => setSelectedArticle(null)} markRead={markFavoriteRead} toggleFavorite={toggleFavoriteFromDialog} onArticleUpdated={mergeUpdatedArticle} hideTranslatedAbstract={isChineseJournalArticle(selectedArticle)} />}
    </section>
  );
}

export default FavoritesView;
