import { useCallback, useEffect, useState } from "react";
import { View, Text, RichText } from "@tarojs/components";
import Taro, { useShareAppMessage } from "@tarojs/taro";
import { api } from "../../lib/api.js";
import { articleDate, formatDate, isChineseJournalArticle } from "../../lib/format.js";
import { findJournal, journalAbbr, journalGroup } from "../../lib/journal.js";
import { directionLabel } from "../../lib/directions.js";
import { toBibtex, toRis } from "../../lib/export.js";
import { SkeletonList, Empty } from "../../components/States.jsx";
import { markdownToNodes } from "../../lib/md.js";

/**
 * 文献详情页（网站的 ArticleDialog 升级为独立页面）：
 * 打开即标记已读；操作 = 收藏切换、复制引用（BibTeX/RIS/标题作者）、
 * 复制链接（小程序个人主体无 web-view，外链一律走复制）。
 */
export default function ArticlePage() {
  const id = Taro.getCurrentInstance().router.params.id;
  const [article, setArticle] = useState(null);
  const [journals, setJournals] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    api.get("/api/journals").then((data) => setJournals(Array.isArray(data) ? data : [])).catch(() => {});
    api.get(`/api/articles/${id}`).then((data) => {
      setArticle(data);
      if (!data.is_read) {
        api.post(`/api/articles/${id}/read`).then(() => {
          setArticle((current) => (current ? { ...current, is_read: 1 } : current));
        }).catch(() => {});
      }
    }).catch((err) => setError(err.message || "加载失败")).finally(() => setLoading(false));
  }, [id]);

  useShareAppMessage(() => article ? {
    title: article.title,
    path: `/pages/article/index?id=${article.id}`
  } : { title: "电力文献", path: "/pages/feed/index" });

  const copy = useCallback((text, label) => {
    Taro.setClipboardData({ data: text, success: () => Taro.showToast({ title: `${label}已复制`, icon: "none" }) });
  }, []);

  async function toggleFavorite() {
    try {
      const updated = await api.post(`/api/articles/${article.id}/favorite`, {});
      setArticle((current) => ({ ...current, is_favorite: updated.is_favorite ? 1 : 0 }));
      Taro.showToast({ title: updated.is_favorite ? "已收藏" : "已取消收藏", icon: "none" });
    } catch (error) {
      Taro.showToast({ title: error.message, icon: "none" });
    }
  }

  async function copyCitation() {
    try {
      const result = await Taro.showActionSheet({ itemList: ["复制 BibTeX", "复制 RIS", "复制标题与作者"] });
      if (result.tapIndex === 0) copy(toBibtex([article]), "BibTeX");
      if (result.tapIndex === 1) copy(toRis([article]), "RIS");
      if (result.tapIndex === 2) copy(`${article.title}\n${article.authors || ""}`, "标题与作者");
    } catch (error) { /* 用户取消 */ }
  }

  if (loading) return <View className="page-body"><SkeletonList count={3} /></View>;
  if (!article) return <View className="page-body"><Empty title="文献不存在或已下架" hint={error} /></View>;

  const tone = journalGroup(findJournal(journals, article.journal) || article.journal);
  const dateValue = articleDate(article);
  const direction = article.research_direction || "";
  const keywords = String(article.keywords || "").split(/[;；]/).map((item) => item.trim()).filter(Boolean);
  const showTranslatedAbstract = !isChineseJournalArticle(article, journals) && article.translated_abstract;

  return (
    <View className="page-body">
      <View className={`card tone-${tone}`} style={{ borderLeftWidth: "3px", borderLeftColor: "var(--tone)" }}>
        <View className="acard-head">
          <Text className="jmark">{journalAbbr(article.journal)}</Text>
          <Text className="jname grow">{article.journal || "未知期刊"}</Text>
          {direction ? <Text className={`dir-chip dir-${direction}`}>{directionLabel(direction)}</Text> : null}
        </View>
        <View style={{ fontSize: "17px", fontWeight: "700", lineHeight: 1.5 }}>{article.title}</View>
        {article.translated_title && article.translated_title !== article.title ? (
          <View className="muted small mt8">{article.translated_title}</View>
        ) : null}
        {article.authors ? <View className="small muted mt8">{article.authors}</View> : null}
        <View className="row mt8" style={{ gap: "8px", flexWrap: "wrap" }}>
          <Text className="chip">{formatDate(dateValue)}</Text>
          {article.year ? <Text className="chip">{article.year}</Text> : null}
          {article.volume ? <Text className="chip">卷 {article.volume}</Text> : null}
          {article.issue ? <Text className="chip">期 {article.issue}</Text> : null}
          {article.is_favorite ? <Text className="badge badge-fav">★ 已收藏</Text> : null}
        </View>
      </View>

      <View className="row" style={{ gap: "8px", marginBottom: "10px" }}>
        <Text className="btn grow" onClick={toggleFavorite}>{article.is_favorite ? "★ 取消收藏" : "☆ 收藏"}</Text>
        <Text className="btn grow" onClick={copyCitation}>复制引用</Text>
        {article.url ? <Text className="btn grow" onClick={() => copy(article.url, "链接")}>复制链接</Text> : null}
      </View>

      {article.abstract ? (
        <View className="card">
          <View className="sheet-group-label">摘要</View>
          <RichText nodes={markdownToNodes(article.abstract)} />
        </View>
      ) : (
        <View className="card center muted">暂无摘要，可在网页端触发批量补全</View>
      )}

      {showTranslatedAbstract ? (
        <View className="card tone-ieee" style={{ background: "var(--tone-soft)" }}>
          <View className="sheet-group-label">中文摘要</View>
          <View className="small">{article.translated_abstract}</View>
        </View>
      ) : null}

      {keywords.length ? (
        <View className="card">
          <View className="sheet-group-label">关键词（点按复制）</View>
          <View className="row wrap">
            {keywords.map((keyword, index) => (
              <Text key={index} className="kw-tag" onClick={() => copy(keyword, "关键词")}>{keyword}</Text>
            ))}
          </View>
        </View>
      ) : null}

      {article.doi ? (
        <View className="card row row-between" onClick={() => copy(article.doi, "DOI")}>
          <Text className="muted small">DOI（点按复制）</Text>
          <Text className="small">{article.doi}</Text>
        </View>
      ) : null}
    </View>
  );
}
