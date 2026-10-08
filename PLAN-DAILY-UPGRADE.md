# 每日任务升级方案（PLAN-DAILY-UPGRADE）

> 状态：**已批准实施（2026-10-08）**。决策结果：需求一采纳**简化路线**——放弃 A/B/C 三层（不做接口公开化、不做深链、正文不放外链），改为**文末引导访问网站**（渲染器引导语强化 + 草稿「阅读原文」固定指向站点首页）；需求二按 D4 建议执行（classify 并入每日 06:30 任务）；新增速评选题规则：**优先 IEEE Transactions on Smart Grid（TSG）**。
> 日期：2026-10-08　·　前置：公众号日报 L1 档已闭环（DESIGN-WECHAT-MP-DAILY.md，M4 通过）
> 需求：① 每日资讯原文链接直达/超链接；② 文献 AI 分类从每周一次改为每日增量（含分析及时性）。

---

## 需求一：资讯原文直达

### 1.1 平台硬限制（先说清楚做不到什么）

**个人订阅号的图文正文里，外部链接不可点击**——微信公众号只允许认证账号在正文中插入超链接，`draft/add` 的 content 对未认证账号会剥除 `<a>` 标签。此为微信平台限制，无法绕过。因此「正文内点链接直达原文」在当前账号类型下不可实现；以下是可达的最优组合。

### 1.2 三层方案

| 层 | 方案 | 效果 |
|---|---|---|
| A. 阅读原文深链 | `draft/add` 增加 `content_source_url` 字段，每天自动填 `https://lhmktz.top/#/news?date=<昨日>`；前端资讯页支持 `?date=` 深链自动定位单日 | 每期日报底部「阅读原文」一键直达当日资讯页，页内来源链接**全部可点**（网站不受微信限制） |
| B. 网站接口公开化 | `server/index.js` 通行证网关的 `publicApiPaths` 豁免 `/api/daily-news` 与 `/api/daily-news/detail` 两个只读接口 | 无通行证的公众号粉丝也能打开资讯页看全文与原文链接；文献库等其他接口鉴权**不变** |
| C. 正文来源可感知 | 资讯卡片来源行附域名明文：`来源：央视网 · 重点新闻（news.cctv.com）` | 正文内不可点，但来源可感知、域名可手动复制 |

依赖链：A 依赖前端深链支持；A 的价值依赖 B（无通行证粉丝可达）；C 独立。

### 1.3 变更清单

| # | 文件 | 改动 | 预期效果 |
|---|---|---|---|
| 1 | `src/features/news/DailyNewsView.jsx` | 挂载时解析 `location.hash` 中 `?date=`（严格 YYYY-MM-DD 校验，非法忽略），作为初始 `selectedDate` 并直接加载该日详情 | `#/news?date=2026-10-07` 打开即定位单日，深链无参行为不变 |
| 2 | `server/index.js` | `publicApiPaths` 增加 `"/api/daily-news"`、`"/api/daily-news/detail"` | 两个只读资讯接口免通行证；daily-news.js 自带日期白名单与路径穿越防护（已有），无需额外加固 |
| 3 | `scripts/publish-wechat-draft.mjs` | draft/add 的 article 增加 `content_source_url: https://lhmktz.top/#/news?date=<昨日>`（由 issue JSON 传入 `sourceUrl` 字段，渲染契约 +1） | 每期草稿自动带当日资讯深链 |
| 4 | `scripts/wechat-render.mjs` | 资讯卡片 source 行拼接域名（从 issue JSON 的 news 卡新增 `sourceDomain` 可选字段，缺省不显示） | 正文来源可感知 |
| 5 | `scripts/probe-wechat-html.mjs` | M2 增加：sourceUrl 与日期口径校验（深链日期 = 报道窗口日） | 防日期错位 |
| 6 | `scripts/sop-wechat-publish.md` + `DESIGN-WECHAT-MP-DAILY.md` | L0 粘贴路径补充「阅读原文需手动填当日深链」说明；设计文档记录本迭代 | 文档一致 |

### 1.4 验收标准

| # | 验收项 | 通过门槛 |
|---|---|---|
| M1 | 深链 | 浏览器无痕窗口（无通行证）打开 `https://lhmktz.top/#/news?date=<昨日>`：不弹登录、直接显示该日资讯，来源链接可点；非法 `?date=abc` 回退默认行为 |
| M2 | 有通行证回归 | 原有登录用户访问资讯页/feed 行为不变；`node --test` 全绿（daily-news.test.js 关注） |
| M3 | 草稿 | 次日草稿的「阅读原文」链接正确指向当日深链（草稿预览确认） |
| M4 | 探针 | probe 对 sourceUrl/sourceDomain 0 违规 |
| M5 | 部署 | version/CHANGELOG + sync + redeploy（`-SkipTests`）+ verify-render 全过 |

## 需求二：每日增量 AI 分类

### 2.1 现状与痛点

classify 每周日 23:00 集中跑（≤400 篇/轮），周中新入库文献 `research_direction IS NULL`：网站列表无方向标签、公众号日报的文献清单只能归「暂未分类」组。日增 40-60 篇，读者希望当天看到分类。

### 2.2 方案：并入每日 06:30 日报任务最前段（无代码改动）

```
每日 06:30 会话：
  ① classify 增量（RUNBOOK §4 流程：export-direction-batch --limit 400 → 只导 IS NULL
     → 会话按 4.2/4.3 分类 → apply-directions 写回；日增量 40-60 篇，一轮完成）
  ② 起跑日报链路（export-wechat-daily 导出的昨日文献即带方向 → 日报分组不再「暂未分类」）
  ③ 速评/渲染/探针/草稿写入（原链路不变）
```

- **零代码**：classify 脚本已幂等（只处理 IS NULL）、白名单与 manual 保护齐全，纯流程变更。
- **周日周作业不撤**：classify 变兜底（每日任务已清空增量时空跑，属正常现象，prompt 中注明）；digest 总览周报/方向专报/月报节奏不变。
- **"分析"及时性**：每日速评本就在日报中精选 5-8 篇即时撰写；全量速评仍按周（每日全量 40-60 篇速评的会话成本约为现状 5 倍，不建议，见决策点 D5 备选）。

### 2.3 变更清单（纯文档/流程）

| # | 位置 | 改动 |
|---|---|---|
| 1 | `RUNBOOK-AI-JOBS.md` §3 调度表 | 加一行：每日 06:30 / wechat-daily（含 classify 前置） |
| 2 | RUNBOOK §8.5 | 步骤 1 前新增「步骤 0.5 classify 增量」；注明空窗口与周作业兜底关系 |
| 3 | RUNBOOK 附录 A | 日报 prompt 与周作业 prompt 同步更新（逐字同步铁律）+ `.workbuddy` 镜像 |
| 4 | WorkBuddy 自动化 | prompt 用 automation_update 同步（逐字） |

### 2.4 验收标准

| # | 验收项 | 通过门槛 |
|---|---|---|
| M6 | 分类写回 | apply-directions 的 invalid=0；当日远端 `research_direction IS NULL` 数量较前日减少（≈当日入库量） |
| M7 | 日报收益 | 次日起日报文献清单按方向分组呈现，「暂未分类」组消失（当日未分类新增除外） |
| M8 | 周作业兼容 | 周日 classify 空跑（或仅漏网几篇）不报错；digest/专报节奏不变 |
| M9 | 连续观察 | 连续 7 天：分类延迟 ≤1 天、无批次失败积压 |

## 决策点

| # | 决策点 | 建议 |
|---|---|---|
| D1 | daily-news 两接口是否公开化（B 层） | **放开**（内容聚合自公开渠道、每条带官方来源，无个人数据；文献库等其余接口鉴权不动） |
| D2 | 「阅读原文」目标 | 当日资讯深链（推荐）；备选：网站首页 |
| D3 | 来源行域名明文（C 层） | 加（推荐，正文长度几乎不变）；不加则来源维持现状 |
| D4 | 每日 classify 挂载点 | 并入 06:30 日报任务（推荐，单会话完成零额外开销）；备选：独立定时任务（多一次会话启动） |
| D5 | 速评及时性口径 | 维持「日报精选 5-8 篇即时 + 周报全量」（推荐）；备选：每日全量速评（会话成本 ×5，且与周报速评重复率高） |

## 批准后执行顺序

1. 需求一：变更 1-2（深链 + 公开化）→ 本机测试 + 探针 → 变更 3-5（草稿/渲染/探针）→ 部署（M5）
2. 需求二：RUNBOOK/镜像/自动化 prompt 同步（M6-M8 随次日运行观察，M9 挂连续 7 天）
3. 收尾：version/CHANGELOG、当日日志、DESIGN 文档迭代记录
