import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, MousePointerClick, Sparkles, X } from "lucide-react";

/**
 * 新手教程 v2（2026-10-13 重做）——「手把手」教练式引导。
 *
 * 与 v1（幻灯片式弹窗）的区别：
 *  - 高亮**页面上真实的按钮/区域**（聚光灯挖孔 + 呼吸环），提示用户照着点；
 *  - 用户完成操作后**自动进入下一步**（检测元素出现/消失、进度变化等）；
 *  - 教程自带页面跳转（#feed → #reports → …），**跨页面、跨弹窗都不会中断**；
 *  - 全程只由用户主动「跳过教程 / 退出」结束；操作中（如翻页、关闭弹窗）按 Esc
 *    交给底层界面处理，不会误退出教程。
 */

const SEEN_KEY = "onboardingSeen";
const TOUR_EVENT = "start-onboarding";
const POLL_MS = 140;
const POLL_IDLE_MS = 380;

/** 教程会依次打开这些页面：开始时预热分包，避免"跳到某页要等加载"造成的停顿 */
const PAGE_CHUNKS = [
  () => import("../reports/ReportsView.jsx"),
  () => import("../news/DailyNewsView.jsx"),
  () => import("../favorites/FavoritesView.jsx"),
  () => import("../stats/StatsView.jsx"),
  () => import("../settings/SettingsView.jsx"),
  () => import("../feedback/FeedbackView.jsx"),
  () => import("../account/AccountView.jsx")
];
function prefetchPages() {
  for (const load of PAGE_CHUNKS) load().catch(() => { /* 预热失败不影响教程 */ });
}

/** 依次尝试多个选择器/取值器，返回第一个命中且可见的元素（页面在不同身份/数据下结构不同） */
const firstVisible = (...getters) => {
  for (const get of getters) {
    try {
      const el = typeof get === "function" ? get() : document.querySelector(get);
      if (!el) continue;
      const box = el.getBoundingClientRect();
      if (box.width > 0 && box.height > 0) return el;
    } catch { /* 忽略单个取值器异常 */ }
  }
  return null;
};

/** 触发一次真实点击（用于「用户直接点下一步」时替用户完成该步操作） */
const clickIf = (getter) => {
  try {
    const el = typeof getter === "function" ? getter() : document.querySelector(getter);
    if (el && !el.disabled) el.click();
  } catch { /* 忽略 */ }
};
const customModeOn = () => Boolean(byText('.reader-mode-tabs [role="tab"]', "自定义筛选")?.classList.contains("on"));
const limitOn = () => [...document.querySelectorAll(".reader-chip.on")].some((el) => /^(50|100|200|无上限)$/.test(el.textContent.trim()));

/** 展开筛选面板里的某个分组（教程介绍该分组时自动展开，让用户看到全部选项） */
const expandFilterGroup = (key) => {
  const content = document.getElementById(`feed-filter-group-${key}`);
  if (!content || !content.hidden) return;
  content.previousElementSibling?.querySelector(".filter-group-toggle")?.click();
};

/* ── DOM 小工具 ─────────────────────────────────────────────── */
const has = (selector) => Boolean(document.querySelector(selector));
/** 存在且可见（面板/弹窗常驻 DOM，靠 CSS 显隐，判定必须看可见性） */
const visible = (selector) => {
  const el = document.querySelector(selector);
  if (!el) return false;
  const box = el.getBoundingClientRect();
  return box.width > 0 && box.height > 0;
};
const byText = (selector, text) => [...document.querySelectorAll(selector)].find((el) => el.textContent.trim().includes(text)) || null;
const isOnText = (selector, text) => [...document.querySelectorAll(selector)].some((el) => el.classList.contains("on") && el.textContent.includes(text));
const readerIndex = () => Number(document.querySelector(".cr-progress strong")?.textContent || 0);
const onHash = (page) => (page ? String(window.location.hash || "").startsWith(page) : true);
/** 是否已登录个人账户（收藏/推送/讨论/账户页需要） */
const loggedIn = () => {
  try {
    return Boolean(localStorage.getItem("userToken") || sessionStorage.getItem("userToken"));
  } catch {
    return false;
  }
};

/* ── 教程步骤（每步：高亮目标 + 说明 + 操作提示 + 自动推进条件）────── */
const STEPS = [
  {
    key: "welcome",
    center: true,
    title: "跟着点一遍，3 分钟上手",
    body: "这是一套「手把手」教程：每一步都会高亮页面上的真实按钮，你照着点，操作完成后自动进入下一步。",
    hint: "中途可以随时「跳过教程」；之后在使用说明页可以重新体验。"
  },
  {
    key: "feed-detail",
    page: "#feed",
    target: ".article-list .title-button",
    title: "文献库：打开一篇文献",
    body: "站点收录期刊的最新论文都在这里。卡片左上角色标 = 出版社色系，彩色标签 = AI 标注的研究方向。",
    hint: "请点击这篇文献的标题（或摘要图标）打开详情。",
    perform: () => clickIf(() => document.querySelector(".article-list .title-button")),
    advance: () => visible(".article-dialog")
  },
  {
    key: "feed-dialog",
    page: "#feed",
    target: ".article-dialog",
    title: "文献详情弹窗",
    body: "这里能看到 DOI、卷期、作者、关键词、中英文摘要与原文链接；底部是 3 篇相关文献（可点击切换），顶部按钮可一键复制 GB/T 7714 引用。",
    hint: "看完请点右上角 ✕ 关闭弹窗。",
    perform: () => clickIf('[aria-label="关闭文献摘要"]'),
    advance: () => !visible(".article-dialog")
  },
  {
    key: "feed-open-filter",
    page: "#feed",
    target: ".filter-toggle",
    title: "筛选：先打开面板",
    body: "筛选面板默认收起，不会长期占用阅读区域。",
    hint: "请点击「打开筛选」。",
    perform: () => { if (!visible(".filter-panel")) clickIf(".filter-toggle"); },
    advance: () => visible(".filter-panel")
  },
  {
    key: "filter-search",
    resolve: () => document.getElementById("feed-filter-group-search"),
    enter: () => expandFilterGroup("search"),
    title: "筛选①：搜索",
    body: "在标题、作者、摘要与关键词中做全文匹配，命中内容会在列表中高亮显示。已知关键词或作者时用它最快。",
    hint: "这一步只看不点，看完点「下一步」继续。"
  },
  {
    key: "filter-journal",
    resolve: () => document.getElementById("feed-filter-group-journal"),
    enter: () => expandFilterGroup("journal"),
    title: "筛选②：期刊",
    body: "按出版社分组列出全部期刊（IEEE / 爱思唯尔 / 中文期刊 / 其他），每组可整体展开收起，可多选；每本刊后附当前命中篇数。",
    hint: "这一步只看不点，看完点「下一步」继续。"
  },
  {
    key: "filter-direction",
    resolve: () => document.getElementById("feed-filter-group-direction"),
    enter: () => expandFilterGroup("direction"),
    title: "筛选③：研究方向",
    body: "AI 为每篇文献标注的研究方向（15 个，含「其他/交叉」之外的常用方向），每个方向附篇数，可多选；“其他/交叉”类文献不进入文献库列表。",
    hint: "这一步只看不点，看完点「下一步」继续。"
  },
  {
    key: "filter-date",
    resolve: () => document.getElementById("feed-filter-group-date"),
    enter: () => expandFilterGroup("date"),
    title: "筛选④：时间范围",
    body: "填写开始 / 结束日期限定文献日期（按首次公开日期计），只填一端即为开区间；面板外的「时间范围」快捷项与它联动。",
    hint: "这一步只看不点，看完点「下一步」继续。"
  },
  {
    key: "filter-flags",
    resolve: () => document.getElementById("feed-filter-group-flags"),
    enter: () => expandFilterGroup("flags"),
    title: "筛选⑤：阅读与收藏状态",
    body: "「仅未读」只看还没读过的文献，「仅收藏」只看自己收藏过的文献；游客也能看到这两项，但收藏需要登录个人账户。",
    hint: "这一步只看不点，看完点「下一步」继续。"
  },
  {
    key: "filter-keyword",
    resolve: () => document.getElementById("feed-filter-group-keyword"),
    enter: () => expandFilterGroup("keyword"),
    title: "筛选⑥：关键词",
    body: "列出文献的原文关键词标签（带篇数），点一个即可筛出含该关键词的文献，可多选。",
    hint: "这一步只看不点，看完点「下一步」继续。"
  },
  {
    key: "filter-sort",
    resolve: () => document.getElementById("feed-filter-group-sort"),
    enter: () => expandFilterGroup("sort"),
    title: "筛选⑦：排序",
    body: "最新优先 / 最早优先 / 相关性三种排序；相关性按标题、关键词与摘要中的匹配程度计算。",
    hint: "这一步只看不点，看完点「下一步」继续。"
  },
  {
    key: "feed-quick",
    page: "#feed",
    target: ".feed-quick-group",
    title: "工具栏快捷筛选",
    body: "面板之外，工具栏还提供「时间范围」（近 7 日 / 近 30 日 / 本月）与「阅读状态」（全部 / 未读 / 已读），两者与面板双向联动。",
    hint: "请点一下「近 7 日」。",
    perform: () => { if (!isOnText(".feed-quick-chip", "近 7 日")) clickIf(() => [...document.querySelectorAll(".feed-quick-chip")].find((el) => el.textContent.includes("近 7 日"))); },
    advance: () => isOnText(".feed-quick-chip", "近 7 日")
  },
  {
    key: "feed-close-filter",
    page: "#feed",
    target: ".filter-toggle",
    title: "收起筛选面板",
    body: "面板内可按标题、作者、摘要、关键词、期刊、研究方向、日期、已读与收藏状态组合筛选：同一条件内多选为「或」，不同条件之间为「且」。",
    hint: "请点击「收起筛选」。",
    perform: () => { if (visible(".filter-panel")) clickIf(".filter-toggle"); },
    advance: () => !visible(".filter-panel")
  },
  {
    key: "reader-entry",
    page: "#feed",
    target: ".feed-cardread-entry",
    title: "进入卡片阅读",
    body: "「卡片阅读」把一批文献变成一张张卡片逐条翻阅，免去反复开关弹窗。",
    hint: "请点击「卡片阅读」按钮。",
    perform: () => { if (!visible(".reader-setup")) clickIf(".feed-cardread-entry"); },
    advance: () => visible(".reader-setup")
  },
  {
    key: "reader-period",
    // 有速览期就选期次；本期文献很少（或本机没有报告数据）时改走「自定义筛选」
    resolve: () => firstVisible(".reader-chip--period", () => byText('.reader-mode-tabs [role="tab"]', "自定义筛选")),
    title: "第一步：选范围方式",
    body: "范围有两种选法：① 按速览期（周报 / 月报 → 期次 → 方向 → 专题）② 自定义筛选（期刊 / 方向 / 时间 / 阅读状态 / 数量上限）。某一期文献很少时，用「自定义筛选」更容易凑够一批。",
    hint: "请点选一个期次；若本期文献很少，可改点「自定义筛选」。",
    perform: () => { if (!has(".reader-chip--period.on") && !customModeOn()) clickIf(() => document.querySelector(".reader-chip--period") || byText('.reader-mode-tabs [role="tab"]', "自定义筛选")); },
    advance: () => has(".reader-chip--period.on") || customModeOn()
  },
  {
    key: "reader-direction",
    target: ".reader-chip--dir",
    title: "第二步：选研究方向",
    body: "每个方向后面标注的是本期该方向的文献篇数。",
    hint: "请点选一个研究方向。",
    perform: () => { if (!has(".reader-chip--dir.on")) clickIf(".reader-chip--dir"); },
    advance: () => has(".reader-chip--dir.on")
  },
  {
    key: "reader-limit",
    resolve: () => firstVisible(() => byText(".reader-chip", "无上限")?.closest(".reader-chip-row"), ".reader-limit-custom"),
    // 按速览期模式下没有「数量上限」→ 自动跳过
    autoSkipIfMissing: true,
    optional: true,
    title: "第三步（自定义筛选）：数量上限",
    body: "自定义模式下可限定本批数量：50 / 100 / 200 / 自定义（1–300）/ 无上限。选大一些就能一次读更多文献。",
    hint: "点一个上限（如 100），或直接点「下一步」。",
    perform: () => { if (!limitOn()) clickIf(() => byText(".reader-chip", "100") || byText(".reader-chip", "无上限")); },
    advance: () => limitOn()
  },
  {
    key: "reader-topic",
    target: ".reader-chip--topic",
    // 自定义筛选模式下没有「专题」→ 自动跳过
    autoSkipIfMissing: true,
    title: "第三步（按速览期）：选专题",
    body: "月度方向专报按主题聚类组织，可以只读某一个专题；保持「全部专题」也可以。",
    hint: "点一个专题，或直接点「下一步」。",
    perform: () => { if (visible(".reader-chip--topic")) clickIf(".reader-chip--topic"); },
    optional: true,
    advance: () => [...document.querySelectorAll(".reader-chip--topic.on")].some((el) => !el.textContent.includes("全部专题"))
  },
  {
    key: "reader-catalog",
    resolve: () => byText(".reader-setup button", "生成文献目录"),
    title: "第四步：生成文献目录",
    body: "先给出这批文献的目录（标题 / 期刊 / 日期 / 已读状态），确认无误再开始阅读。",
    hint: "请点击「生成文献目录」。",
    perform: () => clickIf(() => byText(".reader-setup button", "生成文献目录")),
    advance: () => visible(".reader-catalog-row")
  },
  {
    key: "reader-start",
    resolve: () => byText("button", "开始卡片阅读"),
    title: "第五步：开始阅读",
    body: "目录确认无误后进入全屏卡片阅读；阅读中随时可以「返回调整」重新选范围。",
    hint: "请点击「开始卡片阅读」。",
    perform: () => clickIf(() => byText("button", "开始卡片阅读")),
    advance: () => visible(".card-reader")
  },
  {
    key: "reader-flip",
    resolve: () => document.querySelector(".cr-nav--primary"),
    title: "翻页",
    body: "顶部显示「第 N / M 条」，进度条可点击或拖动跳转；默认开启「读即标记」——翻过去就自动标记已读。",
    hint: "请点「下一条」，或直接按键盘 → / 空格。",
    perform: () => clickIf(".cr-nav--primary"),
    enter: () => readerIndex(),
    // 只有 1 篇（下一条禁用）时无页可翻 → 自动继续，避免卡住
    advance: (baseline) => readerIndex() > (baseline || 0) || !document.querySelector(".cr-nav--primary:not([disabled])")
  },
  {
    key: "reader-view",
    target: ".cr-views",
    title: "切换卡片版本",
    body: "速评版（研究对象 / 研究方法 / 核心结论）、中文摘要版（完整摘要，可展开英文对照）、原文版；默认版本会自动记忆。",
    hint: "请点击「中文摘要版」（也可以按键盘 2）。",
    perform: () => { if (!visible(".cr-abstract")) clickIf(() => document.querySelectorAll(".cr-views button")[1]); },
    advance: () => visible(".cr-abstract")
  },
  {
    key: "reader-drawer",
    resolve: () => document.querySelector(".cr-head-right .cr-icon-btn"),
    title: "目录抽屉",
    body: "这里能看全批清单、点击序号直达，也能在阅读中改范围（仅未读 / 仅有速评 / 按期刊）。",
    hint: "请点击目录按钮（或按 D）。",
    perform: () => { if (!visible(".cr-drawer")) clickIf(() => document.querySelector(".cr-head-right .cr-icon-btn")); },
    advance: () => visible(".cr-drawer")
  },
  {
    key: "reader-batch",
    target: ".cr-drawer-batch",
    title: "读完本批",
    body: "抽屉底部可以把本批剩余未读一键标记为已读（会二次确认）。现在先不用点。",
    hint: "点「下一步」继续（或按 Esc 关闭抽屉）。"
  },
  {
    key: "reader-note",
    target: ".cr-note-toggle",
    title: "备注 / 收藏 / 复制引用",
    body: "卡片底部可以随手记备注（存到收藏备注，未收藏会自动先收藏）；底部操作栏还有收藏（F）、标记已读（R）、复制 GB/T 7714 引用（C）。",
    hint: "可以先关闭抽屉，再点「下一步」。"
  },
  {
    key: "reader-exit",
    resolve: () => document.querySelector(".cr-close"),
    title: "退出卡片阅读",
    body: "同一范围下次再打开时，会自动回到上次读到的位置（断点续读）。",
    hint: "请点击右上角 ✕ 退出阅读。",
    perform: () => clickIf(".cr-close"),
    advance: () => !visible(".card-reader")
  },
  {
    key: "reports",
    page: "#reports",
    resolve: () => firstVisible(".reports-toolbar", ".reports-main", ".reports-view"),
    title: "研究速览：页面结构",
    body: "由 AI 每周日晚（月报为每月 1 日凌晨）基于当期入库文献自动生成，所有数字取自数据库统计。顶部是「一周速览 / 月度趋势」切换 + 期次选择 + 方向 chips，主体是各方向的分组内容。",
    hint: "下面逐步介绍每一块，点「下一步」继续。"
  },
  {
    key: "reports-tabs",
    resolve: () => firstVisible(".reports-tabs", ".reports-period-select"),
    title: "① 一周速览 / 月度趋势",
    body: "「一周速览」是每周生成的周报；「月度趋势」是每月 1 日凌晨生成的月报，内容更聚合。右侧下拉可切换历史期次，回看任意一周/一月。",
    hint: "这一步只看不点，看完点「下一步」。"
  },
  {
    key: "reports-groups",
    resolve: () => firstVisible(".reports-group-head", ".reports-group-body"),
    title: "② 总览按方向分组",
    body: "每个研究方向一张分组卡：显示本期篇数与环比、本期主题一句话、3 张速评卡预览，组头还有该组的期刊构成（期刊缩写色标）；点「查看该方向全部 N 篇」可按本期时间窗列出完整清单。",
    hint: "这一步只看不点，看完点「下一步」。"
  },
  {
    key: "reports-brief",
    resolve: () => firstVisible(".reports-brief-card", ".reports-brief-fields"),
    title: "③ 三段式速评卡",
    body: "每篇精选文献一张卡，固定给出「研究对象 / 研究方法 / 核心结论」三段；点卡片直接打开该文献详情。卡片配色随期刊出版社（IEEE 蓝 / 爱思唯尔棕 / 中文刊青 / 其他灰）。",
    hint: "这一步只看不点，看完点「下一步」。"
  },
  {
    key: "reports-direction",
    resolve: () => firstVisible(".reports-dir-chip", ".reports-cluster", ".reports-cluster-head"),
    title: "④ 方向专报与主题聚类",
    body: "点方向 chips 进入单个方向的深度报告：周报方向专报为逐篇速评；月报方向专报按主题聚类（专题）组织——聚类头可展开/收起，聚类内速评卡默认先显示一行，点「继续加载全部」看其余条目。",
    hint: "这一步只看不点，看完点「下一步」。"
  },
  {
    key: "reports-journal-filter",
    resolve: () => firstVisible(".reports-journal-chip", ".reports-meta-journals"),
    title: "⑤ 来源期刊筛选",
    body: "方向专报信息条里的期刊 chips 可点选隐藏 / 显示某一来源的速评卡，方便只看某个期刊的内容；仅影响当前报告的浏览，不改变数据。",
    hint: "这一步只看不点，看完点「下一步」。"
  },
  {
    key: "reports-cardread",
    resolve: () => firstVisible(".reports-group-cardread", ".reports-group-head"),
    title: "⑥ 卡片阅读入口与个性化",
    body: "方向分组底部、方向专报信息条、主题聚类底部都提供「卡片阅读 · N 篇」，按该范围逐条阅读。方向 chips 支持拖拽排序与隐藏（存本机浏览器）；点期刊名可看该刊最近文献，主题词可一键搜索。",
    hint: "这一步只看不点，看完点「下一步」。"
  },
  {
    key: "news",
    page: "#news",
    resolve: () => firstVisible(".daily-rail", ".daily-content", ".daily-news"),
    title: "每日资讯",
    body: "每天凌晨汇总前一天的政策、标准与重点新闻：左侧按日期，右侧内容可按分类筛选、查找，点导读直达详情。",
    hint: "点「下一步」继续。"
  },
  {
    key: "account-register",
    page: "#account",
    // 高亮整个注册卡片（含标签页 / 表单 / 说明），避免其余区域被遮罩压灰
    resolve: () => document.querySelector(".account-auth-card") || document.querySelector(".account-grid"),
    placement: "right",
    title: "先注册个人账户",
    body: "接下来的收藏、推送、讨论与个性设置都属于个人账户，游客只能浏览不能保存。个人账户与网页通行证是两套账号，注册只需用户名 + 密码。",
    hint: "请切到「注册个人账户」填写并提交；已登录账户会自动跳过这一步。",
    advance: () => loggedIn()
  },
  {
    key: "favorites",
    page: "#favorites",
    resolve: () => firstVisible(".favorites-sidebar", ".favorites-layout", ".favorites-view"),
    title: "收藏文献",
    body: "星标收藏后在这里按分组管理，还能记备注、按来源期刊与研究方向轻筛选；卡片阅读里记的备注也会同步过来。",
    hint: "点「下一步」继续。"
  },
  {
    key: "stats",
    page: "#stats",
    resolve: () => firstVisible(".stats-filters", ".stats-view h2", ".stats-view"),
    title: "关键词统计",
    body: "汇总一段时间、指定期刊内的关键词分布，支持列表 / 词云 / 共现三种视图，点击关键词可查看对应文献。",
    hint: "点「下一步」继续。"
  },
  {
    key: "push",
    page: "#settings",
    resolve: () => firstVisible(".settings-left", ".settings-section", ".settings-view"),
    title: "文献推送：页面结构",
    body: "左栏是「我的周报邮箱」，右栏是「推送计划」——上面是当前计划概览，下面是可编辑的推送设置。另有微信公众号「电气前沿速递」每日推送。",
    hint: "下面逐步介绍每个设置项，点「下一步」继续。"
  },
  {
    key: "push-email",
    resolve: () => firstVisible(".email-row", ".saved-email-status"),
    title: "① 我的周报邮箱",
    body: "填写接收邮箱后点「保存」；点「发送测试邮箱」可确认地址是否可用（测试邮件或正式推送没收到时，先核对邮箱再联系管理员）。",
    hint: "这一步只看不点，看完点「下一步」。"
  },
  {
    key: "push-summary",
    resolve: () => firstVisible(".push-summary", ".push-settings"),
    title: "② 当前推送计划概览",
    body: "这里汇总当前生效的配置：推送频率、推送期刊、研究方向偏好。改设置并保存后，概览会同步更新。",
    hint: "这一步只看不点，看完点「下一步」。"
  },
  {
    key: "push-frequency",
    resolve: () => firstVisible(".push-frequency"),
    title: "③ 推送频率",
    body: "每天 / 每周 / 每月三选一：每周需再选星期几，每月需再选日期；配合发送时间即可确定推送节奏。",
    hint: "这一步只看不点，看完点「下一步」。"
  },
  {
    key: "push-time",
    resolve: () => firstVisible(".push-time-selector"),
    title: "④ 发送时间",
    body: "选择小时与分钟（按服务器时间）；设置完成后需要点「保存推送设置」，计划才会真正生效。",
    hint: "这一步只看不点，看完点「下一步」。"
  },
  {
    key: "push-content",
    resolve: () => firstVisible(".push-content-options"),
    title: "⑤ 邮件内容",
    body: "可分别开关：附件文件、摘要、关键词、中文翻译。只勾选需要的部分，邮件会更精简。",
    hint: "这一步只看不点，看完点「下一步」。"
  },
  {
    key: "push-journals",
    resolve: () => firstVisible(".push-journal-filter"),
    title: "⑥ 推送期刊范围",
    body: "按出版社分组选择要推送的期刊，可整组勾选或逐本挑选；不选即默认全部期刊。",
    hint: "这一步只看不点，看完点「下一步」。"
  },
  {
    key: "push-directions",
    resolve: () => firstVisible(".push-direction-list"),
    title: "⑦ 推送研究方向",
    body: "只推送选定的研究方向；邮件正文按方向分组展示，分组顺序与这里的点选顺序一致（标签上带顺序编号，取消后重新点选即可调整顺序）。",
    hint: "这一步只看不点，看完点「下一步」。"
  },
  {
    key: "push-actions",
    resolve: () => firstVisible(".push-actions"),
    title: "⑧ 保存与立即发送",
    body: "点「保存推送设置」才会让计划生效；「立即发送」可以不等到计划时间，马上发一封当前摘要邮件（可用于试收）。",
    hint: "这一步只看不点，看完点「下一步」。"
  },
  {
    key: "discussion",
    page: "#feedback",
    resolve: () => firstVisible(".feedback-hero", ".feedback-layout h1", ".feedback-layout"),
    title: "公共讨论",
    body: "面向访问者公开展示的交流区：登录后可发主题、评论与点赞，每个账户每小时最多发起 1 个主题。",
    hint: "点「下一步」继续。"
  },
  {
    key: "account",
    page: "#account",
    resolve: () => firstVisible(".account-grid", ".account-auth-card"),
    title: "账户与个性设置",
    body: "网页通行证用于进入站点；个人账户用于保存阅读、收藏、推送与讨论数据。个性设置可本机保存，也可上传到账户在别的设备载入。",
    hint: "点「下一步」完成教程。"
  },
  {
    key: "done",
    page: "#feed",
    center: true,
    title: "教程结束，可以开始用了",
    body: "想再看一遍：使用说明页 →「重新体验新手教程」。遇到问题可以在公共讨论区留言。",
    hint: "祝使用愉快！"
  }
];

export default function OnboardingTour({ enabled = true }) {
  const [active, setActive] = useState(false);
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState(null);
  const [flash, setFlash] = useState(false);
  // 目标长时间找不到（如本地环境缺该功能的数据）→ 提示可跳过，避免用户卡住
  const [stuck, setStuck] = useState(false);
  // flash 提示文案（用户手动完成 → "操作完成"；点下一步由教程代劳 → "已帮你完成"）
  const [flashText, setFlashText] = useState("操作完成，继续下一步");
  const autoOpened = useRef(false);
  const baselineRef = useRef(null);
  const scrolledRef = useRef("");
  const indexRef = useRef(0);
  const total = STEPS.length;
  const step = STEPS[index];

  useEffect(() => { indexRef.current = index; }, [index]);

  const close = useCallback(() => {
    try { localStorage.setItem(SEEN_KEY, "1"); } catch { /* 忽略 */ }
    setActive(false);
  }, []);

  const go = useCallback((delta) => {
    setFlash(false);
    setIndex((current) => Math.min(Math.max(current + delta, 0), total - 1));
  }, [total]);

  /** 「下一步」：若本步需要操作，则先替用户完成该步的真实点击（避免直接跳过导致页面状态不对） */
  const handleNext = useCallback(() => {
    if (step?.perform) {
      setFlashText("已帮你完成这一步，正在继续…");
      setFlash(true);
      try { step.perform(); } catch { /* 忽略 */ }
      const at = indexRef.current;
      setTimeout(() => { if (indexRef.current === at) go(1); }, 1400);
      return;
    }
    go(1);
  }, [go, step]);

  const start = useCallback(() => {
    prefetchPages();
    setIndex(0);
    setActive(true);
  }, []);

  /* 首次访问自动弹一次 */
  useEffect(() => {
    if (!enabled || autoOpened.current) return undefined;
    let seen = "";
    try { seen = localStorage.getItem(SEEN_KEY) || ""; } catch { seen = "1"; }
    if (seen === "1") return undefined;
    autoOpened.current = true;
    prefetchPages();
    const timer = setTimeout(() => setActive(true), 900);
    return () => clearTimeout(timer);
  }, [enabled]);

  /* 使用说明页「重新体验新手教程」 */
  useEffect(() => {
    window.addEventListener(TOUR_EVENT, start);
    return () => window.removeEventListener(TOUR_EVENT, start);
  }, [start]);

  /* 步骤切换：必要时跳转页面；记录基线；把目标滚入视野 */
  useEffect(() => {
    if (!active || !step) return;
    if (step.page && !onHash(step.page)) {
      window.location.hash = step.page;
    }
    baselineRef.current = step.enter ? step.enter() : null;
    setFlash(false);
    // 滚动定位改到「目标出现的那一刻」立刻执行（见跟踪 effect），
    // 不再用固定 700ms 等待——那段时间界面静止，是"步骤之间卡顿"的主要来源。
    scrolledRef.current = "";
  }, [active, index, step]);

  /* 目标矩形跟踪 + 自动推进检测（丝滑化：矩形去重、更密轮询、缺失淡出） */
  useEffect(() => {
    if (!active || !step) return undefined;
    let advancing = false;
    let missSince = 0;
    let lastKey = "";
    let stableCount = 0;
    let timer = null;
    const measure = () => {
      const el = step.resolve ? step.resolve() : (step.target ? document.querySelector(step.target) : null);
      const box = el ? el.getBoundingClientRect() : null;
      const shown = Boolean(box && box.width > 0 && box.height > 0);
      if (!shown) {
        // 目标暂未出现（如跨页面加载中）：先保留旧位置 400ms，之后隐藏聚光灯
        missSince = missSince || Date.now();
        lastKey = "";
        stableCount = 0;
        const missed = Date.now() - missSince;
        if (missed > 400) setRect(null);
        if (missed > 5000) setStuck(true);
        // 该步在当前模式下不存在（如自定义筛选没有"专题"）→ 自动跳过，不卡住用户
        if (step.autoSkipIfMissing && missed > 2200 && !advancing) {
          advancing = true;
          setFlashText("当前模式下没有这一步，已自动跳过");
          setFlash(true);
          setTimeout(() => go(1), 520);
        }
        return;
      }
      missSince = 0;
      setStuck((prev) => (prev ? false : prev));
      // 目标一出现就把它滚到视野中央（每步只做一次，用即时滚动避免与动画打架）
      const stepKey = `${index}`;
      if (scrolledRef.current !== stepKey) {
        scrolledRef.current = stepKey;
        const inView = box.top >= 90 && box.top + box.height <= window.innerHeight - 90;
        if (!inView) el.scrollIntoView?.({ block: "center", behavior: "auto" });
      }
      const key = `${Math.round(box.top)}|${Math.round(box.left)}|${Math.round(box.width)}|${Math.round(box.height)}`;
      if (key === lastKey) stableCount += 1;
      else { lastKey = key; stableCount = 0; }
      // 连续两次测量一致才落位：避免页面还在布局时聚光灯来回跑（卡顿主因之一）
      if (stableCount >= 1) {
        setRect((prev) => (
          prev
          && Math.abs(prev.top - box.top) < 1
          && Math.abs(prev.left - box.left) < 1
          && Math.abs(prev.width - box.width) < 1
          && Math.abs(prev.height - box.height) < 1
            ? prev
            : { top: box.top, left: box.left, width: box.width, height: box.height }
        ));
      }
      // 位置稳定后降低轮询频率，减少主线程占用
      if (stableCount === 4 && timer) {
        clearInterval(timer);
        timer = setInterval(tick, POLL_IDLE_MS);
      }
    };
    const checkAdvance = () => {
      if (!advancing && step.advance && step.advance(baselineRef.current)) {
        advancing = true;
        setFlashText("操作完成，继续下一步");
        setFlash(true);
        setTimeout(() => go(1), 520);
      }
    };
    const tick = () => { measure(); checkAdvance(); };
    tick();
    const raf1 = requestAnimationFrame(tick);
    const raf2 = requestAnimationFrame(() => requestAnimationFrame(tick));
    timer = setInterval(tick, POLL_MS);
    window.addEventListener("resize", tick);
    window.addEventListener("scroll", tick, true);
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      if (timer) clearInterval(timer);
      window.removeEventListener("resize", tick);
      window.removeEventListener("scroll", tick, true);
    };
  }, [active, index, step, go]);

  /* 键盘：← → 步进、Esc 退出（底层有弹窗/阅读器时交给底层处理） */
  useEffect(() => {
    if (!active) return undefined;
    function onKey(event) {
      const overlayOpen = visible(".article-dialog") || visible(".card-reader") || visible(".modal-backdrop");
      if (event.key === "Escape") {
        if (overlayOpen) return; // 交给底层关闭弹窗/阅读器（正好是当前步骤的操作）
        event.preventDefault();
        close();
        return;
      }
      if (overlayOpen) return; // 阅读器内 ← → 是翻页，不劫持
      if (event.key === "ArrowRight") { event.preventDefault(); go(1); }
      else if (event.key === "ArrowLeft") { event.preventDefault(); go(-1); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, close, go]);

  const progress = useMemo(() => Math.round(((index + 1) / total) * 100), [index, total]);
  // 气泡真实尺寸（用于避让高亮目标：下 → 上 → 左/右）
  const tipRef = useRef(null);
  const [tipSize, setTipSize] = useState({ w: 380, h: 240 });
  // useLayoutEffect：绘制前量好尺寸，避免气泡首帧按默认高度定位后再跳一下
  useLayoutEffect(() => {
    const el = tipRef.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    if (box.width && box.height && (Math.abs(box.height - tipSize.h) > 2 || Math.abs(box.width - tipSize.w) > 2)) {
      setTipSize({ w: Math.round(box.width), h: Math.round(box.height) });
    }
  }, [index, rect, tipSize.h, tipSize.w]);

  const tipStyle = useMemo(() => {
    if (!rect) {
      // 目标暂缺（跨页加载中）：给一个稳定的居中位置，靠 transition 平滑滑过去
      return { left: `${Math.round(window.innerWidth / 2 - 190)}px`, top: `${Math.round(window.innerHeight / 2 - 130)}px`, width: "380px" };
    }
    const gap = 14;
    const pad = 12;
    const width = 380;
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;
    const spaceBelow = viewportH - (rect.top + rect.height);
    const spaceAbove = rect.top;
    const centeredLeft = Math.min(Math.max(rect.left + rect.width / 2 - width / 2, pad), viewportW - width - pad);
    const spaceRight = viewportW - (rect.left + rect.width);
    const spaceLeft = rect.left;
    const sideTop = Math.min(Math.max(rect.top + rect.height / 2 - tipSize.h / 2, pad), viewportH - tipSize.h - pad);
    const place = {
      below: { fits: spaceBelow >= tipSize.h + gap + pad, style: { left: `${centeredLeft}px`, top: `${rect.top + rect.height + gap}px`, width: `${width}px` } },
      above: { fits: spaceAbove >= tipSize.h + gap + pad, style: { left: `${centeredLeft}px`, top: `${Math.max(pad, rect.top - gap - tipSize.h)}px`, width: `${width}px` } },
      right: { fits: spaceRight >= width + gap + pad, style: { left: `${rect.left + rect.width + gap}px`, top: `${sideTop}px`, width: `${width}px` } },
      left: { fits: spaceLeft >= width + gap + pad, style: { left: `${Math.max(pad, rect.left - width - gap)}px`, top: `${sideTop}px`, width: `${width}px` } }
    };
    // 步骤可指定优先方位（如注册步放右侧，避免挡住表单），其余按 下→上→右→左 自动选位
    const priority = step.placement
      ? [step.placement, "below", "above", "right", "left"]
      : ["below", "above", "right", "left"];
    for (const key of priority) {
      if (place[key]?.fits) return place[key].style;
    }
    // 兜底：目标占满视口时（整页级容器），把气泡夹紧到视口内（右下角附近）
    return {
      left: `${Math.min(Math.max(centeredLeft, pad), viewportW - width - pad)}px`,
      top: `${Math.min(Math.max(rect.top + rect.height + gap, pad), Math.max(pad, viewportH - tipSize.h - pad))}px`,
      width: `${width}px`
    };
  }, [rect, tipSize.h, tipSize.w, step.placement]);

  if (!active || !step) return null;

  return (
    <div className="tour" role="dialog" aria-modal="false" aria-label="新手教程">
      {rect && !step.center ? (
        // 四块纯色遮罩条（比"超大面积 box-shadow 挖孔"便宜：位移/缩放只重绘几块小矩形）
        <>
          <div className="tour-band" style={{ left: 0, top: 0, width: "100%", height: `${Math.max(0, rect.top)}px` }} aria-hidden="true" />
          <div className="tour-band" style={{ left: 0, top: `${rect.top + rect.height}px`, width: "100%", height: `${Math.max(0, window.innerHeight - rect.top - rect.height)}px` }} aria-hidden="true" />
          <div className="tour-band" style={{ left: 0, top: `${rect.top}px`, width: `${Math.max(0, rect.left)}px`, height: `${rect.height}px` }} aria-hidden="true" />
          <div className="tour-band" style={{ left: `${rect.left + rect.width}px`, top: `${rect.top}px`, width: `${Math.max(0, window.innerWidth - rect.left - rect.width)}px`, height: `${rect.height}px` }} aria-hidden="true" />
          <div className="tour-ring" style={{ left: `${rect.left - 5}px`, top: `${rect.top - 5}px`, width: `${rect.width + 10}px`, height: `${rect.height + 10}px` }} aria-hidden="true" />
        </>
      ) : (
        <div className="tour-dim" aria-hidden="true" />
      )}

      {/* key={index}：每步重新挂载 → 直接在新位置淡入，避免气泡横跨屏幕滑动造成的"卡顿感" */}
      <div key={index} ref={tipRef} className={`tour-tip${step.center ? " is-center" : ""}${flash ? " is-flash" : ""}`} style={step.center ? undefined : tipStyle}>
        <div className="tour-tip-head">
          <span className="tour-tip-brand"><Sparkles size={13} aria-hidden="true" /> 新手教程</span>
          <span className="tour-tip-step">第 {index + 1} / {total} 步</span>
          <button type="button" className="tour-tip-close" title="退出教程（Esc）" aria-label="退出教程" onClick={close}>
            <X size={15} />
          </button>
        </div>
        <div className="tour-tip-bar"><i style={{ width: `${progress}%` }} /></div>
        <div className="tour-tip-body">
          <h2 className="tour-tip-title">{step.title}</h2>
          <p className="tour-tip-text">{step.body}</p>
          <p className={`tour-tip-hint${flash ? " is-ok" : ""}`}>
            {flash ? <><Check size={14} aria-hidden="true" /> {flashText}</> : <><MousePointerClick size={14} aria-hidden="true" /> {step.hint}</>}
          </p>
          {!rect && !step.center && (
            <p className={`tour-tip-wait${stuck ? " is-stuck" : ""}`}>
              {stuck ? "这一步的功能在你当前环境暂无数据，可直接点「下一步」跳过。" : "正在准备页面…"}
            </p>
          )}
        </div>
        <div className="tour-tip-foot">
          <button type="button" className="tour-skip" onClick={close}>跳过教程</button>
          <div className="tour-tip-nav">
            <button type="button" className="tour-prev" disabled={index === 0} onClick={() => go(-1)}>
              <ChevronLeft size={14} aria-hidden="true" />上一步
            </button>
            {index < total - 1 ? (
              <button type="button" className="tour-next" onClick={handleNext}>
                下一步<ChevronRight size={14} aria-hidden="true" />
              </button>
            ) : (
              <button type="button" className="tour-next" onClick={close}>
                完成<Check size={14} aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
