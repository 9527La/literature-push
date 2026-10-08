# RUNBOOK-AI-JOBS（根目录镜像）

> 本文件是 .workbuddy/skills/literature-ai-jobs/SKILL.md 的逐字镜像：定时会话未拾取项目级 skill 时，以本文为执行依据。两文件必须同版本维护（改动一处即同步另一处）。

---
name: literature-ai-jobs
description: 文献推送站（E:\SC\文献推送）全部 AI 批量作业的统一执行入口。触发词：文献 AI 作业、文献 AI 周作业、文献 AI 月作业、跑方向分类、生成周报、生成月报、方向专报。经 sc-remote 在远端执行「导出素材 → 本会话生成 → 写回数据库」循环，全程零外部 API、零费用。
---

# 文献推送 · AI 批量作业执行手册（唯一执行依据）

> **本手册是所有文献 AI 作业的唯一执行依据**；执行会话动手前必须完整通读本文。
> 版本：2026-10-08 v6（wechat-daily prompt 增加步骤 ④.5 交稿自评：三段/字数/数字一致/禁夸大措辞，§8.5.1 同步）
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

## 3. 作业调度

| 触发 | 作业序列 | 说明 |
|---|---|---|
| 每周日 23:00 / 「文献 AI 周作业」 | **classify → digest → 逐方向专报** | 专报依赖总览批次与分类完成，顺序不可颠倒 |
| 每月 1 日 03:00 / 「文献 AI 月作业」 | **report → 逐方向专报** | 覆盖上一个完整自然月；速评优先复用周报（见 §6 复用规则），只新写未覆盖文献 |
| 每日 06:30 / 「电气前沿速递公众号日报」 | **classify 增量 → wechat-daily** | 独立渠道不写库（§8.5）：classify 使素材带方向，产出 data\wechat-drafts\ 存档，草稿箱自动写入，发布由人工完成 |
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

## 本周值得注意
- [12345] **{论文标题}**（{期刊}）：{≤40 字推荐理由，只依据素材摘要}
（3–5 篇；**行首必须带 `[id] `**——站内编号自动隐藏、整行可点击弹文献卡片，
  邮件自动剥离编号；id 记入 highlightIds）

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
  "highlightIds": [4021, 3988],
  "topTopics": ["共享储能", "配电网重构"],
  "paperBriefs": [ { "id": 4021, "object": "…", "method": "…", "finding": "…" } ]
}
```

apply 硬校验（整批拒收）：四个头字段与素材逐字一致；contentMd 非空 ≤20 000 字符；highlightIds ⊆ 素材 articles 的 id 且 ≤8；topTopics ≤12 条（每条 ≤30 字）；paperBriefs 按 5.5 校验（总览可选、仅精选条目）。

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
- **总览周报/月报：仅 highlightIds 精选条目附 brief**（ids ⊆ highlightIds，出现精选之外的 id 拒收）；
- 正文速评行与 paperBriefs 必须同源一致：同一 id 的对象/方法/结论两边说的是同一件事。
- **速评复用（priorBrief，v4）**：导出素材中带 `priorBrief` 字段的文献 = 该篇已在本期周报（总览精选或周方向专报）写过三字段速评。月报/月度专报**必须逐字复用**其 object/method/finding（原样照抄，禁止改写、禁止重新总结），只有无 priorBrief 的文献才新写；周报正常首跑几乎无命中（当周都是新文献），重跑同期时整期可复用。

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

## 本月值得注意
- [12345] **{标题}**（{期刊}）：{理由}
（3–5 篇，行首 [id] 前缀同 5.2）
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
## 值得精读
- [12345] **{标题}**（{期刊}）：{推荐理由}
（2–3 篇，同样 [id] 前缀；id 记入 highlightIds）
```

**月度专报结构**（主题聚类形式）：

```markdown
# {方向名} · 月度趋势 {periodStart} ~ {periodEnd}（N 篇，上月 M，±K）
<1–2 句总评>
## 主题聚类速评
### 主题 A（约 n 篇）
- [12345] **{标题/概括}**（{期刊}）｜对象：…｜方法：…｜结论：…
（逐条带 [id]，覆盖当月该方向全部或代表性文献）
### 主题 B（…）
## 方法观察
（可选节）
```

**结果 JSON**：同 5.4 契约 + 顶层 `"direction": "<key>"`（与导出批次逐字一致）；`highlightIds` 2–3 个；
`paperBriefs` **必须覆盖该方向批次内每一篇**（5.5 契约，缺一篇整批拒收）。

**步骤 4 — 批量写回**：全部专报结果 Write 到本地 `_ai-jobs-work\direction-inbox\`（文件名如 `d-storage.json` / `dm-202608-storage.json`），整目录 `sc_sync_upload` 到远端 `data\direction-inbox`，然后：

```
Set-Location 'E:\\SC\\文献推送'; & .runtime\node\node.exe scripts\apply-reports-bulk.mjs --dir data\\direction-inbox
```

（bulk 按文件名自动匹配批次：周 `report-batch-d-<key>.json`、月 `report-batch-d-<YYYY-MM>-<key>.json`。）

**纪律（硬性）**：
1. 行内所有 `[id]`（含正文速评，不只 highlightIds）必须属于该方向导出批次——前端整行会渲染成该 id 的可点击卡片，写错会指向错误文献。
2. exportedAt/kind/periodStart/periodEnd/direction 五个头字段与素材逐字一致。
3. contentMd 非空 ≤20 000 字符；highlightIds ⊆ 批次 id 且 ≤8；topTopics ≤12。
4. 数字抄素材；评语只依据摘要。
5. paperBriefs 按 5.5 规范：三字段非空、object ≤30 / method ≤40 / finding ≤50 字；方法禁空泛词、结论禁编造；与正文速评行同源一致。
6. priorBrief 复用一致性（月度作业硬性）：素材带 priorBrief 的文献，结果 JSON 中该 id 的 object/method/finding 必须与 priorBrief **逐字一致**——写回前逐条比对，改写即视为质量事故（同一文献两期口径漂移）。

## 7. 质量自检（写回前本地执行）

- 用本地脚本或正则核对每份专报：正文所有 `[id]` ⊆ 对应素材 articles 的 id 集（不等式：`contentMd.match(/\[(\d{4,6})\]/g)` 逐个比对）。
- `exportedAt` 等五头字段与 `list-batch-headers.mjs` 输出逐字比对。
- highlightIds 计数 ≤8、topTopics ≤12。
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
| 会话中途被切断 | 无需补救——全链路幂等，下次自动续 |

**红线重申**：禁直改库、禁外部 API、禁 sc_job_cancel、禁改 .env/服务代码。

**汇报模板**

```
【文献 AI 作业报告】<日期>
- classify：分类 N 篇（M 批），覆盖 classified/total，待复核 N 篇
- digest：总览周报入库（period，total 篇，精选 k 篇）
- digest-direction：方向专报 N 份入库（覆盖方向列表；bulk ok=X failed=Y；速评复用 R 篇 / 新写 W 篇）
- 异常与处理：无 / 描述
```

## 8.5 job: wechat-daily（公众号日报，独立渠道，不写库）

> 渠道设计真值 = DESIGN-WECHAT-MP-DAILY.md。本 job 与 §4-6.5 的写库链路完全独立：
> 产物只落 `data\wechat-drafts\`，不触碰 ai_reports / articles；发布由人工完成
> （个人订阅号无 freepublish 权限，2025-07 微信政策）。

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
≠ 失败：清单板块如实写「今日无新入库文献」，继续步骤 2-5（只有导读与资讯的日报合法）。

**步骤 2 — 下载素材**：`sc_download` 远端 `文献推送/data/wechat-daily-batch-<昨日>.json`
→ 本地 `_ai-jobs-work\wechat-daily\batch-<昨日>.json`，Read 分段完整读完（禁止跳读）。

**步骤 3 — 资讯与写作**：

- Read 本地 `data\daily-news\<昨日>.md`（不存在则资讯板块如实留空，不得编造补位）；
- 精选 5-8 篇（素材 ≤8 篇时全选）撰写三字段速评：契约同 §5.5（对象≤30 / 方法≤40 /
  结论≤50 字）；素材带 priorBrief 的文献**逐字复用、禁止改写**；
- **精选优先级（PLAN-DAILY-UPGRADE）**：IEEE Transactions on Smart Grid（TSG）文章优先，
  当日多篇 TSG 时按方向分散选取；TSG 不足 5 篇时以其他 IEEE Trans 系刊补足，仍不足再按
  方向分散补足；
- 资讯精选：政策 ≤3 条、新闻 ≤5 条，概览式短句改写并 `**加粗**` 关键数字；
  来源与数字必须与每日资讯原文一致，不得编造；政策文件优先全收录。

**步骤 4 — 写 issue JSON**：Write `data\wechat-drafts\<期号日>.json`（期号日 = 今天，
报道窗口 = 昨日）。结构契约：`{version, date, digest≤60字, intro, news{policy≤3,
general≤5}, briefs 1-8 条, listing[], siteUrl}`；渲染器硬校验，违规清单见步骤 5。

**步骤 4.5 — 交稿自评（A1-3，2026-10-08）**：进入渲染前对照自查——①每篇速评三段
齐全且逐条满足 §5.5 字数上限；②导读条目与正文一致；③所有数字与素材/资讯原文一致，
不得编造；④无「首次 / 重大突破 / 国际领先 / 填补空白」等夸大措辞。发现不符先改
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
`data\wechat-drafts\cover-thumb.json`，同日重跑复用）；失败（48001 无权限 / 40164 白名单 /
40001 密钥）按脚本提示如实汇报，**不回滚产物**，L0 路径不受影响；
未配置凭据时跳过本步（L0 档）。

**步骤 6 — 收尾**：清理 `_ai-jobs-work\wechat-daily\` 下临时自测文件；按 8.5.2 汇报。
人工发布按 `scripts\sop-wechat-publish.md` 执行（L1：草稿箱 → 订阅号助手 App 点发表；L0：网页端粘贴）——本 job 不做最后群发。

### 8.5.2 汇报

```
【公众号日报】<期号日>
- 素材：昨日（<日期>）新入库 N 篇，精选 k 篇写速评（复用 priorBrief R 篇）
- 资讯：政策 P 条 / 新闻 M 条（来源 data\daily-news\<昨日>.md）
- 产物：data\wechat-drafts\<期号日>.{json,html}，探针 0 违规
- 草稿：media_id=<id> / 未配置凭据跳过（L0） / 失败原因
- 异常与处理：无 / 描述
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

**公众号日报提示词（原文粘贴，与定时任务「每日 06:30」逐字一致）：**

```
执行 literature-ai-jobs skill（若未加载，通读项目根目录 RUNBOOK-AI-JOBS.md），运行「job: wechat-daily」（第 8.5 节）：⓪ 先按第 4 节执行 classify 增量一轮（export-direction-batch.mjs --limit 400 只导未分类 → 会话按 4.2/4.3 分类 → apply-directions.mjs 写回，invalid 必须=0；exported=0 空跑属正常）——必须在导出日报素材之前完成，使素材带方向；① sc_run 远端跑 scripts\export-wechat-daily.mjs 导出昨日新入库文献素材（空窗口≠失败，如实写「今日无新入库文献」），sc_download 到 _ai-jobs-work\wechat-daily\ 并 Read 完整读完；② Read 本地 data\daily-news\<昨日>.md（不存在则资讯板块如实留空）；③ 精选 5-8 篇写三字段速评（契约同第 5.5 节：对象≤30/方法≤40/结论≤50 字，priorBrief 逐字复用禁止改写；精选优先级：IEEE Trans. on Smart Grid 文章优先、不足以其他 IEEE Trans 系刊补足、再按方向分散），资讯精选政策≤3 条、新闻≤5 条概览式改写、**加粗**关键数字、不得编造；④ Write data\wechat-drafts\<期号日>.json（期号日=今天，报道窗口=昨日）；④.5 交稿自评：对照自查——每篇速评三段齐全且逐条满足 5.5 字数上限、导读与正文条目一致、所有数字与素材/资讯原文一致不得编造、无「首次/重大突破/国际领先/填补空白」等夸大措辞，发现不符先改 JSON 再进 ⑤；⑤ 本地跑 scripts\wechat-render.mjs 渲染 + scripts\probe-wechat-html.mjs 探针，0 违规才算完成，校验失败修正 JSON 重跑、禁止手改 HTML；⑤.5 若 .env 已配置 WECHAT_APPID/WECHAT_SECRET，本地跑 scripts\publish-wechat-draft.mjs --in data\wechat-drafts\<期号日>.json 自动写入公众号草稿箱（失败按脚本提示如实汇报、不影响产物已完成，未配置凭据则跳过）；⑥ 清理临时文件并按第 8.5.2 节模板汇报。本 job 不写数据库、不做最后群发（草稿写入见⑤.5，人工按 scripts\sop-wechat-publish.md 点发表）。全程遵守第 2 节红线。sc-remote 不可用或脚本缺失时汇报终止，不做变通。
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
