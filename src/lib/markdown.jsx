export function renderInlineMarkdown(text) {
  const parts = [];
  const re = /(\*\*.*?\*\*)|(\*.*?\*)|(`[^`]+`)|(\[([^\]]+)\]\(([^)]+)\))/g;
  let lastIdx = 0, m, key = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > lastIdx) parts.push(text.slice(lastIdx, m.index));
    if (m[1]) parts.push(<strong key={key++}>{m[1].slice(2, -2)}</strong>);
    else if (m[2]) parts.push(<em key={key++}>{m[2].slice(1, -1)}</em>);
    else if (m[3]) parts.push(<code key={key++}>{m[3].slice(1, -1)}</code>);
    else if (m[4]) parts.push(<a key={key++} href={m[6]} target="_blank" rel="noopener noreferrer">{m[5]}</a>);
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < text.length) parts.push(text.slice(lastIdx));
  return parts.length ? parts : text;
}

function isFenceLine(trimmed) {
  return trimmed.startsWith("```");
}

function isHorizontalRule(trimmed) {
  return /^\s*(\*\s*\*\s*\*|-{3,}|_{3,})\s*$/.test(trimmed);
}

function Fence({ raw }) {
  // 每日资讯的围栏块内是来源 URL：整块是合法 URL 时渲染为可点击链接。
  const content = raw.join("\n").trim();
  const url = /^https?:\/\/\S+$/.test(content) ? content : null;
  if (url) {
    return (
      <pre className="md-fence md-fence-link">
        <a href={url} target="_blank" rel="noopener noreferrer">{content}</a>
      </pre>
    );
  }
  return <pre className="md-fence">{content}</pre>;
}

export function renderMarkdown(md) {
  if (!md) return null;
  const lines = md.split("\n");
  const blocks = [];
  let listItems = [], bKey = 0;
  let fenceLines = null; // null = 不在围栏内；数组 = 围栏内已收集的行
  function flushList() {
    if (listItems.length) {
      blocks.push(<ul key={bKey++}>{listItems.map((item, i) => <li key={i}>{renderInlineMarkdown(item)}</li>)}</ul>);
      listItems = [];
    }
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (fenceLines !== null) {
      if (isFenceLine(trimmed)) {
        blocks.push(<Fence key={bKey++} raw={fenceLines} />);
        fenceLines = null;
      } else {
        fenceLines.push(line);
      }
      continue;
    }
    if (isFenceLine(trimmed)) {
      flushList();
      fenceLines = [];
      continue;
    }
    if (isHorizontalRule(trimmed)) {
      flushList();
      blocks.push(<hr key={bKey++} className="md-sep" />);
      continue;
    }
    if (trimmed.startsWith("### ")) {
      flushList();
      blocks.push(<h5 key={bKey++}>{renderInlineMarkdown(trimmed.slice(4))}</h5>);
    } else if (trimmed.startsWith("## ")) {
      flushList();
      blocks.push(<h4 key={bKey++}>{renderInlineMarkdown(trimmed.slice(3))}</h4>);
    } else if (trimmed.startsWith("# ")) {
      flushList();
      blocks.push(<h3 key={bKey++}>{renderInlineMarkdown(trimmed.slice(2))}</h3>);
    } else if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
      listItems.push(trimmed.slice(2));
    } else if (trimmed === "") {
      flushList();
    } else {
      flushList();
      blocks.push(<p key={bKey++}>{renderInlineMarkdown(trimmed)}</p>);
    }
  }
  if (fenceLines !== null) {
    // 未闭合的围栏按原文兜底输出，避免吞掉后续内容。
    blocks.push(<Fence key={bKey++} raw={fenceLines} />);
  }
  flushList();
  return blocks;
}
