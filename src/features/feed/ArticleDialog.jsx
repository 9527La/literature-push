import { useEffect, useState } from "react";
import { Check, Copy, Globe, Heart, Languages, Star, X } from "lucide-react";
import { api } from "../../lib/api.js";
import { copyText } from "../../lib/clipboard.js";
import { formatDate, formatRelativeDate, isChineseSourceText } from "../../lib/format.js";
import { journalAbbr, journalGroup } from "../../lib/journal.js";
import Modal from "../../components/Modal.jsx";

function ArticleDialog({ article, close, markRead, toggleFavorite, onArticleUpdated, showActions = true, hideTranslatedAbstract = false }) {
  const [detail, setDetail] = useState(article);
  const [enriching, setEnriching] = useState(true);
  const [enrichError, setEnrichError] = useState("");
  const [copiedField, setCopiedField] = useState("");
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
    setCopiedField("");
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

  async function copyField(field, value) {
    const ok = await copyText(value);
    setCopiedField(ok ? field : "");
    if (ok) setTimeout(() => setCopiedField((current) => (current === field ? "" : current)), 2000);
  }

  const absoluteDate = formatDate(detail.published_at);
  const tone = journalGroup(detail.journal);
  const translatedAbstract = hideTranslatedAbstract ? "" : String(translation?.abstract || "").trim();
  const translatedTitle = String(translation?.title || "").trim();
  // Two abstracts side by side, one abstract across the full width: the dialog
  // never reserves an empty column for a translation that does not exist.
  const hasBothAbstracts = Boolean(String(detail.abstract || "").trim() && translatedAbstract);

  return (
    <Modal open onClose={close} labelledBy="article-dialog-title" className={`article-dialog tone-${tone}`}>
        <header className="dialog-header">
          <div>
            {/* Publication date first, then journal identity: same reading order
                as the list card, so the dialog feels like the card opened up. */}
            <div className="article-meta">
              <time dateTime={absoluteDate} title={absoluteDate}>{formatRelativeDate(detail.published_at)}</time>
              <span className="meta-divider" aria-hidden="true" />
              <span className={`journal-mark tone-${tone}`} aria-hidden="true">{journalAbbr(detail.journal)}</span>
              <span className="article-journal">{detail.journal || "未知期刊"}</span>
            </div>
            <h3 id="article-dialog-title">{detail.title}</h3>
            {translatedTitle && translatedTitle !== detail.title && (
              <p className="translated-title"><Languages size={14} /> {translatedTitle}</p>
            )}
          </div>
          <div className="dialog-header-actions">
            {/* The single most common action stays in the first screenful
                instead of sitting at the end of a long abstract. */}
            {detail.url && (
              <a className="secondary dialog-open-source" href={detail.url} target="_blank" rel="noreferrer">
                <Globe size={16} /> 打开原文
              </a>
            )}
            <button className="icon-button" title="关闭" aria-label="关闭文献摘要" onClick={close}>
              <X size={20} />
            </button>
          </div>
        </header>
        {detail.authors && <p className="dialog-authors">{detail.authors}</p>}

        {(detail.doi || detail.volume || detail.issue) && (
          <div className="dialog-facts">
            {detail.doi && (
              <span className="fact">
                <span className="fact-label">DOI</span>
                <span className="fact-value">{detail.doi}</span>
                <button
                  type="button"
                  className="copy-button"
                  aria-label={copiedField === "doi" ? "DOI 已复制" : "复制 DOI"}
                  title={copiedField === "doi" ? "已复制" : "复制 DOI"}
                  onClick={() => copyField("doi", detail.doi)}
                >
                  {copiedField === "doi" ? <Check size={13} /> : <Copy size={13} />}
                </button>
              </span>
            )}
            {(detail.volume || detail.issue) && (
              <span className="fact">
                <span className="fact-label">卷期</span>
                <span className="fact-value">{[detail.volume && `Vol. ${detail.volume}`, detail.issue && `No. ${detail.issue}`].filter(Boolean).join(" · ")}</span>
              </span>
            )}
          </div>
        )}

        <div className={`abstract-region ${hasBothAbstracts ? "is-dual" : "is-single"}`}>
          <section className="abstract-panel">
            <h4>摘要 · Abstract</h4>
            {detail.abstract ? (
              <p>{detail.abstract}</p>
            ) : enriching ? (
              <div className="abstract-skeleton" role="status" aria-live="polite" aria-label="正在补全摘要">
                <span className="skeleton" />
                <span className="skeleton" />
                <span className="skeleton" />
              </div>
            ) : (
              <p>公开数据源和页面爬取都暂未提供该文献摘要，可通过原文链接查看。</p>
            )}
            {enrichError && <p className="crawl-note">爬取补全未成功：{enrichError}</p>}
          </section>
          {hasBothAbstracts && (
            <section className="abstract-panel abstract-panel-zh">
              <h4>中文摘要</h4>
              <p>{translatedAbstract}</p>
            </section>
          )}
        </div>

        <div className="translation-tools">
          {!isChineseSourceText(detail.title) && (
            <button className="secondary" onClick={() => translate("zh")} disabled={Boolean(translating)}>
              <Languages size={18} /> {translating === "zh" ? "翻译中" : (translatedAbstract ? "重新译为中文" : "译为中文")}
            </button>
          )}
        </div>
        {translationError && <p className="crawl-note">翻译未成功：{translationError}</p>}

        {detail.keywords && (
          <div className="keywords-band">
            <span className="keywords-band-label">关键词 / Keywords</span>
            <div className="keywords">
              {detail.keywords.split(/[;；]/).map((keyword) => keyword.trim()).filter(Boolean).map((keyword, index) => (
                <span className="keyword-tag" key={index}>{keyword}</span>
              ))}
            </div>
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
                <Globe size={18} /> 打开原文
              </a>
            )}
          </footer>
        )}
    </Modal>
  );
}

export default ArticleDialog;
