import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, FolderPlus, Languages, Pencil, Plus, Save, Star, Trash2, X } from "lucide-react";
import { api } from "../../lib/api.js";
import { articleDate, formatDate, isChineseJournalArticle } from "../../lib/format.js";
import { findJournal, journalAbbr, journalGroup } from "../../lib/journal.js";
import { directionLabel, directionVar } from "../../lib/directions.js";
import ArticleDialog from "../feed/ArticleDialog.jsx";
import EmptyState from "../../components/EmptyState.jsx";

// 时间范围（三档，与文献库快捷区间同口径：按文献日期计算下限）
const FAV_TIME_RANGES = [
  { key: "7d", label: "近 7 日" },
  { key: "30d", label: "近 30 日" },
  { key: "month", label: "本月" }
];
// 阅读状态（单选：全部 / 未读 / 已读）
const FAV_READ_STATES = [
  { key: "all", label: "全部" },
  { key: "unread", label: "未读" },
  { key: "read", label: "已读" }
];

function favoriteTimeFloor(range) {
  const now = new Date();
  if (range === "month") {
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  }
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (range === "7d") day.setDate(day.getDate() - 6);
  if (range === "30d") day.setDate(day.getDate() - 29);
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
}

function FavoritesView({ canPersonalize, markRead, toggleFavorite, onArticleUpdated, onDataChanged, journals = [] }) {
  const [data, setData] = useState({ groups: [], favorites: [], total: 0 });
  const [selectedGroup, setSelectedGroup] = useState("all");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [newGroupName, setNewGroupName] = useState("");
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [editingGroupId, setEditingGroupId] = useState(null);
  const [editingGroupName, setEditingGroupName] = useState("");
  // 新建分组不常驻（需求 6）：默认只显示「+ 新建分组」按钮，点击才展开输入行。
  const [createOpen, setCreateOpen] = useState(false);
  const [savingArticleId, setSavingArticleId] = useState(null);
  const [noteDrafts, setNoteDrafts] = useState({});
  const [selectedArticle, setSelectedArticle] = useState(null);
  // 甲-3：列表轻筛选（来源期刊 + 研究方向 + 排序 + 时间范围 + 阅读状态）——纯客户端，仅作用于当前分组视图
  const [favFilters, setFavFilters] = useState({ journals: [], dirs: [], sort: "recent", timeRange: null, readState: "all" });
  // 乙-2：备注默认折叠为一行预览，点击「编辑/添加备注」展开
  const [noteEditing, setNoteEditing] = useState(() => new Set());

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

  // ── 甲-3：列表轻筛选派生数据与操作 ──
  const journalEntries = useMemo(() => {
    const counts = new Map();
    for (const article of data.favorites) {
      const name = String(article.journal || "").trim();
      if (!name) continue;
      counts.set(name, (counts.get(name) || 0) + 1);
    }
    return [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [data.favorites]);

  const directionEntries = useMemo(() => {
    const counts = new Map();
    for (const article of data.favorites) {
      const key = article.research_direction || "";
      if (!key || key === "other") continue; // 「其他」不进入用户可见筛选面（与文献库口径一致）
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return [...counts.entries()]
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
  }, [data.favorites]);

  const visibleFavorites = useMemo(() => {
    const floor = favFilters.timeRange ? favoriteTimeFloor(favFilters.timeRange) : "";
    const list = data.favorites.filter((article) =>
      (favFilters.journals.length === 0 || favFilters.journals.includes(String(article.journal || "").trim()))
      && (favFilters.dirs.length === 0 || favFilters.dirs.includes(article.research_direction || ""))
      && (!floor || String(articleDate(article)) >= floor)
      && (favFilters.readState === "all"
        || (favFilters.readState === "unread" ? !article.is_read : Boolean(article.is_read)))
    );
    if (favFilters.sort === "date") {
      return [...list].sort((a, b) => String(articleDate(b)).localeCompare(String(articleDate(a))));
    }
    return list;
  }, [data.favorites, favFilters]);

  const favFilterActive = favFilters.journals.length > 0 || favFilters.dirs.length > 0
    || Boolean(favFilters.timeRange) || favFilters.readState !== "all";

  function toggleFavFilter(field, value) {
    setFavFilters((prev) => ({
      ...prev,
      [field]: prev[field].includes(value) ? prev[field].filter((item) => item !== value) : [...prev[field], value]
    }));
  }
  function resetFavFilters() {
    setFavFilters((prev) => ({ ...prev, journals: [], dirs: [], timeRange: null, readState: "all" }));
  }
  function startEditNote(article) {
    setNoteEditing((prev) => new Set(prev).add(article.id));
  }
  function cancelEditNote(article) {
    setNoteDrafts((current) => ({ ...current, [article.id]: article.note || "" }));
    setNoteEditing((prev) => {
      const next = new Set(prev);
      next.delete(article.id);
      return next;
    });
  }
  function finishEditNote(article) {
    setNoteEditing((prev) => {
      const next = new Set(prev);
      next.delete(article.id);
      return next;
    });
  }

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
      return true;
    } catch (error) {
      setMessage(error.message);
      return false;
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
      </div>
      {message && <div className="admin-notice favorites-notice" role="status">{message}</div>}
      <div className="favorites-layout">
        <aside className="favorites-sidebar" aria-label="收藏分组">
          <div className="favorites-sidebar-header"><div><span className="eyebrow">我的收藏</span><h2>分组</h2></div><Star size={18} /></div>
          <div className="favorites-group-list">
            {/* 分组行右侧不再显示篇数（需求 7/8）：计数没有操作价值，行内只保留
                名称；自定义分组的重命名/删除按钮常驻显示。 */}
            <button className={`favorites-group-button ${selectedGroup === "all" ? "active" : ""}`} type="button" onClick={() => setSelectedGroup("all")}>
              <span>全部收藏</span>
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
                        <span>{group.name}</span>
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
          {/* 新建入口折叠（需求 6）：点「+ 新建分组」才展开输入行。 */}
          {createOpen ? (
            <form className="favorites-create-form" onSubmit={createGroup}>
              <div><input id="new-favorite-group" value={newGroupName} maxLength={40} onChange={(event) => setNewGroupName(event.target.value)} placeholder="例如：储能方向" autoFocus /><button className="secondary compact" type="submit" disabled={creatingGroup || !newGroupName.trim()}><FolderPlus size={14} /> 新建</button></div>
            </form>
          ) : (
            <button className="secondary compact favorites-create-toggle" type="button" onClick={() => { setCreateOpen(true); }}>
              <Plus size={14} /> 新建分组
            </button>
          )}
        </aside>
        <section className="favorites-content" aria-live="polite">
          <header className="favorites-content-header"><div><span className="eyebrow">收藏列表</span><h2>{selectedGroupData.name}</h2></div></header>
          {/* 甲-3：轻筛选工具条——期刊四色 chips + 方向 chips + 排序 + 计数（纯客户端联动） */}
          {!loading && data.favorites.length > 0 && (
            <div className="favorites-tools">
              <div className="favorites-tools-row">
                <span className="favorites-tools-label">来源期刊</span>
                {journalEntries.map(({ name, count }) => {
                  const tone = journalGroup(findJournal(journals, name) || name);
                  const on = favFilters.journals.includes(name);
                  return (
                    <button
                      key={name}
                      type="button"
                      className={`fav-jchip tone-${tone}${on ? " on" : ""}`}
                      aria-pressed={on}
                      title={on ? `取消筛选「${name}」` : `只看「${name}」的收藏`}
                      onClick={() => toggleFavFilter("journals", name)}
                    >
                      <span className="fav-jmark" aria-hidden="true">{journalAbbr(name)}</span>
                      <span className="fav-jname">{name}</span>
                      <span className="fav-jcount">{count}</span>
                    </button>
                  );
                })}
              </div>
              {directionEntries.length > 0 && (
                <div className="favorites-tools-row">
                  <span className="favorites-tools-label">研究方向</span>
                  {directionEntries.map(({ key, count }) => {
                    const on = favFilters.dirs.includes(key);
                    return (
                      <button
                        key={key}
                        type="button"
                        className={`fav-dchip${on ? " on" : ""}`}
                        style={{ "--dir-key": directionVar(key) }}
                        aria-pressed={on}
                        title={directionLabel(key)}
                        onClick={() => toggleFavFilter("dirs", key)}
                      >
                        <span className="direction-dot" aria-hidden="true" />
                        {directionLabel(key)}
                        <span className="fav-jcount">{count}</span>
                      </button>
                    );
                  })}
                </div>
              )}
              <div className="favorites-tools-row">
                <span className="favorites-tools-label">时间范围</span>
                {FAV_TIME_RANGES.map(({ key, label }) => {
                  const on = favFilters.timeRange === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      className={`favorites-tools-chip${on ? " on" : ""}`}
                      aria-pressed={on}
                      title={on ? "取消时间筛选" : `${label}内出版的收藏文献`}
                      onClick={() => setFavFilters((prev) => ({ ...prev, timeRange: prev.timeRange === key ? null : key }))}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              <div className="favorites-tools-row">
                <span className="favorites-tools-label">阅读状态</span>
                {FAV_READ_STATES.map(({ key, label }) => {
                  const on = favFilters.readState === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      className={`favorites-tools-chip${on ? " on" : ""}`}
                      aria-pressed={on}
                      title={key === "all" ? "显示全部阅读状态" : `只看${label}的收藏`}
                      onClick={() => setFavFilters((prev) => ({ ...prev, readState: key }))}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              <div className="favorites-tools-row favorites-tools-meta">
                <label className="favorites-tools-sort">
                  排序
                  <select value={favFilters.sort} onChange={(event) => setFavFilters((prev) => ({ ...prev, sort: event.target.value }))}>
                    <option value="recent">最近收藏</option>
                    <option value="date">出版日期</option>
                  </select>
                </label>
                <span className="favorites-tools-count" role="status" aria-live="polite">
                  显示 <strong>{visibleFavorites.length}</strong> / 共 {data.favorites.length} 篇
                </span>
                {favFilterActive && (
                  <button type="button" className="favorites-tools-reset" onClick={resetFavFilters}>全部显示</button>
                )}
              </div>
            </div>
          )}
          {loading ? <div className="loading-skeleton"><div className="skeleton" style={{ height: 140, marginBottom: 12 }} /><div className="skeleton" style={{ height: 140 }} /></div> : data.favorites.length ? (
            visibleFavorites.length ? (
            <div className="favorites-list">
              {visibleFavorites.map((article) => {
                const selectedValue = article.group_id === null || article.group_id === undefined ? "ungrouped" : String(article.group_id);
                const note = noteDrafts[article.id] ?? article.note ?? "";
                // 色系卡片（需求 5）：与文献库同源的期刊身份条（实底徽章 + 刊名 +
                // 方向 chip），整卡带期刊色系。
                const journalRecord = findJournal(journals, article.journal);
                const tone = journalGroup(journalRecord || article.journal);
                const direction = article.research_direction || "";
                return (
                  <article className={`favorite-card tone-${tone}`} key={article.id}>
                    <header className="article-head">
                      <span className={`journal-mark tone-${tone}`} aria-hidden="true">{journalAbbr(article.journal)}</span>
                      <span className="article-journal">{article.journal || "未知期刊"}</span>
                      {article.is_read ? <span className="article-status-badge read-badge"><Check size={11} /> 已读</span> : null}
                      <span className="article-head-spacer" aria-hidden="true" />
                      {direction && (
                        <span className="direction-chip" style={{ "--dir-key": directionVar(direction) }} title={directionLabel(direction)}>
                          {directionLabel(direction)}
                        </span>
                      )}
                      <time dateTime={formatDate(articleDate(article))}>{formatDate(articleDate(article))}</time>
                      <button className="icon-button favorite-remove-button" type="button" title="取消收藏" aria-label={`取消收藏：${article.title}`} disabled={savingArticleId === article.id} onClick={() => removeFavorite(article)}><Star size={17} fill="currentColor" /></button>
                    </header>
                    <button className="favorite-card-title" type="button" onClick={() => setSelectedArticle(article)}>{article.title || "未命名文献"}</button>
                    {article.translated_title && article.translated_title !== article.title && <p className="translated-title"><Languages size={14} /> {article.translated_title}</p>}
                    {article.authors && <p className="authors">{article.authors}</p>}
                    <div className="favorite-card-meta">
                      <label className="favorite-group-field"><span>分组</span><select value={selectedValue} onChange={(event) => saveFavorite(article, { groupId: event.target.value === "ungrouped" ? null : event.target.value })}><option value="ungrouped">未分组</option>{allGroups.filter((group) => group.id !== null).map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
                      {/* 乙-2：备注折叠为一行预览，点击「编辑/添加备注」展开；保存后收回单行 */}
                      {noteEditing.has(article.id) ? (
                        <div className="favorite-note-edit">
                          <textarea rows={2} maxLength={2000} value={note} onChange={(event) => setNoteDrafts((current) => ({ ...current, [article.id]: event.target.value }))} placeholder="记录阅读重点、研究方向或后续行动" autoFocus />
                          <div className="favorite-note-actions">
                            <span className="favorite-note-hint">修改将保存到个人账户</span>
                            <button className="link-button" type="button" onClick={() => cancelEditNote(article)}>取消</button>
                            <button className="secondary compact" type="button" disabled={savingArticleId === article.id || note === (article.note || "")} onClick={async () => { const ok = await saveFavorite(article); if (ok) finishEditNote(article); }}><Save size={14} /> 保存备注</button>
                          </div>
                        </div>
                      ) : (
                        <div className="favorite-note-preview">
                          <span className={`favorite-note-text${note ? "" : " is-empty"}`} title={note || ""}>{note || "暂无备注"}</span>
                          <button className="secondary compact favorite-note-toggle" type="button" onClick={() => startEditNote(article)}>{note ? "编辑" : "＋ 添加备注"}</button>
                        </div>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
            ) : (
              <div className="empty favorites-empty"><Star size={22} /><strong>没有符合当前筛选的收藏文献</strong><p>点上方 chip 取消筛选，或点「全部显示」恢复完整列表。</p></div>
            )
          ) : (
            <EmptyState art="favorites" title="这个分组还没有收藏文献" description="在文献库页面点击星标即可加入收藏。" />
          )}
        </section>
      </div>
      {selectedArticle && <ArticleDialog article={selectedArticle} close={() => setSelectedArticle(null)} markRead={markFavoriteRead} toggleFavorite={toggleFavoriteFromDialog} onArticleUpdated={mergeUpdatedArticle} onOpenArticle={(nextArticle) => setSelectedArticle(nextArticle)} hideTranslatedAbstract={isChineseJournalArticle(selectedArticle, journals)} />}
    </section>
  );
}

export default FavoritesView;
