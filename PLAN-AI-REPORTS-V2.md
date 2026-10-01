# 研究速览 v2 — 结构化速评 + 周分类浏览 + 前端重设计（已全部落地）

> 状态：**实施完成并上线**。M1–M7 全部完成（2026.09.29.1 首次上线），2026-09-29 深夜按用户改判完成**历史期数全部回填**（周 5 期 + 月 2 期，93 份报告 1950 条 briefs，终验 ALL_OK）；2026-09-30 修复三个上线反馈（版本 2026.09.30.1）：卡片配色回归期刊组 tone-* 四色、「全部折叠/展开」语义修正、分组主题句重复与空环比括号。
> 验证：本机 npm test 172/172；远端 verify-render + probe-reports-api（meta/full/detail）+ probe-reports-view 全过。
> 日期：2026-09-29 · 前置：研究速览 v1 已上线（2026.09.28.8，见 `PLAN-AI-REPORTS.md`）
> 诉求来源：① 现「文献速览」AI 总结信息量不足——研究对象、研究方法等维度不清楚；
> ② 需要按研究方向的周分类浏览（每周每种类型的文献分类好并给出）；
> ③ 研究速览前端页面重新设计。

---

## 0. 现状与痛点诊断（基于实际产物，含代码锚点）

### 0.1 v1 现有链路

```
生成层（WorkBuddy 智能体，周作业 digest-direction）
  → ai_reports 表（kind / period_start / direction / content_md / stats_json）
  → /api/reports（列表，含 direction 维度）
  → ReportsView.jsx（周报/月报 tab + 总览/方向专报 chips）
```

### 0.2 痛点（对照 2026-09-28 实际产物 `_ai-jobs-work/backfill-20260928/`）

| # | 痛点 | 实例（09-22~09-28 储能专报） | 根因 |
|---|---|---|---|
| P1 | 论文速评信息量不足 | 「[69012] 抽蓄电站备用容量分层运行优化：水风光互补下的备用分层」——基本是标题复述＋半句话，看不出方法与结论 | 速评契约只要求一句话，无字段结构 |
| P2 | 研究维度缺失 | 无「研究对象 / 研究方法 / 核心结论」的区分，读者无法快速判断这篇是否值得读 | 同上 |
| P3 | 周分类浏览弱 | 方向 chips 已有，但专报内速评是纯文本行，无期刊徽章/日期/方向身份条；没有「浏览该方向本周全部文献」的入口 | 速评行不带文章元数据，文章需另查 |
| P4 | 总览页方向动态只有 1–2 句 | 「电池健康管理密集投稿……」主题词罗列，方法/对象热点不分明 | 契约限制（§5.2 每方向 1–2 句） |
| P5 | 前端一次拉全量报告 | `ReportsView.jsx` L375：`/api/reports?limit=200` 含全部 content_md；v2 数据变大后会线性膨胀 | v1 无懒加载 |

### 0.3 可复用的既有能力（零 / 低成本，已核实）

| 能力 | 锚点 | 对本方案的意义 |
|---|---|---|
| 文章列表已支持方向 + 日期窗口过滤 | `db.js#buildArticleListQuery` L687–712：`direction`（白名单多选）+ `from`/`to`（display_date 口径）+ `sort` | 「某方向某周全部文献」**无需新后端** |
| ai_reports 已有 direction 维度 | `db.js` L282–321（建表 + 迁移），`listAiReports` L2582 | 方向专报存取链路现成 |
| stats_json 通道有硬校验模式 | apply 脚本的 DIRECTIONS 白名单 + `highlightIds ⊆ 导出批次` | paperBriefs 校验照抄同一模式 |
| 邮件速评已剥 `[id]` 前缀 | `digest.js#renderAiReportSection` L138 | 速评行改三字段后邮件自然可读，**零邮件改动** |
| 前端组件可复用 | `--dir-*` 色板、`ArticleMiniCard`、`ArticleListDialog`、期刊弹窗、`parseReportContent` | v2 在既有组件上扩展，不推倒重来 |

---

## 1. 目标与非目标

**目标**
1. **结构化速评**：每篇文献的 AI 速评固定三字段——研究对象 / 研究方法 / 核心结论（可选第 4 字段：主题归属），一眼判断「研究什么、怎么做的、得到了什么」。
2. **周分类浏览**：周报页提供「按方向分组」的浏览形态——每组显示本期主题一句话 + 组内文献结构化速评卡 + 「查看该方向全部 N 篇」入口。
3. **前端重设计**：研究速览页面 v2（周报/月报双 tab 保留），mockup 先行、批准后实施。
4. **兼容**：旧报告无新字段时自动降级为 v1 展示，不回滚、不迁移历史数据。

**非目标**
- ❌ 不做实时生成、不加服务端 LLM（v1 红线全部继承）。
- ❌ 不动方向分类体系（15 方向白名单）、日期口径（first_public_at）、翻页三规则。
- ❌ 月报不做全量逐篇速评（月度 800+ 篇不现实；月报保持主题聚类 + 精选三字段）。
- ❌ 不动推送方向过滤 / AI 段落置顶逻辑（v1 已稳定）。

---

## 2. 核心设计

### 2.1 paperBrief 数据契约（stats_json v2 扩展）

方向专报的 stats_json 在现有字段（total/previous/highlightIds/topTopics）基础上新增 `paperBriefs` 数组，**每篇文献一条**：

```json
{
  "total": 29,
  "previous": { "total": 6 },
  "highlightIds": [70762, 63431, 63413],
  "paperBriefs": [
    {
      "id": 70762,
      "object": "LDES/绿氨/DAC 三类长时储能技术的商业化部署",
      "method": "需求-成本-政策-融资四类障碍耦合的风险量化框架",
      "finding": "技术前景取决于最薄弱障碍而非平均强度，可用于路线筛选"
    }
  ]
}
```

**字段规范（写进 RUNBOOK 契约 + apply 硬校验）**：

| 字段 | 必填 | 字数上限 | 规范 |
|---|---|---|---|
| `id` | ✓ | — | 整数，必须 ⊆ 当期导出批次 id 集（防幻觉引用） |
| `object` 研究对象 | ✓ | 30 字 | 研究的系统/装置/场景，具体到对象本体；**禁止复述标题** |
| `method` 研究方法 | ✓ | 40 字 | 方法/模型/数据/验证手段；综述写「综述＋覆盖范围」；**禁止只写「优化/分析」这类空词** |
| `finding` 核心结论 | ✓ | 50 字 | 结果/指标/工程价值；**摘要没有的禁止编造** |
| `topic` 主题归属 | ✗ | 12 字 | 所属主题聚类名，与 content_md 聚类标题一致时填 |

**覆盖范围**：方向专报全量（该方向本期每一篇都有 brief）——v1 专报本来就逐篇列一行速评，v2 只是同一批文献换成结构化输出，**输入成本不变、输出约 +60%**。

**放置位置**：
- 方向专报（weekly + monthly 专报的「值得精读」精选条目）：全量 paperBriefs；
- 总览周报 / 月报：只为 `highlightIds` 精选条目生成 brief（精选卡片用），不逐篇。

### 2.2 content_md 速评行格式 v2（邮件 / 降级渲染共用）

```markdown
## 论文速评
- [70762] **复合部署风险分析（LDES/绿氨/DAC）**｜对象：LDES/绿氨/DAC 商业化部署｜方法：四类障碍耦合的风险量化框架｜结论：前景取决于最薄弱障碍而非平均强度
```

- 邮件侧：`renderAiReportSection` 已剥 `[id]`，一行自然可读，**邮件链路零改动**（内联样式红线不触发）。
- 前端：以 `stats_json.paperBriefs` 为渲染**真值**；content_md 行仅作无 stats 时的降级源（按 `｜` 分隔正则解析）。

### 2.3 生成层改动（RUNBOOK-AI-JOBS.md + Skill 同步修订，两处同版本镜像）

| 节 | 改动 |
|---|---|
| §5 digest（总览周报） | 「各方向动态」每方向升级为：主题聚焦 1 句 + 方法/对象热点半句；stats_json 的 highlightIds 条目附 brief |
| §6 report（总览月报） | 结构不变；「本月值得注意」精选条目附三字段 |
| §6.5 digest-direction（方向专报） | 「论文速评」从一句话升级为三字段速评行；stats_json 增全量 `paperBriefs`；主题聚类保留；「值得精读」= 精选条目的 brief + 一句推荐理由 |
| export-report-batch.mjs | 文章清单摘要截断 500 → **800 字**（finding 提取需要）；其余口径不动 |
| apply-report.mjs / apply-reports-bulk.mjs | 硬校验追加：`paperBriefs[].id ⊆ 批次 id 集`；三字段必填、非空、≤ 字数上限；任一失败整批拒收（照抄现有模式） |

**生成纪律追加（写进 Skill）**：三字段必须来自导出摘要的原文信息，禁止推断摘要未支撑的结论；method 优先写具体（模型名/数据集/仿真平台/实验规模），空泛词不允许单独出现。

### 2.4 服务端（小改，两项）

1. **`/api/reports` 列表瘦身**（针对 P5）：默认只返回轻量行（id / kind / period_start / period_end / direction / status / generated_at / stats 的 total·directionCounts·highlightIds），**不含 content_md 与 paperBriefs**；`?include=full` 保留 v1 完整行为（兼容现有探针 `probe-reports-api.mjs` 的 latest/list 用例）。
2. **新增 `GET /api/reports/detail`**（`?id=` 或 `?kind&period_start&direction` 定位）：返回单份完整报告（content_md + 含 paperBriefs 的 stats），前端按期数/方向切换时懒加载。

其余零改动：文章列表接口已支持 `direction + from/to`；`digest.js` 邮件链路不动；全部走既有通行证鉴权。

### 2.5 前端重设计（M4 · mockup 先行）

**周报 tab 页面结构**：

```
┌ 研究速览 · AI 生成 ─────────────────── [一周速览 | 月度趋势] ┐
│ 期数 2026-09-22 ~ 09-28 ▾     [总览] 储能29 电力电子59 输电20 …
├ ① 概览区（总览态）                                            │
│    收录 217 篇（上期 31）· 方向分布条（现有 DirectionBars）     │
├ ② 本周值得注意（精选 3–5 篇 · 三字段结构化卡片）                │
│    ┌ [AE] Applied Energy · 3 天前 ─────────────────┐          │
│    │ 复合部署风险分析（LDES/绿氨/DAC）  标题        │          │
│    │ 研究对象  LDES/绿氨/DAC 三类技术的商业化部署    │          │
│    │ 研究方法  四类障碍耦合的风险量化框架            │          │
│    │ 核心结论  前景取决于最薄弱障碍而非平均强度      │          │
│    └ 点击打开 ArticleDialog ───────────────────────┘          │
├ ③ 方向分组浏览（分类核心）                                      │
│    ▾ 储能系统 29 篇 ↑23 ｜ 本期主题：电池健康管理方法学密集迭代  │
│       [BriefCard × 3 预览] … 「查看该方向全部 29 篇 ›」         │
│    ▸ 电力电子装备 59 篇 ↑59 ｜ 本期主题：TTE 整期集中出版        │
│    ▸ 输电网运行与规划 20 篇 …（默认形态见决策点 3）             │
├ ④ 方向专报态（点 chip 深入）                                    │
│    主题聚类速评 + 全量三字段速评列表 + 高频关键词 + 值得精读     │
└───────────────────────────────────────────────────────────────┘
```

**新组件与交互**：

| 组件 | 职责 | 数据源 |
|---|---|---|
| `BriefCard`（新） | 三字段速评卡：字段标签（研究对象/研究方法/核心结论）+ 文本三行；有文章数据时整卡可点开 ArticleDialog | `stats.paperBriefs[id]` + `/api/articles?ids=` 批量元数据（现有机制） |
| `DirectionGroup`（新） | 分组头（方向色点 + 名称 + 篇数 + 环比 + 本期主题句）+ 组内前 3 张 BriefCard + 「查看全部 N 篇」 | 专报 stats + 总览 insights |
| 「查看该方向全部」 | 该方向该周完整文献列表弹窗（复用 ArticleListDialog 形态） | `/api/articles?direction=X&from=period_start&to=period_end&sort=desc`（**零新后端**，display_date 口径与 export 同窗） |
| 期数/方向切换 | 懒加载 detail 接口 | `/api/reports/detail` |

**样式**：新 `reports-*` 类全部追加 styles.css **文件末尾段**（避开 `.article` 三层历史层叠区）；配色一律走 `--dir-*` / `--tone*` 变量，不写死主题蓝。

### 2.6 兼容与降级矩阵

| 数据形态 | 展示 |
|---|---|
| 新报告（有 paperBriefs） | 三字段 BriefCard |
| 旧报告（仅一行速评） | 降级为 v1 一行速评形态，卡片角标「旧格式」 |
| 旧总览周报 | `parseReportContent` v1 解析路径原样保留（不删） |
| detail 接口异常 | 回退 `include=full` 列表旧路径 |

---

## 3. 修改清单与验收标准（M1–M7）

| # | 内容 | 文件 | 验收标准 |
|---|---|---|---|
| M1 | 契约修订：RUNBOOK-AI-JOBS.md + Skill §5/§6/§6.5（paperBriefs 契约、三字段规范表、生成纪律） | RUNBOOK-AI-JOBS.md + `.workbuddy/skills/literature-ai-jobs/SKILL.md` | 两处同版本号镜像；字段规范完整（字数上限、禁编造、method 禁空词条款齐备） |
| M2 | 脚本改造：apply 硬校验 paperBriefs；export 摘要 800 字 | `scripts/apply-report.mjs` `scripts/apply-reports-bulk.mjs` `scripts/export-report-batch.mjs` | 三组用例：正常批通过；id 越界 / 字段空 / 超长 → 整批拒收；重跑幂等覆盖同期 |
| M3 | 服务端：/api/reports 轻量列表 + /api/reports/detail | `server/index.js` `server/db.js` | `include=full` 与 v1 响应逐字节一致；空库不 500；detail 按期+方向定位准确 |
| M4 | 前端 v2（**mockup 批准后实施**）：BriefCard + DirectionGroup + 分组浏览 + 懒加载 + 降级 | `src/features/reports/ReportsView.jsx`（或拆分）+ `src/styles.css` | mockup 先行确认；分组浏览 / 专报全量速评 / 精选三字段卡全通；旧期数自动降级不报错；verify-render 过 |
| M5 | 测试：ai-reports.test.js 扩展（paperBriefs 解析 / 旧格式降级 fixture）+ probe-reports-api.mjs 扩展（detail / include 参数） | `server/ai-reports.test.js` `scripts/probe-reports-api.mjs` | 本机 npm test 0 warnings 全过（远端 ieee 恒败 1 项按名认）；探针走应用鉴权 |
| M6 | 部署：version.json + CHANGELOG + 标准链路（sc_project_sync → redeploy -SkipTests → 新会话探测 4177 → verify-render） | version.json CHANGELOG.md | `-VerifyOnly` + verify-render 过；redeploy 后新会话探测 4177 存活 |
| M7 | 首跑验证：手动会话跑一轮 digest-direction（新格式）并汇报抽样 | — | 新专报落库含 paperBriefs；前端三字段卡可见；「查看全部」弹窗列表数 = 专报篇数；邮件速评一行可读 |

**实施顺序**：M1 契约 → M2 脚本 →（并行）M3 服务端 / M4 mockup → 批准 → 实施 → M5 → M6 → M7。
**部署节奏**：一次性发版（后端契约 + 前端 v2 同版本上线，避免「报告已带新字段但页面不认」的中间态）。

---

## 4. 成本与风险

- **Token**：paperBriefs 使 digest-direction 输出约 +60%（每篇多 2 字段 ≈ 120 字）；输入不变（摘要本来就要读）。周作业总量估计 8–15 万 token，仍走会话额度，零现金成本。
- **风险**：

| 风险 | 缓解 |
|---|---|
| 三字段编造（摘要没有的结论） | apply 只能校验形式；语义靠 Skill 纪律条款 + 作业汇报时抽样附 3 篇原文对照 |
| stats_json 变大（约 5KB/方向/期） | detail 懒加载已覆盖；列表瘦身不传 paperBriefs |
| 旧报告降级路径解析出错 | M5 专项用例：旧格式 fixture（取 `_ai-jobs-work/backfill-20260928/` 真实旧报告） |
| 智能体当周未跑 / 失败 | 沿用 v1 空态与降级机制，不动 |

---

## 5. 拍板决策记录（2026-09-29 用户确认）

| # | 决策点 | 结论 |
|---|---|---|
| 1 | 速评覆盖范围 | **全量**：每方向每篇都有三字段 |
| 2 | paperBriefs 存储 | **stats_json 扩展**（零迁移） |
| 3 | 方向分组默认形态 | **手风琴默认全展开** + 一键折叠/展开 |
| 4 | 历史期数 | **全部回填重跑**（2026-09-29 晚由用户改判，原选「降级显示」）：5 个周期（08-25/09-01/09-08/09-15/09-22）+ 2 个月报期（2026-07/2026-08）的总览与全部方向专报按 v2 格式重新生成 |

前端预览稿：`DESIGN-MOCKUP-REPORTS-VIEW-V2.html`（三视图切换：总览分组态 / 方向专报态 / 旧格式降级态；数据取自 2026-09-22~09-28 真实周报）。降级路径仍然保留（作为兜底，不删）。

---

## 6. 红线（全程有效，继承 v1）

1. 同步接口零 LLM / 零新增网络调用；AI 只存在于 Skill 会话与异步落库。
2. ai_reports 写入只经 apply 脚本；智能体禁止直连远端库执行 SQL。
3. 新 UI 先 mockup 预览再实施；配色走 `--dir-*`，禁写死主题蓝。
4. 日期口径唯一 = `first_public_at`（display_date / businessWindow / export 纯 SQL 重写同源）。
5. 邮件必须表格 + 内联样式；速评行格式保证剥 `[id]` 后一行可读。
6. 远端 `.env`、`data/` 不进 sync；redeploy 后新会话探测 4177；测试走非沙箱终端 + run-node-script.js。
