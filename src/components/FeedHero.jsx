import { useMemo } from "react";
import TopicIcon from "./TopicIcon.jsx";
import { keywordGraph, topicHistogram } from "../lib/topics.js";

/**
 * Masthead for the literature list.
 *
 * Everything here is computed from the result set already on screen (topic mix
 * and keyword co-occurrence), so the graphic is a readout rather than decoration:
 * if the numbers change, the picture changes. No images are involved, which keeps
 * it cheap and identical on every machine.
 */
function FeedHero({ articles = [] }) {
  // The headline counts every recognisable topic; only the chip list is capped,
  // otherwise "N 个方向" would silently report the cap instead of the truth.
  const allTopics = useMemo(() => topicHistogram(articles), [articles]);
  const topics = useMemo(() => allTopics.slice(0, 4), [allTopics]);
  const graph = useMemo(() => keywordGraph(articles, 7), [articles]);
  const journalCount = useMemo(
    () => new Set(articles.map((article) => article.journal).filter(Boolean)).size,
    [articles]
  );
  const classifiedCount = allTopics.reduce((sum, topic) => sum + topic.count, 0);

  const geometry = useMemo(() => {
    const center = { x: 110, y: 70 };
    const radius = 46;
    const nodes = graph.nodes.map((node, index) => {
      const angle = (-90 + (index * 360) / graph.nodes.length) * (Math.PI / 180);
      return {
        ...node,
        cx: center.x + radius * Math.cos(angle),
        cy: center.y + radius * Math.sin(angle),
        r: 3 + Math.min(node.count, 8) * 0.55
      };
    });
    const edges = graph.edges
      .filter((edge) => nodes[edge.a] && nodes[edge.b])
      .map((edge) => ({
        x1: nodes[edge.a].cx,
        y1: nodes[edge.a].cy,
        x2: nodes[edge.b].cx,
        y2: nodes[edge.b].cy,
        opacity: Math.min(0.85, 0.3 + edge.weight * 0.2)
      }));
    return { nodes, edges };
  }, [graph]);

  if (!topics.length) return null;

  return (
    <section className="feed-hero" aria-label="研究前沿概览">
      <div className="feed-hero-copy">
        <span className="feed-hero-kicker">研究前沿</span>
        <h2>
          当前结果集中在 <strong>{allTopics[0].label}</strong> 等 {allTopics.length} 个方向
        </h2>
        <p>
          已按关键词归类 {classifiedCount} 篇
          {journalCount > 0 ? `，覆盖 ${journalCount} 本期刊` : ""}。主题分布与共现关系按当前筛选结果实时计算。
        </p>
        <ul className="feed-hero-topics">
          {topics.map((topic) => (
            <li key={topic.key}>
              <TopicIcon topic={topic.key} size={15} />
              <span>{topic.label}</span>
              <strong>{topic.count}</strong>
            </li>
          ))}
          {allTopics.length > topics.length && (
            <li className="feed-hero-topics-more">另有 {allTopics.length - topics.length} 个方向</li>
          )}
        </ul>
      </div>
      {geometry.nodes.length > 1 && (
        <svg
          className="feed-hero-graph"
          viewBox="0 0 220 140"
          role="img"
          aria-label={`关键词共现关系，出现最多的关键词：${graph.nodes.map((node) => node.label).join("、")}`}
        >
          <title>关键词共现关系</title>
          <circle cx="110" cy="70" r="46" fill="none" stroke="#dde4ee" strokeWidth="1" strokeDasharray="4 5" />
          {geometry.edges.map((edge, index) => (
            <line key={`edge-${index}`} x1={edge.x1} y1={edge.y1} x2={edge.x2} y2={edge.y2} stroke="#b5d4f4" strokeWidth="1" opacity={edge.opacity} />
          ))}
          {geometry.nodes.map((node) => (
            <circle key={node.label} cx={node.cx} cy={node.cy} r={node.r} fill="#378add" opacity="0.85" />
          ))}
        </svg>
      )}
    </section>
  );
}

export default FeedHero;
