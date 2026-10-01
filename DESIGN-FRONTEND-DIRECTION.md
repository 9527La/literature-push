# 前端设计方案 — AI 研究方向筛选与标注（交付实施稿）

> **本文档是前端实施的唯一依据**，交付给实施方（人或模型）时应连同仓库访问权限一起提供。后端/数据库由 AI 方向分类管线另行负责（见 `RUNBOOK-AI-DIRECTION.md`），本文档第 2 节给出前后端契约，后端实施方以同一契约为准。
> 版本：2026-09-28 · 预期工作量：前端 5 个文件改动 + 1 个样式块

## 1. 项目背景与硬约束

- 文献推送网站：按日聚合 17 本电力系统期刊的最新论文，提供列表/筛选/收藏/统计/推送。
- 技术栈：React 19 + Vite 7，**hash 路由**（`parseHash`/`filtersFromParams`，见 `src/main.jsx` 67–84 行），无路由库。
- **仅 PC 桌面端，不做响应式**；冷灰底 + 主题蓝 `#3157d5`，无暗色模式，零图片（图标用 lucide-react）。
- 视觉语言：0.5px 边框、低饱和色板、卡片元信息行格式固定为「日期 → 期刊组徽标 → 刊名」。
- ⚠️ 铁律：任何新增色块**不得写死主题蓝**；期刊组配色一律走 `--tone`/`--tone-soft`/`--tone-line` CSS 变量（`styles.css`）。研究方向配色同样必须走本方案第 4 节定义的 `--dir-*` 变量。

## 2. 数据与 API 契约（前后端共同遵守）

### 2.1 数据库新列（articles 表，后端负责迁移）

| 列 | 类型 | 含义 |
|---|---|---|
| research_direction | TEXT | 主方向 key（白名单见 2.4） |
| research_direction_secondary | TEXT | 次方向 key，逗号分隔，≤2 个，可 NULL |
| direction_confidence | REAL | 0–1 |
| direction_source | TEXT | `ai` \| `manual` |
| direction_reason | TEXT | 一句话依据，≤30 字；<0.6 置信时带 `[待复核]` 前缀 |
| classified_at | TEXT | ISO 时间 |

### 2.2 列表接口（改造现有文章列表查询）

- 请求新增参数：`direction=key1,key2`（**多选 OR**，key 须经服务端白名单校验，非法 key 静默忽略；参数绑定防注入）。
- **other 默认排除**：`research_direction='other'` 的文献默认不出现在列表/推送/关键词统计（数据保留，管理端与 `/api/directions` 统计仍可见）；`direction` 筛选**显式包含 `other` 时豁免排除**，可查看这批文献。未分类（NULL）照常展示。
- 响应每条文章新增字段（snake_case，与现有 `display_date` / `translated_title` 风格一致）：`research_direction`（key 或 null）、`research_direction_secondary`（逗号分隔字符串或 null）、`direction_confidence`、`direction_source`（`ai`|`manual`）、`direction_reason`。
- 已实现：`server/db.js#buildArticleListQuery`（direction 子句 + other 排除）+ `listArticlePage`（SELECT 新列）。

### 2.3 方向统计接口（新增 `GET /api/directions`）

```json
{
  "coverage": { "classified": 3977, "total": 3977, "pendingReview": 63 },
  "directions": [ { "key": "storage", "label": "储能系统", "total": 812, "last30": 86 } ]
}
```

### 2.4 方向 key 白名单（15 个，与 `server/directions.js` 同步）

`distributed-gen, storage, market, transmission, distribution, microgrid, forecasting, stability, protection, power-quality, hv, power-electronics, transport, ies, other`

中文名：分布式电源与并网 / 储能系统 / 电力市场与机制 / 输电网运行与规划 / 配电网运行与规划 / 微电网与虚拟电厂 / 预测与数据驱动 / 电力系统稳定性 / 继电保护与故障诊断 / 电能质量 / 高电压与绝缘 / 电力电子装备 / 电动汽车与电气化 / 综合能源系统 / 其他

### 2.5 人工改判接口（新增，管理员用）

`POST /api/admin/articles/{id}/direction`，body `{ "direction": "storage", "secondary": ["market"] }` → 服务端写库并置 `direction_source='manual'`、清空 confidence/reason。鉴权走现有 admin 通行证体系。

## 3. 设计决策（已拍板，不要重新发明）

| # | 决策 |
|---|---|
| D1 | 卡片上现有正则主题标签（`ArticleCard.jsx` 的 `articleTopic`/`.keyword-topic`，数据源 `src/lib/topics.js`）**由 AI 方向 chip 取代**；`topics.js` 文件保留不删（词云等仍用关键词），但卡片不再引用 |
| D2 | 筛选面板新增「研究方向」分组，多选 chips + 计数，位于「期刊」分组之后 |
| D3 | 摘要弹窗标题下新增方向区块，含管理员改判下拉 |
| D4 | 统计视图新增方向分布板块（条形图 + 方向×期刊组矩阵） |
| D5 | 方向为空（未分类）的文章：卡片不渲染 chip、筛选面板计数不含它；弹窗显示「未分类」 |
| D6 | AI 方向是独立筛选维度，与期刊/日期/关键词筛选叠加（AND 语义，组内多选 OR） |

## 4. 色板与样式规范（`--dir-*` CSS 变量）

在 `styles.css` 的 `:root` 中新增 15 组方向色（与期刊组色板刻意区分开）：

```css
:root {
  --dir-distributed-gen: #8A6238;  /* 分布式电源与并网 */
  --dir-storage: #3D6E66;          /* 储能系统 */
  --dir-market: #5F6773;           /* 电力市场与机制 */
  --dir-transmission: #34547A;     /* 输电网运行与规划 */
  --dir-distribution: #3F5D93;     /* 配电网运行与规划 */
  --dir-microgrid: #4E7D3B;        /* 微电网与虚拟电厂 */
  --dir-forecasting: #7D5BA6;      /* 预测与数据驱动 */
  --dir-stability: #9C4A4A;        /* 电力系统稳定性 */
  --dir-protection: #8C3E5F;       /* 继电保护与故障诊断 */
  --dir-power-quality: #A8842C;    /* 电能质量 */
  --dir-hv: #2E7D8F;               /* 高电压与绝缘 */
  --dir-power-electronics: #B5486F;/* 电力电子装备 */
  --dir-transport: #B3662E;        /* 电动汽车与电气化 */
  --dir-ies: #7E7A26;              /* 综合能源系统 */
  --dir-other: #767B82;            /* 其他/交叉 */
}
```

chip 三态样式模板（key 经 CSS 变量间接引用，禁止硬编码色值到组件）：

```css
.direction-chip {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 3px 10px; border-radius: 999px; font-size: 12px;
  color: var(--dir-key); border: 1px solid var(--dir-key);
  background: color-mix(in srgb, var(--dir-key) 8%, transparent);
}
.direction-chip .direction-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--dir-key); }
```

组件内用法（key 转变量名：`--dir-${key.replace(/-/g, "_")}`）：`<span className="direction-chip" style={{ "--dir-key": `var(--dir-storage)` }}>`。**允许的唯一例外**：`--dir-*` 变量定义块本身。筛选面板选中态：边框 1px、背景 `color-mix(... 12%, transparent)`；未选中态：0.5px `var(--color-border-tertiary)` 边框、文字 `var(--color-text-secondary)`、色点仍用方向色。

## 5. 模块设计

### 5.1 筛选面板「研究方向」分组（`src/features/feed/Feed.jsx`）

- 位置：期刊分组（`feed-filter-group-journal`）之后、日期分组之前，沿用现有 `filter-group` / `filter-group-content` / `collapsedFilterGroups` 折叠结构，可折叠。
- 内容：15 个方向 chip（label 来自 `src/lib/directions.js`），每个 chip = 色点 + 中文名 + 计数（如 `储能系统 812`）；计数来自 `GET /api/directions`（视图挂载时请求一次即可）。
- 交互：多选；点击切换选中态；再点取消；「已选 n」计数显示在分组头部右侧；底部「清除」按钮（有选中时显示）。
- 状态：`DEFAULT_FILTERS`（`src/lib/constants.js`）增加 `direction: []`；`filtersFromParams` 增加 `if (params.has("direction")) next.direction = params.get("direction").split(",").filter(Boolean);`；hash 写回逻辑同步加 `direction` 参数（与 `journal` 参数完全同构，参照现有实现即可）。
- 筛选变更后走现有 `debouncedFilters`（300ms）→ `loadArticles` 链路，无需新请求机制。

### 5.2 文章卡片（`src/components/ArticleCard.jsx`）

- **删除**现有关键词主题标签：`const topic = articleTopic(keywords)` 与对应 `<span className="keyword-topic">`（87 行附近），移除 `articleTopic/topicLabel` 导入。
- 在关键词 chips 行的**首位**渲染主方向 chip：

```jsx
{article.researchDirection && (
  <span className="direction-chip"
        style={{ "--dir-key": `var(--dir-${article.researchDirection.replace(/-/g, "_")})` }}
        title={`AI 方向 · 置信 ${article.directionConfidence?.toFixed(2)} · ${article.directionReason || ""}`}>
    <i className="direction-dot" />{directionLabel(article.researchDirection)}
  </span>
)}
```

- 关键词 chips 保持现状（截断展示逻辑不动）。
- `directionSource === "manual"` 时 title 前缀改为「人工确认 ·」。

### 5.3 摘要弹窗（`src/features/feed/ArticleDialog.jsx`）

- 标题之下新增方向区块（单列竖排布局的一部分，符合现有弹窗规范）：
  - 第一行：`研究方向` 标签（12px 次要色）+ 主方向 chip + 次方向 chips（次方向用同款 chip 但不加粗边框，1px→0.5px）；
  - 第二行（13px 次要色）：`置信 0.92 · 依据：共享储能容量配置与运行优化`；`[待复核]` 前缀存在时以警示色（`var(--color-text-warning)`）显示「待复核」徽标；
  - 未分类文章显示 `研究方向：未分类`。
- 管理员改判（仅 admin 视角渲染）：一行内 `select`（15 个方向，当前值高亮显示 `当前（AI · 0.92）`）+「保存为人工确认」按钮 → `POST /api/admin/articles/{id}/direction`；成功后乐观更新弹窗内状态并 toast 提示；失败 toast 报错不改状态。
- 非管理员不渲染任何改判控件。

### 5.4 统计视图（`src/features/stats/StatsView.jsx`）

- 新增「研究方向分布」板块，置于现有词云板块之后：
  - **条形图**：15 个方向按篇数降序，横向条形（色条用对应 `--dir-*`，右端标数字），时间维度切换「近 7 日 / 近 30 日 / 全部」（复用现有 stats 时间切换控件样式）；数据来自 `/api/directions`（`last30` 字段；近 7 日可由前端再传 `?window=7` 请求，后端支持可选参数 `window`）。
  - **方向 × 期刊组矩阵**：行 = 15 方向，列 = 4 期刊组（IEEE / 爱思唯尔 / 中文 / 其他），单元格 = 篇数，背景深浅 = `color-mix(in srgb, var(--dir-key) n%, transparent)`（n 按行内占比 8–60% 线性映射）。数据接口 `GET /api/directions?matrix=1` 返回 `{ "storage": { "ieee": 120, "elsevier": 40, "cn": 30, "other": 8 }, ... }`（后端实现；前端按契约渲染）。
- 未分类文章在统计中以独立一行「未分类」呈现（灰色）。

### 5.5 管理中心（`src/features/admin/AdminView.jsx`，轻量）

- 新增一张「AI 方向分类」信息卡（只读）：覆盖率 `classified/total`、待复核数、各方向计数迷你条形。数据复用 `/api/directions`。
- 不做任何"触发分类"按钮——分类由 WorkBuddy 定时任务执行（见 RUNBOOK），管理中心仅展示状态。

## 6. 涉及文件清单

| 文件 | 动作 |
|---|---|
| `src/lib/directions.js` | **新增**：`DIRECTIONS`（key/label，与 server 同步）、`directionLabel()`、`directionVar()`（key→CSS 变量名） |
| `src/lib/constants.js` | `DEFAULT_FILTERS` 增加 `direction: []` |
| `src/main.jsx` | `filtersFromParams` 解析 `direction`；hash 写回携带 `direction` |
| `src/features/feed/Feed.jsx` | 筛选面板新增方向分组（5.1） |
| `src/components/ArticleCard.jsx` | 移除 keyword-topic，渲染方向 chip（5.2） |
| `src/features/feed/ArticleDialog.jsx` | 方向区块 + 管理员改判（5.3） |
| `src/features/stats/StatsView.jsx` | 方向分布板块（5.4） |
| `src/features/admin/AdminView.jsx` | 分类状态信息卡（5.5） |
| `src/styles.css`（或 src 下对应 css 文件） | `:root` 增加 `--dir-*` 15 变量；`.direction-chip` 系列样式；筛选面板方向组样式 |
| `src/lib/api.js` | `getDirections()`（/api/directions）、`setArticleDirection(id, body)`（admin 改判） |

## 7. 验收标准

1. `npm run build` 0 error；`node scripts/verify-render.mjs <地址>` 渲染正常（部署后必跑）。
2. 方向筛选：`#/feed?direction=storage,market` 直开可复现筛选；与期刊/日期筛选叠加正确；清空 direction 参数后列表与现状逐字节一致（回归）。
3. 卡片：已分类文章显示方向 chip（色点+名称），悬停出「AI 方向 · 置信 · 依据」；未分类不渲染；`keyword-topic` 旧标签不再出现。
4. 弹窗：方向区块按 5.3 呈现；管理员改判保存后立即生效且列表刷新后仍为改判值；非管理员无改判控件。
5. 统计：条形图与矩阵数字与 `/api/directions` 一致；时间切换可用。
6. 样式：全局搜索确认方向相关样式零硬编码色值（仅 `--dir-*` 定义块有 hex）；不使用主题蓝 `#3157d5`。
7. 浏览器验证走局域网地址；等登录框用 `page.fill`；Escape 关弹窗。
