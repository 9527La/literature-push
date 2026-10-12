import Highlight from "./Highlight.jsx";

/**
 * 关键词胶囊（S4）。
 *
 * 文献卡（可点击筛选）与摘要弹窗（静态展示）此前的 markup 各写一遍；
 * 这里统一：有 onClick 渲染 button，否则渲染 span。关键词文本作 key 的
 * 一部分（R1），不用纯数组下标。
 */
export default function KeywordTag({
  keyword,
  onClick = null,
  title = "",
  highlightTerms = [],
  extraClassName = ""
}) {
  const content = <Highlight text={keyword} terms={highlightTerms} />;
  if (onClick) {
    const active = highlightTerms.some((term) => keyword.toLowerCase().includes(String(term).toLowerCase()));
    return (
      <button
        type="button"
        className={`keyword-tag ${active ? "keyword-tag-highlight" : ""} ${extraClassName}`.trim()}
        title={title || `按关键词「${keyword}」筛选`}
        onClick={() => onClick(keyword)}
      >
        {content}
      </button>
    );
  }
  return (
    <span className={`keyword-tag ${extraClassName}`.trim()} title={title || undefined}>
      {content}
    </span>
  );
}
