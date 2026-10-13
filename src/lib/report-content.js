/**
 * 报告内容解析器（自 ReportsView 抽出的公共模块，2026-10-13）。
 *
 * 速览页与「卡片阅读 · 按速览期选择」共用同一解析口径：content_md → 结构化
 * { intro, insights, reviews, clusters, keywords, textCards }。抽出的原因是
 * ReaderSetup（主包）需要 clusters 的专题划分——若从 ReportsView 静态引用会把
 * 懒加载的速览路由一并拉进主包（Vite 警告 + 首屏 +57KB）。
 */

export function parseReportContent(markdown) {
  const result = { intro: "", insights: [], reviews: [], clusters: [], keywords: "", textCards: [] };
  if (!markdown) return result;
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const sections = [];
  let current = null;
  for (const line of lines) {
    const h2 = line.match(/^##\s+(.+)$/);
    if (h2) {
      current = { title: h2[1].trim(), body: [] };
      sections.push(current);
    } else if (current) {
      current.body.push(line);
    }
  }
  const bodyOf = (section) => (section ? section.body.join("\n").trim() : "");
  const parseReviewLine = (line) => {
    const review = line.match(/^[-*]\s*\[(\d{4,6})\]\s*(.+)$/);
    return review ? { id: Number(review[1]), text: review[2].trim() } : null;
  };

  const beforeFirstH2 = [];
  let reachedH2 = false;
  for (const line of lines) {
    if (/^##\s/.test(line)) { reachedH2 = true; break; }
    if (!reachedH2 && !/^#\s/.test(line)) beforeFirstH2.push(line);
  }
  result.intro = beforeFirstH2.join("\n").trim();

  for (const section of sections) {
    const { title } = section;
    const body = bodyOf(section);
    if (!body) continue;
    if (title.includes("各方向动态") || title.includes("各方向趋势解读") || title.includes("方向动态")) {
      const subs = [];
      let sub = null;
      for (const line of section.body) {
        const h3 = line.match(/^###\s+(.+)$/);
        if (h3) {
          sub = { heading: h3[1].trim(), lines: [] };
          subs.push(sub);
        } else if (sub) {
          sub.lines.push(line);
        }
      }
      result.insights = subs
        .map(({ heading, lines: subLines }) => {
          const metaMatch = heading.match(/^([^（(]+)[（(]([^）)]*)[）)]$/);
          return {
            name: (metaMatch ? metaMatch[1] : heading).trim(),
            meta: metaMatch ? metaMatch[2].trim() : "",
            text: subLines.join("\n").trim()
          };
        })
        .filter((insight) => insight.text);
      if (!result.insights.length) result.textCards.push({ title, body });
    } else if (title.includes("主题聚类")) {
      let cluster = null;
      for (const line of section.body) {
        const h3 = line.match(/^###\s+(.+)$/);
        if (h3) {
          // 组名剥掉 AI 写作时附带的「（N 篇）」规模尾巴（需求：与组内实际
          // 速评条数不一致，造成"标题 15 篇、展开只有几个"的困惑）。速评
          // 契约只覆盖部分文献，组内条数就是速评条数，展示用词改为「条」。
          cluster = { name: h3[1].trim().replace(/[（(]\s*\d+\s*篇\s*[）)]\s*$/, "").trim(), reviews: [] };
          result.clusters.push(cluster);
          continue;
        }
        const review = parseReviewLine(line);
        if (review && cluster) cluster.reviews.push(review);
        else if (!cluster && line.trim()) result.intro = result.intro ? `${result.intro}\n${line.trim()}` : line.trim();
      }
    } else if (title.includes("论文速评")) {
      for (const line of section.body) {
        const review = parseReviewLine(line);
        if (review) result.reviews.push(review);
      }
    } else if (title.includes("值得注意") || title.includes("值得精读")) {
      // 已下线（2026-10-13 用户需求）：「本周/本期值得注意」「值得精读」不再产出、不再展示；
      // 历史报告中的同名节在此显式跳过（否则会落入兜底分支渲染成正文卡片）。
    } else if (title.includes("高频关键词") || title.includes("热点主题") || title.includes("新兴主题")) {
      result.keywords = result.keywords ? `${result.keywords}\n${body}` : body;
    } else if (title.includes("主题脉络") || title.includes("方法观察") || title.includes("方法趋势")) {
      result.textCards.push({ title, body });
    } else if (title.includes("方向分布")) {
      // 分布由 stats 渲染
    } else {
      result.textCards.push({ title, body });
    }
  }
  return result;
}
