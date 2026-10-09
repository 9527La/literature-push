# PLAN — 全站卡片动效升级（悬停光效 + 顶部色条 + 上浮 + 入场级联扩展）

> 状态：**待审批**（本轮只交方案，不改任何源文件；批准后先出 mockup 再实施）
> 日期：2026-10-09 ｜ 参考页：aihot-daily-briefing（AI 日报看板）、aihot-weekly-papers（AI 论文档案库）
> 原则：**只模仿动画效果**；色相一律沿用现有期刊五色系变量，仅调整深浅/透明度。

---

## 0. 结论先行

将参考页的 4 个原子动效移植到本项目，按「整卡 / 行内」两档分配到 8 个表面，全部通过 `styles.css` 文件末尾追加段 + 少量 JSX `enterDelay` 传参实现，不改任何布局与色相定义：

| 原子效果 | 来源 | 移植后规格 | 应用表面 |
|---|---|---|---|
| A1 悬停彩色光晕 | 日报 `.card:hover` 彩色阴影 | 期刊色系光晕叠加中性阴影 | 所有卡片 |
| A2 顶部色条展开 | 日报 `.card::before` scaleX | 3px 色系渐变条从左展开 | 整卡档 5 处 |
| A3 悬停轻微上浮 | 论文库 `.paper:hover` translateY(-2px) | -2px 合成层位移 | 所有卡片 |
| A4 逐个加载入场 | 两页 opacity+位移 级联 | 统一 40ms 步进入场级联 | 4 个列表页 |

---

## 1. 参考页动画解析（拆到可移植的原子）

### 1.1 AI 日报看板（daily-briefing）

| 元素 | 实现机制 | 视觉效果 |
|---|---|---|
| 卡片悬停 | `:hover{transform:translateY(-3px); box-shadow:0 8px 28px rgba(255,107,53,0.16); border-color:var(--border-hover)}` | 上浮 + **主题色光晕** + 边框换色 |
| 顶部色条 | `.card::before{top:0;height:3px;background:渐变;transform:scaleX(0);transform-origin:left}` → hover `scaleX(1)`，300ms | **卡片最上方一条渐变色从左向右展开** |
| 入场级联 | `opacity:0 + translateY(16px)`，IntersectionObserver 进视口触发，每卡 +40ms 延迟 | 卡片逐个浮现 |
| 过渡曲线 | `0.25s cubic-bezier(0.4,0,0.2,1)` | 全局统一缓动 |

### 1.2 AI 论文档案库（weekly-papers）

| 元素 | 实现机制 | 视觉效果 |
|---|---|---|
| 入场 | `.paper{opacity:0;transform:translateX(-12px)}` → `.visible` 恢复，600ms ease | 逐个滑入 |
| 悬停 | `:hover{transform:translateY(-2px); background:var(--bg-elevated); border-color:加深; box-shadow:加深}` | **轻微上浮 + 背景提亮一档 + 边框变色** |

> 参考页均为纯 CSS transition/animation + transform/opacity（合成层动画），无 JS 逐帧驱动、无鼠标跟随光斑。**本项目按同口径移植**，不引入 mousemove 光斑（见决策点 D4）。

---

## 2. 现状盘点（本项目已有机制，避免冲突）

| 事实 | 位置 | 对本方案的影响 |
|---|---|---|
| Feed 卡片**已有**入场级联：`article-enter 240ms`，translateY(6px)，40ms 步进，上限 600ms | styles.css 5456 行（B3-2 段）、Feed.jsx `enterDelay={…*40}` | A4 只需**微调幅度**（6px→10px、240ms→300ms），机制复用 |
| 悬停已有：三边描边换 `--tone-ring` + 底色提亮 + `--shadow-md`，**无上浮** | styles.css 4854 行（五色系段） | A1/A3 在其上**追加**，不回退已有变色逻辑 |
| ⚠️ 971 行历史注释：曾因「指针下移时整列抖动」**移除过悬停 translateY** | styles.css 966–970 行 | 与本次需求冲突 → **决策点 D1** |
| `.article::before` 已存在但被 `display:none` 废弃 | styles.css 3145 行 | 顶部色条可直接复活该伪元素（末尾新规则覆盖） |
| `.article` 已有 `overflow:hidden` | styles.css 4810 行 | 色条 `position:absolute` 不会被裁切问题阻塞，直接可用 |
| 色系铁律：卡片配色只经 `--tone/--tone-soft/--tone-line/--tone-ring`（4 期刊组），悬停/阴影新规则**必须写文件末尾** | styles.css 4780+ 行、MEMORY 铁律 | 本方案全部新规则落在文件末尾追加段 |
| 全局 `prefers-reduced-motion` 兜底（动画/过渡压到 0.01ms） | styles.css 3241 行 | 新动画自动降级，无需额外代码 |
| 卡片 `content-visibility:auto` 离屏跳过渲染 | styles.css 962 行 | transform 悬停兼容；入场动画由挂载触发，行为与 B3-2 一致 |
| 弹窗 `dialogEnter`、骨架屏 `skeleton-sweep` 已有 | 1293 / 5434 行 | 不动，气质已统一 |

**其他卡片表面现状**（均只变色、不位移、无入场动画）：

| 表面 | 选择器 | 现有悬停 |
|---|---|---|
| 收藏卡 | `.favorite-card`（4009 行） | 仅标题变色 |
| 速评卡（研究速览） | `.reports-brief-card`（5199 行） | 边框 tone 变色 + shadow-sm |
| 速览精选卡 | `.reports-hl-card`（5078 行） | 边框变色 + shadow-sm |
| 统计页文献行 | `.journal-article-row`（5135 行） | 边框变色 + shadow-sm |
| 统计页关键词文献卡 | `.keyword-article-card`（1926 行） | 边框变色 |
| 公众号日报条目 | `.daily-item`（5347 行） | — |
| 弹窗相关文献行 | `.related-item`（5485 行） | 底色/边框变色 |

---

## 3. 方案设计

### 3.1 表面分档

**S1 整卡档**（全套 A1 光晕 + A2 顶部色条 + A3 上浮 + A4 入场）：
`.article`、`.favorite-card`、`.reports-brief-card`、`.reports-hl-card`、`.daily-item`

**S2 行内档**（A1 淡光晕 + A3 上浮 -1px，**不加**顶部色条——条目太矮，色条会喧宾夺主）：
`.journal-article-row`、`.keyword-article-card`、`.related-item`

**不动的表面**：管理端 AdminView（保持素净）、弹窗/Toast（已有进出场动画）、导航/按钮（已有 hover 反馈）。

### 3.2 动画规格表（最终参数）

| 效果 | 规格参数 | 说明 |
|---|---|---|
| A1 光晕 | `box-shadow: 0 6px 20px color-mix(in srgb, var(--tone) 16%, transparent), var(--shadow-md)` | 光晕色取期刊色系 `--tone`（S2 档降为 10%）；已读卡悬停光晕降为 10%。color-mix 不支持时自动退回纯 `--shadow-md` |
| A2 顶部色条 | `.article::before`：`top:0;left:0;right:0;height:3px`，`background:linear-gradient(90deg, var(--tone), color-mix(in srgb, var(--tone) 30%, transparent))`，`transform:scaleX(0);transform-origin:left` → hover `scaleX(1)`，`transition:transform 280ms var(--ease-out)` | 复活 3145 行废弃伪元素；需先写 `display:block` 覆盖。各期刊色系自动生效 |
| A3 上浮 | `:hover{transform:translateY(-2px)}`（S1）/ `-1px`（S2）；`transition` 列表补 `transform var(--transition)` | 合成层动画不触发 layout；位移幅度对齐参考页 2 的「轻微」档 |
| A4 入场级联 | `animation: card-enter 300ms var(--ease-out) backwards; animation-delay: var(--enter-delay,0ms)`；keyframes `from{opacity:0;transform:translateY(10px)}`；步进 40ms、单批上限 480ms | Feed 现有 B3-2 的 keyframes 微调（6px→10px、240ms→300ms）后全体复用；`--enter-delay` 由各列表 JSX 按 `index*40` 传入（Feed 已有同款机制，Favorites/Reports/News/Stats 新增传参） |

### 3.3 色彩约束（对应需求第 4 点）

- **零新增色相**：光晕、色条、提亮全部从 `--tone/--tone-soft/--tone-ring` 派生（color-mix 混白/混透明）；
- 「深浅可变」的落点：悬停光晕透明度 10%–16%、已读卡光晕降档、elsevier 已调浅的 `--tone-soft`（6241 行）自动被光晕继承；
- 网站主题蓝 `#3157d5` 不出现在卡片动画里（沿用「主题色管操作层、色系管卡片身份」的既有分工）。

### 3.4 实现载体（严格对齐项目铁律）

1. `src/styles.css`：所有新规则**追加在文件末尾**新段「2026-10-09 · 卡片动效批」（约 100–130 行），不扰动历史层叠；悬停规则天然位于五色系段之后，特异性冲突为零。
2. JSX 传参：`FavoritesView / ReportsView / DailyNewsView / StatsView` 各列表 `map((item,index)=> … style={{"--enter-delay": …}})`，模式与 Feed 完全一致。
3. 不改：色系变量定义、卡片布局结构、服务端、数据口径。

---

## 4. 决策点（请逐项确认）

1. **D1 · 悬停上浮 vs 历史注释**：styles.css 971 行注释记载——此前版本曾给 `.article` 悬停加过 translateY，因「指针沿列表下移时整列抖动」被移除。本次参考页 1/2 同为纵向卡片列表且均带 -2~-3px 上浮，您明确要求此效果。方案按 **-2px + 200ms** 恢复上浮（transform 为合成层动画，不触发重排；抖动观感主要来自幅度过大，2px 幅度与参考页 2 一致）。是否确认恢复？
   - A. 确认 -2px（推荐，对齐参考页）
   - B. 保守 -1px
   - C. 不上浮，仅光晕+色条
2. **D2 · 顶部色条形态**：
   - A. 3px 渐变条从左展开（参考页 1 原样，推荐）
   - B. 更轻：仅顶边框在悬停时从灰过渡为色系色（无边条感）
3. **D3 · 入场级联范围**：
   - A. 扩展到全部 4 个列表页（收藏/速览/日报/统计行内档也加），全站气质统一（推荐）
   - B. 仅微调 Feed 现有动画，其他页面不加
4. **D4 · 鼠标跟随光斑**（radial-gradient 跟随鼠标移动的「真·光效」）：**两个参考页均无此效果**，且需给每卡绑 mousemove 写 CSS 变量。默认**不做**以严守「只模仿动画效果」；如确需可后续加做。确认不做？

---

## 5. 实施流程（mockup 优先）

| 阶段 | 动作 | 产物 | 门禁 |
|---|---|---|---|
| ① Mockup | 独立 HTML 复刻 4 色系 × 已读/未读/收藏三类卡片 + 上述全部动效（可交互悬停、可重放入场），**不动源文件** | `DESIGN-MOCKUP-CARD-ANIM.html` | 您预览确认动效观感 |
| ② 实现 | styles.css 末尾追加动效段 + 4 个 View 传 `--enter-delay` | 源码改动（严格对齐本 PLAN 3.4 节清单） | 改动范围 = PLAN 清单，零超纲 |
| ③ 验证 | 本地 dev 目检 4 列表页 + 截图脚本 + `node --test` 回归 | 截图 + 测试输出 | 见 §6 验收标准 |

---

## 6. 验收标准（预期效果）

| # | 检查项 | 预期效果 |
|---|---|---|
| 1 | Feed 卡片悬停 | 光晕（期刊色系）+ 顶部色条展开 + -2px 上浮 + 原有边框/底色变色，四效果叠加且过渡顺滑无跳变 |
| 2 | 已读卡悬停 | 光晕降档（10%），已读/未读在动效下仍一眼可辨 |
| 3 | 收藏卡/速评卡/精选卡/日报条目悬停 | 与 Feed 同套效果（色条取各自色系/方向色） |
| 4 | 统计行/相关文献行悬停 | -1px 上浮 + 淡光晕 + 变色，无顶部色条 |
| 5 | 各列表入场 | 首屏卡片 40ms 步进逐个浮现；翻页新批次正常重播；无白屏/闪烁 |
| 6 | Loading 交互 | 翻页三规则不回退：`diagnose-stuck-loading.mjs` 通过；loading 收尾与入场动画互不干扰 |
| 7 | 色系回归 | 全部动画颜色源自 `--tone*` 变量；4 期刊组 + 速评卡各自色系正确；无主题蓝漏入卡片 |
| 8 | 降级 | 系统开启「减少动态效果」时全部动效自动归零（现有 3241 行兜底覆盖） |
| 9 | 工程门禁 | 浏览器控制台 0 warnings；`npm run build` 正常；`node --test` 仅既有 ieee.test.js 历史败（按名字认） |

---

## 7. 风险与对策

| 风险 | 对策 |
|---|---|
| 上浮引发列表「抖动感」复发（D1 历史问题） | 幅度压到 2px、缓动 200ms 快进快出；mockup 阶段即可体感验证 |
| `content-visibility:auto` 与入场动画叠加导致离屏卡跳帧 | 与 B3-2 同机制已在生产验证一年，仅调幅度，风险低 |
| color-mix 旧浏览器不支持 | 每条新规则先写退回值再写 color-mix（项目既有惯例，光晕退回纯中性阴影） |
| 速评卡「is-fallback」态（无跳转的死卡） | 不上浮、不出光晕（沿用 5206 行豁免模式） |

---

## 8. 实施记录（2026-10-09，D1=-2px / D2=色条展开 / D3=全列表 / D4=不做光斑）

### 8.1 实际改动（对比 §3.4 的一处实现优化）

| 文件 | 改动 |
|---|---|
| `src/styles.css` | 末尾追加「2026-10-09 · 卡片动效批」约 260 行（6287→6549）：A1/A2/A3/A4 全部规则；`.article::before` 复活覆盖 3145 行 display:none |
| `DESIGN-MOCKUP-CARD-ANIM.html` | 新增 mockup（与实现同参数，含重播按钮） |
| `scripts/snapshot-card-anim.mjs` | 新增主服务动效探针（Feed/收藏/日报断言 + console 检查 + 截图） |
| `scripts/snapshot-card-anim-reports.mjs` | 新增速评卡专项探针（跑 `_reports-preview` 种子服务） |
| `scripts/diagnose-stuck-loading.mjs` | **既有脚本过期修补**（与本任务无关的既有问题）：筛选面板默认收起后需先「打开筛选」+ 点开「排序」组，否则 select 不可见 |

**实现差异说明**：A4 入场级联未按 §3.4 用 JSX 逐项传 `--enter-delay`（ReportsView 有 7 处 BriefCard 渲染点，传参侵入大），改用 **CSS `:is(容器) > *:nth-child(2..12)`** 纯 CSS 方案——视觉结果一致（40ms 步进、480ms 上限）、零 JSX 改动、React key 复用节点时筛选不重播。Feed 沿用既有 `--enter-delay` 机制（批次上限 600ms 维持原值，未动）。

### 8.2 验证结果（全部通过）

| 项 | 结果 |
|---|---|
| `npm run build` | ✓ 1737 modules，零错误 |
| Feed 主探针 | 8/8 PASS：入场 card-enter/300ms、色条 scaleX 0→1、::before 复活、上浮 -2px、光晕实测=期刊色系色（color(srgb 0.541/0.384/0.220)=#8a6238 爱思唯尔）、console 零错误 |
| 速评卡专项（种子服务） | 7/7 PASS：入场、上浮 -2px、光晕=tone-cn 色系、色条展开、相关文献行 li 级联 + 上浮 -1px、console 零错误 |
| 日报条目 | 入场+色条+上浮 PASS（主题蓝担当身份色，flash 定位环与悬停共存规则已备） |
| 翻页 loading 回归 | `stuck:false`，append/replace 并存正常，按钮恢复、再翻 50→100 正常 |
| 收藏卡 | 本地无个人账户凭据无法端到端——与已验证的 article/daily-item 同规则形状，tone 链路经代码核验（`favorite-card tone-${tone}` + 全局 `.tone-*` 变量），标记为**同构等价验证** |
| 截图 | `artifacts/anim-feed-hover.png`、`anim-reports-hover.png`、`anim-news-hover.png` 等 |

### 8.3 顺带发现（未动，仅记录）

- `src/styles.css` 尾部存在**历史整段重复**：第四批（5894/5940 行起）与第五批（6100/6194 行起）各重复一次（内容逐字相同，规则幂等无视觉影响）。建议下次批量清理时去重。
- 收藏页端到端验证需个人账户登录态，后续可在有测试账户的环境中补测。

### 8.4 待办：部署

本地验证已完成；上线需按固定收尾四步执行：version.json + CHANGELOG bump → commit/push → `sc_project_sync` → 远端 `redeploy.ps1` → `verify-render.mjs`。
