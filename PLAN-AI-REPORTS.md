# AI 研究速览（周报/月报）+ 定向推送 — 改造实施方案 v2（已全部落地上线）

> 状态：**实施完成并已部署（2026-09-28 晚，版本 2026.09.28.8）**。M1–M8 全部完成。
> 线上验证：redeploy 冒烟 200 + verify-render 全过 + `probe-reports-api.mjs` REPORTS_PROBE_PASS（latest/list/monthly/ids 四端点）；首期周报已由执行会话按 RUNBOOK-AI-JOBS §5 生成入库（2026-09-22~09-28，217 篇，精选 4 篇，主题 6 个）。
> 遗留人工动作：① 用户把「每周文献 AI 方向分类」定时任务的提示词改为 Skill 附录 A 的周作业 prompt（classify→digest），并新建月作业自动化（每月 1 日 09:00）；② 次月 1 日观察月作业首次触发。
> 日期：2026-09-28 · 前置依赖：AI 方向分类已上线（`research_direction` 列 + RUNBOOK 周作业）
> 范围：① 站内新板块「研究速览」（一周论文速览 + 月度趋势报告）；② 推送可选研究方向 + 可选附 AI 总结；③ 全部 AI 自动化统一为一个项目级 Skill

## 拍板决策记录（2026-09-28 用户确认）

| # | 决策点 | 结论 |
|---|---|---|
| 1 | 板块命名与位置 | 「研究速览」，导航置于**关键词统计之前**（最新文献 → 研究速览 → 关键词统计 → …） |
| 2 | `pushIncludeAiReport` 默认值 | **默认开**（`!== "false"` 模式；冷启动无报告时邮件自动无感知省略） |
| 3 | daily 频率用户 | **置顶最近一期周报**（段落标注期数「（YYYY-MM-DD ~ YYYY-MM-DD 期）」） |
| 4 | 现有自动化任务 | 接受改造：现有「每周文献 AI 方向分类」任务改名为周作业入口（classify → digest） |

---

## 0. 现状与依赖（实测，含代码锚点）

| 事实 | 代码锚点 | 影响 |
|---|---|---|
| 方向分类已周批运行（周日 23:00 WorkBuddy 智能体） | `RUNBOOK-AI-DIRECTION.md` + 三件套脚本 | 周报/月报的方向统计**必须排在分类之后**执行 |
| 推送 = node-cron 按用户 `pushCron` 逐人生成发送 | `refresh.js#createAndSendDigest / runPush` | AI 报告只能**预生成落库、发送时读取**，不能在推送链路实时生成 |
| 邮件正文 = 模板平铺列表（五开关） | `digest.js#renderDocument / articleMarkdown` | 新增两开关走同一模式 |
| 推送配置双层 | 全局：`db.js` L369–376（默认 insertSetting）/ L436–451（getSettings）/ L483–523（updateSettings）；个人：L2335–2363（getUserSettings）/ L2365–2403（updateUserSettings） | 新键必须**两层四处**同步；⚠️ `getUserSettings` 是全局 settings 被 user_settings **键级覆盖**（`Object.assign` 合并），个人未设置时自然回落全局默认——`pushIncludeAiReport` 用 `!== "false"` 模式即可实现「默认开、两层皆可关」 |
| digest 取数已带垃圾标题过滤 + other 排除 | `db.js#listRecentArticlesForDigest`（L743–789）：7 条 `NOT LIKE` 垃圾标题 + `EXCLUDE_OTHER_PLAIN` + 期刊参数绑定；⚠️ **未用** `is_non_research_title`（该自定义 SQL 函数只在 server/db.js 加载时注册，裸 `node:sqlite` 连接没有） | ① 方向过滤加第 4 参；② **export-report-batch.mjs 必须复刻同一组垃圾标题过滤与 other 排除**（裸 SQL 可直接表达，不碰自定义函数），否则报告数字与邮件/列表口径漂移 |
| 周报窗口 = `businessWindow(N)` | `server/date/normalize.js`；digest 窗口标题与查询同源 | AI 周报窗口复用同源函数；export 脚本内用纯 SQL 重写 `displayDateSql`（COALESCE(first_public_at, 旧口径)）保证同口径 |
| 列表页已带方向列 | `db.js#listArticlePage` SELECT 已含 5 个方向列 + `substr(abstract,1,320)` + 译文 | 精选文献卡片加 `ids` 参数即可复用现有分页查询与前端数据形态 |
| 既有脚本模式可照抄 | `scripts/export-direction-batch.mjs`（`DatabaseSync` readOnly + JSON 落盘 + 单行统计输出）/ `apply-directions.mjs`（`normalize()` 白名单校验 + 事务 + stats JSON；`import { DIRECTIONS } from "../server/directions.js"` 直用） | 新脚本 export-report-batch / apply-report 完全同构，降低智能体执行面 |
| 同步接口 100s 红线、服务端禁 LLM API | PLAN-AI-DIRECTION §4 已核实（WorkBuddy 免密通道禁服务端代理） | AI 内容一律由 WorkBuddy 智能体离线生成 → 落库 → 服务端纯读 |

## 1. 目标与非目标

**目标**
1. 站内新板块「研究速览」：展示每周论文速览（周报）与每月趋势报告（月报），AI 生成、历史期数可回看、精选文献可跳转详情。
2. 推送增强：用户可选**研究方向**（14 方向多选）限定推送范围；邮件内容新增「AI 研究速览」开关，开启后 AI 周报/月报段落**置顶**于邮件正文。
3. 自动化统一：方向分类、周报生成、月报生成收敛到**一个项目级 Skill**（`literature-ai-jobs`），规范化「导出→生成→写回→核对→汇报」循环，后续任何 AI 作业按同一骨架扩展。

**非目标**
- ❌ 邮件正文按方向分组重排（保持平铺，仅置顶 AI 段落；分组列为后续可选增强）。
- ❌ 不做实时生成：推送发送时只读库，找不到当期报告走降级（见 §6）。
- ❌ 不动方向体系、不动日期口径、不动翻页三规则。
- ❌ 不新增服务端 LLM 依赖、不新增外部 API key。

## 2. 总体架构（三层，AI 全部在 Skill 会话内）

```
┌─ 生成层（WorkBuddy 智能体 + 项目级 Skill「literature-ai-jobs」）────────┐
│  周作业（周日 23:00）: classify → digest                                  │
│  月作业（每月 1 日 09:00）: report（上月完整自然月）                        │
│  智能体经 sc-remote: export 脚本导出素材 → 自行生成 → apply 脚本写库        │
└──────────────────────────────────────────────────────────────────────┘
        ↓ 落库（ai_reports 表，服务端零参与）
┌─ 服务层（纯读，零 LLM）───────────────────────────────────────────────┐
│  GET /api/reports（列表）/ /api/reports/latest（最新一期）                 │
│  digest.js 发送时按 pushFrequency 匹配 kind 读取最新 ready 报告置顶渲染     │
│  推送范围: pushDirectionFilter → listRecentArticlesForDigest 新增参数      │
└──────────────────────────────────────────────────────────────────────┘
        ↓
┌─ 展示层（新 ReportsView 板块 + SettingsView 两个新控件）────────────────┐
│  周报/月报 tab · markdown 渲染 · 方向分布条(--dir-* 色板) · 精选文献卡片   │
│  推送设置: 方向 chips 多选 + 「AI 研究速览」开关                            │
└──────────────────────────────────────────────────────────────────────┘
```

**关键依赖顺序**：周作业内先分类后周报——周报的方向统计依赖当周新文章已分类，顺序不可颠倒。

## 3. 统一 Skill 设计（本方案核心）

### 3.1 位置与形态

- 项目级 Skill：`.workbuddy/skills/literature-ai-jobs/SKILL.md`（与项目绑定，随仓库走）
- 现有 `RUNBOOK-AI-DIRECTION.md` 的分类手册内容**并入 Skill 第 4 节**，根目录 RUNBOOK 保留为历史文档并在头部标注「已被 literature-ai-jobs Skill 取代」；WorkBuddy 自动化 prompt 改为指向 Skill。
- Skill 是「执行规范」，不是代码——远端三件套脚本 + 新增两件套才是落地的手脚。

### 3.2 SKILL.md 骨架（草案全文见附录 A）

```
literature-ai-jobs — 文献推送站全部 AI 批量作业的统一执行入口
├─ 1. 红线（继承现有 RUNBOOK：禁直改库/禁外部 API/禁 sc_job_cancel…）
├─ 2. 作业调度（job 一览 + 执行顺序 + 何时触发哪个）
│     weekly  = classify → digest
│     monthly = report
├─ 3. 统一作业循环（每个 job 都走同一五步）
│     ① sc_status 前置检查 → ② 远端 export 导出素材 →
│     ③ 智能体生成（契约见各 job 节）→ ④ sc_upload + apply 写回并核对 →
│     ⑤ 按模板汇报
├─ 4. job: classify（方向分类，全文并入现有 RUNBOOK 第 2–7 节）
├─ 5. job: digest（周报，素材契约 + 内容规范 + JSON 契约）
├─ 6. job: report（月报，同上 + 上月对比素材）
├─ 7. 异常处理（幂等/降级/汇报格式，全 job 共用）
└─ 8. 附录：定时任务 prompt 模板（周/月两条）
```

### 3.3 新增远端脚本（与方向三件套同目录 `scripts\`，模式照抄现有两脚本）

| 脚本 | 职责 | 幂等保证 |
|---|---|---|
| `export-report-batch.mjs` | 导出指定窗口素材：文章清单（id/标题/方向/期刊/摘要前500字）+ 本期方向分布统计 + **上期对比统计**（weekly=上一个同宽窗口 / monthly=上月）+ 期数参数（`--kind weekly --days 7` / `--kind monthly --month 2026-08`） | 只读（`DatabaseSync` readOnly），无副作用 |
| `apply-report.mjs` | 把智能体产出的报告 JSON 写入 `ai_reports` | `UNIQUE(kind, period_start)` 冲突 → UPDATE（重跑覆盖同期产物）；全量字段硬校验 |

**export 的 SQL 口径（与 `listRecentArticlesForDigest` 逐条对齐，防止报告数字与邮件/列表漂移）**：
- 日期判据 = 纯 SQL 重写 `displayDateSql`（`COALESCE(NULLIF(first_public_at,''), substr(旧口径,1,10))`，旧口径 CASE 与 db.js 同构）；
- 窗口 = 北京业务日（脚本内用固定 `Asia/Shanghai` 偏移计算当天，与 `businessWindow` 同构：今天 + 向前 N-1 自然日；月报 = 指定自然月 `[YYYY-MM-01, YYYY-MM-末]`）；
- **复刻 7 条垃圾标题 `NOT LIKE` 过滤**（information / table of contents / blank page / correction to / publication information / front cover / back cover）+ `research_direction IS NULL OR research_direction != 'other'`（等价 `EXCLUDE_OTHER_PLAIN`）；
- ⚠️ 裸 `node:sqlite` 连接**没有** `is_non_research_title` 等自定义 SQL 函数（只在 server/db.js 加载时注册）——export 的 SQL 一律不用自定义函数（digest 查询本身也不用，天然可复刻）；
- 素材分层：`stats`（total/各方向计数/上月或上期计数——脚本数好，智能体**禁止自行数数**）+ `articles`（全量 id/标题/方向/期刊/摘要前 500 字，供智能体抽读写动态与推荐理由）+ `exportedAt/kind/periodStart/periodEnd`；单行统计输出格式沿用 `exported=... period=... total=... out=...`。

**写回契约（apply 侧硬校验，任一失败整批拒收不部分写入）**：`kind` ∈ {weekly, monthly}；`period_start/period_end` 与导出素材的窗口**逐字一致**（apply 重开导出文件比对，或要求结果 JSON 内嵌导出摘要并由脚本校验——采用后者：结果 JSON 必须原样带回 export 头字段）；`content_md` 非空 ≤20 000 字符；`stats_json` 可解析且 `directionCounts`/`directionDelta` 的 key 全部在 `DIRECTIONS` 白名单内（`import { DIRECTIONS } from "../server/directions.js"`，与 apply-directions 同法）；`highlightIds` 为整数数组且**全部来自导出文件的 id 集合**（防幻觉引用不存在的文献）；`total` 必须等于导出素材 `stats.total`。

### 3.4 定时任务收敛（2 条自动化，1 个 Skill）

| 自动化 | 频率 | prompt 指向 |
|---|---|---|
| 文献 AI 周作业 | 每周日 23:00（现有分类任务**改造**，不新建） | literature-ai-jobs Skill §2 weekly：先 classify 后 digest |
| 文献 AI 月作业 | 每月 1 日 09:00（新建） | literature-ai-jobs Skill §2 monthly：report |

月报选每月 1 日而非「月末周日」：完整自然月数据 + 避开月末周报窗口交叠；1 日上午执行，当月首次推送（若有用户设 1 日推送）大概率晚于 09:00，能赶上置顶。

## 4. 数据库改造（M1）

### 4.1 新表 `ai_reports`（`server/db.js` init 段，CREATE TABLE IF NOT EXISTS，幂等）

```sql
CREATE TABLE IF NOT EXISTS ai_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('weekly','monthly')),
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ready',      -- ready|failed
  content_md TEXT NOT NULL,
  stats_json TEXT,                            -- 结构化统计，见 §5 契约
  generated_at TEXT,
  generator TEXT NOT NULL DEFAULT 'workbuddy-agent',
  UNIQUE(kind, period_start)
);
```

⚠️ 新**表**无 ALTER 之虑（与 articles 新列的两处同步坑不同），但必须放在 db.js 现有建表 `db.exec` 块内（`user_settings` 表之后），随服务启动自动创建。

**新增查询函数（db.js，挂 AI 方向区段之后）**：
- `listAiReports({ kind, limit })` → 按 `period_start DESC`，返回行含 `stats` 字段（`JSON.parse(stats_json)` 已解析，坏 JSON 降级 `null` 不抛错）；
- `getLatestReadyReport(kind)` → `WHERE kind=? AND status='ready' ORDER BY period_start DESC LIMIT 1`，digest 与 `/api/reports/latest` 共用；**注意**：对「当期是否已生成」的判断用 `period_start == 窗口 startDate`，不是时间戳比较（时序降级表 §6 的判定基础）。

### 4.2 新增 settings 键（两层四处：默认值/解析/合并/upsert）

| 键 | 类型 | 默认 | 含义 |
|---|---|---|---|
| `pushDirectionFilter` | string（逗号分隔方向 key） | `""`（空=全部方向） | 推送限定研究方向 |
| `pushIncludeAiReport` | bool | `true` | 邮件是否置顶 AI 研究速览 |

改动位置（已按源码定位）：全局 `db.js` L369–376（默认 insertSetting）/ L436–451（getSettings 解析）/ L483–499（updateSettings 合并）/ L510–523（全局 upsert）；个人 L2335–2363（getUserSettings 解析）/ L2365–2403（updateUserSettings upsert，现有模式是**每个键无条件 upsert**、未传时回落 current——新键照抄）。

解析语义（照抄现有模式）：
- `pushDirectionFilter`: `values.pushDirectionFilter || ""`（两层合并后非空覆盖）；
- `pushIncludeAiReport`: `values.pushIncludeAiReport !== "false"`（默认开，任一层显式 "false" 即关）；
- **入库前白名单清洗**（新逻辑，写在 updateSettings/updateUserSettings 内）：逗号拆分 → 过滤仅保留 `DIRECTIONS` 白名单 key（含 `other`，显式选其他=只要其他）→ 重新 join；非法 key 静默丢弃。

## 5. 内容契约（Skill 生成规范，前端/邮件共用）

### 5.1 周报（kind=weekly）content_md 结构

```markdown
# 一周论文速览 · {period_start} ~ {period_end}
本周期共收录 {total} 篇（较上期 {delta:+N}），方向分布：储能 32 · 配电网 28 · …

## 各方向动态
### 储能系统（32 篇 ↑5）
<1–2 句：本周主题聚焦，如"容量配置与共享储能占主导，两篇涉及全寿命周期经济性">
（每个非零方向一小节，顺序按篇数降序）

## 本周值得注意
1. **{标题}**（{期刊}）：{≤40 字推荐理由，说明为何值得读}
（3–5 篇，id 记入 highlightIds，前端渲染成可点击卡片）

## 热点主题
{topTopics 词组 + 一句话}（≤6 个）
```

### 5.2 月报（kind=monthly）content_md 结构

```markdown
# 月度趋势报告 · {period_start} ~ {period_end}
本月共收录 {total} 篇（环比 {delta%}）。

## 方向分布与环比
（每方向：篇数、环比、一句话判断；数据同时进 stats_json 供前端画分布条）

## 各方向趋势解读
（每个重点方向 2–4 句：主题演变、方法热点、与上月差异）

## 新兴主题
（本月新出现或显著增长的主题词/方法组合，≤5 条，每条一句依据）

## 方法观察
（跨方向的方法趋势，如"数据驱动方法在 X/Y 方向的渗透"，可选节）
```

### 5.3 stats_json 契约（前端结构化渲染用，apply 硬校验）

```json
{
  "total": 312,
  "delta": -14,
  "directionCounts": { "storage": 32, "distribution": 28 },
  "directionDelta": { "storage": 5, "distribution": -2 },
  "highlightIds": [4021, 3988, 4055],
  "topTopics": ["共享储能", "配电网重构"]
}
```

**生成纪律（写进 Skill）**：数字必须来自导出素材的统计字段，禁止智能体自行数数；推荐理由只依据导出的摘要前 500 字，禁止编造摘要里没有的内容；中文输出，术语与方向 label 用 `server/directions.js` 原文。

## 6. 时序与降级（邮件置顶的关键边界）

| 场景 | 处理 |
|---|---|
| 用户推送时刻晚于当期报告生成（常态） | 置顶**当期**报告，正常 |
| 用户推送时刻早于当期报告生成（如周日 22:00 推送、23:00 才生成） | 降级附**最近一期 ready** 报告，段落标注「（{period_start} ~ {period_end} 期）」 |
| 库内无任何 ready 报告（首月冷启动） | 邮件不含 AI 段落，正文照旧，不报错 |
| 用户频率映射 | weekly→weekly 报告；monthly→monthly 报告；daily→最近一期 weekly（标注期数） |

实现位置（已核对调用链）：
- **零改 `refresh.js`**：`createAndSendDigest(settings, …)` 已把完整 settings 传入 `generateWeeklyDigestMarkdown`（现有 `pushJournalFilter` 即同路读取），`pushDirectionFilter` / `pushIncludeAiReport` 自然随 settings 到位。
- `digest.js#generateWeeklyDigestMarkdown`：① 解析 `settings.pushDirectionFilter`（逗号→白名单 key 数组）传给 `listRecentArticlesForDigest` 第 4 参；② 按 §6 表选 kind（`settings.pushFrequency` 映射）→ `getLatestReadyReport(kind)`，当期已生成用当期，否则用最近一期并记录 `stalePeriod` 标注；③ `pushIncludeAiReport === false` 或库内无 ready 报告 → 不加 AI 段。
- `digest.js#renderDocument` 头部插入 `renderAiReportSection(report, { stalePeriod })`（compact 与全文两个渲染分支共用，邮件侧输出内联样式安全段落——markdown 源里 AI 段落为引用块/普通标题段，`mail.js` 现有 markdown→HTML 管线直出）；`文件附件`（filePath 的 md）保持纯文献列表不变，AI 段只进邮件正文。

推送方向过滤实现：`listRecentArticlesForDigest(days, limit, journals, directions)` 加第 4 参（SQL `AND research_direction IN (…)` 参数绑定，写法照抄 journalClause 的 `@dir${index}` 命名参数模式）；`""`/空数组 = 不过滤（`other` 仍按现状排除；显式选 `other` = 只要 other，此时 EXCLUDE_OTHER_PLAIN 需让位——语义为「IN 命中优先」，实现时 IN 子句替换而非叠加 EXCLUDE，测试覆盖该边界）。

## 7. 服务端 API（M3，零 LLM）

| 端点 | 说明 |
|---|---|
| `GET /api/reports?kind=weekly&limit=12` | 历史期数列表（id/kind/period_start/period_end/status/generated_at + content_md + 解析后 stats），按 period_start DESC；kind 缺省=weekly，limit 钳制 1–48 |
| `GET /api/reports/latest?kind=weekly\|monthly` | 最新 ready 一期（板块首屏用，避免拉全量）；无报告返回 `{ report: null }` 不 404 |
| `GET /api/articles?ids=1,2,3` | 现有列表接口加 `ids` 参数（精选文献卡片取详情用，`buildArticleListQuery` 加 ids 分支：参数绑定 + 上限 20 + 白名单整数解析，与现有 direction/journal 参数解析同段） |

- 路由注册位置：`/api/reports*` 挂 `index.js` 现有 `/api/directions` 路由之后（L193–196 附近）；`/api/reports/latest` 在 `/api/reports` 之前注册（express 精确路径无冲突，但按惯例具体在前）；`ids` 分支写在 `buildArticleListQuery`，不影响无参数行为（验收：无参数响应与现状逐字节一致）。
- 全部走既有通行证鉴权（`app.use("/api", requirePassport)` 已覆盖）；零新增网络调用。

## 8. 前端改造（M4/M5）

### 8.1 新板块「研究速览」（M4，按拍板：导航置于**关键词统计之前**）

- `src/main.jsx`：`VIEWS` 数组加 `"reports"`（置于 `"feed"` 与 `"stats"` 之间）；导航按钮同位插入（「最新文献」→「研究速览」→「关键词统计」），hash `#reports`；`main.jsx` L63 一处 + 导航按钮 JSX 一处 + 视图分派一处（L878–935 区段）。
- 新文件 `src/features/reports/ReportsView.jsx`：
  - 顶部 tab：**一周速览** / **月度趋势**（默认周报）；
  - 主体：`content_md` 经 `src/lib/markdown.jsx` 渲染；
  - 方向分布条：stats_json.directionCounts 横向条形（`--dir-{key}` 三档变量，禁写死主题蓝——沿用方向 chip 色板约定）；
  - 「值得注意」精选文献：highlightIds → `GET /api/articles?ids=` → 复用 ArticleCard 精简形态，点击打开 ArticleDialog（阅读/收藏/跳原文全功能）；
  - 历史期数：右侧期数列表（period + 总篇数），点击切换；
  - 空态（无 ready 报告）：EmptyState「AI 速览生成中，每周日晚更新」。
- ⚠️ 按约定：**先出 mockup 预览（HTML 静态稿）确认后再实施**本节。

### 8.2 推送设置两个新控件（M5，`SettingsView.jsx`）

- 「推送范围」区（推送期刊选择下方）：**研究方向** chips 多选（复用 `src/lib/directions.js` 色板与 label，含「全部」态），保存进 `pushDirectionFilter`；
- 「邮件内容」区：新增开关 **AI 研究速览**（与附件/摘要/关键词/翻译并列，Icon 用 Sparkles 或 Newspaper），保存进 `pushIncludeAiReport`；
- 摘要行（L255）同步追加显示「AI 速览」与所选方向数。

## 9. 修改清单总表（M1–M8）

| # | 内容 | 文件 | 预期效果 |
|---|---|---|---|
| M1 | ai_reports 建表 + 2 个 settings 键（两层四处） | `server/db.js` | 旧库升级 0 报错；新键默认值不改变现有用户行为（方向空=全部、AI 速览默认开但冷启动无段落） |
| M2 | 新脚本 export-report-batch / apply-report | `scripts/*.mjs` | 导出→写回往返一致；UNIQUE 幂等；非法 stats_json/越界 highlightIds 整批拒收 |
| M3 | reports API + articles ids 参数 + digest 方向过滤 + AI 段落置顶渲染 + getLatestReadyReport | `server/index.js` `server/db.js` `server/digest.js` | 端点过鉴权；推送按时序降级；发送链路零新增网络调用 |
| M4 | ReportsView 板块 + 导航注册 | `src/main.jsx` + 新文件 | 先 mockup 后实施；verify-render 通过 |
| M5 | SettingsView 方向 chips + AI 速览开关 | `src/features/settings/SettingsView.jsx` | 保存/回显/摘要行三处一致 |
| M6 | Skill：literature-ai-jobs（并入分类手册）+ RUNBOOK 标注取代 | `.workbuddy/skills/…/SKILL.md` | 本地会话说「跑文献 AI 周作业」可触发；手动冒烟一轮 digest 往返 |
| M7 | 测试 | `server/*.test.js` + 脚本冒烟 | 本机 npm test 0 warnings 全过（远端 ieee 恒败 1 项按名认） |
| M8 | 部署 + 首跑 | version.json + CHANGELOG + 标准链路 + 2 条自动化配置 | 远端 -VerifyOnly + verify-render 过；首期周报落库可见 |

**部署节奏（两段式，减少 M4 mockup 等待期的阻塞）**：
- 第一段（M1–M3 + M5–M7 全部本地完成并测试通过后）：可与 M4 mockup 并行，但**不单独发版**——后端就绪后先本地冒烟，等 M4 批准实施完毕，一次性 bump 版本部署（推送开关/方向过滤与板块同版本上线，避免「设置了 AI 速览开关但站内看不到板块」的中间态）；
- 第二段（M4 实施完）：统一部署 → 远端手动会话跑一轮 digest 作业产出首期报告 → 板块可见 + 测试邮件含 AI 段落 → 配置/改造两条 WorkBuddy 自动化（周任务改名改造、月任务新建）→ 次月 1 日验证月作业触发。

## 10. 红线（全程有效）

1. 同步接口零 LLM/零新增网络调用；AI 只存在于 Skill 会话与异步落库。
2. `ai_reports` 写入**只**经 `apply-report.mjs`（智能体禁止直连远端库执行 SQL——沿用方向分类红线）。
3. 新 UI 先 mockup 预览再实施；方向配色走 `--dir-*`，禁写死主题蓝。
4. 新 settings 键两层四处同步；LIKE + 用户输入带 `ESCAPE '\'`（chips keys 为白名单校验后的 ASCII，风险低但按规执行）。
5. 远端 `.env`、`data/` 不进 sync；redeploy 后新会话探测 4177（沿用部署坑位清单）。
6. 邮件仍必须表格 + 内联样式（`mail.js` 约定）：AI 段落渲染为单个内联样式 `<div>` 块，不做复杂嵌套。

## 11. 验收标准汇总

| 编号 | 验收 |
|---|---|
| M1 | 旧库启动建表 0 报错；未保存新键的老用户推送行为与现状一致 |
| M2 | export/apply 往返：正常批、重跑批（覆盖同日）、非法批（幻觉 id / 坏 JSON / 越界方向 key）三组用例 |
| M3 | `/api/reports` 空库返回空数组不 500；`pushDirectionFilter=storage` 邮件仅含储能方向；无 ready 报告时邮件正文与现状逐字节一致 |
| M4 | mockup 批准后实施；周报/月报切换、期数回看、精选卡片开弹窗全通；verify-render 通过 |
| M5 | 保存方向选择 + AI 开关 → 刷新回显一致；游客不可保存（沿用现状） |
| M6 | 手动会话执行「文献 AI 周作业」完整跑通 classify→digest→汇报；RUNBOOK 头部出现取代标注 |
| M7 | 本机 `npm test` 0 warnings 全过；沙箱限制用例走非沙箱终端 + run-node-script.js |
| M8 | 首期周报在板块可见、测试邮件含 AI 段落；月作业自动化次月 1 日触发（日志可查） |

## 12. 成本与风险

- **Token**：周报素材 ≈ 窗口 300–400 篇的统计 + 摘要抽样（Skill 规定按方向抽读 top 篇目，不全量精读）≈ 5–10 万 token/周，走会话额度；月报类似。零现金成本。
- **主要风险**：① 智能体生成的数字与库内统计不一致 → apply 硬校验（total 必须等于素材 stats.total；highlightIds 必须属于导出 id 集）+ Skill 纪律条款双保险；② 推送时序竞态 → §6 降级表已覆盖；③ Skill 加载失败（定时会话未拾取项目级 skill）→ 两条自动化 prompt 兜底写「若 skill 未加载，通读项目根目录 RUNBOOK-AI-JOBS.md」——Skill 定稿全文镜像到根目录 `RUNBOOK-AI-JOBS.md`，两个入口同一内容、同版本号；④ 首期周报冷启动：板块上线后到第一个周日 23:00 之间无 ready 报告 → 空态文案「AI 速览生成中，每周日晚更新」，邮件照旧不报错；可在部署后手动会话跑一轮 digest 作业立即产出首期（幂等，周任务会覆盖同期）。

---

## 附录 A · SKILL 草案 → 已落地为正式手册（v2，2026-09-28 晚定稿）

> 本附录的早期骨架已由正式手册取代：**唯一执行依据 = `.workbuddy/skills/literature-ai-jobs/SKILL.md`**
> （根目录镜像 `RUNBOOK-AI-JOBS.md`）。手册含：classify 全量规范、digest/report 总览契约、
> **§6.5 方向专报 job**（全方向无门槛、`[id]` 行前缀互动锚点、主题聚类格式）、
> bulk 写回（`apply-reports-bulk.mjs`）、质量自检清单、两条自动化 prompt 原文（附录 A）。

## 附录 B · 两条自动化任务的 prompt 模板（v2 定稿，同步于 RUNBOOK-AI-JOBS.md 附录 A）

**周作业（改造现有「每周文献 AI 方向分类」任务，改名）**
```
执行 literature-ai-jobs skill（若未加载，通读项目根目录 RUNBOOK-AI-JOBS.md），运行「周作业」三步：① classify——按手册第 4 节完成本周 AI 方向分类（每轮≤400 篇）；② digest——按第 5 节生成全方向总览周报；③ digest-direction——按第 6.5 节为本期所有非零方向逐个生成方向专报（每个方向一份 export+结果 JSON，全部写入本地 _ai-jobs-work\direction-inbox\ 后整目录上传，用 apply-reports-bulk.mjs --dir data\direction-inbox 批量写回）。写回前按手册第 7 节完成本地质量自检（[id] ⊆ 批次、五个头字段逐字一致）。最后按第 8 节模板汇报。全程遵守第 2 节红线。sc-remote 不可用或脚本缺失时汇报终止，不做变通。
```

**月作业（新建）**
```
执行 literature-ai-jobs skill（若未加载，通读项目根目录 RUNBOOK-AI-JOBS.md），运行「月作业」两步：① report——按手册第 6 节导出上月完整自然月素材（--kind monthly --month 上月）生成全方向总览月报（含环比与新兴主题）；② 逐方向专报——按第 6.5 节为上月所有非零方向逐个生成月度方向专报（主题聚类形式），全部写入 _ai-jobs-work\direction-inbox\ 后整目录上传，用 apply-reports-bulk.mjs --dir data\direction-inbox 批量写回。写回前按第 7 节自检。最后按第 8 节模板汇报。全程遵守第 2 节红线。sc-remote 不可用或脚本缺失时汇报终止，不做变通。
```
