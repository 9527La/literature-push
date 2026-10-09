import { useEffect, useState } from "react";
import { Check, Copy, Globe, Heart, Languages, Quote, Star, X } from "lucide-react";
import { api } from "../../lib/api.js";
import { copyText } from "../../lib/clipboard.js";
import { articleDate, formatDate, formatCitationGB7714, formatRelativeDate } from "../../lib/format.js";
import { journalAbbr, journalGroup } from "../../lib/journal.js";
import { DIRECTIONS, directionLabel, directionVar } from "../../lib/directions.js";
import Modal from "../../components/Modal.jsx";

function ArticleDialog({ article, close, markRead, toggleFavorite, onArticleUpdated, onOpenArticle, showActions = true, hideTranslatedAbstract = false, canModerate = false }) {
  const [detail, setDetail] = useState(article);
  const [loadingDetail, setLoadingDetail] = useState(true);
  const [copiedField, setCopiedField] = useState("");
  const [actionError, setActionError] = useState("");
  const [directionDraft, setDirectionDraft] = useState(article.research_direction || "");
  const [savingDirection, setSavingDirection] = useState(false);
  const [directionError, setDirectionError] = useState("");
  const [related, setRelated] = useState([]);

  // 相关文献推荐（A3-3）：与详情并行请求，失败静默整块隐藏，绝不阻塞主内容。
  useEffect(() => {
    let ignore = false;
    setRelated([]);
    api.get(`/api/articles/${article.id}/related`)
      .then((data) => {
        if (!ignore) setRelated(Array.isArray(data?.articles) ? data.articles : []);
      })
      .catch(() => {
        if (!ignore) setRelated([]);
      });
    return () => {
      ignore = true;
    };
  }, [article.id]);

  useEffect(() => {
    let ignore = false;
    setDetail(article);
    setCopiedField("");
    setDirectionDraft(article.research_direction || "");
    setDirectionError("");
    setLoadingDetail(true);
    // 只从数据库取详情（需求 12）：不再发起 enrich 实时补全，缺什么就是什么。
    api.get(`/api/articles/${article.id}`)
      .then((fullArticle) => {
        if (ignore) return;
        const mergedArticle = { ...article, ...fullArticle };
        setDetail(mergedArticle);
        onArticleUpdated?.(mergedArticle);
      })
      .catch(() => { /* 详情失败时保留卡片数据展示，不打断弹窗 */ })
      .finally(() => {
        if (!ignore) setLoadingDetail(false);
      });

    return () => {
      ignore = true;
    };
  }, [article.id]);

  async function copyField(field, value) {
    const ok = await copyText(value);
    setCopiedField(ok ? field : "");
    if (ok) setTimeout(() => setCopiedField((current) => (current === field ? "" : current)), 2000);
  }

  // 弹窗内已读/收藏（需求 3）：速览/统计等页面的文献不在主列表里，直接调
  // 交互接口（toggle 语义）并本地翻转，保证任何入口的弹窗都即时生效；
  // onArticleUpdated 同步到各列表。收藏使用默认分组。
  async function handleMarkRead() {
    setActionError("");
    try {
      const result = await api.post(`/api/articles/${detail.id}/read`);
      const next = { ...detail, is_read: result.isRead ? 1 : 0 };
      setDetail(next);
      onArticleUpdated?.(next);
    } catch (error) {
      setActionError(error.message);
    }
  }

  async function handleToggleFavorite() {
    setActionError("");
    try {
      const result = await api.post(`/api/articles/${detail.id}/favorite`);
      const next = { ...detail, is_favorite: result.is_favorite ? 1 : 0 };
      setDetail(next);
      onArticleUpdated?.(next);
    } catch (error) {
      setActionError(error.message);
    }
  }

  /** 管理员改判：置 manual 后 apply 脚本永不覆盖（与 RUNBOOK 约定一致）。 */
  async function saveDirection() {
    if (!directionDraft || savingDirection) return;
    setSavingDirection(true);
    setDirectionError("");
    try {
      const data = await api.post(`/api/admin/articles/${detail.id}/direction`, { direction: directionDraft });
      const updated = {
        ...detail,
        research_direction: data.article.research_direction,
        research_direction_secondary: data.article.research_direction_secondary,
        direction_source: data.article.direction_source,
        direction_confidence: null,
        direction_reason: null
      };
      setDetail(updated);
      onArticleUpdated?.(updated);
    } catch (error) {
      setDirectionError(error.message);
    } finally {
      setSavingDirection(false);
    }
  }

  const dateValue = articleDate(detail);
  const absoluteDate = formatDate(dateValue);
  // 三段时间各自含义（首次公开为主日期）：
  //   · 首次公开 first_public_at —— 论文第一次正式公开的日期（卡片上的日期同源）；
  //   · 正式出版 published_at —— 只在「已经发生」且与首次公开不同日时展示，
  //     未来的卷期日仍留在数据库里但不对用户展示；
  //   · 系统收录 first_seen_at —— 本系统首次抓到的时间，用于审计。
  const todayStr = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
  const publishedDate = String(detail.published_at || "").slice(0, 10);
  const officialDate = publishedDate && publishedDate <= todayStr && publishedDate !== String(dateValue || "").slice(0, 10)
    ? formatDate(publishedDate)
    : "";
  const seenDate = detail.first_seen_at ? formatDate(String(detail.first_seen_at)) : "";
  const tone = journalGroup(detail.journal);
  const translatedAbstract = hideTranslatedAbstract ? "" : String(detail.translated_abstract || "").trim();
  const translatedTitle = String(detail.translated_title || "").trim();
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
              <time dateTime={absoluteDate} title={absoluteDate}>{formatRelativeDate(dateValue)}</time>
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
            {/* 引用一键复制（B2-1）：科研用户的高频动作，图标按钮与关闭键同级。 */}
            <button
              className="icon-button"
              title={copiedField === "citation" ? "引用已复制" : "复制引用（GB/T 7714）"}
              aria-label="复制引用（GB/T 7714）"
              onClick={() => copyField("citation", formatCitationGB7714(detail))}
            >
              {copiedField === "citation" ? <Check size={18} /> : <Quote size={18} />}
            </button>
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

        {/* AI 研究方向区块：主方向 + 次方向 + 置信/依据；管理员可在此改判为 manual。 */}
        {(detail.research_direction || canModerate) && (
          <div className="dialog-direction">
            <span className="fact-label">研究方向</span>
            <div className="direction-block">
              {detail.research_direction ? (
                <>
                  <div className="direction-block-chips">
                    <span className="direction-chip" style={{ "--dir-key": directionVar(detail.research_direction) }}>
                      <i className="direction-dot" aria-hidden="true" />
                      {directionLabel(detail.research_direction)}
                    </span>
                    {String(detail.research_direction_secondary || "").split(",").filter(Boolean).map((key) => (
                      <span key={key} className="direction-chip direction-chip-soft" style={{ "--dir-key": directionVar(key) }}>
                        {directionLabel(key)}
                      </span>
                    ))}
                    {String(detail.direction_reason || "").startsWith("[待复核]") && (
                      <span className="direction-review-badge">待复核</span>
                    )}
                  </div>
                  {detail.direction_source !== "manual" && detail.direction_confidence != null && (
                    <p className="direction-meta">
                      置信 {Number(detail.direction_confidence).toFixed(2)}
                      {detail.direction_reason ? ` · ${String(detail.direction_reason).replace(/^\[待复核\]/, "")}` : ""}
                    </p>
                  )}
                </>
              ) : (
                <span className="direction-uncategorized">未分类</span>
              )}
              {canModerate && (
                <div className="direction-moderate">
                  <select
                    value={directionDraft}
                    aria-label="管理员改判研究方向"
                    onChange={(event) => setDirectionDraft(event.target.value)}
                  >
                    <option value="">（未分类）</option>
                    {DIRECTIONS.map((direction) => (
                      <option key={direction.key} value={direction.key}>
                        {directionLabel(direction.key)}
                        {direction.key === detail.research_direction && detail.direction_source === "ai"
                          ? `（AI · ${Number(detail.direction_confidence ?? 0).toFixed(2)}）`
                          : ""}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="secondary direction-save"
                    onClick={saveDirection}
                    disabled={savingDirection || directionDraft === (detail.research_direction || "")}
                  >
                    {savingDirection ? "保存中" : "保存为人工确认"}
                  </button>
                  {directionError && <span className="direction-error">{directionError}</span>}
                </div>
              )}
            </div>
          </div>
        )}

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

        {(dateValue || officialDate || seenDate) && (
          <div className="dialog-facts">
            <span className="fact">
              <span className="fact-label">首次公开</span>
              <span className="fact-value">{dateValue ? absoluteDate : "未知"}</span>
            </span>
            {officialDate && (
              <span className="fact">
                <span className="fact-label">正式出版</span>
                <span className="fact-value">{officialDate}</span>
              </span>
            )}
            {seenDate && (
              <span className="fact">
                <span className="fact-label">系统收录</span>
                <span className="fact-value">{seenDate}</span>
              </span>
            )}
          </div>
        )}

        <div className={`abstract-region ${hasBothAbstracts ? "is-dual" : "is-single"}`}>
          <section className="abstract-panel">
            <h4>摘要 · Abstract</h4>
            {detail.abstract ? (
              <p>{detail.abstract}</p>
            ) : loadingDetail ? (
              <div className="abstract-skeleton" role="status" aria-live="polite" aria-label="正在加载摘要">
                <span className="skeleton" />
                <span className="skeleton" />
                <span className="skeleton" />
              </div>
            ) : (
              <p>数据库暂未收录该文献摘要，可通过原文链接查看。</p>
            )}
          </section>
          {hasBothAbstracts && (
            <section className="abstract-panel abstract-panel-zh">
              <h4>中文摘要</h4>
              <p>{translatedAbstract}</p>
            </section>
          )}
        </div>

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

        {/* 相关文献（A3-3）：同方向 + 关键词共现取 3 篇；列表为空/请求失败时整块
            不渲染。有 onOpenArticle（文献库）时点击可直接在弹窗内切换文献。 */}
        {related.length > 0 && (
          <section className="related-articles" aria-label="相关文献">
            <h4>相关文献</h4>
            <ul className="related-list">
              {related.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className={`related-item${onOpenArticle ? "" : " is-static"}`}
                    onClick={onOpenArticle ? () => onOpenArticle(item) : undefined}
                    title={onOpenArticle ? "查看这篇文献" : undefined}
                  >
                    <span className="related-item-meta">
                      {item.research_direction && (
                        <span className="direction-chip direction-chip-soft" style={{ "--dir-key": directionVar(item.research_direction) }}>
                          {directionLabel(item.research_direction)}
                        </span>
                      )}
                      <span className="related-item-journal">{item.journal || "未知期刊"}</span>
                      <time dateTime={formatDate(item.display_date)}>{formatDate(item.display_date)}</time>
                    </span>
                    <span className="related-item-title">{item.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {actionError && <p className="crawl-note" role="alert">{actionError}</p>}
        {showActions && (
          <footer className="dialog-actions">
            <button className="secondary" onClick={() => handleMarkRead()}>
              <Check size={18} /> {detail.is_read ? "取消已读" : "标记已读"}
            </button>
            <button className="secondary" onClick={() => handleToggleFavorite()}>
              {detail.is_favorite ? <Star size={18} fill="currentColor" /> : <Heart size={18} />} {detail.is_favorite ? "取消收藏" : "收藏"}
            </button>
            {/* 「打开原文」只保留顶部一处（需求 2）：底部与顶部重复，已合并。 */}
          </footer>
        )}
    </Modal>
  );
}

export default ArticleDialog;
