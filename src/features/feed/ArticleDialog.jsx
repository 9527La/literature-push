import { useEffect, useState } from "react";
import { Check, ExternalLink, Heart, Languages, Star, X } from "lucide-react";
import { api } from "../../lib/api.js";
import { formatDate, isChineseSourceText } from "../../lib/format.js";
import Modal from "../../components/Modal.jsx";

function ArticleDialog({ article, close, markRead, toggleFavorite, onArticleUpdated, showActions = true, hideTranslatedAbstract = false }) {
  const [detail, setDetail] = useState(article);
  const [enriching, setEnriching] = useState(true);
  const [enrichError, setEnrichError] = useState("");
  const [translation, setTranslation] = useState(() => article.translated_title ? {
    target_language: "zh",
    title: article.translated_title,
    abstract: article.translated_abstract || ""
  } : null);
  const [translating, setTranslating] = useState("");
  const [translationError, setTranslationError] = useState("");

  useEffect(() => {
    let ignore = false;
    setDetail(article);
    setEnrichError("");
    setTranslation(article.translated_title ? {
      target_language: "zh",
      title: article.translated_title,
      abstract: article.translated_abstract || ""
    } : null);
    setTranslationError("");
    setEnriching(true);
    api.get(`/api/articles/${article.id}`)
      .then(async (fullArticle) => {
        if (ignore) return;
        const applyArticle = (nextArticle) => {
          const mergedArticle = { ...article, ...nextArticle };
          setDetail(mergedArticle);
          setTranslation(nextArticle.translated_title ? {
            target_language: "zh",
            title: nextArticle.translated_title,
            abstract: nextArticle.translated_abstract || ""
          } : null);
          if (nextArticle.enrichment_error) setEnrichError(nextArticle.enrichment_error);
          onArticleUpdated?.(mergedArticle);
          return mergedArticle;
        };
        applyArticle(fullArticle);
        const missingFields = [
          !String(fullArticle.abstract || "").trim() ? "abstract" : "",
          !String(fullArticle.keywords || "").trim() ? "keywords" : ""
        ].filter(Boolean);
        if (!missingFields.length) return;
        try {
          applyArticle(await api.get(`/api/articles/${article.id}/enrich?fields=${encodeURIComponent(missingFields.join(","))}`));
        } catch (error) {
          if (error.article) applyArticle(error.article);
          setEnrichError(error.message);
        }
      })
      .catch((error) => {
        if (!ignore) {
          if (error.article) {
            const mergedArticle = { ...article, ...error.article };
            setDetail(mergedArticle);
            onArticleUpdated?.(mergedArticle);
          }
          setEnrichError(error.message);
        }
      })
      .finally(() => {
        if (!ignore) setEnriching(false);
      });

    return () => {
      ignore = true;
    };
  }, [article.id]);

  async function translate(targetLanguage) {
    setTranslating(targetLanguage);
    setTranslationError("");
    try {
      const nextTranslation = await api.post(`/api/articles/${detail.id}/translate`, { targetLanguage });
      setTranslation(nextTranslation);
      if (targetLanguage === "zh" && nextTranslation.title) {
        const translatedArticle = {
          ...detail,
          translated_title: nextTranslation.title,
          translated_abstract: nextTranslation.abstract || ""
        };
        setDetail(translatedArticle);
        onArticleUpdated?.(translatedArticle);
      }
    } catch (error) {
      setTranslationError(error.message);
    } finally {
      setTranslating("");
    }
  }

  return (
    <Modal open onClose={close} labelledBy="article-dialog-title" className="article-dialog">
        <header className="dialog-header">
          <div>
            <div className="article-meta">
              <span>{detail.journal || "未知期刊"}</span>
              <span>{formatDate(detail.published_at)}</span>
              {detail.year && <span>{detail.year}</span>}
            </div>
            <h3 id="article-dialog-title">{detail.title}</h3>
          </div>
          <button className="icon-button" title="关闭" aria-label="关闭文献摘要" onClick={close}>
            <X size={20} />
          </button>
        </header>
        {detail.authors && <p className="dialog-authors">{detail.authors}</p>}
        <dl className="paper-fields">
          {detail.doi && (
            <>
              <dt>DOI</dt>
              <dd>{detail.doi}</dd>
            </>
          )}
          {(detail.volume || detail.issue) && (
            <>
              <dt>卷期</dt>
              <dd>{[detail.volume && `Vol. ${detail.volume}`, detail.issue && `No. ${detail.issue}`].filter(Boolean).join(" · ")}</dd>
            </>
          )}
        </dl>
        {detail.keywords && (
          <div className="keywords-panel">
            <h4>关键词 / Keywords</h4>
            <div className="keywords">
              {detail.keywords.split(/[;；]/).map((kw, i) => kw.trim()).filter(Boolean).map((kw, i) => (
                <span className="keyword-tag" key={i}>{kw}</span>
              ))}
            </div>
          </div>
        )}
        <div className="abstract-panel">
          <h4>摘要</h4>
          <p>{detail.abstract || (enriching ? "正在补全摘要..." : "公开数据源和页面爬取都暂未提供该文献摘要，可通过原文链接查看。")}</p>
          {enrichError && <p className="crawl-note">爬取补全未成功：{enrichError}</p>}
        </div>
        <div className="translation-tools">
          {!isChineseSourceText(detail.title) && <button className="secondary" onClick={() => translate("zh")} disabled={Boolean(translating)}>
            <Languages size={18} /> {translating === "zh" ? "翻译中" : "译为中文"}
          </button>}
        </div>
        {translationError && <p className="crawl-note">翻译未成功：{translationError}</p>}
        {translation && (
          <div className="translation-panel">
            <h4>{translation.target_language === "zh" ? "中文翻译" : "English Translation"}</h4>
            {translation.title && <strong>{translation.title}</strong>}
            {!hideTranslatedAbstract && translation.abstract && <p>{translation.abstract}</p>}
          </div>
        )}
        {showActions && (
          <footer className="dialog-actions">
            <button className="secondary" onClick={() => markRead(detail.id)}>
              <Check size={18} /> 标记已读
            </button>
            <button className="secondary" onClick={() => toggleFavorite(detail.id)}>
              {detail.is_favorite ? <Star size={18} /> : <Heart size={18} />} 收藏
            </button>
            {detail.url && (
              <a className="primary" href={detail.url} target="_blank" rel="noreferrer">
                <ExternalLink size={18} /> 打开原文
              </a>
            )}
          </footer>
        )}
    </Modal>
  );
}

export default ArticleDialog;
