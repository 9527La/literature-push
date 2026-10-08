# 顶部导航分组优化方案（DESIGN-NAV-GROUPS v2 · 已实施）

> 状态：**已实施并本地验证通过**（2026-10-08，用户拍板五块分组）
> 关联文件：`src/main.jsx`、`src/styles.css`（新规则追加文件末尾）、`scripts/snapshot-nav-groups.mjs`（截图探针）
> 前期决策记录：mockup（`DESIGN-MOCKUP-NAV-GROUPS.html`）为方案 A/B 预演 artifact；用户最终分组如下，与 A/B 均不同。

## 1. 背景与问题

- 主导航原为 10 个平铺 tab（管理员态），tab 条约 1100px 宽；窗口压窄（1280/1180 档）时末尾栏目被裁剪且滚动条隐藏，仅有边缘渐隐 + 滚轮横滚兜底（2026-10-01 加入），可发现性差——用户感知为「后面的栏目无法点击」。

## 2. 最终分组（用户拍板）

| 入口 | 形态 | 包含视图（view key） |
|---|---|---|
| 文献库 | 常驻 tab | 最新文献(feed)，即原「最新文献」视图更名 |
| 资讯汇总 | 下拉组 ▾ | 研究速览(reports)、每日资讯(news)、关键词统计(stats) |
| 公共讨论 | 常驻 tab | 公共讨论(feedback) |
| 使用说明 | 常驻 tab | 使用说明(help) |
| 个人中心 | 下拉组 ▾ | 收藏文献(favorites，含收藏数 badge)、文献推送(settings)、个人账户(account，展示用户名)、管理中心(admin，仅管理员，带分隔线) |

- 顶栏右侧不变：立即刷新（管理员）、退出网页；账户入口从一级 nav 收进「个人中心」。

## 3. 交互规格

- 下拉单开互斥；hover 进组即开、离组 200ms 收；点击切换（hover 刚打开 <400ms 时的点击视为「确认」不关闭，避免一闪而过）；外点 / Esc / 窗口 resize / 导航横滚关闭。
- 面板 portal 到 body（`.nav` 是 overflow 裁剪容器，面板挂里面会被裁掉），fixed 定位按触发按钮视口坐标锚定；顶栏 fixed，页面滚动不影响面板位置。
- 激活态：组按钮与主 tab 同款（蓝字 + 2px 底边线），宽度不变；面板内当前项浅蓝底 + ✓。
- badge：未读数留在「文献库」；收藏数在「个人中心 ▾ 收藏文献」行内。
- `nav-wrap` 边缘渐隐 + 滚轮横滚兜底机制保留，正常档位不触发。

## 4. 实施记录（修改点）

| # | 文件 | 内容 |
|---|---|---|
| 1 | src/main.jsx | 导入 `createPortal`、`Library`、`BookOpen`、`CircleUserRound`；新增模块级 `NavGroupPanel`（portal 面板）；App 内新增 `openGroup` 状态 + `openGroupMenu / scheduleCloseGroup / toggleGroup / switchView` + 外点/Esc/resize/横滚关闭 effect；nav JSX 重构为五入口（含两个下拉组） |
| 2 | src/styles.css | 文件末尾追加 `.nav-group / .group-btn 开合与激活态 / .nav-menu / .nav-menu-item / .menu-label / .menu-check / .menu-sub / .nav-menu-sep / nav-menu-in 动画` |
| 3 | scripts/snapshot-nav-groups.mjs | 新增截图探针：1440/1180 两档登录截顶栏 + 展开个人中心 + 点研究速览验证组激活态；注入模拟 badge（2937）按最坏宽度核对 |
| 4 | 不改动 | 视图组件、hash 路由、badge 数据源(/api/status)、admin 条件渲染、`--topbar-h`、nav-wrap 兜底机制 |

## 5. 验收结果（2026-10-08，本地 + 远端部署后实测）

1. ✅ 1440 / 1180 两档顶栏单行完整可点，无裁剪无横滚（截图 `artifacts/nav-groups-*-topbar.png`）。
2. ✅ 「个人中心」下拉正确展示四项 + 管理员分隔线（`nav-groups-*-personal-open.png`）。
3. ✅ 点击「资讯汇总 → 研究速览」视图切换成功，组按钮呈蓝字+底线激活态（`nav-groups-*-reports-active.png`）。
4. ✅ Esc 关闭面板；badge 注入后 1180 档仍有富余。
5. ✅ `npm run build` 0 error（vite 7，1738 modules，本地与远端构建产物 hash 一致）。
6. ✅ 文案同步：HelpView（区块标题/键盘快捷键/订阅期刊说明）、FavoritesView 空态、SettingsView 订阅提示中「最新文献」页面称谓已改「文献库」；概念性表述（拉取/推送/加载最新文献）保留。

## 6. 部署记录（2026-10-08，v2026.10.08.5）

- bump version.json + CHANGELOG → sc_project_sync（10 文件，第二次补 verify-render/snapshot 探针共 2 文件）→ 远端 `redeploy.ps1 -SkipTests`（vite build 0 error，冒烟全 200）。
- 已知现象复现：redeploy 起的服务随 sc_run SSH 断开被连坐杀 → 新会话 `schtasks /end + /run LiteraturePushService` 拉起，4177 存活，/version.json 返回 2026.10.08.5。
- `verify-render.mjs` 已适配新导航：登录后 hover「个人中心」下拉再点「管理中心」菜单项（原按一级 tab 按钮查找会 30s 超时）；8 项检查全过。
- 公网验证：本机网络对 lhmktz.top 连接被断（已知 DNS/网络劫持），改由远端本机 IWR `https://lhmktz.top/version.json` → 200 且版本 2026.10.08.5；浏览器侧对局域网地址 `http://192.168.31.233:4177` 跑导航探针 6 张截图全过（`artifacts/nav-groups-remote-*.png`）。
