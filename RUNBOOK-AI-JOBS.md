# RUNBOOK-AI-JOBS（根目录镜像）

> 本文件是 .workbuddy/skills/literature-ai-jobs/SKILL.md 的逐字镜像：定时会话未拾取项目级 skill 时，以本文为执行依据。两文件必须同版本维护（改动一处即同步另一处）。

---
name: literature-ai-jobs
description: 文献推送站（E:\SC\文献推送）全部 AI 批量作业的统一执行入口。触发词：文献 AI 作业、文献 AI 周作业、文献 AI 月作业、跑方向分类、生成周报、生成月报、方向专报。经 sc-remote 在远端执行「导出素材 → 本会话生成 → 写回数据库」循环，全程零外部 API、零费用。
---

# 文献推送 · AI 批量作业执行手册（唯一执行依据）

> **本手册是所有文献 AI 作业的唯一执行依据**；执行会话动手前必须完整通读本文。
> 版本：2026-11-02 v17（§8 新增两行处置：① 总览速评卡降级为「文献 #id」且不可点 = 单期 briefs 总量超过前端元数据拉取上限（2026-11-02 已由 300 修至 1200，src/features/reports/ReportsView.jsx refIds），briefs 逼近 1200 时须同步上调并走部署；② 新入库文献因翻译额度用尽缺中文译名 → 经用户授权以 provider='manual' 手动翻译标题写 translations 表（只动该表、不消耗 API 额度，2026-11-02 已补 17 篇）。教训来源：2026-11-01 期周报 566 briefs 触发上限，输电网等靠后方向卡片全部降级）
> 上一版：2026-10-29 v16（§8.5.0 标题定版：**自拟钩子 + 固定后缀【日报 YYYY-MM-DD】**；`probe-wechat-html.mjs` M2 与 `publish-wechat-draft.mjs` 均增加日期后缀硬校验。教训来源：v15 只定了自拟规则未定日期后缀，用户按「…【AI 早报 2026-10-29】」样式定版为【日报 日期】）
> 上一版：2026-10-29 v15（§8.5.0 标题契约落地为硬闸门：`publish-wechat-draft.mjs` 在 daily 期 `issue.title` 缺失时**直接失败**、不再回退模板标题「电研新视界 日报｜日期」；步骤 4.5 自评补第⑥条 title 检查。教训来源：2026-10-29 期执行会话漏读 §8.5.0，草稿以模板标题写入草稿箱，事后删除重发）
> 上一版：2026-10-28 v14（§8.5 契约澄清：**listing = 报道窗口内新入库文献的全量清单**，briefs = 精选子集——头部「新入库文献 N 篇」与 ④ 区块标题均取自 listing 条目合计，listing 只放精选子集会误显「N 篇=N 篇」。教训来源：2026-10-28 期入库 10 篇、速评 8 篇，头部曾误显 8/8）
> 上一版：2026-10-24 v13（§8.6 覆盖规则变更：当日**全部**文献必须有核心创新点，全部下载全文逐篇完整阅读，废除「>30 篇只做前 N 篇重点」性能约束；下载失败者降级摘要并在 points 如实标注。教训来源：2026-10-24 当日 146 篇仅做 12 篇重点，用户要求全覆盖）
> 上一版：2026-10-17 v12（§8.6 新增「步骤 2.6 — 写回核心创新点」：速评与创新点是**两条独立写库路径**——速评进 `ai_reports.paperBriefs`，创新点进 `articles.deep_analysis` + `figure_path`，新增 `scripts/apply-deep-analysis.mjs` 作为创新点的唯一写入口；附录 A 每日提示词同步补该步。教训来源：2026-10-17 首跑只读了全文并写了速评，未产出创新点，站上「核心创新点」区块全空）
> 上一版：2026-10-16 v11（§8.6 新增「步骤 2.5 — 全文获取」：当日新增文献先用 `webvpn-paper-fetch` skill 下载全文再写分析，不再只依据摘要；附录 A 每日提示词同步加入该步骤。另：全部导出脚本的摘要截断已移除——分类 / 报告 / 公众号日报三处 `abstractClip` 常量删除，AI 读取完整摘要）
> 上一版：2026-10-16 v10（§8.6 结构与附录 A 提示词：正文只写「当日分析摘要」一节，取消标题下的总述句——篇数/来源/方向已由页内标签承载，复述属重复；前端同步只渲染该小节）
> 上一版：2026-10-15 v9（§8.6 下线「重点关注」板块：当日文献已按三字段速评卡全量展示，再单列子集只会重复同样的卡；§8.6 结构与附录 A 提示词同步去掉 focusIds / 「## 重点关注」小节，apply 侧保留该字段容错）
> 上一版：2026-10-15 v8（新增 §8.6 job: daily-digest——研究速览「当日新增」标签页的 AI 日报，并入每日 06:30 作业；ai_reports.kind 白名单扩为 weekly/monthly/daily；§8.5.1 步骤 4.5 与附录 A 提示词补「资讯条目与网页昨日文件逐条对应」自查项）
> 上一版：2026-10-13 v7（下线「本周/本期值得注意」「值得精读」板块：模板删除、highlightIds 降级为保留字段一律填 `[]`；前端同步不再展示）
> 上一版：2026-10-08 v6（wechat-daily prompt 增加步骤 ④.5 交稿自评：三段/字数/数字一致/禁夸大措辞，§8.5.1 同步）
> 上一版：2026-10-01 v4（速评复用 priorBrief：月报/专报逐字复用周报已写速评，只新写未覆盖文献；定时任务提示词对齐全流程）
> 维护：方向体系增删须同步第 4.2 节与 `server/directions.js` + `src/lib/directions.js`
> 取代关系：第 4 节 = 原 `RUNBOOK-AI-DIRECTION.md` 全量并入（后者已标注被本 Skill 取代）。

## 1. 背景（一段话）

文献推送网站（前端 React+Vite，后端 Node+SQLite，部署在 SC 远端 Windows 主机）的 AI 能力由 WorkBuddy 定时任务的执行会话（你）亲自完成：通过 sc-remote 连接远端，运行**导出脚本**取得素材 → 你在会话内完成分类/写作 → 结果 JSON 传回远端 → 运行**写回脚本**入库。全程零 API key、零外部调用、零现金成本。

- 远端项目目录：`E:\SC\文献推送`（SSH 5514@192.168.31.233，经 sc-remote MCP 连接器操作）
- 远端 Node：`.runtime\node\node.exe`（远端 PATH 里没有 node，必须用它）
- 数据库：远端 `data\literature.sqlite`（**生产数据，只能经本文档的脚本访问**）
- 本地暂存：`_direction-work\`（分类）与 `_ai-jobs-work\`（周报/月报/专报，专报结果放 `_ai-jobs-work\direction-inbox\`）
- 脚本清单（远端 `scripts\`）：

| 脚本 | 用途 |
|---|---|
| `migrate-directions.mjs` | 首次部署迁移（幂等，一般不需要重跑） |
| `export-direction-batch.mjs` | 分类作业：导出待分类文章 |
| `apply-directions.mjs` | 分类作业：结果写库（白名单 + manual 保护） |
| `export-report-batch.mjs` | 总览/方向专报：导出窗口素材（`--direction <key>` 导出方向批次；`--start/--end` 显式窗口回填） |
| `apply-report.mjs` | 单份报告写库（`--export` 绑定素材硬校验 + 数字重算） |
| `apply-reports-bulk.mjs` | 目录批量写回（专报标准入口，`--dir data\direction-inbox`） |
| `compact-report-batch.mjs` | 素材压缩视图（大批次按方向分组通读用） |
| `list-batch-headers.mjs` | 打印全部批次头的 exportedAt（写结果 JSON 必须逐字一致） |

## 2. 红线（绝对禁止，任何 job 下都有效）

- ❌ 禁止绕过 `apply-*.mjs` 脚本直接写远端数据库（包括 sqlite3 命令行、自写 SQL、`sc_run` 内联 UPDATE/DELETE）。
- ❌ 禁止调用任何外部 LLM API、联网富化——分类与写作由执行会话自身完成。
- ❌ 禁止使用 `sc_job_cancel`（会连带取消远端隧道与补全作业）。
- ❌ 禁止改远端 `.env`、`data\` 下其他文件、服务代码。
- ❌ 禁止在未通读本文档的情况下开始执行。
- ❌ 素材文件禁止跳读——必须用 Read 分段（offset/limit）完整读完；大批次（>400 篇）可先用 `compact-report-batch.mjs` 生成压缩视图后通读压缩视图。

**第 2.1 节是写作类 job 的强制步骤，与本节同等效力。**

## 2.1 写作铁律 · 去 AI 味（所有写作类 job 必做）

> 适用范围：凡产出中文正文的 job —— 总览周报、方向专报、月报、站内日报、公众号日报、文献专题栏目、每日资讯。
> skill 位置（双层扫描，均已安装）：
> ① `C:\Users\admin\.workbuddy\skills\humanizer-zh` —— 中文语感层（翻译腔、机械对照、标点密度、句式同构），权威规则在其 SKILL.md + references/patterns.md
> ② `C:\Users\admin\.workbuddy\skills\humanizer` —— 统计痕迹层（同款句式复制、高频重复词、空泛大词、否定式排比、硬凑三连、泛泛收尾），规则在其 SKILL.md
> （2026-10-29 起替代 qu-ai-wei；qu-ai-wei 保留在 skills 目录但不再被流程引用。）

**执行时机**：成稿写完之后、`apply-*.mjs` 写回或渲染**之前**。两层依次各扫一遍，一轮完成，不反复迭代。

| 步 | 动作 |
|---|---|
| 1 | 建**信息账本**：把成稿里的人物、事实、数字、时间、结论、限定词、来源、术语逐项列出 |
| 2 | 第一层（humanizer-zh）：读其 SKILL.md（深度改写加读 references/patterns.md），扫翻译腔连接词、空泛大词、机械对照句、句式同构、破折号与冒号密度、引号样式（沿用原稿「」或""，全篇不混用） |
| 3 | 第二层（humanizer）：按其 24 类清单扫，重点：同一素材是否被同款句式写两遍、同一词语是否高频复现（≥3 次须错开）、挂在句尾的浅层分析（「体现了…」「反映出…」）、模糊归因、否定式排比（「不仅…更是…」）、硬凑三连、泛泛正面收尾、抽象抬升词（「这件事」「本质上」「归根结底」） |
| 4 | 两层命中合并去重后统一改写：允许改句子主干、拆并句、换主语、调段落顺序；不做同义换壳；**不为改而改**——指不出命中模式的改动一律撤销 |
| 5 | 复扫信息账本：确认事实、数字、日期、归因、证据强度、不确定性均未变；受保护字段（论文标题、期刊、篇数、方向标注、创新点与技术路线等库内逐字内容）不得变动 |
| 6 | 输出终稿直接替换成稿；改动清单存 `data/ai-tone/<job>-<date>.md` |

**模式选择**：定时任务一律内嵌执行（流程内嵌步骤，直接出终稿）；人工交互场景可要求展示改动对照。

**硬约束（违反即返工）**：

- 事实优先：不改事实、数字、日期、归因、引用绑定、逻辑关系
- 不编造：不补写因果、经历、例子、观点；不把不确定说成确定；不把相关性升级成因果
- 不默认摘要：独立事实、限定、例子、反例、评价都要保留，除非明确要求精简
- 受保护片段：真实引语、代码、公式、法律条款、标准定义、专名、引用标识，默认不动
- 不为"人味"加错别字、emoji、网语、第一人称、幽默、个人经历
- 每处改动要能对应到某个命中模式，指不出就撤销
- 改动没有带来可验证改善时，原样返回并说明无需改写

**汇报**：在 §8 汇报模板末尾加一行 `去 AI 味：改动 N 处，主要模式族 <族名>，打磨要点 data/ai-tone/<file>`。

## 3. 作业调度

| 触发 | 作业序列 | 说明 |
|---|---|---|
| 每周日 23:00 / 「文献 AI 周作业」 | **classify → digest → 逐方向专报** | 专报依赖总览批次与分类完成，顺序不可颠倒 |
| 每月 1 日 03:00 / 「文献 AI 月作业」 | **report → 逐方向专报** | 覆盖上一个完整自然月；速评优先复用周报（见 §6 复用规则），只新写未覆盖文献 |
| 每日 06:30 / 「电气前沿速递公众号日报」 | **classify 增量 → daily-digest → wechat-daily** | 站内「当日新增」AI 日报（§8.6，写库）+ 公众号日报（§8.5，独立渠道不写库）；classify 使两份素材都带方向，daily-digest 先落库、wechat-daily 随后复用同一批素材 |
| 会话说「跑一次方向分类」 | 仅 classify | 手动补跑 |

- 逐方向专报 = **当期所有非零方向**（≥1 篇即做，无门槛），逐个 export → 写结果 → 统一 bulk 写回。
- 任一 job 失败不影响已完成的 job；失败按 §8 汇报并终止，不自动重试、不变通。
- 全链路幂等：classify 只处理 `research_direction IS NULL`；报告按 `UNIQUE(kind, period_start, direction)` 先删后插覆盖。

## 4. job: classify（AI 研究方向分类）

### 4.1 执行步骤

**步骤 0**：`sc_status` 前置检查；不可用 → §8 汇报终止。

**步骤 1 — 导出**（`sc_run`）：

```
Set-Location 'E:\SC\文献推送'; & .runtime\node\node.exe scripts\export-direction-batch.mjs --limit 400
```

**步骤 2 — 下载批次**：`sc_download` 远端 `data\direction-batch.json` → 本地 `_direction-work\batch-<日期>.json`，Read 分段完整读完。

**步骤 3 — 分类（每 100 篇一个结果文件）**：按 4.2/4.3 标准 Write `_direction-work\results-<日期>-<序号>.json`（格式见 4.4）。

**步骤 4 — 写回**：`sc_upload` 到远端 `data\direction-inbox.json`（覆盖），然后：

```
Set-Location 'E:\SC\文献推送'; & .runtime\node\node.exe scripts\apply-directions.mjs --file data\direction-inbox.json
```

**步骤 5 — 核对**：`updated` = 该批条数、`invalid` 必须 = 0；连续两批 invalid > 0 → §8。

**步骤 6 — 收尾**：重复至 `exported=0` 或本轮满 400 篇。

### 4.2 方向体系（15 个，唯一白名单）

| key | 名称 | 定义（判归依据） | 典型信号词 |
|---|---|---|---|
| distributed-gen | 分布式电源与并网 | 分布式光伏/风电等**电源侧**的并网运行、消纳能力、接入系统方案与场站控制 | distributed generation, grid integration, curtailment, 消纳, 并网, 新能源场站 |
| storage | 储能系统 | 电池/氢等储能系统的容量配置、运行优化、状态估计、寿命与安全 | BESS, state of charge, capacity allocation, 储能, 容量配置 |
| market | 电力市场与机制 | 电能量/辅助服务市场、竞价出清、定价结算、机制设计与激励相容 | electricity market, bidding, tariff, ancillary services, 电力市场, 电价, 辅助服务 |
| transmission | 输电网运行与规划 | 输电系统经济调度、机组组合、潮流、状态估计、网架规划 | OPF, unit commitment, SCED/SCUC, power flow, 潮流, 机组组合 |
| distribution | 配电网运行与规划 | 配电网重构、网架/容量规划、电压与网损优化、馈线与软开关 | reconfiguration, feeder, soft open point, 配电网, 馈线, 重构, 台区 |
| microgrid | 微电网与虚拟电厂 | 微电网/VPP 能量管理、多主体聚合、并离网控制、聚合商运营、需求响应 | microgrid, VPP, EMS, aggregation, demand response, 微电网, 虚拟电厂, 聚合 |
| forecasting | 预测与数据驱动 | 负荷/出力/电价预测，及 ML/DL 在电力系统中的数据驱动应用 | forecasting, LSTM, deep learning, 负荷预测, 深度学习 |
| stability | 电力系统稳定性 | 功角/频率/电压稳定、低频与次同步振荡、暂态稳定、惯量与阻尼 | small-signal, transient stability, oscillation, damping, 低频振荡, 次同步, 惯量 |
| protection | 继电保护与故障诊断 | 保护原理、故障检测/定位/测距、行波、设备故障诊断 | relay, fault location, traveling wave, 保护, 行波, 测距 |
| power-quality | 电能质量 | 谐波、电压暂降、闪变、三相不平衡的机理与治理 | harmonics, voltage sag, flicker, 谐波, 电能质量, 电压暂降 |
| hv | 高电压与绝缘 | 绝缘材料与特性、局部放电、过电压防护、防雷、高压试验 | insulation, partial discharge, overvoltage, lightning, 绝缘, 局放, 过电压 |
| power-electronics | 电力电子装备 | 变换器拓扑与控制、MMC、调制策略、宽禁带器件、装置本体 | converter, MMC, modulation, SiC, GaN, 变流器, 逆变器, 调制 |
| transport | 电动汽车与电气化 | 充电设施规划、充电负荷建模、车网互动、交通电气化供电 | EV charging, V2G, charging station, 电动汽车, 充电桩, 车网互动 |
| ies | 综合能源系统 | 电-热-气-氢多能耦合、P2G、热电联产、区域综合能源优化 | integrated energy, P2G, CHP, hydrogen, 综合能源, 多能互补, 氢能 |
| other | 其他/交叉 | 以上均不适配时才用。**预期占比 <10%**；other 不进入列表/推送/统计/速览 | — |

### 4.3 分类标准

1. **先识别研究问题，再匹配方向**（用 LSTM 做负荷预测 → `forecasting`，不看方法标签）。
2. 主方向唯一；次方向 0–2 个且不与主方向重复。
3. 置信度：0.90–1.00 关键词直接命中；0.70–0.89 需结合摘要；0.50–0.69 跨方向凭主旨；<0.60 由脚本自动加 `[待复核]`。
4. 仅标题+关键词（无摘要）时置信度 ≤0.70。
5. other 门槛：仅当 14 方向确实不适配；信息不足给最接近方向 + 低置信。
6. reason ≤30 字，写判归依据，禁空话。
7. 边界：风机/光伏本体 → `power-electronics` 或 `other`；电缆绝缘本体 → `hv`（对配网影响 → `distribution`）；充电桩拓扑 → `power-electronics`（设施规划与负荷 → `transport`）；氢能全链条 → `ies`。

### 4.4 输出 JSON 契约

```json
{ "results": [ { "id": 3977, "direction": "storage", "secondary": ["distribution"], "confidence": 0.92, "reason": "共享储能容量配置与运行优化" } ] }
```

### 4.5 汇报

见 §8 模板的 classify 段。

## 5. job: digest（全方向总览周报）

### 5.1 执行步骤

**步骤 1 — 导出**：

```
Set-Location 'E:\SC\文献推送'; & .runtime\node\node.exe scripts\export-report-batch.mjs --kind weekly --days 7
```

输出含 `exported/period/total/prev_total/top=[方向:篇数]`，素材默认落 `data\report-batch-weekly.json`。

**步骤 2 — 下载通读**：`sc_download` → `_ai-jobs-work\batch-weekly-<日期>.json`，分段完整读完（>400 篇可先生成压缩视图：`scripts\compact-report-batch.mjs --file <batch> --out <compact.txt>`，通读压缩视图）。

**步骤 3 — 撰写**：按 5.2 结构写 contentMd，按 5.4 契约写结果文件。

**步骤 4 — 写回**：`sc_upload` 结果到 `data\report-inbox.json`，然后（**必须同时给 --export**）：

```
Set-Location 'E:\SC\文献推送'; & .runtime\node\node.exe scripts\apply-report.mjs --export data\report-batch-weekly.json --file data\report-inbox.json
```

**步骤 5 — 核对**：`updated=1 invalid=0`；invalid 的 errors 数组说明原因（幻觉 id / 头字段不一致 / 超长），修正重传；连续两次失败 → §8。

### 5.2 contentMd 结构（结构即 UI：前端按标题分模块渲染）

```markdown
# 一周论文速览 · {periodStart} ~ {periodEnd}
本周期共收录 {stats.total} 篇（上期 {stats.previous.total} 篇），方向分布：储能 32 · 配电网 28 · …
（↑ H1 之后、第一个 ## 之前的段落 = 前端「引言卡」；数字必须逐字取自 stats）

## 各方向动态
### 储能系统（32 篇，较上期 +5）
<第 1 句主题聚焦，第 2 句点出方法/对象热点（如「A、B、C 多路线并行」），依据素材归纳>
（每个非零方向一节，按篇数降序 → 前端渲染为「方向动态卡片网格」；
  若 stats.unclassified > 0 加「### 待方向标注（N 篇）」节如实说明）

## 热点主题
主题词一、主题词二、…（≤6 个顿号分隔 → 前端渲染为可点击主题 chips）
```

### 5.3 stats 与数字纪律

- `total / directionCounts / directionDelta` 由 `apply-report.mjs` 从素材**重算**入库，你不提供数字字段。
- 正文所有数字必须逐字抄素材 stats，禁止自行数数；方向名用 4.2 表中文名。
- 推荐理由只依据素材摘要前 500 字，禁止编造。

### 5.4 输出 JSON 契约

```json
{
  "exportedAt": "<原样带回素材顶层 exportedAt>",
  "kind": "weekly",
  "periodStart": "<原样带回>",
  "periodEnd": "<原样带回>",
  "contentMd": "<5.2 全文>",
  "highlightIds": [],
  "topTopics": ["共享储能", "配电网重构"],
  "paperBriefs": [ { "id": 4021, "object": "…", "method": "…", "finding": "…" } ]
}
```

apply 硬校验（整批拒收）：四个头字段与素材逐字一致；contentMd 非空 ≤20 000 字符；highlightIds 为**保留字段**（2026-10-13 精选板块下线，一律填 `[]`）；topTopics ≤12 条（每条 ≤30 字）；paperBriefs 按 5.5 校验（总览一律留空、方向专报必填）。

### 5.5 三字段速评契约（paperBriefs，研究速览 v2）

每条 = 一篇文献的结构化速评，前端渲染为「研究对象 / 研究方法 / 核心结论」三行卡片：

| 字段 | 必填 | 上限 | 规范 |
|---|---|---|---|
| id | ✓ | — | 素材内文章 id，正整数 |
| object 研究对象 | ✓ | 30 字 | 研究的系统/装置/场景，具体到对象本体；**禁止复述标题** |
| method 研究方法 | ✓ | 40 字 | 方法/模型/数据/验证手段，优先写具体名词（模型名/数据集/仿真平台）；**「优化/分析」等空泛词不允许单独出现**；纯综述写「综述＋覆盖范围」 |
| finding 核心结论 | ✓ | 50 字 | 结果/指标/工程价值；**摘要没有的禁止编造** |
| topic 主题归属 | ✗ | 12 字 | 所属主题聚类名（与正文聚类标题一致时填） |

覆盖规则（apply 硬校验，任一失败整批拒收）：
- **方向专报：paperBriefs 必须提供，且覆盖该方向批次内每一篇文献**（缺一篇即拒收，错误信息会列出缺失 id）；
- **总览周报/月报：不写 paperBriefs**（精选板块已下线，填 `[]`）；
- 正文速评行与 paperBriefs 必须同源一致：同一 id 的对象/方法/结论两边说的是同一件事。
- **速评复用（priorBrief，v4）**：导出素材中带 `priorBrief` 字段的文献 = 该篇已在本期周报（周方向专报）写过三字段速评。月报/月度专报**必须逐字复用**其 object/method/finding（原样照抄，禁止改写、禁止重新总结），只有无 priorBrief 的文献才新写；周报正常首跑几乎无命中（当周都是新文献），重跑同期时整期可复用。

## 6. job: report（全方向总览月报）

与 §5 同流程，仅导出与结构不同：

**导出**：

```
Set-Location 'E:\SC\文献推送'; & .runtime\node\node.exe scripts\export-report-batch.mjs --kind monthly --month <上一个自然月 YYYY-MM>
```

```markdown
# 月度趋势报告 · {periodStart} ~ {periodEnd}
本月共收录 {stats.total} 篇（上月 {stats.previous.total} 篇，环比 ±N%）。

## 方向分布与环比
### 储能系统（93 篇，上期 56，+37）
<1–2 句环比判断>
（每个非零方向一节；### 标题格式 = 前端方向卡片网格）

## 各方向趋势解读
（每个重点方向 2–4 句：主题演变、方法热点、与上月差异）

## 新兴主题
（≤5 条，每条一句依据 → 前端 chips）

## 方法观察
（跨方向方法趋势，可选节 → 前端文本卡）

```

环比口径提醒：若上月数据受分类覆盖进度影响（如分类刚收口），在引言注明「环比仅供参考」。

**速评复用规则（v4，先复用后新写）**：导出脚本自动把窗口内已入库周报（总览 + 周方向专报，status='ready'）的 paperBriefs 注入素材——文章带 `priorBrief` 字段 = 周报已写过速评。总览月报的 highlight briefs 与月度方向专报的 paperBriefs 一律**先取 priorBrief 逐字复用**，仅对无 priorBrief 的文献（周报漏覆盖、跨月边界等）新写。素材顶层 `briefReuse: {available, matched}` 给出可复用与命中数，导出摘要行的 `prior_briefs=命中/可复用` 同义。

## 6.5 job: digest-direction（方向专报，周/月同构，全方向无门槛）

总览写完后**当期所有非零方向逐个生成专报**（每方向一份独立报告，≥1 篇即做）。

**步骤 1 — 导出（同窗口 + `--direction`）**：

```
Set-Location 'E:\SC\文献推送'; & .runtime\node\node.exe scripts\export-report-batch.mjs --kind weekly --days 7 --direction storage --out data\report-batch-d-storage.json
```

月度：`--kind monthly --month <YYYY-MM> --direction <key> --out data\report-batch-d-<YYYY-MM>-<key>.json`。
然后 `& .runtime\node\node.exe scripts\list-batch-headers.mjs` 获取每批的 `exportedAt`（结果 JSON 必须逐字一致）。

**步骤 2 — 通读**：方向批次通常 ≤100 篇，直接分段通读；月度大方向可生成压缩视图。月度批次先按 `priorBrief` 把文章分成「复用组」（三字段照抄素材，禁止改写）与「新写组」（逐篇细读摘要后按 5.5 契约撰写）——新写组才需要逐篇精读，复用组通读标题即可。

**周报专报结构**（`## 论文速评` **逐篇全覆盖**）：

```markdown
# {方向名} · 一周速览 {periodStart} ~ {periodEnd}（N 篇）
<1–2 句引言：本周主题聚焦>
## 主题脉络
<2–4 句聚类与环比>
## 论文速评
- [12345] **{论文标题}**（{期刊}）｜对象：{研究对象}｜方法：{研究方法}｜结论：{核心结论}
（**每篇都有**，行首必须 `[id] `；站内整行渲染为三字段速评卡、邮件自动剥离编号；
  三字段与结果 JSON 的 paperBriefs 同源一致，字数按 5.5 上限）
## 高频关键词
词一、词二、…（顿号分隔 → 前端 chips）
```

**月度专报结构**（主题聚类形式）：

```markdown
# {方向名} · 月度趋势 {periodStart} ~ {periodEnd}（N 篇，上月 M，±K）
<1–2 句总评>
## 主题聚类速评
### 主题 A
- [12345] **{标题/概括}**（{期刊}）｜对象：…｜方法：…｜结论：…
（**逐条带 [id]，必须覆盖该主题下全部文献**——paperBriefs 已覆盖批次每篇，
 速评逐字复用 priorBrief 或按 5.5 撰写；**不得只列代表性文献**、组名不加篇数。
 前端默认每组只展示一行速评卡，用户点「继续加载」查看全部，行数多不影响阅读）
### 主题 B
## 方法观察
（可选节）
```

**结果 JSON**：同 5.4 契约 + 顶层 `"direction": "<key>"`（与导出批次逐字一致）；`highlightIds` 保留字段（填 `[]`）；
`paperBriefs` **必须覆盖该方向批次内每一篇**（5.5 契约，缺一篇整批拒收）。

**步骤 4 — 批量写回**：全部专报结果 Write 到本地 `_ai-jobs-work\direction-inbox\`（文件名如 `d-storage.json` / `dm-202608-storage.json`），整目录 `sc_sync_upload` 到远端 `data\direction-inbox`，然后：

```
Set-Location 'E:\\SC\\文献推送'; & .runtime\node\node.exe scripts\apply-reports-bulk.mjs --dir data\\direction-inbox
```

（bulk 按文件名自动匹配批次：周 `report-batch-d-<key>.json`、月 `report-batch-d-<YYYY-MM>-<key>.json`。）

**纪律（硬性）**：
1. 行内所有 `[id]`（正文速评行）必须属于该方向导出批次——前端整行会渲染成该 id 的可点击卡片，写错会指向错误文献。
2. exportedAt/kind/periodStart/periodEnd/direction 五个头字段与素材逐字一致。
3. contentMd 非空 ≤20 000 字符；highlightIds 填 `[]`；topTopics ≤12。
4. 数字抄素材；评语只依据摘要。
5. paperBriefs 按 5.5 规范：三字段非空、object ≤30 / method ≤40 / finding ≤50 字；方法禁空泛词、结论禁编造；与正文速评行同源一致。
6. priorBrief 复用一致性（月度作业硬性）：素材带 priorBrief 的文献，结果 JSON 中该 id 的 object/method/finding 必须与 priorBrief **逐字一致**——写回前逐条比对，改写即视为质量事故（同一文献两期口径漂移）。

## 7. 质量自检（写回前本地执行）

- 用本地脚本或正则核对每份专报：正文所有 `[id]` ⊆ 对应素材 articles 的 id 集（不等式：`contentMd.match(/\[(\d{4,6})\]/g)` 逐个比对）。
- `exportedAt` 等五头字段与 `list-batch-headers.mjs` 输出逐字比对。
- highlightIds 为空数组、topTopics ≤12。
- paperBriefs 覆盖检查：方向专报的 paperBriefs id 数 = 素材 articles 条数（逐 id 比对），每条三字段非空且 ≤ 上限（object 30 / method 40 / finding 50）。
- priorBrief 复用一致性：结果 JSON 中每条 brief，若该 id 在素材中带 priorBrief，则三字段与 priorBrief 逐字一致（本地脚本或正则逐条比对）。
- 任何不符先改本地文件再上传——**远端 apply 拒收一轮就是一次浪费的往返**。

## 8. 异常处理与汇报

| 情形 | 处置 |
|---|---|
| `sc_status` 不可用 | 汇报"本轮未执行+原因"，终止（下周自动重试，幂等无副作用） |
| `no such column: research_direction` | 跑 `scripts\migrate-directions.mjs` 后重试 |
| 远端缺 scripts | 代码未同步，汇报终止（不得在远端自建文件） |
| apply 连续两批 invalid > 0 | 停止写回，保留已写部分，汇报已写入数与问题样本 |
| `highlightId not in export batch` | 引用了批次外文献——改素材内 id 或删该条 |
| `exportedAt mismatch` | 头字段与素材不一致——用 list-batch-headers 输出重新对齐 |
| 总览速评卡显示「文献 #id」且不可点 | 前端元数据拉取上限 < 单期 briefs 总量（2026-11-02 起上限 1200，`src/features/reports/ReportsView.jsx` refIds）。处置：核对当期 briefs 总量，逼近 1200 时上调该 slice 上限并走 Git 部署流程；周作业汇报里附带本期 briefs 总量作为巡检数字 |
| 新入库文献缺中文译名（翻译额度用尽） | 卡片与推送回退英文原题。兜底（需用户授权，不属越权直改库）：AI 翻译标题后以 `provider='manual'`、`target_language='zh'` upsert 进 translations 表——只动该表、只补缺译、不消耗翻译 API 额度；摘要译文留空待 API 额度恢复后由系统自动补齐。参照 `_tmp/manual-translate-remote.py`（2026-11-02 已补 17 篇） |
| 会话中途被切断 | 无需补救——全链路幂等，下次自动续 |

**红线重申**：禁直改库、禁外部 API、禁 sc_job_cancel、禁改 .env/服务代码。

**汇报模板**

```
【文献 AI 作业报告】<日期>
- classify：分类 N 篇（M 批），覆盖 classified/total，待复核 N 篇
- digest：总览周报入库（period，total 篇）
- digest-direction：方向专报 N 份入库（覆盖方向列表；bulk ok=X failed=Y；速评复用 R 篇 / 新写 W 篇）
- 异常与处理：无 / 描述
```

## 8.5 job: wechat-daily（公众号日报，独立渠道，不写库）

> 渠道设计真值 = DESIGN-WECHAT-MP-DAILY.md。本 job 与 §4-6.5 的写库链路完全独立：
> 产物只落 `data\wechat-drafts\`，不触碰 ai_reports / articles；发布由人工完成
> （个人订阅号无 freepublish 权限，2025-07 微信政策）。

### 8.5.0 标题契约（2026-10-28 起硬性；2026-10-29 v16 定版结构）

**每期标题 = 自拟内容钩子 + 固定日期后缀，写进 issue JSON 的 `title` 字段**，形如
「南方区域电力市场获准转入正式运行【日报 2026-10-29】」。禁止「电研新视界 日报｜YYYY-MM-DD」这类只差日期的旧模板——平台会判定为低质/营销内容并限流。

| 项 | 要求 |
|---|---|
| 结构 | **内容钩子 + 固定后缀【日报 YYYY-MM-DD】**（后缀日期 = issue.date，一字不差） |
| 长度 | 钩子 12–24 字，总长 ≤64（别顶格） |
| 取材 | 当天最有传播力的 1–2 条（政策优先于新闻，数字优先于形容词） |
| 数字 | 用阿拉伯数字，能给对比就给（「破 20 亿千瓦」优于「大幅增长」） |
| 禁止 | 钩子以日期开头或含「速递 / 第 N 期」字样（【日报 日期】后缀除外）、重磅/突发/首次/速看等标题党词、旧模板「电研新视界 日报｜日期」 |
| 句式轮换 | **写之前读上一期 `data\wechat-drafts\<昨日>.json` 的 `title`，钩子必须换一种结构**（昨天是「A，B」两段式，今天就用单句或带转折的） |
| 校验 | `probe-wechat-html.mjs` M2 拦截旧模板、缺【日报 日期】后缀与「正文重复标题」；`publish-wechat-draft.mjs` 在 `title` 缺失或缺日期后缀时**直接失败**（2026-10-29 起不再回退模板） |

示例（同一份真实内容的三种写法，任选其一，但相邻两期钩子不得同构）：

- 光伏 12 项技术拟被列入出口管制【日报 2026-10-29】
- 出口管制名单里的 12 项光伏技术，意味着什么【日报 2026-10-29】
- 今天 4 条政策，光伏出口管制最要紧【日报 2026-10-29】

### 8.5.1 执行步骤

**步骤 0**：`sc_status` 前置检查；不可用 → §8 汇报终止。

**步骤 0.5 — classify 增量（PLAN-DAILY-UPGRADE，必须在步骤 1 之前）**：按 §4 全流程执行
一轮：`export-direction-batch.mjs --limit 400`（只导 IS NULL）→ 会话按 4.2/4.3 分类 →
`apply-directions.mjs` 写回 → 核对 invalid=0。日增量通常 40-60 篇一轮完成；exported=0
空跑属正常。先分类再导出，日报素材才能带上方向（文献清单不再归「暂未分类」组）。

**步骤 1 — 导出昨日素材**（`sc_run`）：

```
Set-Location 'E:\SC\文献推送'; & .runtime\node\node.exe scripts\export-wechat-daily.mjs
```

默认导出北京时间昨日业务日（`--date YYYY-MM-DD` 可显式指定）。空窗口（total=0）
≠ 失败：清单板块如实写「今日无新入库文献」，继续步骤 2-5（只有头部卡与资讯的日报合法）。

**步骤 2 — 下载素材**：`sc_download` 远端 `文献推送/data/wechat-daily-batch-<昨日>.json`
→ 本地 `_ai-jobs-work\wechat-daily\batch-<昨日>.json`，Read 分段完整读完（禁止跳读）。

**步骤 3 — 资讯与写作**：

- Read 本地 `data\daily-news\<昨日>.md`（不存在则资讯板块如实留空，不得编造补位）；
- 精选 5-8 篇（素材 ≤8 篇时全选）撰写三字段速评：契约同 §5.5（对象≤30 / 方法≤40 /
  结论≤50 字）；素材带 priorBrief 的文献**逐字复用、禁止改写**；
- **精选优先级（期刊从高到低，2026-10-09 起）**：IEEE Transactions on Smart Grid（TSG）
  > IEEE Transactions on Power Systems（TPS）> IEEE Transactions on Sustainable Energy（TSE）
  > 电力系统自动化（电自）> 中国电机工程学报（电机）> Applied Energy（AE）> Energy；
  同级多篇时按方向分散选取；高优先级刊不足 5 篇时按下一位顺序顺延补足；
- 资讯收录：当日**全部**政策标准与**全部**重点新闻（与网站同源同量，不设数量精选、不得因条目多而省略），逐条概览式短句改写并 `**加粗**` 关键数字；
  来源与数字必须与每日资讯原文一致，不得编造。

**步骤 4 — 写 issue JSON**：Write `data\wechat-drafts\<期号日>.json`（期号日 = 今天，
报道窗口 = 昨日）。结构契约：`{version, date, title, digest≤60字, news{policy、general（全量收录，与网页昨日文件逐条对应；渲染器防守上限 policy 10 / general 15）}, briefs 1-8 条, listing[], siteUrl}`（intro 字段已废弃——头部数量统计与概览由渲染器自动生成）；
**`title` 必填且每期自拟**（内容钩子 12–24 字 + 固定后缀【日报 YYYY-MM-DD】——抓当天最有传播力的 1–2 条，钩子内禁「速递/第 N 期」与标题党词、禁「电研新视界 日报｜日期」旧模板；写之前先读上一期 JSON 的 title，钩子句式必须与上期不同。规则见 §8.5.0）；
**listing = 报道窗口内新入库文献的全量清单**（含未入选速评的篇目，按方向分组，每篇 title+journal）——头部「新入库文献 N 篇」与 ④ 区块标题「今日新入库文献（N 篇）」均取自 listing 条目合计，briefs 才是精选子集；listing 误放精选子集会把头部错写成「N 篇=N 篇」（教训 2026-10-28）。渲染器硬校验，违规清单见步骤 5。

**步骤 4.5 — 交稿自评（A1-3，2026-10-08）**：进入渲染前对照自查——①每篇速评三段
  齐全且逐条满足 §5.5 字数上限；②不撰写导读文字（头部数量统计与概览由渲染器自动生成）；③资讯条目与网页昨日文件逐条
  对应（政策标准与重点新闻条数须一一对齐、不得遗漏）；④所有数字与素材/资讯原文一致，
  不得编造；⑤无「首次 / 重大突破 / 国际领先 / 填补空白」等夸大措辞；⑥`title` 已按 §8.5.0
  自拟（钩子 12–24 字、无禁词、含【日报 日期】后缀、钩子句式与上期不同构）。发现不符先改
  JSON 再进步骤 5（探针管结构，本步管措辞，两道闸门互补）。

**步骤 5 — 渲染与探针**（本地）：

```
node scripts/wechat-render.mjs --in data/wechat-drafts/<期号日>.json
node scripts/probe-wechat-html.mjs --in data/wechat-drafts/<期号日>.html --issue data/wechat-drafts/<期号日>.json
```

渲染器校验失败 → 修正 JSON 重跑；**禁止手改 HTML**。探针 0 违规才算完成。

**步骤 5.5 — L1 草稿写入（.env 已配 WECHAT_APPID/WECHAT_SECRET 时执行；M4 实测 2026-10-08 通过）**：

```
node scripts/publish-wechat-draft.mjs --in data/wechat-drafts/<期号日>.json
```

成功输出草稿 media_id（封面由脚本**按期号日自动生成（含日期）并上传永久素材**，按日缓存
`data\wechat-drafts\cover-thumb.json`，同日重跑复用；**同名草稿已存在时改为 draft/update 原地更新，不产生重复草稿**）；失败（48001 无权限 / 40164 白名单 /
40001 密钥）按脚本提示如实汇报，**不回滚产物**，L0 路径不受影响；
未配置凭据时跳过本步（L0 档）。

**步骤 6 — 收尾**：清理 `_ai-jobs-work\wechat-daily\` 下临时自测文件；按 8.5.2 汇报。
人工发布按 `scripts\sop-wechat-publish.md` 执行（L1：草稿箱 → 订阅号助手 App 点发表；L0：网页端粘贴）——本 job 不做最后群发。

### 8.5.2 汇报

```
【公众号日报】<期号日>
- 素材：昨日（<日期>）新入库 N 篇，精选 k 篇写速评（复用 priorBrief R 篇）
- 资讯：政策标准 P 条 / 新闻 M 条（来源 data\daily-news\<昨日>.md）
- 产物：data\wechat-drafts\<期号日>.{json,html}，探针 0 违规
- 草稿：media_id=<id> / 未配置凭据跳过（L0） / 失败原因
- 异常与处理：无 / 描述
```

## 8.6 job: daily-digest（研究速览「当日新增」AI 日报，写库）

> 渠道设计真值 = `PLAN-DAILY-DIGEST.md`。与 §5/§6/§6.5 同一条写库链路，区别只有三点：
> 窗口 = 单个北京业务日；`kind = 'daily'`；无方向维度（`direction` 恒为 `null`）。
> **并入每日 06:30 作业**，排在 wechat-daily 之前——先落库站内日报，公众号日报随后复用
> 同一批素材，两者互不干扰。

**步骤 1 — 导出当日素材**（`sc_run`）：

```
Set-Location 'E:\SC\文献推送'; & .runtime\node\node.exe scripts\export-report-batch.mjs --kind daily
```

默认窗口 = 北京时间**今天**（`--date YYYY-MM-DD` 可显式指定，用于补跑历史某天）。输出摘要含
`exported / kind / period / total / prev_total / top=[...]`，素材落 `data\report-batch-daily-<日期>.json`。
抓取作业 05:00 已跑完，06:30 取「今天」即当日新增全量。**空窗口（total=0）跳过本 job**——
无新增不写日报（前端「当日新增」页自然走空态），不要写一份空报告入库。

**步骤 2 — 下载通读**：`sc_download` 素材 → 本地 `_ai-jobs-work\batch-daily-<日期>.json`，
分段完整读完（日增量 4–60 篇，通常一轮读完，不必压缩视图）。

**步骤 2.5 — 全文获取（2026-10-16 新增，用户要求：不再只依据摘要）**：

当日新增文献**必须先下载全文再写分析**，用已打通的 `webvpn-paper-fetch` skill：

```bash
S="C:/Users/admin/.workbuddy/skills/webvpn-paper-fetch/scripts"
# ① 会话检查（过期则登录；凭据见 user-level MEMORY.md，勿写入仓库）
node "$S/wv.mjs" status || node "$S/wv.mjs" login
# ② 批量下载：把素材里的 DOI 逐行写入 dois.txt
node "$S/wv.mjs" batch dois.txt -o <工作目录>/papers
# ③ 生成分析素材包（全文 + 分析要求 + 输出 JSON schema）
node "$S/read.mjs" batch <工作目录>/papers -o <工作目录>/inputs
# ④ 分析完成后清理 PDF（PDF 只是中间产物，不长期保存）
node "$S/read.mjs" cleanup --days 0
```

**中文刊**（万方，无 DOI 或 DOI 不可下载者）改用 `node "$S/wanfang-fetch.mjs" --list titles.txt -o <工作目录>/papers`。

**逐篇完整读完** `inputs/*.md`（内含全文，不截断），据此撰写分析与速评。
下载失败的文献降级为摘要分析，并在正文中如实标注「该篇未获取全文」。

> ⚠️ **覆盖要求（2026-10-24 用户规则，替代原「>30 篇只做重点」性能约束）**：
> 当日**每一篇**文献都必须有「核心创新点」（`articles.deep_analysis`），**全部下载全文并逐篇完整阅读**，不做重点子集。
> 篇数大时可分多轮会话完成，但当日 daily-digest 写库闭环（apply-report + apply-deep-analysis）以 deep_analysis 覆盖数 = 当日 total 为完成标准。
> 个别下载失败的文献允许降级：基于摘要撰写创新点，并在该条 innovations 的 points 中如实标注「全文获取失败，基于摘要」。

**步骤 2.6 — 写回「核心创新点」（2026-10-17 新增，必做）**：

> ⚠️ **速评与创新点是两条独立的写库路径，只做其一站上就会缺内容**：
> · 速评 → `ai_reports.stats_json.paperBriefs`（走步骤 4 的 `apply-report.mjs`）
> · **创新点 → `articles.deep_analysis` + `articles.figure_path`（走本步骤的 `apply-deep-analysis.mjs`）**
> 2026-10-17 的教训：作业按步骤 2.5 读了全文、也写了速评，但**没有写创新点**，
> 结果站上「核心创新点」区块全空 —— 因为当时 RUNBOOK 只定义了「读全文」这个输入侧动作，
> 没定义产出侧。**本步骤与步骤 4 必须都执行。**

① **提取配图**（摘要图 / 技术路线图；无合适配图可跳过）：

```bash
# 必须用 skill 的 fig1.py（v4：图注栏区域生长，合并全部子图/矢量簇）。
# ⚠️ 不要再用「第一张内嵌图的 bbox」——多面板/跨栏 Fig.1 只会截到一个子图，
#    2026-10-27 用户反馈「24 号很多摘要图不全」的根因就是旧 v1–v3 只取局部图对象。
python "$S/fig1.py" figs <id>=papers/x.pdf [<id2>=papers/y.pdf ...]
# 输出 figs/<id>.png 与 figs/_fig1-report.json（status=ok/no-fig/bad-pdf + clip）
```

**配图自检（必做）**：抽 5–10 张查看，确认①没有只截到半张图/缺面板；②没有带入正文、标题、作者或邻栏表格。批量时生成 contact sheet 目检更快；发现 `clip` 贴边或尺寸异常（宽<120px / 高<80px）时人工复核。

② **写分析结果 JSON**（数组，每篇一条），存 `data\deep-analysis-inbox.json`：

```json
[
  { "id": 138789, "figure": "138789.png", "pages": 17, "chars": 86243,
    "innovations": [ { "title": "一句话概括", "points": ["支撑论据（可用 <b> 强调）"], "value": "价值句" } ],
    "method": { "object": "…", "theory": "…", "control": "…", "validation": "…" } }
]
```

纪律：`innovations` **至少 1 条**（通常 2–3 条）；`points` 支持 `<b>` 强调（前端按富文本渲染）；
**只写全文里有的内容，不得编造**；`figure` 无图时省略。

③ **配图**放 `<工作目录>/figs/`，与 JSON 一并 `sc_upload` 到远端
`data\deep-analysis-inbox.json` 与 `data\deep-analysis-figs\`，然后写库：

```
Set-Location 'E:\SC\文献推送'; & .runtime\node\node.exe scripts\apply-deep-analysis.mjs --in data\deep-analysis-inbox.json --figdir data\deep-analysis-figs
```

核对 **`updated` = 当日需写回篇数、`invalid` = 0**；配图缺失只会提示跳过配图、不阻塞分析落库。

④ **自检**（必做）：写完后查一句确认落库成功：

```
Set-Location 'E:\SC\文献推送'; $py='E:\SC\.sc-remote-runner\python-env\Scripts\python.exe'; \
  "import sqlite3;c=sqlite3.connect(r'data/literature.sqlite');\
   print(c.execute(\"SELECT COUNT(*) FROM articles WHERE substr(COALESCE(first_public_at,published_at,first_seen_at),1,10)=date('now','+8 hours') AND deep_analysis IS NOT NULL AND deep_analysis<>''\").fetchone()[0])" | & $py -
```

**步骤 3 — 撰写**（正文结构即 UI：前端按小节渲染）：

```markdown
# 当日新增文献分析 · {periodStart}（{total} 篇）

## 当日分析摘要
<2–5 句：主题主线 / 方法取向 / 结论强度 / 与昨日对比（stats.previous 可用）>
```

> **正文只写「## 当日分析摘要」一节，不要写标题下的总述句。**（2026-10-16 用户需求）
> 篇数、来源期刊、方向分布这些数字已由页内「来源与分类分布」的两组标签直接展示，
> 正文再复述一遍属于重复信息；站上前端也只渲染"当日分析摘要"小节，标题外的段落会被丢弃。

> 「重点关注」板块已于 2026-10-15 下线（用户需求）：当日文献在站上按三字段速评卡**全量**
> 展示，再单列一份子集只会重复同样的卡。**不要再写 `## 重点关注` 小节，也不要提供 `focusIds`。**

**步骤 4 — 写回**（`sc_upload` 结果到 `data\report-inbox.json`，**必须同时给 --export**）：

```
Set-Location 'E:\SC\文献推送'; & .runtime\node\node.exe scripts\apply-report.mjs --export data\report-batch-daily-<日期>.json --file data\report-inbox.json
```

**步骤 5 — 核对**：`updated=1 invalid=0`；`briefCount` = 当日篇数。
`invalid` 的 errors 会说明原因（幻觉 id / 头字段不一致 / 速评漏篇 / 字段超长），修正重传；
连续两次失败 → §8。

**结果 JSON 契约**（同 §5.4，无 `focusIds`）：

```json
{
  "exportedAt": "<原样带回素材顶层 exportedAt>",
  "kind": "daily",
  "periodStart": "<原样带回，与 periodEnd 相同>",
  "periodEnd": "<原样带回>",
  "direction": null,
  "contentMd": "<步骤 3 全文>",
  "topTopics": ["共享储能", "配电网重构"],
  "paperBriefs": [ { "id": 12345, "object": "…", "method": "…", "finding": "…" } ]
}
```

**纪律（硬性）**：
1. `kind / periodStart / periodEnd / exportedAt` 四个头字段与素材逐字一致，`direction` 恒为 `null`。
2. `paperBriefs` **必须覆盖当日批次每一篇**（缺一篇整批拒收），三字段按 §5.5 上限（对象 ≤30 / 方法 ≤40 / 结论 ≤50 字）。
3. **不写「重点关注」**：`contentMd` 里不要出现 `## 重点关注` 小节，结果 JSON 也不要带 `focusIds`
   （该字段与 highlightIds 一样已下线；apply 侧仍容错接受，写了不会拒收，但站上不再展示）。
4. `highlightIds` 仍是保留字段，一律填 `[]`（2026-10-13 起永久下线）。
5. `contentMd` 非空且 ≤20 000 字符；**标题下不写总述句**（数字重复），只写「当日分析摘要」小节；数字抄素材；**评语须依据步骤 2.5 下载的全文（未获取到全文的文献才退回摘要，并在其速评中如实标注）**，全文与摘要都没写的不得编造。
6. 素材带 `priorBrief` 的文献三字段逐字复用（同日重跑、或该篇已在本周周报写过速评时）。
7. 正文内所有 `[id]` 必须属于当日导出批次（写错会指向错误文献）。

### 8.6.2 汇报

```
【站内当日新增】<日期>
- 素材：当日新入库 N 篇（含待方向标注 M 篇），priorBrief 命中 R 篇
- 写回：kind=daily period=<日期> briefCount=N invalid=0
- 跳过：total=0（无新增，未写日报） / 未跳过
- 异常与处理：无 / 描述
```

## 8.7 job: 文献专题选题（每天 10:00，只选题不制作）

> 设计真值 = `DESIGN-WECHAT-TRANS-COLUMN.md` v4。与 §8.5/§8.6 的区别：**本 job 只产出选题单，不写库、不渲染、不发布**。
> 制作是另一条链路（用户选定后手动触发，见 §8.7.2）。

### 8.7.1 选题（每天 09:00 自动跑）

**步骤 0 — 查队列积压**（本地）：

```
node scripts/topic-queue.mjs list
```

记下 `status=queued` 的条数 N，据此决定本次出几组：N ≥ 3 只出 2 组并提示先清队列；N = 1–2 正常出 4 组但注明积压；N = 0 正常出 4 组。

**步骤 1 — 全库导出 + 主题聚簇**（`sc_run`，超时给 180 秒）：

```
Set-Location 'E:\SC\文献推送'; & .runtime\node\node.exe scripts\export-topic-candidates.mjs --days 0 --limit 5000 --cluster --cluster-limit 80
```

`--days 0` = **全库不设时间窗**（专题可能跨越数年，按月切会切断线索）。排序用 `first_seen_at`（`first_public_at` 对 TSE 有系统性偏差）；排除 5 个方向 + `other`；**不按 `deep_analysis` 过滤**。

输出三个文件：`topic-candidates.json`（含摘要，约 1.4 MB）、`topic-candidates-compact.json`（标题级）、`topic-clusters.json`（约 115 KB）。

**聚簇规则**（脚本内实现）：标题的英文 bigram 与中文 2-gram 建倒排；词频 ≥3 且单簇 ≤25 篇；领域泛词对（power system / distribution network / smart grid / electric vehicle 等）剔除，单复数归一；重叠 >60% 的簇去重；按「是否短语 → IEEE Trans 篇数 → 簇大小」排序，输出 80 个簇。

`total < 200` 或 `clusterCount = 0` → 如实汇报异常并结束。

**步骤 2 — 下载**：`sc_download` 到 `_ai-jobs-work\topics\`：
· `topic-clusters.json` → **完整读完**，这是粗筛依据
· `topic-candidates.json` → **不要读**，只供步骤 4 按 id 取摘要

**步骤 3 — 粗筛**：从 80 个簇里挑 8–10 个能成专题的。判据：term 是「问题/技术路线」不是学科名；`transRatio` 高者优先；簇间主题不重叠（`state estimation` 与 `system state` 只取其一）；term 只是半个短语、看不出具体问题的剔除。

**步骤 4 — 细选**（关键）：对每个候选簇按 id 读摘要——

```
node scripts\topic-lookup.mjs --ids <簇内全部 id，逗号分隔> --chars 320
```

逐篇判断是否真属于同一专题：优先 IEEE Transactions；同簇里只共享一个泛词的剔掉；**篇数不设上限，3–8 篇为宜**，超过 8 篇说明主题太宽（收窄主题或拆两组）；凑不成专题的簇放弃，从备选簇补。

**步骤 5 — 组 4 组**：互不重叠、至少覆盖 3 个方向；`recommended.json` 里 `picked=true` 的不再推荐，推荐满 3 次未 picked 的沉底。

**步骤 6 — 写选题单**：`data\wechat-topics\<日期>.json` + `.md`，再过 §2.1 去 AI 味（双层流程内嵌执行，只改评述，不动论文标题）。
JSON 字段固定：`{ date, window:{days:0,total}, excluded:[], groups:[{ index, topic, directions:[], articleIds:[], why }] }` —— 队列脚本按这个结构读。

**步骤 7 — 贴图文字兜底**（每次必跑）：

```
node scripts\wechat-poster.mjs --all
```

扫描 `data\wechat-topics\*-issue*.json`（正式期稿，自动排除 `.bak`/`.humanizer*` 等中间版本），为缺 `poster` 字段的期稿生成兜底 `.poster.txt`。脚本报「缺 poster 字段」或「字数超上限」时，在汇报里点名是哪一期。

**步骤 8 — 汇报**：队列积压 N、全库总量、各方向数量、簇总数、各组专题名与篇数、贴图文字状态。

### 8.7.2 制作（用户回复「选 ②」后手动跑）

**多选与排队**：用户回「选 ② ④」时，第一个立即做，其余入队：

```
node scripts/topic-queue.mjs add --from data\wechat-topics\<日期>.json --groups 4
```

入队会把对应文章在 `recommended.json` 里标 `picked=true`，后续不再推荐。队列状态：`queued → building → drafted → published`。

```
① 选题来源二选一：
   · 用户指定组号 → 读 data\wechat-topics\<日期>.json 取该组
   · 用户说「做队列」→ node scripts/topic-queue.mjs take（取队首并标 building）
② 3–4 篇逐篇：有 deep_analysis 直接用；没有的下载全文补做
   （复用 §8.6 步骤 2.5/2.6 链路：wv.mjs batch → read.mjs → fig1.py → apply-deep-analysis.mjs）
③ 写期稿 JSON：专题名 / 导语 / 每篇一句话判断 + 局限 + 可迁移
   创新点与技路线从库里逐字复制，禁止手抄改写
④ 去 AI 味（§2.1）：只改导语、一句话判断、局限、可迁移四处
⑤ node scripts\wechat-topic-render.mjs --in <期稿.json>
⑥ node scripts\probe-wechat-topic.mjs --in <期稿.html> --issue <期稿.json>
⑦ node scripts\upload-wechat-image.mjs --in <期稿.json>   ← 摘要图换 mmbiz URL
⑧ 重跑 ⑤（图片地址变了要重渲染）+ ⑥
⑨ 贴图配套文字（每期必出）：图由系统生成（标题图 + 每篇摘要图），文字是图文对照说明：
   期稿 JSON 写 poster 字段：lead 一句话 ≤40 字（这期讲什么）+ items 与 papers 一一对应（每条 ≤30 字，写结论不写主题）
   node scripts\wechat-poster.mjs --in <期稿.json>
   → <期稿>.poster.txt（总 ≤200 字）
   编号 ①②③④ 与「配图 N」由脚本生成，手写会错位；配图 N = 第 N 篇的摘要图（不含标题图）
⑩ node scripts\publish-wechat-draft.mjs --in <期稿.json>
   → 单条 draft/add 写入专题草稿（脚本按 JSON 里有无 papers 自动识别类型与封面）
   → **脚本到此为止，不群发**：发不发、用群发还是后台「发布」、要不要和日报合成
     一条多图文（--extra），全部由人决定
⑪ 若这一期来自队列：node scripts\topic-queue.mjs done --id <队列id> --issue <期稿.json>
   → 标记 drafted 并回填期稿路径；人工发布后回填 status=published（可选）
```

**红线**：
- ⑦ 不跑，⑨ 会直接报 `IMG` 错误拒绝发布（正文里是本地路径，手机上是白框）
- 创新点/技术路线逐字复用，去 AI 味只作用于评述文字
- 双图文重跑时脚本会先 `draft/delete` 再 `draft/add`（`draft/update` 无法追加条目），草稿未发布，删除无风险
- 队列里 `picked=true` 的文章不得再出现在新选题单里

### 8.7.3 汇报

```
【文献专题选题】<日期>
- 池子：近 N 天 M 篇（扩窗：是/否），方向分布 …
- 选题：4 组（各组专题名 + 篇数）
- 去 AI 味：改动 K 处，主要模式族 …
```

## 9. 附录 A · 定时任务配置与提示词

| 项 | 周作业 | 月作业 | 公众号日报 |
|---|---|---|---|
| 名称 | 文献 AI 周作业（分类+速览） | 文献 AI 月作业（月度趋势） | 电气前沿速递公众号日报 |
| 模型 | Hy3 | Hy3 | Hy3 |
| 频率 | 每周日 23:00 | 每月 1 日 03:00 | 每天 06:30 |
| 关联目录 | 文献推送（项目根） | 文献推送（项目根） | 文献推送（项目根） |
| 权限 | 允许完全访问 | 允许完全访问 | 允许完全访问 |

**周作业提示词（原文粘贴，与定时任务「周」逐字一致）：**

```
执行 literature-ai-jobs skill（若未加载，通读项目根目录 RUNBOOK-AI-JOBS.md），运行「周作业」三步：① classify——按手册第 4 节完成本周 AI 方向分类（每轮≤400 篇；每日 06:30 日报任务通常已清空增量，exported=0 空跑属正常，非故障）；② digest——按第 5 节生成全方向总览周报；③ digest-direction——按第 6.5 节为本期所有非零方向逐个生成方向专报（每个方向一份 export+结果 JSON，全部写入本地 _ai-jobs-work\direction-inbox\ 后整目录上传，用 apply-reports-bulk.mjs --dir data\direction-inbox 批量写回）。写回前按手册第 7 节完成本地质量自检（[id] ⊆ 批次、五个头字段逐字一致、paperBriefs 覆盖与三字段字数上限）。最后按第 8 节模板汇报。全程遵守第 2 节红线。sc-remote 不可用或脚本缺失时汇报终止，不做变通。
```

**月作业提示词（原文粘贴，与定时任务「月」逐字一致）：**

```
执行 literature-ai-jobs skill（若未加载，通读项目根目录 RUNBOOK-AI-JOBS.md），运行「月作业」两步：① report——按手册第 6 节导出上月完整自然月素材（--kind monthly --month 上月）生成全方向总览月报（含环比与新兴主题）；② 逐方向专报——按第 6.5 节为上月所有非零方向逐个生成月度方向专报（主题聚类形式）。素材中带 priorBrief 的文献，其三字段速评必须逐字复用、禁止改写，仅对无 priorBrief 的文献新写（手册第 5.5/6 节复用规则）。全部结果写入 _ai-jobs-work\direction-inbox\ 后整目录上传，用 apply-reports-bulk.mjs --dir data\direction-inbox 批量写回。写回前按第 7 节自检（含 priorBrief 复用一致性）。最后按第 8 节模板汇报。全程遵守第 2 节红线。sc-remote 不可用或脚本缺失时汇报终止，不做变通。
```

**每日作业提示词（原文粘贴，与定时任务「每日 06:30」逐字一致；该任务同时产出站内「当日新增」日报与公众号日报）：**

```
执行 literature-ai-jobs skill（若未加载，通读项目根目录 RUNBOOK-AI-JOBS.md），运行「每日作业」：⓪ 先按第 4 节执行 classify 增量一轮（export-direction-batch.mjs --limit 400 只导未分类 → 会话按 4.2/4.3 分类 → apply-directions.mjs 写回，invalid 必须=0；exported=0 空跑属正常）——必须在导出任何素材之前完成，使素材带方向；⓪.5 按第 8.6 节执行 job: daily-digest（站内研究速览「当日新增」AI 日报，写库）：sc_run 远端跑 scripts\export-report-batch.mjs --kind daily 导出当日素材（默认今天），sc_download 到 _ai-jobs-work\ 并完整读完；**再按 8.6 节步骤 2.5 用 webvpn-paper-fetch skill 下载当日文献全文**（node "$S/wv.mjs" batch dois.txt 下载 → node "$S/read.mjs" batch 生成分析素材包 → 逐篇完整读完全文；中文刊改用 wanfang-fetch.mjs；下载失败者降级用摘要并在正文如实标注；分析完成后 read.mjs cleanup 清理 PDF），按 8.6 节结构写 contentMd（**只写「## 当日分析摘要」小节，标题下不写总述句**——篇数/来源/方向分布页内标签已有，重复；也不写「重点关注」）与结果 JSON（paperBriefs 必须覆盖当日每一篇、三字段按第 5.5 节上限；不带 focusIds；highlightIds 仍填 []），sc_upload 后跑 scripts\apply-report.mjs --export data\report-batch-daily-<日期>.json --file data\report-inbox.json，核对 updated=1 invalid=0；**再按 8.6 节步骤 2.6 写回「核心创新点」（必做，漏做则站上创新点区块全空）**：从 PDF 提取配图（⚠️ 必须用 get_image_rects + get_pixmap(clip=...) 区域渲染，直接 extract_image 会得到品红底的 CMYK 图）→ 写 data\deep-analysis-inbox.json（每条含 id / figure / pages / chars / innovations[≥1 条，points 可用 <b> 强调] / method）→ sc_upload JSON 与配图到远端后跑 scripts\apply-deep-analysis.mjs --in data\deep-analysis-inbox.json --figdir data\deep-analysis-figs，核对 updated=当日篇数、invalid=0；**空窗口（total=0）跳过本步、不写空报告**；① sc_run 远端跑 scripts\export-wechat-daily.mjs 导出昨日新入库文献素材（空窗口≠失败，如实写「今日无新入库文献」），sc_download 到 _ai-jobs-work\wechat-daily\ 并 Read 完整读完；② Read 本地 data\daily-news\<昨日>.md（不存在则资讯板块如实留空）；③ 精选 5-8 篇写三字段速评（契约同第 5.5 节：对象≤30/方法≤40/结论≤50 字，priorBrief 逐字复用禁止改写；精选优先级（期刊从高到低）：TSG > TPS > TSE > 电力系统自动化 > 中国电机工程学报 > Applied Energy > Energy，同级多篇按方向分散，高优先级不足 5 篇按序顺延），资讯收录当日全部政策标准与全部重点新闻（与网站同源同量，不得因条目多而省略），逐条概览式短句改写、**加粗**关键数字、不得编造；④ Write data\wechat-drafts\<期号日>.json（期号日=今天，报道窗口=昨日；**intro 字段不再需要**——头部数量统计与概览由渲染器自动生成；**title 必填：自拟钩子+【日报 YYYY-MM-DD】后缀（8.5.0）**）；④.5 交稿自评：对照自查——每篇速评三段齐全且逐条满足 5.5 字数上限、不撰写导读文字（头部数量统计与概览由渲染器自动生成）、资讯条目与网页昨日文件逐条对应（政策标准与重点新闻条数须一一对齐、不得遗漏）、所有数字与素材/资讯原文一致不得编造、无「首次/重大突破/国际领先/填补空白」等夸大措辞、标题按 8.5.0 自拟含【日报 日期】后缀且钩子句式与上期不同构，发现不符先改 JSON 再进 ⑤；⑤ 本地跑 scripts\wechat-render.mjs 渲染 + scripts\probe-wechat-html.mjs 探针，0 违规才算完成，校验失败修正 JSON 重跑、禁止手改 HTML；⑤.5 若 .env 已配置 WECHAT_APPID/WECHAT_SECRET，本地跑 scripts\publish-wechat-draft.mjs --in data\wechat-drafts\<期号日>.json 自动写入公众号草稿箱（失败按脚本提示如实汇报、不影响产物已完成，未配置凭据则跳过）；⑥ 清理临时文件并按第 8.5.2 节模板汇报。本 job 不写数据库、不做最后群发（草稿写入见⑤.5，人工按 scripts\sop-wechat-publish.md 点发表）。全程遵守第 2 节红线。sc-remote 不可用或脚本缺失时汇报终止，不做变通。
```

## 10. 附录 B · 常见问题

- **导出为何按 id 倒序？** 新文章优先，周任务一轮覆盖增量。
- **manual 改判？** 前端管理员改判写 `direction_source='manual'`，永不被 AI 覆盖。
- **方向体系调整？** 改 `server/directions.js` + 本手册 4.2 + `src/lib/directions.js` 三处。
- **「待方向标注」？** 素材 stats.unclassified = 窗口内方向为 NULL 的文章数，如实写明，不得归入任何方向。
- **重跑安全吗？** classify 幂等跳过已分类；报告 UNIQUE(kind,period_start,direction) 先删后插覆盖同期。
- **为什么速评行必须带 [id]？** 前端把行渲染成该 id 的可点击文献卡（编号隐藏、邮件剥离）；不带 [id] 的行只是文字，用户无法点击。
- **本月新方向只有 1 篇也要专报吗？** 要——全方向无门槛，单篇专报写「本方向本期新增 1 篇」+ 该篇速评即可。
- **月报为什么复用周报速评？** 当月大部分文献的速评已在各周周报里写过（周方向专报全覆盖 + 总览精选），月报重新总结一遍既重复消耗会话时长、又可能与周报口径漂移；导出脚本把已入库周报的 paperBriefs 注入素材 `priorBrief` 字段，月报逐字照抄即可，只新写周报漏掉的文献（跨月边界、当期周作业未跑等）。
- **priorBrief 会与正文速评行冲突吗？** 不会——正文速评行（对象/方法/结论）同样取自 priorBrief 原文，两边天然同源一致；新写文献的两边由同一次写作产出，保持一致即可。
- **三字段速评（对象/方法/结论）怎么写？** 只用素材摘要里的信息：对象=研究了什么系统/装置/场景；方法=用了什么方法/模型/数据（写具体名词）；结论=得到什么结果或指标。摘要没写的不编；「优化/分析」这类空词不允许单独作为方法；纯综述的方法写「综述＋覆盖范围」。
