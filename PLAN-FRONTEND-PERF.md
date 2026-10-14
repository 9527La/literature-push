# 前端性能诊断与优化方案（PLAN-FRONTEND-PERF）

> 2026-10-14 首版。定位结论 + 按优先级的可落地优化项 + 验收标准。
> **本文只做诊断与方案，未改动任何源码**；按项目惯例，审批通过后再逐项实施。
> 实测环境：本机 4188 预览服务（`_reports-preview` 库，4403 篇文献 / 1849 篇带关键词 / 6556 个唯一关键词），无头 Edge，另跑一组 4× CPU 降速模拟中端机。

---

## 一、结论速览

| # | 问题 | 位置 | 实测代价 | 优先级 |
|---|---|---|---|---|
| 1 | **统计页首屏 3.7 s（中端机 8.1 s）**：`/api/keyword-stats` 返回 **4.5 MB** 原文（gzip 后仍 668 KB），客户端一次性渲染 **6556 个关键词按钮、41608 个 DOM 节点** | `server/db.js#getKeywordStats` + `StatsView.jsx` | 长任务累计 504 ms（中端机 4520 ms） | **P0** |
| 2 | **新手教程启动即下载 8 个分包**（OnboardingTour 自身 28.7 KB + `prefetchPages()` 7 个视图分包 ≈ 101 KB），与首屏数据请求抢带宽和主线程 | `OnboardingTour.jsx:21-32, 578-594` | 教程弹出时长任务 522 ms（中端机） | **P0** |
| 3 | **教程第④步自动点击「打开筛选」→ 触发 4.5 MB 的 keyword-stats**（筛选面板只用它取热门关键词 chips） | `OnboardingTour.jsx:116-124` + `Feed.jsx:143-153` | 该步长任务 804 ms（中端机，含 4.5 MB 解析） | **P0** |
| 4 | 教程轮询 140 ms/次 + **非 passive 的 capture scroll 监听**，每 tick 强制读布局；重页面（统计页 4 万节点）下滚动掉帧 | `OnboardingTour.jsx:616-696` | 滚动两屏长任务 70 ms（中端机，文献库）；统计页下更差 | P1 |
| 5 | `/api/keyword-cooccurrence` 同样全表扫描，300 KB 原文；且与 keyword-stats **串行**请求，第二个请求的启动被前者的渲染长任务堵住 | `db.js:1893-1952`、`StatsView.jsx:63-83` | 浏览器侧 507 ms（独立请求仅 65 ms） | P1 |
| 6 | 速览页月报 `directions=` 批量包一次返回全部方向专报（含各专报 paperBriefs）；生产规模估算 ≈ 14 方向 × 300 briefs ≈ 560 KB 原文 | `ReportsView.jsx:496-522`、`server/index.js:245` | 未在生产库实测（预览库 briefs 为空），按契约估算 | P1 |
| 7 | 环境层：CF 隧道**每新建连接 0.7–1.1 s**（局域网同资产 15–20 ms），请求数比字节数更敏感；字体按 unicode-range 分片，标题区（serif）每页拉 2–8 个子集 | 部署层 | 首访全部资产 ≈ 0.7–1.1 s/个 | P2 |

**不慢的环节（已优化到位，勿回退）**：文献库首屏列表（50 篇 14 KB gz / 80 ms）、文献弹窗与相关文献（2–23 ms）、每日资讯（热后 6–19 ms，405 ms 为冷启动误报）、速览 meta 列表（2 KB / 2–4 ms）、卡片阅读全文批次（50 篇 127 KB / 8 ms）。

---

## 二、根因分析

### 2.1 keyword-stats：一个为「筛选面板 chips」设计的重接口，被三处消费

`getKeywordStats`（`server/db.js:1836`）全表取出带关键词文献，为**每个关键词内嵌全部文献对象**（`{id,title,journal,published_at,display_date,url,doi}`）。预览库实测：

- 唯一关键词 **6556 个**，涉及文献 1849 篇，最大关键词「Renewable energy」内嵌 **156 篇**完整文献对象；
- 响应 **4.5 MB 原文 / 668 KB gzip**，服务端 123 ms；
- 客户端 `JSON.parse` 27 ms（中端机约 110 ms），随后 `StatsView` 列表模式 `filteredKeywords.map()` **无上限渲染 6556 个按钮**，全页 41608 个 DOM 节点。

消费方有三个，需求却各不相同：

| 消费方 | 实际用到的字段 | 是否需要内嵌文献 |
|---|---|---|
| 统计页列表/词云 | `keyword`、`count` | 否（点关键词后才需要） |
| 统计页关键词文献面板 | `articles`（选中那个关键词的） | 是，但只有 1 个关键词 |
| 文献库筛选面板热门关键词 | `keyword`、`count` | 否 |

即 95% 的传输量服务的是「点开某一个关键词」的按需场景。

### 2.2 新手教程的三个放大机制

1. **启动即预热 8 个分包**：`prefetchPages()`（`OnboardingTour.jsx:30-32`）在教程弹出的**同一时刻**并发 import 7 个视图分包；加上 OnboardingTour 自身分包，首访 JS 从 ≈530 KB 涨到 ≈630 KB。隧道环境下每个请求 ≈0.7–1 s，直接拖慢同周期的首屏列表请求。
2. **自动操作触发重请求**：第④步 `perform` 代替用户点击 `.filter-toggle`（`OnboardingTour.jsx:122`），筛选面板首次打开即请求 keyword-stats（`Feed.jsx:143-153`）——教程进行中突然插入一个 668 KB 的下载 + 4.5 MB 解析，表现为「点着突然卡一下」。
3. **轮询 + 非 passive 滚动监听**：`setInterval(tick, 140)` 且 `window.addEventListener("scroll", tick, true)`（capture、非 passive）。每个 tick 调 `getBoundingClientRect()` 强制读布局，`setRect` 再写内联样式触发合成。文献库上实测每次滚动两屏 70 ms 阻塞（中端机）；若用户在**统计页**（4 万节点）开着教程滚动，单次强制布局成本数量级上升。

### 2.3 环境层（非代码问题，但决定体感）

- 隧道/CF 每连接 0.7–1.1 s（本机 LAN 15–20 ms）——**请求个数**比字节数更金贵；
- 静态资源已带 `immutable` 一年缓存（复访快），痛点集中在**首访与接口**；
- 字体 `font-display: swap` + unicode-range 分片设计正确，标题（`.title-button` 用 Noto Serif SC）每页约拉 2–8 个子集，属可接受范围，暂不动。

---

## 三、优化方案（按优先级；每项含修改点 / 预期效果 / 验收标准）

### P0-1 统计接口瘦身：keyword-stats 不再内嵌文献全量

| 项 | 内容 |
|---|---|
| 修改点 | ① `server/db.js#getKeywordStats`：响应只返回 `{keyword, count}`，删除 `articles` 数组（预计 4.5 MB → ≈200 KB）；② 新增 `GET /api/keyword-stats/articles?keyword=xx&limit=50&offset=0`（或直接复用已有 `GET /api/articles?keyword=xx`，筛选语义现成）；③ `StatsView.jsx` 选中关键词时按需拉取文献面板数据（`StatsView.jsx:265-303` 改消费新接口）；④ `Feed.jsx:146` 面板 chips 不受影响（本来就用不到 articles） |
| 连带 | `server/article-filters.test.js` / `server/db-translation-coverage.test.js` 若断言 keyword-stats 结构需同步；`scripts/probe-*.mjs` 无相关断言则不加 |
| 预期效果 | 传输 668 KB → ≈40 KB（gz）；统计页首屏长任务 504 ms → ≈150 ms；中端机 8.1 s → ≈2.5 s |
| 验收标准 | 探针断言 `GET /api/keyword-stats` 响应 < 250 KB 且每条 keyword 无 `articles` 字段；统计页点关键词后面板正确列出文献且可打开摘要；`npm test` 全绿 |

### P0-2 关键词列表虚拟化 / 分页渲染

| 项 | 内容 |
|---|---|
| 修改点 | `StatsView.jsx:244-260` 列表模式：默认渲染前 100 条，底部「显示更多」每次 +100（或按滚动哨兵加载）；`filteredKeywords` 的 `useMemo` 不变 |
| 预期效果 | 首屏 DOM 从 41608 节点降到 ≈1 万节点内；输入框过滤（每敲一次 filter 6556 项）保持流畅 |
| 验收标准 | 统计页 `document.querySelectorAll('.keyword-freq-item').length ≤ 100`（展开前）；「显示更多」点击后按 100 递增；词云模式（前 50/100/200）行为不变 |

### P0-3 教程启动与重请求治理

| 项 | 内容 |
|---|---|
| 修改点 | ① `OnboardingTour.jsx:21-32`：`prefetchPages()` 改为**只预热接下来 2 步会去的页面**（或整体删除——TopNav hover/focus 已有预热，`main.jsx:26-29`）；② 第④步不再 `perform` 自动点击 `.filter-toggle`，改为提示用户自己点（`advance` 判定保留）；若坚持自动点击，则 ③ `Feed.jsx:143-153` 面板关键词改用新的轻量统计（P0-1 之后天然变轻，此项可省） |
| 预期效果 | 教程启动额外下载 101 KB → ≈0–30 KB；教程进行中不再插入 668 KB 请求 |
| 验收标准 | `_tmp/verify-tour-v3.mjs` 全流程仍 PASS；探针断言教程弹出后 3 s 内 `/api/articles*` 之外无 >100 KB 的请求；首访 JS 总字节下降可对比 |

### P1-1 教程轮询与滚动监听轻量化

| 项 | 内容 |
|---|---|
| 修改点 | `OnboardingTour.jsx:687-688`：scroll 监听改 `{ passive: true, capture: true }` 且用 rAF 合并一帧一次 measure；`measure()` 内多次 `getBoundingClientRect`（目标 + advance 里的 `visible()`）合并为一次读取；页面 `document.hidden` 时暂停轮询 |
| 预期效果 | 滚动期间每帧强制布局从「每事件一次」降为「每帧一次、只读一次」；统计页等重页面下教程滚动不掉帧 |
| 验收标准 | 探针复跑「教程轮询中连续滚动两屏」长任务 ≤ 现有值的 50%；教程高亮跟随、自动推进行为不变（`verify-tour-v3.mjs` PASS） |

### P1-2 共现接口与请求编排

| 项 | 内容 |
|---|---|
| 修改点 | ① `StatsView.jsx:71-76`：keyword-stats 与 cooccurrence 改**并行**请求（`Promise.all`），消除后者被前者渲染长任务堵住 500 ms 的排队；② `db.js#getKeywordCooccurrence`：`keywords` 频率表只返回 top 200（cooccurrences 已 slice 100），响应 300 KB → ≈80 KB |
| 预期效果 | 统计页接口阶段从「123 + 507 ms 串行」降为「≈max(123, 80) 并行」 |
| 验收标准 | 探针断言两请求并行发起；共现面板 top 100 数据与改前一致 |

### P1-3 速览页方向包按需化

| 项 | 内容 |
|---|---|
| 修改点 | `ReportsView.jsx:507-510`：`directions=` 批量包改为**只取当前选中方向**的 detail（总览态取 overview + 各方向仅 meta）；切换方向 chip 时再拉该方向 detail |
| 预期效果 | 月报首屏 detail 传输估算 560 KB → ≈60 KB（生产规模） |
| 验收标准 | 速览页切换期数/方向行为不变；探针断言首屏 detail 请求体 < 100 KB；聚类/速评/来源构成微条数据不回退 |
| 前置 | 需先在生产库跑一次探针确认批量包实际大小（本地方案列为估算项） |

### P2-1 请求数治理（环境层配合）

| 项 | 内容 |
|---|---|
| 修改点 | ① `index.html`：对标题 serif 实际命中的 1–2 个拉丁子集加 `<link rel="preload">`（消除 FOUT 二次布局）；② 教程步骤的 `autoSkipIfMissing 2.2 s` / `stuck 5 s` 阈值在接口变轻后复跑校准；③ 复查 `font-face.css` 的 `immutable` 缓存与「重新裁剪字体后文件内容变、文件名不变」的风险（改内容时给 CSS 加 hash 查询参数） |
| 预期效果 | 首访少 1–2 个字体往返；教程卡顿阈值更贴合实际 |
| 验收标准 | 字体预加载后标题无可见字体跳变；教程在 4× 降速下无「自动跳过」误触 |

---

## 四、期望达到的性能指标（验收基线）

| 指标 | 现状（本机 / 中端机 4×） | 目标 |
|---|---|---|
| 统计页首屏可交互 | 3.7 s / 8.1 s | **< 1.5 s / < 3 s** |
| 统计页首屏长任务累计 | 504 ms / 4520 ms | **< 150 ms / < 600 ms** |
| keyword-stats 传输（gz） | 668 KB | **< 50 KB** |
| 统计页 DOM 节点 | 41608 | **< 12000** |
| 教程启动额外下载 | ≈130 KB / 8 请求 | **< 30 KB / ≤2 请求** |
| 教程进行中最大单请求 | 668 KB | **< 100 KB** |
| 教程轮询中滚动长任务 | 70 ms（中端机，文献库） | **≤ 35 ms**，统计页同样达标 |
| 文献库首屏列表 | 80 ms / 14 KB | 保持（不回退） |
| `npm test` | 远端恒 1 败（ieee.test.js） | 改后仍仅该 1 败，无新增 |

---

## 五、待用户决策点

1. **P0-1 的文献面板数据源**：(A) 新增轻量 `/api/keyword-stats/articles?keyword=` 分页接口；(B) 直接复用 `GET /api/articles?keyword=xx`（零新接口，但分页/排序语义以列表接口为准）。推荐 (B)，改动最小。
2. **P0-3 教程预热**：(A) 只预热后 2 步页面；(B) 完全删除 `prefetchPages`（TopNav hover 已覆盖大部分场景）。推荐 (B)，首访最干净。
3. **P0-3 第④步是否保留「自动打开筛选面板」**：保留则依赖 P0-1 先落地；不保留则用户多点一次。推荐保留点击动作但接受面板晚 100 ms 出现（P0-1 后接口已轻）。
4. **P1-3 是否需要现在做**：依赖生产库实测数据，建议放在 P0 三项验收通过后、先补探针再定。

## 七、实施记录（2026-10-14 已落地，版本 2026.10.14.30）

### 7.1 已完成项与实测对比

| 项 | 改动 | 改前 | 改后（实测） |
|---|---|---|---|
| 教程·高亮同步 | `OnboardingTour.jsx` 跟踪循环：去掉"连续两次测量一致"就绪门，首次测量即落位；位移 >8px 立即跟手，<8px 才去抖 | 就位 280~440 ms | **平均 63 ms / 中位 5 ms**（51 步全流程实测） |
| 教程·动画统一 | `99-tail.css` 新增统一层：`--tour-dur:220ms` + `cubic-bezier(.22,.61,.36,1)`，遮罩/描边环/气泡/进度条共用 | 各动各的（.16s ease / .2s / .3s） | 单一节奏 |
| 教程·消除跳变 | 四块遮罩条常驻（无 rect 时＝整屏遮罩），挖孔平滑开合；跨页步骤先清旧矩形 | dim ↔ 四条的硬切换闪一下 | 平滑开合、无跨页滑动 |
| 教程·滚动流畅 | scroll/resize 改 `passive` + rAF 合并；`document.hidden` 时暂停轮询 | 每事件一次强制布局 | 每帧最多一次 |
| 教程·启动轻量 | `prefetchPages` 改为只预热后 2 步页面 | 弹出后新增 **8 个分包** | **1 个**（仅教程自身） |
| 教程·弱机 | `prefers-reduced-motion` 全量降级 | 无 | 瞬时完成、关呼吸环 |
| P0-1 keyword-stats | 不再内嵌文献数组；新增 `/api/keyword-articles` 精确分页 | 4.5 MB / gz 668 KB / 123 ms | **293 KB / gz 63 KB / 53 ms** |
| P0-2 关键词列表 | 渐进渲染（首屏 100 + 显示更多） | 6556 按钮 / 41608 DOM | **100 按钮 / 2872 DOM** |
| P1-2 共现 | 去掉未消费的频次表；与统计接口并行 | 300 KB / gz 61 KB | **8 KB / gz 1.2 KB** |
| P1-2 统计页编排 | `Promise.all` 并行 | 串行（后者被前者渲染堵 500 ms） | 并行 |

**统计页端到端（进入 #stats → 摘要渲染）**

| 指标 | 改前 | 改后 |
|---|---|---|
| 无降速 | 1218 ms | **841 ms** |
| 4× CPU 降速 | 5636 ms | **1428 ms** |
| 长任务累计（无降速 / 4×） | 504 ms / 4520 ms | **0 ms / 550 ms** |
| 最长单任务（4×） | 2941 ms | **170 ms** |

**教程内步骤④（自动打开筛选面板）**：长任务 804 ms → **108 ms**（4× 降速）。

### 7.2 验收与回归

- `npm test`：**190 / 190 通过**（含 `article-filters` / `publishers` / `ieee` 等）
- 接口探针 `_tmp/probe-keyword-api.mjs`：**全部通过**（含"分页接口篇数与统计口径一致"156 = 156、"精确匹配"、"第二页不重复"、"缺参 400"）
- 教程全流程 `_tmp/verify-tour-v4.mjs`：**51 / 51 步走完、标题序列与源文件逐项一致、0 页面异常**
  - 其中 5 步就位 >300 ms（研究速览 451 ms、每日资讯 292 ms、注册 412 ms、收藏 394 ms、关键词统计 401 ms）——均为**跨页步骤**，延迟来自目标元素本身尚未渲染（页面数据在加载），元素一出现即落位，属预期行为
  - 第 39–47 步（文献推送设置）在**游客态**无高亮：设置页对游客渲染的是"游客模式"占位（无 `.settings-left`），这是既有设计（这些步骤面向已注册个人账户），非本次回归
- 教程启动分包 `_tmp/probe-tour-chunks.mjs`：新增 1 个（仅 OnboardingTour）

### 7.3 未实施项（保持原计划）

- **P1-3 速览页方向包按需化**：仍待生产库实测数据（预览库 paperBriefs 为空，估不出真实体量）；改动会触及聚类/速评/来源构成微条的数据链路，建议单独一轮做并补探针。
- **P2-1 字体子集 preload**：当前标题 serif 每页约 2–8 个子集，收益有限；若后续开启「中文摘要」批量阅读再评估。

### 7.4 新增/变更的探针与脚本

- `_tmp/probe-keyword-api.mjs`（接口验收，可复跑）
- `_tmp/verify-tour-v4.mjs`（教程全流程 + 高亮就位延迟实测，按源文件标题断言）
- `_tmp/probe-tour-chunks.mjs`（教程启动分包计数）
- `_tmp/probe-stats-perf.mjs` / `-native.mjs`（统计页长任务，计时口径已修正）
- `_tmp/repro-catalog-to-reader.mjs`（真实点击路径复现：生成目录 → 开始卡片阅读）
- `_tmp/probe-reader-empty-recover.mjs`（空目录一键放宽条件验收）

### 7.5 追加修复：生成目录后进不去卡片阅读（2026.10.14.31）

**现象**：教程「第七步：生成文献目录」之后无法进入卡片阅读。

**根因**：教程前几步的 `perform` 会把条件演示性地设窄（选一本期刊 / 改时间范围 / 选方向 / 设上限）。点「下一步」时教程会先点「重置条件」再生成，所以走得通；但**用户自己手点「生成文献目录」**不会重置 → `buildCatalog` 抛"当前条件下没有匹配的文献" → `setCatalog` 从未执行 → 不进入目录态 → **没有「开始卡片阅读」按钮**，且 `advance: () => visible(".reader-catalog-row")` 永不成立 → 教程卡死在该步。

**修复（两层兜底）**
1. 教程新增 `recover` 机制（`OnboardingTour.jsx` 跟踪循环）：步骤可声明"走不通时怎么自救"，检测到 `.reader-setup-error` 即自动「重置条件 + 重新生成目录」，提示"当前条件太窄，已自动放宽条件并重新生成目录"，带 4s 冷却防抖。
2. 页面兜底（`ReaderSetup.jsx`）：错误提示旁新增「重置条件并重新生成」（自定义模式下显示）。实现上用 `pendingRebuild` 标记 + `useEffect`，**等重置后的新 state 生效再生成**——直接在同一闭包里调用会读到旧条件（这点与教程的 DOM 点击路径等价）。

**验证**
- `_tmp/repro-catalog-to-reader.mjs`：真实手点路径 → 目录 100 行 → 点「开始卡片阅读」→ 阅读器打开（1680×1000）→ 教程进入「翻页」✓
- `_tmp/probe-reader-empty-recover.mjs`：把时间范围设到 2030 年制造空结果 → 报错 + 一键按钮 → 点击后目录 100 行、可进阅读 ✓（6/6 断言通过）
- 教程全流程 `verify-tour-v4.mjs` 复跑：51/51 步、序列一致、高亮就位平均 57 ms
- `npm test`：190 项（首次运行出现 1 项偶发失败，复跑两次均 190/190；与本次改动无关的时序敏感用例）


## 八、复现与复测命令（全部已落盘）

- 接口探针：`node _tmp/probe-perf.mjs` / `node _tmp/probe-perf2.mjs`
- 关键词接口验收：`node _tmp/probe-keyword-api.mjs`
- 教程全流程性能：`node _tmp/probe-tour-perf.mjs http://127.0.0.1:4188`（含 4× CPU 降速与长任务采集）
- 教程全流程正确性 + 高亮延迟：`node _tmp/verify-tour-v4.mjs http://127.0.0.1:4188`
- 教程启动分包计数：`node _tmp/probe-tour-chunks.mjs`
- 统计页性能：`node _tmp/probe-stats-perf.mjs`（降速）/ `node _tmp/probe-stats-perf-native.mjs`（原生）
- 字体子集估算：`node _tmp/probe-font-subsets.mjs`
- 预览服务：`PORT=4188 LITERATURE_DATA_DIR="E:/Users/admin/文档/文献推送/_reports-preview" node server/index.js`（当前仍在后台运行）
