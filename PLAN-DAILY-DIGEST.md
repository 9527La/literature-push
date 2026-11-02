# 研究速览「当日新增文献分析」方案（PLAN-DAILY-DIGEST）

> 状态：**已批准并实施（2026-10-15）**。决策结果：**1 = 丙（混合：统计实时 + AI 摘要增强）/ 2 = 2a（并入每日 06:30 作业）/ 3 = 全覆盖当日每篇 / 4 = 支持近 7 天回看**。
> 本文保留为设计与验收记录；实测结论见第 4 节验收标准逐条结果与第 7 节验证记录。
> 日期：2026-10-15　·　前置：研究速览 v2（`PLAN-AI-REPORTS-V2.md`）已上线；每日 06:30 公众号日报链路已闭环（`RUNBOOK-AI-JOBS.md` §8.5）
> 需求：在研究速览模块新增「当日新增文献分析」——按当日窗口筛选新增文献，统计数量 / 来源分布 / 分类情况，提取主要研究主题、方法与关键结论，生成简明分析摘要，突出值得重点关注的内容；明确无新增与加载失败的展示方式；与现有研究速览布局交互风格一致。

---

## 1. 定位与数据口径

| 项 | 取值 | 依据 |
|---|---|---|
| 入口 | 研究速览第三个标签页，位于「一周速览 / 月度趋势」之后 | 与现有 `reports-tabs` 同构 |
| 统计窗口 | **北京时间业务日当天**（`YYYY-MM-DD 00:00 ~ 24:00`），可切「昨日」 | 与 `export-wechat-daily.mjs` 的 `businessToday()` / `shiftBusinessDate()` 同源 |
| 日期口径 | `first_public_at` 优先（`displayDateSql`） | 项目唯一日期口径，勿另立 |
| 排除项 | 垃圾标题（7 条 LIKE 过滤）、`research_direction='other'` | 与周报/日报导出逐条对齐，避免同库两个口径 |
| 未分类 | 方向为 `NULL` 的计为「待方向标注」，不归入任何方向 | 沿用 `stats.unclassified` 语义 |
| 来源分布 | 按 `journal` 聚合，落 `journalGroup()` 四组（IEEE / Elsevier / 中文 / 其他）配色 | 复用 `src/lib/journal.js` |

---

## 2. 决策点（请逐条拍板，编号回复即可）

**决策 1 · 内容来源（最关键）**

| 方案 | 摘要与「重点关注」怎么来 | 优点 | 代价 |
|---|---|---|---|
| 甲 · 纯 AI 日报 | 新 `kind='daily'` 报告，与周/月报完全同构 | 内容质量与现有速览一致；实现最规整 | 需 DB 迁移 + 脚本 + RUNBOOK + 定时任务；**当天首跑前该页无内容** |
| 乙 · 纯实时统计 | 无 AI：数量/来源/分类实时算；摘要用模板拼句（「今日新增 N 篇，集中在 X、Y 方向，来源以 A、B 为主」） | 零作业、零维护、打开即有数、永不过期 | 「主题/方法/结论」只能复用已有速评（当日文献通常还没有）；摘要非真分析 |
| **丙 · 混合（推荐）** | 统计与清单**实时算**（页面永不空）；摘要与重点关注为 AI 产物，**有则显示、无则整段隐藏** | 兼顾即时可用与内容质量；= 甲 + 降级路径 | 仍是甲的全部工作量 |

> 推荐 **丙**：统计部分不依赖 AI，避免「标签页点开是空的」；AI 部分并入已有每日作业，不新增定时任务。

**决策 2 · AI 产出的挂载位置**

- **2a（推荐）** 并入现有每日 06:30「电气前沿速递公众号日报」作业末尾：该会话本来就要通读当日素材，追加一次 `apply-report.mjs --kind daily` 即可，**零新增定时任务**。
- 2b 新建独立「文献 AI 日报」定时任务（如每日 07:30）。链路更清晰，但多一个作业与提示词要维护。

**决策 3 · 三字段速评覆盖范围**

- **3a** 覆盖当日**全部**文献（与方向专报同门槛，缺一拒收）——摘要与清单逐条可读，日增 40–60 篇的会话成本可接受。
- **3b（推荐）** 只对「重点关注」3–5 篇 + 方向分布中每个方向的代表 1 篇写速评（合计约 10–15 篇），其余清单行只显示标题与方向。成本约为 3a 的 1/4。

**决策 4 · 是否允许回看**

- **4a（推荐）** 支持日期切换（默认今天，可选近 7 天），空态给「查看昨日」按钮；AI 摘要按日期取对应日报。
- 4b 仅当天，不提供切换；空态只给「切到一周速览」。

---

## 3. 变更清单（按决策 1=丙 / 2=2a / 3=3b / 4=4a 列示）

### A. 服务端（实时统计，无 AI 依赖）

| # | 文件 | 改动 | 预期效果 |
|---|---|---|---|
| A1 | `server/db.js` | 新增 `getDailyDigest({ date })`：返回 `{date, total, unclassified, directionCounts, journalCounts[], articles[]}`，SQL 与 `export-wechat-daily.mjs` 同口径（displayDateSql + 垃圾标题过滤 + 排除 other），`articles` 为轻量行（id/title/translated_title/journal/research_direction/display_date） | 单次查询拿到当日全部统计，零 LLM |
| A2 | `server/db.js` | `ai_reports.kind` 约束 `('weekly','monthly')` → `('weekly','monthly','daily')`：新增幂等迁移（`PRAGMA table_info` 判列存在与否之外，另判 `sqlite_master.sql` 是否含 `'daily'`，仿 direction 迁移重建表） | 旧库无损升级；重复执行安全 |
| A3 | `server/db.js` | `listAiReports` / `getAiReportDetail` / `getLatestReadyReport` 的 `kind` 默认值与白名单加入 `daily` | 三接口可查日报 |
| A4 | `server/index.js` | 新增 `GET /api/reports/daily?date=YYYY-MM-DD`（缺省=北京业务日今天；非法日期 400）；`kind` 解析由二值改为三值（`weekly\|monthly\|daily`） | 前端一次请求拿到统计 + 已生成日报（若有） |
| A5 | `server/index.js` | `/api/reports/daily` 的 `report` 字段复用 `getLatestReadyReport('daily')` 同款查询，返回 `content_md` + `stats_json.paperBriefs` | AI 摘要与三字段随统计同响应返回 |

### B. AI 作业（决策 1=丙 时必做）

| # | 文件 | 改动 | 预期效果 |
|---|---|---|---|
| B1 | `scripts/apply-report.mjs` | `kind` 白名单与内置建表 schema 副本加入 `daily`；`stats` 重算逻辑兼容单日窗口（`previous` = 昨日） | 日报可经既有写回链路入库，不新开旁路 |
| B2 | `scripts/export-report-batch.mjs` | 新增 `--kind daily [--date YYYY-MM-DD]`（窗口 = 单日；`previous` = 前一日；`priorBrief` 注入沿用现有逻辑） | 日报素材导出复用同一脚本，口径自动与周/月一致 |
| B3 | `RUNBOOK-AI-JOBS.md` + `.workbuddy/skills/literature-ai-jobs/SKILL.md` | 新增 §8.6 `job: daily-digest`（结构与写作纪律：引言 + 方向概览 + 重点关注 + 速评），**两文件同版本同步** | 定时会话有唯一执行依据 |
| B4 | 同上 §9 附录 A | 每日 06:30 提示词**逐字追加**日报步骤（放在 wechat-daily 之后） | 提示词与手册同步，避免口径漂移 |
| B5 | WorkBuddy 定时任务「电气前沿速递公众号日报」 | 提示词按 B4 更新 | 次日起自动产出 |

### C. 前端

| # | 文件 | 改动 | 预期效果 |
|---|---|---|---|
| C1 | `src/features/reports/ReportsView.jsx` | `KINDS` 增加 `{key:'daily', label:'当日新增'}`；新增 `daily` 渲染分支（KPI 概览 / 来源与分类分布 / 当日分析摘要 / 重点关注 / 当日新增文献清单 / 底部「卡片阅读」） | 第三个标签页可用，其余两页行为零变化 |
| C2 | 同上 | daily 态数据走独立 `useAsync`（`/api/reports/daily`），三态：加载中骨架 → 正常 / 空 / 失败；失败态给「重新加载」，空态给「查看昨日」+「切到一周速览」 | 无新增与失败均有明确出路，不出现死胡同 |
| C3 | 同上 | AI 摘要 / 重点关注为 `null` 时**整段不渲染**（不留空标题、不留骨架）；分布条形与清单行可点击 → 复用 `ArticleListDialog` / `ArticleDialog` | 降级路径干净 |
| C4 | 同上 | 方向切换 chips / 期刊筛选 / 卡片阅读在 daily 态沿用（数据源改为当日窗口） | 交互一致 |
| C5 | `src/styles/99-tail.css`（**文件末尾追加**） | 新增 `.reports-kpis` / `.reports-kpi*` / `.reports-switch` / `.reports-sect-row` / `.reports-badge-focus` / `.reports-list-foot` | 新类名独立，不动历史层叠区 |

### D. 文档与发布

| # | 文件 | 改动 |
|---|---|---|
| D1 | `README.md` | 研究速览章节补「当日新增」说明与接口 `/api/reports/daily` |
| D2 | `CHANGELOG.md` + `version.json` | 按项目约定 bump 版本并记录 |
| D3 | 部署 | `sc_project_sync` → 远端 `redeploy.ps1 -SkipTests` → 重启 → `verify-render.mjs` |

---

## 4. 验收标准

| # | 验收项 | 通过门槛 |
|---|---|---|
| M1 | 统计准确性 | 任取一天，`/api/reports/daily?date=D` 的 `total` 与 `SELECT COUNT(*)` 手工核对一致（同一 displayDateSql 口径）；`journalCounts` 求和 = total − unclassified |
| M2 | 口径一致 | 同一天的 `total` 与 `export-wechat-daily.mjs --date D` 的 `total` **逐字相等**（同一 SQL 口径，机器比对） |
| M3 | 无新增 | 选一个无入库日：显示空态（含统计窗口说明 + 「查看昨日」+「切到一周速览」），无报错、无骨架残留、控制台 0 warning |
| M4 | 加载失败 | 断网 / 改错接口路径：显示失败态 + 「重新加载」可恢复；不出现整页崩溃（ErrorBoundary 未触发） |
| M5 | AI 降级 | 日报未生成时，摘要与重点关注整段不渲染，页面只剩统计 + 分布 + 清单，无空标题 |
| M6 | AI 摘要 | 日报入库后：摘要中每个数字与同页统计一致；三字段字数满足 §5.5 上限（对象 ≤30 / 方法 ≤40 / 结论 ≤50）；`[id]` ⊆ 当日批次 |
| M7 | 一致性 | 三个标签页头部 / 标签 / 信息条 / 分区标题 / 速评卡 / 空态视觉与交互一致；切页不串数据（切回周报仍为周报数据） |
| M8 | 回归 | `node --test server/` 全绿；`_tmp/verify-tour-v5.mjs` 教程探针 0 违规（新增 tab 不影响既有 51 步锚点） |
| M9 | 迁移幂等 | 对已升级库重复执行迁移脚本：无报错、无数据丢失、`kind` 约束含 `daily` |
| M10 | 部署 | version/CHANGELOG → sync → redeploy → verify-render 全过；线上打开三个标签页均正常 |

---

## 5. 风险与待确认

1. **DB 迁移**：`ai_reports` 的 CHECK 约束需重建表（SQLite 不支持改约束）。迁移在 `db.js` 建表段之后、按幂等条件执行，参照已有 `direction` 迁移写法；`apply-report.mjs` 内的 schema 副本（约 267 行起）必须同步，否则新库写 `daily` 会被拒。
2. **教程兼容**：新手教程（51 步）含研究速览步骤，新增第三个标签页可能影响锚点选择；M8 用 `_tmp/verify-tour-v5.mjs` 回归。
3. **本地库结构旧**：本机 `data/literature.sqlite` 无 `direction` 列，daily 态验证以线上或 `_reports-preview` 为准。
4. **会话成本**：决策 3a 每日全覆盖速评会显著拉长 06:30 作业时长；建议 3b。
5. **待用户拍板**：决策 1–4（见第 2 节）。

---

## 6. 评审物

- 设计预览：`DESIGN-MOCKUP-DAILY-DIGEST.html`（四态切换：正常 / 无新增 / 加载失败 / 加载中）

---

## 7. 验证记录（2026-10-15 实施后）

### 7.1 变更文件

| 层 | 文件 | 说明 |
|---|---|---|
| 服务端 | `server/db.js` | ai_reports.kind 约束迁移（含 daily）；`getDailyDigest()`；`REPORT_KINDS` 白名单；**附带修复** `json_valid` 守卫（损坏 stats_json 曾把列表接口打成 500） |
| 服务端 | `server/index.js` | 新增 `GET /api/reports/daily`；`parseReportKind()` 三值解析（4 处） |
| 脚本 | `scripts/export-report-batch.mjs` | `--kind daily [--date]`（单日窗口，上期 = 前一日） |
| 脚本 | `scripts/apply-report.mjs` | kind 白名单含 daily；schema 副本同步；`focusIds` 校验与落库；daily 要求 paperBriefs 全覆盖 |
| 前端 | `src/features/reports/DailyDigestPanel.jsx`（新增） | 当日新增面板：三态 + AI 降级 + 分布切换 + 下钻 + 卡片阅读 |
| 前端 | `src/features/reports/BriefCard.jsx`（新增） | 三字段速评卡抽出为共享模块（避免反向 import 形成循环依赖） |
| 前端 | `src/features/reports/ReportsView.jsx` | KINDS 加 daily；daily 渲染分支（置于 loading/error 闸门之前）；`lists[kind] || []` 兜底 |
| 样式 | `src/styles/99-tail.css` | 文件末尾追加 `.reports-kpis` / `.reports-switch` / `.reports-badge-focus` / `.reports-list*` 等 |
| 测试 | `server/ai-reports.test.js` | 新增用例「ai reports daily kind: kind migration, daily read paths and focusIds contract」（10 组断言） |
| 文档 | `RUNBOOK-AI-JOBS.md` + `.workbuddy/skills/literature-ai-jobs/SKILL.md` | 新增 §8.6 job: daily-digest；§3 调度表与附录 A 每日提示词同步（两文件逐字镜像，已校验） |
| 文档 | `README.md` / `CHANGELOG.md` / `version.json` | 用户文档与版本 2026.10.15.36 |

### 7.2 验收结果（对应第 4 节）

| # | 验收项 | 结果 |
|---|---|---|
| M1 | 统计准确性 | ✅ `_tmp/probe-daily-digest.mjs`：total == articles.length、ΣjournalCounts == total、ΣdirectionCounts + unclassified == total |
| M2 | 口径一致 | ✅ 与 export-wechat-daily 同口径手算逐日比对相等（近 7 天逐日扫描无异常） |
| M3 | 无新增 | ✅ `_tmp/verify-daily-digest-ui.mjs`：空态标题 + 2 个出路按钮（查看昨日 / 切到一周速览） |
| M4 | 加载失败 | ✅ 拦截接口后显示失败态 + 错误原因 +「重新加载」，重试后脱离失败态 |
| M5 | AI 降级 | ✅ 无日报时说明行 1 条、无「重点关注」小节、统计与清单照常 |
| M6 | AI 摘要 | ✅ 三字段卡 6 个字段、重点关注 2 张带角标与理由行；（内容质量由 apply 硬校验兜底：字数上限、[id] ⊆ 批次、全覆盖） |
| M7 | 一致性 | ✅ 三标签视觉/交互一致；切回一周速览无残留（kpi=0） |
| M8 | 回归 | ✅ `node --test server/` **164/164 全绿**；教程回归 `_tmp/verify-tour-v5.mjs`（预览库 4188）**研究速览 7 步全部高亮 ✓**（含步骤 29「① 一周速览 / 月度趋势」，即新标签所在的行） |
| M9 | 迁移幂等 | ✅ 探针连跑两次：第二次识别到约束已含 daily 直接跳过，数据行数不变 |
| M10 | 部署 | ✅ 2026-10-15 10:30 上线：sync（16 文件/844KB，0 冲突）→ 远端 `redeploy.ps1 -NoRestart`（构建 2.98s，**npm test 191/191 全绿**）→ 精准重启服务 → `verify-render.mjs https://lhmktz.top` 全过 → 线上功能验收 `_tmp/verify-daily-digest-prod.mjs` 全过（真实方向条形 / 下钻 / 回看 / 0 JS 报错） |

### 7.3 遗留事项

1. ~~定时任务提示词~~ ✅ 已更新（2026-10-15 10:20，`automation_update` 仅改 prompt：opening 改「运行「每日作业」」、⓪ 后插入 ⓪.5 daily-digest、④.5 补「资讯条目逐条对齐」自查项；rrule / 名称 / cwds 未动）。顺手把这句自查项回灌进 RUNBOOK §8.5.1 与附录 A，消除手册与定时任务之间的既有漂移。
2. ~~部署~~ ✅ 已上线（M10）。生产库 `ai_reports` CHECK 已含 daily，132 行历史报告完好。
3. **本地库方向标注**：本机 `data/literature.sqlite` 的文献 `research_direction` 全为 NULL，「按方向」分布视图在本机只能看到「均未标注方向」提示（线上已验真实条形，无需处理）。
4. **AI 日报首跑**：明日 06:30 定时作业才会首次产出 `kind='daily'` 报告，届时线上「当日分析摘要 / 重点关注」自动出现；在此之前页面按降级路径渲染（已有说明行）。
5. **文档镜像教训**：SKILL.md 曾落后 RUNBOOK 22 行，反向生成会静默丢内容 → 已确立「改 RUNBOOK → 生成 SKILL」单向流程，并写进项目记忆。
6. **git 提交未做**：GitHub 仓库为 public 且历史含通行证（轮换待决策），待用户确认后再提交推送。

---

## 8. 版式调整（2026-10-15 下午，用户反馈，v2026.10.15.38）

| # | 反馈 | 落地 |
|---|---|---|
| 1 | 来源与分类分布要有「标签」样式 | 由横向条形改为 chip：方向用 `.reports-dir-chip`（方向色圆点 + 方向名 + 篇数），期刊用 `.reports-group-jchip`（刊名缩写 + 篇数）；点 chip 下钻到该方向 / 该期刊的当日文献 |
| 2 | 当日文献要有「三字段速评卡」样式 | 有速评时渲染 `.reports-brief-grid`（预览 3 张）+ 底部「卡片阅读 · N 篇」「查看当日全部 N 篇」；无速评（AI 未跑）时降级为原紧凑清单行 |
| 3 | 页内统计文字删除、排版优化 | 删除页内信息条（`统计窗口 / 新增 / 来源 / 覆盖`）；概览四张卡整块删除；「待方向标注 N 篇」并入分布区小字提示 |
| 4 | 页头整体重排，标签移到选择器右侧 | 新增 `.reports-head-bar`：**选择器在左、标签在右**同一行；周/月用期数选择器、当日用日期选择器（同一位置，切换无跳动） |
| 5 | 顺序：当日新增、每周、每月 | `KINDS` 顺序改为 **当日新增 / 一周速览 / 月度趋势**，且**当日新增为默认页**（文案保持「一周速览 / 月度趋势」不变） |
| 6 | 不需要「重点关注」了 | 板块整体下线（UI + RUNBOOK §8.6 + 定时任务提示词）：当日文献已按速评卡全量展示，再单列子集只会重复同样的卡。`focusIds` / `highlightIds` 降级为 apply 侧容错的保留字段，不再渲染 |

**实现要点**：当日日期状态提升到 `ReportsView`（`dailyDate` / `dailyAnchor`），面板通过 `onDateResolved` 回报服务端业务今天作锚点；日期工具抽到 `src/lib/report-dates.js`；`BriefCard` 移除 `focus`/`reason` 两个 prop。

**验证**：离线渲染真机 bundle（`_tmp/verify-daily-layout.mjs`，27 项全过）；线上 `_tmp/verify-daily-digest-prod.mjs`（23 项全过）；`scripts/verify-render.mjs` 通过。截图 `_tmp/daily-ui-shots-v2/` 与 `_tmp/daily-ui-shots-prod2/`。

**回滚备份**：远端 `E:/SC/文献推送/dist-backup-20261015a`（本次部署前的 dist，110 文件）。

---

## 9. 第三轮调整（2026-10-16，用户反馈，v2026.10.16.40）

| # | 反馈 | 落地 |
|---|---|---|
| 1 | 当日文献要**全部展示**，不能只有 3 个 | 去掉预览条数（原 `LIST_PREVIEW = 3`），当日文献全部铺开成速评卡网格；底部只留「卡片阅读 · N 篇」（全展开后「查看当日全部」已无意义，删除） |
| 2 | 来源与分类分布**不要分开**，方向和期刊一起展示 | 删除「按方向 / 按期刊」切换器与 `mode` 状态，改为两组同屏：`.reports-daily-dist` 内两行，行标「研究方向」「来源期刊」；方向无数据时该行显示「当日文献均未标注方向」 |
| 3 | 摘要文字要大一点、整体排版优化；第一句是重复信息要删 | 新增 `.reports-daily-summary`：正文 13.5 → **15px**、行高 → **2**、内边距放宽；**不再渲染 `parsed.intro`**（AI 正文标题下那句「当日共收录 N 篇…方向分布…来源期刊…」）。同步改手册：RUNBOOK v10 的 §8.6 结构与附录 A 提示词都要求**标题下不写总述句**，定时任务 prompt 已更新——明日 06:30 起新日报不再写该句；今天那份仍带该句，由前端过滤不显示 |

**验证**：离线渲染真机 bundle 36 项全过；线上 30 项全过（今日 6 篇 → cards=6、方向 chip 3 个、期刊 chip 3 个同屏、摘要 15px/行高 30px、0 JS 报错）。部署 2026.10.16.40 已上线。

**顺带修复**：`CHANGELOG.md` 上一版标题的版本号长期停留在 `.37`（只有 `version.json` 跟着改成 `.39`），已对齐为 `.39`。

---

## 10. 第四轮调整：页头布局 + 整页字号（2026-10-16，v2026.10.16.41）

| # | 反馈 | 落地 |
|---|---|---|
| 1 | 优化研究速览头部布局 | 上一版把选择器与标签页拆成「贴左 / 贴右」两行，中间留出一大片空白。本版**合回单行 flex**：左侧 `.reports-head-main`（标题 + 说明两行成块），右侧 `.reports-head-controls`（选择器 + 标签页，垂直居中、贴右）。`.reports-head-bar` / `.reports-head-select` 及其样式全部删除 |
| 2 | 整页字体大一号 | 从 104 处 font-size 中挑出阅读面相关的一批，**统一在 `99-tail.css` 末尾追加一块覆盖**（只作用于 `.reports-*` / `.rgj-*` / 速览内 `.journal-article-*`）：小节标题 15→16、摘要正文 13.5→15、速评卡标题 14→15、速评卡字段 12.5→13.5、方向/期刊标签 12.5→13.5、标签页 13.5→14.5、页头说明 12.5→13.5、日期选择器 13→14、方向分组名 17→18 等 |

**为什么用「末尾集中覆盖」而不是改原规则**：字号是一类会反复微调的参数，集中一处便于下次只改一个地方；也让「研究速览专属字号」与全站字号彻底解耦。

**验证**：离线渲染真机 bundle 48 项全过（含「页头单行：标题块与控件组中心 y 差 < 30px」「11 项字号下限」）；线上 42 项全过。部署 2026.10.16.41 已上线。
