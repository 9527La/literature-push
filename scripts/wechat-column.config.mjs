/**
 * 栏目配置 —— 公众号文献专题栏目的唯一真值。
 *
 * 改名只需动这一个文件，三处消费方自动跟随：
 *   · scripts/wechat-topic-render.mjs  头部卡与标题
 *   · scripts/make-wechat-cover.mjs    封面 kicker
 *   · scripts/publish-wechat-draft.mjs 草稿标题前缀
 *
 * 注意：issue JSON 里的 column 字段仅作留档，渲染与发布一律以本文件为准，
 * 避免历史期稿把旧栏目名带回来。
 */
export const COLUMN_NAME = "专题深读";
