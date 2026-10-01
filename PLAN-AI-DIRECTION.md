# AI 研究方向分类 — 实施方案 v2（决策已落定）

> 状态：**方案定稿，部分实施**。v2 变更：① 取消 L0 规则预分，全量直连 LLM 作业；② LLM 接入通道双方案；③ 新增每周定时分类任务。
> **v3 决策记录（2026-09-28 用户拍板）**：
> 1. 通道 = **方案 B**：WorkBuddy 定时任务（每周日 23:00，模型 Hy3/腾讯混元）由执行智能体经 sc-remote 分类，不用服务端 LLM API；
> 2. 方向体系 14+1 维持不变；
> 3. 卡片正则主题标签（keyword-topic）**由 AI 方向 chip 取代**；
> 4. 执行手册（提示词+流程+契约）= `RUNBOOK-AI-DIRECTION.md`；前端设计稿（交付外部模型）= `DESIGN-FRONTEND-DIRECTION.md`；
> 5. 已实施：`server/directions.js`（方向真值）、`scripts/migrate-directions.mjs`、`scripts/export-direction-batch.mjs`、`scripts/apply-directions.mjs`（本地冒烟全过：迁移幂等/导出/写回/非法 key 拒收/manual 保护/越界钳制）；
> 6. 待办：同步三件套+文档到远端 → 首次迁移 → 存量首跑（≈10 轮×400 篇）→ 前端按设计稿实施 → 旧版 M3（服务端 LLM 作业）与 M9（node-cron）**作废**。
> 日期：2026-09-28 · 依据：本地库 data/literature.sqlite 实测 + WorkBuddy 云服务 LLM 文档核实

## 0. 现状与缺口（实测数据）

| 指标 | 数值 | 说明 |
|---|---|---|
| 文章总数 | 3 977 | 本地库快照，生产同量级 |
| 有作者关键词 | 1 469（37%） | 现有正则主题标签的覆盖上限 |
| 有摘要（>100 字符） | 3 330（84%） | LLM 分类的主要输入 |
| 日增 | ≈40–60 篇 | 周累计 ≈300–400 篇 |

## 1. 目标与非目标

**目标**
- 每篇文献：1 个主方向 + 至多 2 个次方向 + 置信度 + 一句话依据，100% 覆盖（无摘要时用标题+关键词；两者皆无落 `other`）。
- 方向可筛选（hash 参数）、可统计、可人工校正（manual 级永不被 AI 覆盖）。
- 每周自动对新增文献跑一次分类，无需人工干预。

**非目标**
- ❌ 不做实时分类：同步接口零 LLM 调用（100 s 红线）。
- ❌ 不做规则预分（v2 按用户要求取消 L0）。
- ❌ 不动现有 keyword-topic 正则标签与 keyword 筛选组；不动日期口径。

## 2. 方向体系（14 + 1 兜底，待拍板增删）

| key | 名称 | 典型信号 |
|---|---|---|
| distributed-gen | 分布式电源与并网 | DG, grid integration, 并网 |
| storage | 储能系统 | battery, BESS, 储能, capacity allocation |
| market | 电力市场与机制 | bidding, tariff, 辅助服务 |
| transmission | 输电网运行与规划 | transmission expansion, OPF, 潮流 |
| distribution | 配电网运行与规划 | reconfiguration, 配电网重构 |
| microgrid | 微电网与虚拟电厂 | microgrid, VPP, 能量管理 |
| forecasting | 预测与数据驱动 | load forecasting, deep learning, 负荷预测 |
| stability | 电力系统稳定性 | small-signal, transient, 低频振荡 |
| protection | 继电保护与故障诊断 | relaying, fault location, 行波 |
| power-quality | 电能质量 | harmonics, 电压暂降, flicker |
| hv | 高压与绝缘 | insulation, 局放, overvoltage |
| power-electronics | 电力电子装备 | converter, inverter, MMC, 宽禁带 |
| transport | 电动汽车与电气化 | EV charging, V2G |
| ies | 综合能源系统 | integrated energy, 电-热-气, P2G |
| other | 其他/交叉 | 兜底 |

维护位置：`server/directions.js` + `src/lib/directions.js` + `server/directions.test.js` + `README.md`（对齐期刊四处同步约定）。

## 3. 总体架构（v2：两层）

```
L1 LLM 分类作业（唯一打标来源）：maintenance 异步批处理，复用 metadata-backfill#runStage 骨架
L2 人工校正（管理员）：弹窗下拉改判，direction_source='manual' 永不被覆盖
```

## 4. LLM 接入通道（v2 核心变更）

### ⚠️ WorkBuddy 免密 LLM 通道调研结论：不能用于服务端定时作业

核实依据（WorkBuddy 云服务 LLM 官方文档）：
1. 数据面 `/.cloud/llm/chat/completions` 需要**已激活云服务应用**的 `endpoint + publishableKey`，且服务端强制 **Origin 精确匹配**（web）/ 请求域白名单（小程序）——该通道为浏览器前端设计；
2. 明确禁止模式清单中包含 **"Building a BFF / Node API route / server proxy to call the model service directly"**——从服务端（含 SC 远端 Node 服务）代理调用属于禁止模式，Origin 校验也会直接拒绝（`auth_` 错误）；
3. 本项目工作区无已激活云服务应用（无 `.workbuddy/applications.yaml`），且该通道与生产服务的定时批量作业形态不匹配。

因此给出两个可行方案：

### 方案 A：远端直连 OpenAI 兼容 API（全自动，推荐）

- `server/direction-classify.js` 直接 fetch OpenAI 兼容 `chat/completions`，SSE/非流式均可；temperature 0 + `response_format: json_object`。
- 配置进远端 `.env`（人工改，sync 不覆盖）：`LLM_BASE_URL`、`LLM_API_KEY`、`LLM_MODEL`、`DIRECTION_CRON`。
- 模型可自选：DeepSeek / 智谱 GLM / 腾讯混元（OpenAI 兼容网关，如 Hy3 为混元系模型可在此指定）等任何 OpenAI 兼容端点。
- 每周定时由**服务内 node-cron** 触发（见 M9），不依赖任何外部环境。

### 方案 B：WorkBuddy 智能体执行（零 key 零费用，半自动）

- LLM 不在远端跑：由 **WorkBuddy 会话智能体**（即会话模型本身）完成分类，通过 sc-remote 与远端交互：
  1. 远端跑 `scripts/export-direction-batch.mjs` 导出待分类文章 JSON（id + 标题 + 关键词 + 摘要前 500 字）；
  2. 智能体分批分类（每批 ≤50 篇，输出 `[{id, direction, secondary, confidence, reason}]`）；
  3. 结果 JSON 上传远端，跑 `scripts/apply-directions.mjs` 写库（manual 不覆盖，参数绑定）。
- 定时：WorkBuddy **每周自动化**（周一定时任务，prompt 自包含），也可随时在会话里手动触发（"跑一次文献分类"）。
- 代价与局限：模型由 WorkBuddy 平台指定（**无法自选 Hy3**）；依赖 sc-remote 与 WorkBuddy 环境可用；自动化失败需人工补跑；每周 ≈300–400 篇的 token 走会话额度（约 25–40 万 token/周）。

### 对比

| 维度 | A 远端直连 API | B WorkBuddy 智能体 |
|---|---|---|
| 费用 | 存量一次性 ≈¥4–6；增量 <¥1.5/月 | ¥0（走会话额度） |
| 模型选择 | ✅ 任意 OpenAI 兼容（含 Hy3 若在任一平台） | ❌ 平台指定 |
| 自动化 | ✅ 服务内 cron，全自动 | ⚠️ WorkBuddy 自动化，失败需补 |
| 时效 | 每周一 08:30 固定 | 自动化触发时间固定，执行时长较长 |
| 新增依赖 | 一组 .env 配置 | 两个远端脚本 + 自动化 prompt |
| 分类质量 | 稳定（同一模型+temperature 0） | 取决于当期会话模型 |

**建议**：A 为主（全自动、模型可控、成本极低）；B 作为零成本备选或过渡。两方案共用同一套数据库列与前端（M1/M4/M5 通道无关）。

## 5. 修改清单（M1–M9，逐条验收）

### M1 数据库迁移（`server/db.js`）——两方案共用

```sql
ALTER TABLE articles ADD COLUMN research_direction TEXT;
ALTER TABLE articles ADD COLUMN research_direction_secondary TEXT;  -- 次方向, 逗号分隔
ALTER TABLE articles ADD COLUMN direction_confidence REAL;          -- 0–1
ALTER TABLE articles ADD COLUMN direction_source TEXT;              -- ai|manual
ALTER TABLE articles ADD COLUMN direction_reason TEXT;              -- 依据 ≤30 字
ALTER TABLE articles ADD COLUMN classified_at TEXT;
CREATE INDEX IF NOT EXISTS idx_articles_direction ON articles(research_direction);
```
⚠️ 新列必须同时出现在 CREATE TABLE 与 ALTER 两处（ALTER 在前）；建索引前确认列存在。

### M2 方向体系（新增 `server/directions.js`，v2 缩减）
- 仅导出 `DIRECTIONS` 清单（key/label/定义/信号词）+ key 白名单校验；**不做规则分类**。
- system prompt 的方向清单由它生成，前端 `src/lib/directions.js` 复刻 labels + 色板。

### M3 LLM 分类作业（新增 `server/direction-classify.js`，仅方案 A 需要）
- 挂入 `maintenance.js` 的 `MAINTENANCE_TASKS`：`directions: { label: "AI研究方向分类", kind: "direction", ... }`，复用现有作业生命周期（取消/进度/持久化/预算时长）。
- 取数：`WHERE research_direction IS NULL`（且 `direction_source != 'manual'`），批 15 篇；输入 = 标题 + 关键词 + 摘要前 500 字（无摘要用标题+关键词）。
- 复用 runStage 骨架：轮次、excludeIds、stalled、maxDurationMs（1 h 上限沿用 `MAINTENANCE_MAX_DURATION_MS`）、shouldStop。
- 调用：OpenAI 兼容接口，temperature 0 + JSON mode；输出 key 必须在白名单，否则落 `other`；置信 <0.6 落库但 reason 前缀 `[待复核]`。
- 网络：复用 `http.js#requestJson` 退避；429 且 retry-after >30 s 交给下一轮作业。
- 幂等：`classified_at` 非空跳过；manual 永不覆盖；方向体系升级可 `SET research_direction=NULL WHERE direction_source='ai'` 重跑。

### M4 方案 B 配套脚本（仅方案 B 需要）
- `scripts/export-direction-batch.mjs`：导出待分类 JSON（≤500 篇/次，含分页游标）。
- `scripts/apply-directions.mjs`：读结果 JSON 写库（事务、manual 跳过、key 白名单校验、参数绑定）。
- WorkBuddy 每周自动化 prompt 模板（写入本文档附录，含方向清单全文，自包含）。

### M5 API（`server/index.js` / `server/admin.js`）——两方案共用
- 列表接口：`?direction=key1,key2`（多选 OR，参数绑定）；响应带出 6 新列。
- 新增 `/api/directions`：各方向计数（总数/近 30 日），供筛选面板与统计页。
- maintenance 作业类型注册 `directions`（方案 A）；管理中心加分类作业卡 + 待复核计数 + 一键补跑。
- 方向统计视图：方向分布条形图（近 7/30 日/全部）+ 方向 × 期刊组矩阵（tone 组色）。

### M6 前端（`src/main.jsx` / `Feed.jsx` / `ArticleCard.jsx` / `ArticleDialog.jsx` / `StatsView.jsx`）
1. 筛选面板新增"研究方向"分组（journal 组之后）：chips 多选 + 计数；hash `direction=storage,market`；`DEFAULT_FILTERS.direction: []`。
2. 卡片：关键词行首位主方向 chip（`--dir-{key}` 三档变量，不写死主题蓝），悬停显示置信度+依据；无方向不渲染。
3. 摘要弹窗：标题下方向区块（主/次方向 + 置信度 + 依据）；管理员下拉校正（提交 `direction_source='manual'`）。
4. 统计页方向板块（见 M5）。
（交互细节以上一轮会话 mockup 预览稿为准。）

### M7 测试
- `directions.test.js`（白名单/清单一致性）、`direction-classify.test.js`（mock LLM：非法 key、JSON 解析失败、断点续跑、manual 不覆盖）。
- 列表 direction 筛选分页回归；方案 B 另测 export/apply 脚本往返。
- 测试跑非沙箱终端，子进程走 `run-node-script.js`。

### M8 部署与首跑
- bump `version.json` + `CHANGELOG.md` → `sc_project_sync`（先 `sc_job_cancel`）→ 远端 `.env` 补 LLM 配置（方案 A）→ `scripts\redeploy.ps1` → 重启 → `-VerifyOnly` → `scripts\verify-render.mjs`。
- 首跑：管理中心触发一次全量 ≈3 977 篇（批 15、并发 2，约 40–60 min，作业内分多轮）；抽查每方向 2 条 + `[待复核]` 复核。

### M9 每周定时任务（v2 新增，方案 A 形态）
- `server/config.js`：`directionCron: process.env.DIRECTION_CRON || "30 8 * * 1"`（每周一 08:30，避开 08:00 的 refresh/push 峰）。
- `server/refresh.js`：与现有 `scheduleRefresh` 同构，`cron.schedule(config.directionCron, safeCron("directions", runDirectionClassification), { timezone: "Asia/Shanghai" })`。
- 触发逻辑：只处理 `research_direction IS NULL` 的新文章（周增量 ≈300–400 篇，作业 ≈3–5 min）；若已在跑其他作业则记录跳过（不排队挤占，下一周期自然补上）。
- 不新增 schtasks 系统任务（避开 schtasks 坑位：/end 强杀进程树、XML UTF-16 等）；watchdog 体系不变。
- 方案 B 形态：WorkBuddy 每周自动化（周一 09:00），prompt 自包含（导出→分类→写回→汇报），失败时下次会话补跑（作业幂等，按 NULL 增量）。

## 6. 成本估算（v2：全量 LLM，无规则层预消化）

| 项 | 存量（一次性） | 增量（每周） |
|---|---|---|
| 处理量 | ≈3 977 篇（84% 带摘要） | ≈300–400 篇 |
| Token（输入+输出） | ≈300 万 + 30 万 | ≈30 万 + 3 万 |
| 费用（DeepSeek 量级） | ≈¥5–8 | <¥0.1（月 <¥0.5） |
| 耗时 | ≈40–60 min（异步分轮） | ≈3–5 min |

## 7. 红线（全程有效）

- 100 s：LLM 只在异步作业/智能体会话中；列表/摘要/推送接口零新增网络调用。
- 新列两处同步（CREATE + ALTER）。
- 方向配色走 `--dir-*` 变量；不写死主题蓝。
- 新 UI 先预览再实施（mockup 已出）。
- 校验脚本走通行证鉴权；远端 .env 人工改，不进 sync。
- WorkBuddy 免密 LLM 通道不得从服务端调用（Origin 校验 + 官方禁止模式）。

## 8. 待拍板决策点（v2 更新）

1. **LLM 通道**：方案 A（远端直连，全自动）还是方案 B（WorkBuddy 智能体，零费用）？建议 A。
2. **Hy3 模型澄清**：Hy3 指哪个平台的模型？（腾讯混元第三代？）若其在某 OpenAI 兼容端点可用，方案 A 直接指定；WorkBuddy 会话模型无法自选，方案 B 用不了指定模型。
3. **方向集合**：14+1 是否增删？
4. **正则 keyword-topic 标签**：保留双标签还是卡片上由 AI 方向取代？

## 9. 验收标准汇总

| 编号 | 验收 |
|---|---|
| M1 | 旧库/新库升级 0 报错；6 新列齐备 |
| M2 | 白名单校验测试过 |
| M3 | 作业可取消/续跑/幂等；manual 行不变；非法输出落 other |
| M4 | export→apply 往返一致；manual 跳过 |
| M5 | `?direction=` 筛选分页正确；无参数行为与现状逐字节一致 |
| M6 | 按 mockup 落地；verify-render 通过 |
| M7 | 本机 npm test 0 warnings 全过 |
| M8 | 远端部署 + 首跑覆盖率 100%；抽查 30 条准确率 ≥90% |
| M9 | 周一 08:30 自动触发（日志可见）；新文章次日可见方向；手动触发幂等 |
