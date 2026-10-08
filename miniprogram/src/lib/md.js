/**
 * 极简 Markdown → rich-text nodes 渲染器（研究速览正文 / 每日资讯正文）。
 *
 * 网站用 react-markdown 全量渲染；小程序侧用 rich-text + 本解析器覆盖
 * 服务端生成内容的实际结构：标题 / 段落 / 列表 / 引用 / 分隔线 / 行内
 * 加粗·斜体·行内码·链接。表格与图片在生成模板中不出现，遇到时按
 * 纯文本段落降级，不做完整 GFM。
 *
 * 输出 nodes 结构（rich-text nodes 格式）：
 *   { name, attrs: {class}, children: [node|{type:'text',text}] }
 */

function inlineToChildren(text) {
  const children = [];
  // 顺序：行内码 > 链接 > 加粗/斜体。正则一次扫描，避免嵌套错切。
  const pattern = /(`[^`]+`)|(\[[^\]]+\]\([^)\s]+\))|(\*\*[^*]+\*\*)|(\*[^*\n]+\*)/g;
  let last = 0;
  let match;
  const pushText = (value) => {
    if (value) children.push({ type: "text", text: value });
  };
  while ((match = pattern.exec(text)) !== null) {
    pushText(text.slice(last, match.index));
    const token = match[0];
    if (match[1]) {
      children.push({ name: "code", attrs: { class: "md-code" }, children: [{ type: "text", text: token.slice(1, -1) }] });
    } else if (match[2]) {
      const label = token.slice(1, token.indexOf("]"));
      // rich-text 内 a 标签不可跳转外部浏览器，渲染为可辨识的强调文本。
      children.push({ name: "span", attrs: { class: "md-link" }, children: [{ type: "text", text: label }] });
    } else if (match[3]) {
      children.push({ name: "strong", attrs: { class: "md-strong" }, children: [{ type: "text", text: token.slice(2, -2) }] });
    } else {
      children.push({ name: "em", attrs: { class: "md-em" }, children: [{ type: "text", text: token.slice(1, -1) }] });
    }
    last = match.index + token.length;
  }
  pushText(text.slice(last));
  return children.length ? children : [{ type: "text", text }];
}

function block(tag, className, lines) {
  return { name: tag, attrs: { class: className }, children: inlineToChildren(lines.join("\n")) };
}

export function markdownToNodes(markdown) {
  const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
  const nodes = [];
  let paragraph = [];
  let listItems = null;

  const flushParagraph = () => {
    if (paragraph.length) {
      nodes.push(block("p", "md-p", paragraph));
      paragraph = [];
    }
  };
  const flushList = () => {
    if (listItems) {
      nodes.push({ name: "ul", attrs: { class: "md-ul" }, children: listItems.map((item) => block("li", "md-li", [item])) });
      listItems = null;
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/, "");
    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const level = Math.min(heading[1].length + 1, 4);
      nodes.push(block(`h${level}`, `md-h${level}`, [heading[2]]));
      continue;
    }
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      flushParagraph();
      flushList();
      nodes.push({ name: "hr", attrs: { class: "md-hr" } });
      continue;
    }
    const quote = line.match(/^>\s?(.*)$/);
    if (quote) {
      flushParagraph();
      flushList();
      nodes.push(block("blockquote", "md-quote", [quote[1]]));
      continue;
    }
    const listItem = line.match(/^\s*[-*]\s+(.*)$/);
    if (listItem) {
      flushParagraph();
      if (!listItems) listItems = [];
      listItems.push(listItem[1]);
      continue;
    }
    const orderedItem = line.match(/^\s*\d+[.、]\s+(.*)$/);
    if (orderedItem) {
      flushParagraph();
      if (!listItems) listItems = [];
      listItems.push(orderedItem[1]);
      continue;
    }
    flushList();
    paragraph.push(line.trim());
  }
  flushParagraph();
  flushList();
  return nodes;
}
