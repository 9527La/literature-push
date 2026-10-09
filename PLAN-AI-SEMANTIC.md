# PLAN-AI-SEMANTIC：语义检索 · 相关推荐升级 · 关键词底座（P0，零 API 路线）

> 状态：**待审批**。审批前不改动任何代码。
> 版本：2026-10-09 **v2**（按用户决策改为零 API 路线：全部语义产物由 WorkBuddy 定时任务 + Hy3 会话产出，复用 classify 的 export→会话→apply 模式；v1 混元 embedding API 方案降级为远期备选，见 §8）
> 前置文档：《AI 能力增强建议书》（2026-10-09 会话产出，10 项清单中的 P0-1/2/3）
> 关联约定：新列 CREATE+ALTER 双路径；LIKE 必带 `ESCAPE '\'`；other 豁免口径不变；`displayDateSql` 零改动；作者原词 keywords 永不改写；RUNBOOK-AI-JOBS 与 `.workbuddy/skills/literature-ai-jobs/SKILL.md` 镜像同步维护。

---

## 1. 为什么不用 Hy3 直接做向量（技术结论）

- 语义检索的常规做法是 embedding 稠密向量 + 余弦相似度。**向量只能由专门的向量模型产出**；会话 LLM（Hy3）无法输出有向量空间意义的数值——让它"写向量"得到的数字做相似度计算是随机的。
- 但 Hy3 擅长产出**结构化语义产物**（分类、关键词、概念标签），这正是现有 classify 作业已验证的链路（export → 会话生成 → apply 写回，零 API、零费用、有白名单校验）。
- 因此本方案把「语义能力」拆成 Hy3 能交付的三件产物：**受控语义词表、逐篇双语概念词标注、同义词归一表**，用增强的文本匹配实现语义检索与推荐。远期如需真向量（长句模糊查询），见 §8 备选。

## 2. 现状与痛点（不变）

| # | 环节 | 现状（代码位置） | 痛点 |
|---|---|---|---|
| P0-1 | 文献检索 | `db.js#buildArticleListQuery` filters.q → LIKE 匹配 title/abstract/authors/keywords | 字面匹配：同义词、中英文、表述变体全部漏检 |
| P0-2 | 相关文献推荐 | `db.js#listRelatedArticles` 作者关键词共现打分 + 日期兜底 | 仅 37% 文献有作者关键词，63% 走兜底池，相关性不稳定 |
| P0-3 | 关键词底座 | `articles.keywords` 分号分隔自由文本；`getKeywordStats`/`getKeywordCooccurrence` 统计原词 | 覆盖率 37% 统计有偏；同义词（EV/electric vehicle/电动汽车）未归一 |

**总目标**：用零 API 路线把三个环节的语义覆盖率从 37% 提到 ~100%——检索可跨语言跨同义词命中、相关推荐全部位有真实信号、关键词统计不再偏斜。

**非目标（本期不做）**：主题聚类趋势、单篇精读卡、结构化综述、个性化推荐、RAG 问答（P1 及以后）。

## 3. 总体架构

```
M1 词表基建（一次性 + 月度维护）        M2 逐篇标注（首批 ~2600 篇 + 每日增量）
┌──────────────────────────┐        ┌────────────────────────────────┐
│ semantic_terms 受控词表    │        │ export-keyword-batch.mjs        │
│ (中英对照+同义词+状态)     │───────▶│  → Hy3 会话逐批标注（词表优先）   │
│ 会话产出初版→人工审校       │ 词表   │  → apply-keywords.mjs 写回       │
└──────────┬───────────────┘        │     articles.ai_keywords        │
           │                        └───────────────┬────────────────┘
           │ 归一/扩展                               │ 覆盖率 ~100%
           ▼                                         ▼
┌──────────────────────────┐        ┌────────────────────────────────┐
│ WP-S 检索增强              │        │ WP-R 相关推荐 / WP-K 关键词统计   │
│ q 过词表扩展同义形式        │        │ IDF 加权共现（ai_keywords∪原词）│
│ LIKE 目标列 += ai_keywords │        │ 统计并集去重+归一               │
└──────────────────────────┘        └────────────────────────────────┘
```

**核心设计：双语概念词**。`ai_keywords` 每条标注为中英对照（如 `有序充电;coordinated charging`），检索 LIKE 天然跨语言——用户搜中文可命中仅有英文表述的文献，反之亦然。这是零 API 路线替代向量跨语言能力的关键。

## 4. 决策点（动手前需逐项拍板）

### D1 路线确认

- **A（推荐，本方案）**：零 API 结构化语义路线（本文件）。
- B：本地 ONNX 向量（同样零 API，语义更细腻，但远端原生模块+模型文件部署重，见 §8）。
- C：混元 embedding API（v1 原方案，最省事但引入外部 API 与计费）。

### D2 词表受控强度

- **A（推荐）**：半受控——标注优先从 `semantic_terms` 选词；词表没有的新概念允许自由生成，自动进 `pending` 队列，月度会话复审后转正或归并。兼顾一致性与领域演进。
- B：严格受控——只允许词表内词，新词一律挂起到下月复审。一致性最强但新主题标注滞后。

### D3 检索同义扩展方式

- **A（推荐）**：查询整体 + 词表匹配到的同义形式全部展开为 OR 组（如输「电动汽车」自动带上 `electric vehicle;EV`），结果按命中形式数 + 日期排序。
- B：不扩展，仅靠 ai_keywords 双语命中。实现最简，但对摘要正文的同义命中无提升。

### D4 相关推荐打分

- **A（推荐）**：候选池不变（同方向、日期倒序 240 篇）；打分 = 源文献与候选的 `keywords ∪ ai_keywords` **IDF 加权共现**（`score = Σ 1/log(1+df)`，df=该词全库出现篇数），抑制「power system」类泛词、放大专业词；源文献无任何词时回退现日期兜底。
- B：简单共现计数（现逻辑换数据源）。实现最简但泛词噪声大。

### D5 词表初版规模

- **A（推荐）**：会话基于全库标题+关键词分布产出初版 300-500 个概念（中英对照+同义词组），人工审校一轮后启用。
- B：从小词表（~100）起步逐月扩。起步快但首批标注反复改写。

## 5. 工作包与修改点清单

### WP1 词表与标注基建（其余一切的前提）

| # | 修改点 | 文件 | 内容 | 预期效果 |
|---|---|---|---|---|
| 1.1 | 新表 | `server/db.js` | `semantic_terms(id PK, zh, en, aliases TEXT /*JSON 数组*/, status /*active\|pending*/, created_at)`；`articles.ai_keywords TEXT`——**CREATE TABLE 与 ALTER 迁移双路径** | 词表与标注产物落库 |
| 1.2 | 导出脚本 | `scripts/export-keyword-batch.mjs`（新） | 导出 `ai_keywords IS NULL` 且非研究类过滤的篇目（id/title/journal/abstract/keywords 原文），批次头格式仿 `export-direction-batch.mjs`；`--limit` | 会话标注素材 |
| 1.3 | 写回脚本 | `scripts/apply-keywords.mjs`（新） | 白名单校验：每篇 4-8 个概念、分号分隔、去重、禁含方向词/期刊名/空词；非词表词自动登记 `semantic_terms(pending)`；逐条 UPDATE ai_keywords（**不动 keywords**）；输出 updated/invalid/pendingTerms，invalid>0 拒收 | 与 apply-directions 同安全等级 |
| 1.4 | 词表工具 | `scripts/apply-semantic-terms.mjs`（新） | 词表初版/复审结果写回：新增、归并（alias→canonical）、pending→active；归并时同步改写存量 ai_keywords | 词表全生命周期可维护 |
| 1.5 | RUNBOOK 新 job | `RUNBOOK-AI-JOBS.md` + `.workbuddy/skills/literature-ai-jobs/SKILL.md`（**镜像同步**） | 新增「job: keywords」：词表维护流程 + 标注批次流程（导出→会话→写回→核对）；调度挂周作业 classify 之后；日增量随公众号日报 ⓪ 步顺带 | 双文件逐字同步 |
| 1.6 | 单元测试 | `server/keyword-terms.test.js`（新） | 临时库：双路径迁移、apply 校验（7 词/含期刊名/重复词 拒收）、pending 登记、归并改写 | `node --test` 全绿 |

**验收**：apply 对畸形结果全部拒收；词表初版人工审校完成（active ≥300）；首批标注 100 篇抽检合格率 ≥95%（抽 20 篇人工判词准不准）。

### WP2 检索增强（依赖 WP1 + D3）

| # | 修改点 | 文件 | 内容 | 预期效果 |
|---|---|---|---|---|
| 2.1 | 查询扩展 | `server/db.js`（新函数 `expandQueryTerms(q)`） | q 与 q 的子串命中 `semantic_terms(active)` 的 zh/en/aliases → 返回同义形式集合（含原词） | 「电动汽车」扩展出 `electric vehicle;EV` |
| 2.2 | LIKE 目标列与 OR 组 | `db.js#buildArticleListQuery` | q 分支：匹配列追加 `a.ai_keywords`；q 的每个同义形式各占一个 OR 子句（**全部带 `ESCAPE '\'`**）；keyword 筛选列同步追加 ai_keywords | 跨语言/同义命中；现有筛选全部兼容 |
| 2.3 | 单元测试 | `server/article-filters.test.js` 追加 | 断言：搜中文命中仅英文表述文献（经 ai_keywords）；同义扩展命中；旧用例全过 | 回归零失败 |
| 2.4 | 探针脚本 | `scripts/probe-feed-filters.mjs` 扩展 | 增加语义检索用例（跨语言、同义词、扩展开关对比） | 线上可复验 |

**验收**：预置语料下「电动汽车有序充电」命中仅含 "coordinated charging of EVs" 的文献；现有探针全过；列表总数/分页语义不变。

### WP3 相关推荐升级（依赖 WP1 + D4）

| # | 修改点 | 文件 | 内容 | 预期效果 |
|---|---|---|---|---|
| 3.1 | 打分替换 | `server/db.js#listRelatedArticles` | 词集 = `keywords ∪ ai_keywords`（分词、小写、≥2 字符）；打分改 IDF 加权共现（df 全库预计算缓存，标注写回后失效重算）；候选池/日期/id 兜底不变；源文献词集为空回退现逻辑 | 无作者关键词文献首次获得真实相关信号；泛词噪声被抑制 |
| 3.2 | 单元测试 | `server/related-articles.test.js` 追加 | 预置 ai_keywords 断言：专业词相似篇排第一；泛词不主导排序；旧 7 断言全过 | 回归零失败 |
| 3.3 | 盲评抽检 | 人工 | 抽 20 篇（含 10 篇无原关键词）对比升级前后 3 条推荐 | 不劣于旧版，无关键词组显著提升，记录入当日 memory |

### WP4 关键词统计归一（依赖 WP1）

| # | 修改点 | 文件 | 内容 | 预期效果 |
|---|---|---|---|---|
| 4.1 | 统计口径 | `db.js#getKeywordStats` / `getKeywordCooccurrence` | 读取改 `keywords ∪ ai_keywords` 并集去重；分词后过 `semantic_terms` 归一（alias→canonical，统一显示中文名）再计数 | 覆盖率 37%→~100%；Top50 无同义重复 |
| 4.2 | 单元测试 | `server/keyword-terms.test.js` 追加 | 归一计数断言；并集去重断言 | 全绿 |

## 6. 实施顺序与里程碑

| 里程碑 | 内容 | 验证门禁 |
|---|---|---|
| **M0** | D1-D5 拍板；会话产出词表初版（300-500 概念）+ 人工审校 | 词表入库 active ≥300 |
| **M1** | WP1 脚本与测试；首批标注 100 篇试运行 | WP1 验收全过 |
| **M2** | 全量标注（~4200 篇，按周作业节奏分批，预计 2-3 个作业窗口） | 覆盖率 ≥95% |
| **M3** | WP2+WP3+WP4 同批上线：bump version + CHANGELOG + sc_project_sync + redeploy + verify-render + 线上探针 | 验收总表全勾 |

说明：标注进度不阻塞代码开发——WP2/3/4 代码可与 M1/M2 并行完成，但**上线需覆盖率 ≥95%**，否则无标注文献的检索/推荐体验与旧版无异（有回退，不会更差）。

## 7. 验收总表（上线 Definition of Done）

- [ ] `npm test` 全绿（远端唯一已知败项 ieee.test.js 除外）
- [ ] 检索：跨语言、同义词用例命中；旧探针全过
- [ ] 相关推荐盲评 20 篇不劣于旧版
- [ ] 关键词覆盖率（keywords 或 ai_keywords 非空）≥95%
- [ ] 统计 Top50 无肉眼可见同义重复词条
- [ ] apply 脚本对畸形结果（超词数/含期刊名/空词）invalid 拒收
- [ ] verify-render 全 ok，文献库/详情弹窗/关键词统计人工走查

## 8. 远期备选：真向量升级口（不在本期范围）

若日后需要长句模糊查询（「提升新能源消纳的灵活性资源」），两条路径：

- **本地 ONNX**（零 API，延续本期哲学）：`@xenova/transformers` + bge-small-zh-v1.5/multilingual-e5-small（~100MB 模型随库同步）；服务端 `server/embeddings.js` 屏蔽实现，检索/推荐打分函数预留向量分支；风险=远端原生模块部署（redeploy -InstallDeps、模型文件同步）。
- **混元 embedding API**（v1 方案）：TC3 签名复用 `translate-tencent.js`，100 万 token 免费包，之后 ¥0.7/百万 token；需 M0 实测 GetEmbedding 可用性（官方提示旧 API 迁移 TokenHub）。

本期所有表结构（ai_keywords/semantic_terms）与打分接口设计均不排斥日后叠加向量信号（混合打分）。
