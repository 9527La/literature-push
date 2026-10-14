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
/** 目标从"缺失"变为"出现"后，超过这个时间仍未出现就隐藏聚光灯（避免旧位置长时间滞留） */
const MISS_HIDE_MS = 260;
/** 目标移动超过这个像素视为"真的换了位置"，立即落位；小于它视为抖动，需连续两次一致 */
const MOVE_EPSILON = 8;
/** 自动推进前的提示停留（统一节奏：手动完成 / 教程代劳 / 自动跳过） */
const FLASH_HOLD_MS = 520;
const FLASH_HOLD_PERFORM_MS = 1400;
/** 兜底恢复（recover）的冷却时间：避免同一步反复触发自动修复 */
const RECOVER_COOLDOWN_MS = 4000;
/** 阅读器内步骤的宽限：卡片阅读没打开时，先等这么久（打开有延迟），仍没开就尝试自救/跳过 */
const READER_GRACE_MS = 1500;
/** 阅读器没打开时，最多替用户重试点几次「开始卡片阅读」再放弃（实测手动点一定有效） */
const READER_RECOVER_TRIES = 2;

/** 推送设置步骤（key）：未登录个人账户时，设置页只渲染"游客模式"占位，
 *  这些步骤的目标元素一个都不存在——整段跳过并说明原因，避免连续多步"正在准备页面…"。 */
const ACCOUNT_STEP_KEYS = new Set(["push", "push-email", "push-summary", "push-frequency", "push-time", "push-content", "push-journals", "push-directions", "push-actions"]);
/** 从 fromIndex 之后，第一个不属于推送设置段的步骤 */
function nextStepOutsideAccount(fromIndex) {
  for (let i = fromIndex + 1; i < STEPS.length; i += 1) {
    if (!ACCOUNT_STEP_KEYS.has(STEPS[i].key)) return i;
  }
  return STEPS.length - 1;
}

/** 页面分包按需预热：只预热"接下来 2 步"会去的页面。
 *  （此前在教程启动时一次性 import 全部 7 个视图分包 ≈101 KB，与首屏数据请求
 *   抢带宽和主线程，是"教程一弹出就卡"的主因之一。） */
const PAGE_CHUNKS = {
  "#reports": () => import("../reports/ReportsView.jsx"),
  "#news": () => import("../news/DailyNewsView.jsx"),
  "#favorites": () => import("../favorites/FavoritesView.jsx"),
  "#stats": () => import("../stats/StatsView.jsx"),
  "#settings": () => import("../settings/SettingsView.jsx"),
  "#feedback": () => import("../feedback/FeedbackView.jsx"),
  "#account": () => import("../account/AccountView.jsx")
};
const prefetched = new Set();
function prefetchPages(fromIndex, lookahead = 2) {
  const wanted = new Set();
  for (let i = fromIndex + 1; i <= fromIndex + lookahead && i < STEPS.length; i += 1) {
    const page = STEPS[i]?.page;
    if (page && PAGE_CHUNKS[page]) wanted.add(page);
  }
  for (const page of wanted) {
    if (prefetched.has(page)) continue;
    prefetched.add(page);
    PAGE_CHUNKS[page]().catch(() => { /* 预热失败不影响教程 */ });
  }
}

/** 必须在「卡片阅读已打开」状态下才有意义的步骤（key）。
 *  用户在阅读器里按 Esc 会关闭阅读器（教程故意把 Esc 交给底层），此时这些步骤
 *  的目标元素全部消失——若不做处理，教程会卡在"切换卡片版本"这类步骤上
 *  （2026-10-14 用户反馈：卡在这一步进不去卡片阅读）。 */
const READER_STEP_KEYS = new Set(["reader-flip", "reader-view", "reader-drawer", "reader-batch", "reader-note", "reader-exit"]);
/** 「翻页」步骤的基线：阅读器是异步加载的（先 0 条、再变成 N 条），
 *  进入步骤时读到的索引不能当基线，否则"加载完成导致索引 0→1"会被误判成用户翻页，
 *  这一步就被白白跳过。改为：等总条数就绪后取一次基线，之后的变化才算翻页。 */
let flipBaseline = null;
/** 从 fromIndex 之后，第一个不属于阅读器内的步骤（阅读器被关闭时跳到这里继续） */
function nextStepOutsideReader(fromIndex) {
  for (let i = fromIndex + 1; i < STEPS.length; i += 1) {
    if (!READER_STEP_KEYS.has(STEPS[i].key)) return i;
  }
  return STEPS.length - 1;
}
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
/** 阅读器总条数（读 "第 N / M 条" 里的 M）：为 0 说明还在加载 */
const readerTotal = () => {
  const match = String(document.querySelector(".cr-progress")?.textContent || "").match(/\/\s*(\d+)/);
  return match ? Number(match[1]) : 0;
};
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
    key: "reader-mode-intro",
    resolve: () => firstVisible(".reader-mode-tabs"),
    title: "第一步：两种选范围方式",
    body: "① 按速览期：周报 / 月报 → 期次 → 研究方向 → 专题（主题聚类），适合“把这一期这个方向读一遍”；② 自定义筛选：来源期刊 / 研究方向 / 时间范围 / 阅读状态 / 数量上限，自由组合。",
    hint: "两种方式都了解一下，下面用「自定义筛选」实际走一遍。"
  },
  {
    key: "reader-custom",
    resolve: () => firstVisible(() => byText('.reader-mode-tabs [role="tab"]', "自定义筛选")),
    title: "第二步：切到「自定义筛选」",
    body: "自定义筛选不依赖报告数据，按期刊、方向、时间与数量自由圈定一批文献；文献较少或想跨期阅读时更好用。",
    hint: "请点击「自定义筛选」。",
    perform: () => { if (!customModeOn()) clickIf(() => byText('.reader-mode-tabs [role="tab"]', "自定义筛选")); },
    advance: () => customModeOn()
  },
  {
    key: "reader-journals",
    resolve: () => firstVisible(() => byText(".reader-field", "来源期刊")?.querySelector(".reader-chip-row")),
    autoSkipIfMissing: true,
    optional: true,
    title: "第三步：来源期刊（可选）",
    body: "按出版社分组选择要读的期刊，可多选；不选即全部期刊。",
    hint: "点几本期刊，或直接点「下一步」用全部期刊。",
    perform: () => { if (!has(".reader-chip.on-solid")) clickIf(() => byText(".reader-chip", "IEEE Transactions on Smart Grid") || document.querySelector(".reader-field .reader-chip")); },
    advance: () => has(".reader-chip.on-solid")
  },
  {
    key: "reader-time",
    // 自定义模式下时间范围/阅读状态两个字段都在这一块，给多候选避免偶发解析失败被跳过
    resolve: () => firstVisible(
      () => byText(".reader-field", "时间范围")?.querySelector(".reader-chip-row"),
      () => byText(".reader-field", "阅读状态")?.querySelector(".reader-chip-row"),
      () => byText(".reader-field", "时间范围")
    ),
    autoSkipIfMissing: true,
    optional: true,
    title: "第四步：时间范围与阅读状态（可选）",
    body: "时间范围决定取哪段时间的文献（近 7 日 / 近 30 日 / 本月 / 自定义）；阅读状态可选全部 / 未读 / 已读。",
    hint: "选一个时间范围，或直接点「下一步」用默认。",
    // 时间范围默认已选中 → 用「进入时的选择」做基线，必须真正改选一次才推进，
    // 否则该步会被默认值瞬间满足、一闪而过看不到。
    enter: () => byText(".reader-field", "时间范围")?.querySelector(".reader-chip.on")?.textContent?.trim() || "",
    perform: () => {
      const field = byText(".reader-field", "时间范围");
      if (!field) return;
      const chips = [...field.querySelectorAll(".reader-chip")];
      const current = field.querySelector(".reader-chip.on")?.textContent?.trim() || "";
      const target = chips.find((chip) => chip.textContent.trim() !== current) || chips[0];
      if (target && !target.disabled) target.click();
    },
    advance: (baseline) => {
      const current = byText(".reader-field", "时间范围")?.querySelector(".reader-chip.on")?.textContent?.trim() || "";
      return Boolean(current) && current !== (baseline || "");
    }
  },
  {
    key: "reader-direction",
    target: ".reader-chip--dir",
    title: "第五步：选研究方向",
    body: "每个方向后面标注的是本期该方向的文献篇数。",
    hint: "请点选一个研究方向。",
    // 跳过「无速评」的禁用方向（选了会报错进不去阅读器）
    perform: () => { if (!has(".reader-chip--dir.on")) clickIf(() => document.querySelector(".reader-chip--dir:not([disabled])")); },
    advance: () => has(".reader-chip--dir.on")
  },
  {
    key: "reader-limit",
    resolve: () => firstVisible(() => byText(".reader-chip", "无上限")?.closest(".reader-chip-row"), ".reader-limit-custom"),
    // 按速览期模式下没有「数量上限」→ 自动跳过
    autoSkipIfMissing: true,
    optional: true,
    title: "第六步：数量上限",
    body: "自定义模式下可限定本批数量：50 / 100 / 200 / 自定义（1–300）/ 无上限。选大一些就能一次读更多文献。",
    hint: "点一个上限（如 100），或直接点「下一步」。",
    perform: () => { if (!limitOn()) clickIf(() => byText(".reader-chip", "100") || byText(".reader-chip", "无上限")); },
    advance: () => limitOn()
  },
  {
    key: "reader-catalog",
    resolve: () => byText(".reader-setup button", "生成文献目录"),
    title: "第七步：生成文献目录",
    body: "点「生成文献目录」会按当前条件查一批文献并列出目录（标题 / 期刊 / 日期 / 已读状态）。为避免条件太细导致查不到文献，教程会**先「重置条件」**（无条件＝全部期刊 / 全部方向 / 不限时间），保证目录里一定有文献；你之后可以再按需筛选。",
    hint: "请点击「生成文献目录」（教程会先清空筛选条件）。",
    // 用户可能把条件选得过细 → 生成前先重置条件（无条件），确保一定能出结果、能继续下一步
    perform: () => {
      clickIf(() => byText(".reader-setup-foot button", "重置条件"));
      setTimeout(() => clickIf(() => byText(".reader-setup button", "生成文献目录")), 240);
    },
    advance: () => visible(".reader-catalog-row"),
    // 用户自己手点「生成文献目录」时不会先重置条件 → 条件过窄会得到"没有匹配的文献"，
    // 目录不生成、也就没有「开始卡片阅读」按钮，教程会卡死在这一步（2026-10-14 修复）：
    // 检测到该错误就自动放宽条件并重新生成，把用户带出死胡同。
    recover: () => {
      if (!visible(".reader-setup-error")) return null;
      const reset = byText(".reader-setup-foot button", "重置条件");
      if (reset && !reset.disabled) {
        clickIf(() => byText(".reader-setup-foot button", "重置条件"));
        setTimeout(() => clickIf(() => byText(".reader-setup button", "生成文献目录")), 240);
        return { message: "当前条件太窄，已自动放宽条件并重新生成目录" };
      }
      // 按速览期：「重置条件」不可用。若报的是"该方向本期没有可阅读的速评文献"，
      // 换一个本期真有速评的方向重试（2026-10-14 用户反馈：选到无速评的方向就进不去）。
      const nextDir = document.querySelector(".reader-chip--dir:not([disabled]):not(.on)");
      if (nextDir) {
        nextDir.click();
        setTimeout(() => clickIf(() => byText(".reader-setup button", "生成文献目录")), 700);
        return { message: "该方向本期没有速评，已换一个有速评的方向" };
      }
      return null;
    }
  },
  {
    key: "reader-start",
    resolve: () => byText("button", "开始卡片阅读"),
    title: "第八步：开始阅读",
    body: "目录确认无误后进入全屏卡片阅读；阅读中随时可以「返回调整」重新选范围。",
    hint: "请点击「开始卡片阅读」。",
    perform: () => clickIf(() => byText("button", "开始卡片阅读")),
    // 必须等阅读器真的打开才推进：此前「下一步」会在 1.4s 后无条件前进，
    // 一旦这次点击没生效就会一路滑进阅读器内的步骤（2026-10-14 修复）
    strictAdvance: true,
    advance: () => visible(".card-reader")
  },
  {
    key: "reader-flip",
    needsReader: true,
    resolve: () => document.querySelector(".cr-nav--primary"),
    title: "翻页",
    body: "顶部显示「第 N / M 条」，进度条可点击或拖动跳转；默认开启「读即标记」——翻过去就自动标记已读。",
    hint: "请点「下一条」，或直接按键盘 → / 空格。",
    perform: () => clickIf(".cr-nav--primary"),
    // 进入时只重置基线（真正的基线在"加载完成后的第一帧"取，见 advance）
    enter: () => { flipBaseline = null; return null; },
    // 只有 1 篇（下一条禁用）时无页可翻 → 自动继续，避免卡住；
    // 但"阅读器还在加载"和"加载完成导致的索引跳变"都不算翻页，否则这一步会被跳过。
    advance: () => {
      if (!visible(".card-reader") || readerTotal() === 0) return false;
      const current = readerIndex();
      if (flipBaseline === null) { flipBaseline = current; return false; }
      return current > flipBaseline || !document.querySelector(".cr-nav--primary:not([disabled])");
    }
  },
  {
    key: "reader-view",
    needsReader: true,
    target: ".cr-views",
    title: "切换卡片版本",
    body: "速评版（研究对象 / 研究方法 / 核心结论）、中文摘要版（完整摘要，可展开英文对照）、原文版；默认版本会自动记忆。",
    hint: "请点击「中文摘要版」（也可以按键盘 2）。",
    perform: () => { if (!visible(".cr-abstract")) clickIf(() => document.querySelectorAll(".cr-views button")[1]); },
    advance: () => visible(".cr-abstract")
  },
  {
    key: "reader-drawer",
    needsReader: true,
    resolve: () => document.querySelector(".cr-head-right .cr-icon-btn"),
    title: "目录抽屉",
    body: "这里能看全批清单、点击序号直达，也能在阅读中改范围（仅未读 / 仅有速评 / 按期刊）。",
    hint: "请点击目录按钮（或按 D）。",
    perform: () => { if (!visible(".cr-drawer")) clickIf(() => document.querySelector(".cr-head-right .cr-icon-btn")); },
    advance: () => visible(".cr-drawer")
  },
  {
    key: "reader-batch",
    needsReader: true,
    target: ".cr-drawer-batch",
    title: "读完本批",
    body: "抽屉底部可以把本批剩余未读一键标记为已读（会二次确认）。现在先不用点。",
    hint: "点「下一步」继续（或按 Esc 关闭抽屉）。"
  },
  {
    key: "reader-note",
    needsReader: true,
    target: ".cr-note-toggle",
    title: "备注 / 收藏 / 复制引用",
    body: "卡片底部可以随手记备注（存到收藏备注，未收藏会自动先收藏）；底部操作栏还有收藏（F）、标记已读（R）、复制 GB/T 7714 引用（C）。",
    hint: "可以先关闭抽屉，再点「下一步」。"
  },
  {
    key: "reader-exit",
    needsReader: true,
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
    hint: "这一步只看不点，看完点「下一步」。",
    // 「来源期刊」chips 只存在于**方向专报态**（总览态不渲染）。用户若停在总览，
    // 这一步就会没有任何高亮（2026-10-14 用户反馈）。检测到目标缺失就先替用户
    // 点一个方向 chip 进入专报，再让聚光灯落位。
    recover: () => {
      if (visible(".reports-meta-journals") || visible(".reports-journal-chip")) return null;
      const chip = document.querySelector(".reports-dir-chip:not(.overview)");
      if (!chip) return null;
      clickIf(() => document.querySelector(".reports-dir-chip:not(.overview)"));
      return { message: "已切到方向专报，展示「来源期刊」筛选" };
    }
  },
  {
    key: "reports-cardread",
    // 方向专报态下没有分组卡（总览才有），信息条上的「卡片阅读 · N 篇」是等价入口
    resolve: () => firstVisible(".reports-group-cardread", ".reports-group-head", ".reports-cardread-btn"),
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
    needsAccount: true,
    page: "#settings",
    resolve: () => firstVisible(".settings-left", ".settings-section", ".settings-view"),
    title: "文献推送：页面结构",
    body: "左栏是「我的周报邮箱」，右栏是「推送计划」——上面是当前计划概览，下面是可编辑的推送设置。另有微信公众号「电气前沿速递」每日推送。",
    hint: "下面逐步介绍每个设置项，点「下一步」继续。"
  },
  {
    key: "push-email",
    needsAccount: true,
    resolve: () => firstVisible(".email-row", ".saved-email-status"),
    title: "① 我的周报邮箱",
    body: "填写接收邮箱后点「保存」；点「发送测试邮箱」可确认地址是否可用（测试邮件或正式推送没收到时，先核对邮箱再联系管理员）。",
    hint: "这一步只看不点，看完点「下一步」。"
  },
  {
    key: "push-summary",
    needsAccount: true,
    resolve: () => firstVisible(".push-summary", ".push-settings"),
    title: "② 当前推送计划概览",
    body: "这里汇总当前生效的配置：推送频率、推送期刊、研究方向偏好。改设置并保存后，概览会同步更新。",
    hint: "这一步只看不点，看完点「下一步」。"
  },
  {
    key: "push-frequency",
    needsAccount: true,
    resolve: () => firstVisible(".push-frequency"),
    title: "③ 推送频率",
    body: "每天 / 每周 / 每月三选一：每周需再选星期几，每月需再选日期；配合发送时间即可确定推送节奏。",
    hint: "这一步只看不点，看完点「下一步」。",
    // 已启用推送时设置页默认停在**概览态**（只有摘要 + 「修改推送设置」按钮），
    // 频率/时间/内容/期刊/方向这些编辑项都不渲染 → 步骤③~⑦全都没有高亮
    // （2026-10-14 用户反馈）。检测到目标缺失就先替用户进入编辑态。
    recover: () => {
      if (visible(".push-frequency")) return null;
      const editBtn = byText(".push-actions button", "修改推送设置");
      if (!editBtn || editBtn.disabled) return null;
      clickIf(() => byText(".push-actions button", "修改推送设置"));
      return { message: "已进入推送设置编辑态" };
    }
  },
  {
    key: "push-time",
    needsAccount: true,
    resolve: () => firstVisible(".push-time-selector"),
    title: "④ 发送时间",
    body: "选择小时与分钟（按服务器时间）；设置完成后需要点「保存推送设置」，计划才会真正生效。",
    hint: "这一步只看不点，看完点「下一步」。"
  },
  {
    key: "push-content",
    needsAccount: true,
    resolve: () => firstVisible(".push-content-options"),
    title: "⑤ 邮件内容",
    body: "可分别开关：附件文件、摘要、关键词、中文翻译。只勾选需要的部分，邮件会更精简。",
    hint: "这一步只看不点，看完点「下一步」。"
  },
  {
    key: "push-journals",
    needsAccount: true,
    resolve: () => firstVisible(".push-journal-filter"),
    title: "⑥ 推送期刊范围",
    body: "按出版社分组选择要推送的期刊，可整组勾选或逐本挑选；不选即默认全部期刊。",
    hint: "这一步只看不点，看完点「下一步」。"
  },
  {
    key: "push-directions",
    needsAccount: true,
    resolve: () => firstVisible(".push-direction-list"),
    title: "⑦ 推送研究方向",
    body: "只推送选定的研究方向；邮件正文按方向分组展示，分组顺序与这里的点选顺序一致（标签上带顺序编号，取消后重新点选即可调整顺序）。",
    hint: "这一步只看不点，看完点「下一步」。"
  },
  {
    key: "push-actions",
    needsAccount: true,
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
  /** 上一步所在的页面（hash）：跨页切换时清掉旧矩形，避免聚光灯横跨整页滑动 */
  const prevPageRef = useRef("");
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

  /** strictAdvance 步骤（如"开始阅读"）的连续「下一步」次数：第一次只重试，第二次才放行 */
  const strictRetryRef = useRef(0);

  /** 「下一步」：若本步需要操作，则先替用户完成该步的真实点击（避免直接跳过导致页面状态不对） */
  const handleNext = useCallback(() => {
    if (step?.perform) {
      setFlashText(step.strictAdvance ? "正在打开卡片阅读…" : "已帮你完成这一步，正在继续…");
      setFlash(true);
      try { step.perform(); } catch { /* 忽略 */ }
      // strictAdvance：只按真实状态推进（例如"开始阅读"必须等阅读器真的打开）。
      // ❌ 不要"连点两次就放行"——阅读器还在渲染时硬推进到阅读器内的步骤，
      //    会让后续步骤因阅读器未打开而整段跳过（2026-10-14 用户反馈：
      //    「生成目录后点下一步直接跳到研究速览」）。连点多次仍无进展时，
      //    改为跳过「阅读器段」，而不是硬塞进阅读器内的步骤。
      if (step.strictAdvance) {
        strictRetryRef.current += 1;
        if (strictRetryRef.current >= 3) {
          strictRetryRef.current = 0;
          setFlashText("卡片阅读没有打开，已跳过阅读器内的步骤");
          const target = nextStepOutsideReader(index);
          setTimeout(() => setIndex(target), FLASH_HOLD_MS);
        }
        return;
      }
      const at = indexRef.current;
      setTimeout(() => { if (indexRef.current === at) go(1); }, FLASH_HOLD_PERFORM_MS);
      return;
    }
    go(1);
  }, [go, step, index]);

  const start = useCallback(() => {
    prefetchPages(0);
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
    // 不再一次性预热全部页面分包：只预热第 1 步之后的 2 个页面
    prefetchPages(0);
    const timer = setTimeout(() => setActive(true), 900);
    return () => clearTimeout(timer);
  }, [enabled]);

  /* 使用说明页「重新体验新手教程」 */
  useEffect(() => {
    window.addEventListener(TOUR_EVENT, start);
    return () => window.removeEventListener(TOUR_EVENT, start);
  }, [start]);

  /* 步骤切换：必要时跳转页面；记录基线；按需预热后面 2 步的页面分包 */
  useEffect(() => {
    if (!active || !step) return;
    // 有效页面 = 步骤声明的 page，未声明时沿用当前 hash（否则会被误判成"跨页"，
    // 把气泡打回屏幕中央、正好挡住下一步要点的目标）
    const currentPage = String(window.location.hash || "#feed").split("?")[0] || "#feed";
    const pageKey = step.page || currentPage;
    const pageChanged = pageKey !== prevPageRef.current;
    prevPageRef.current = pageKey;
    if (step.page && !onHash(step.page)) {
      window.location.hash = step.page;
    }
    // 跨页步骤：旧页面的矩形对新页面没有意义，先清掉，避免聚光灯横跨整页滑动
    if (pageChanged) setRect(null);
    strictRetryRef.current = 0;
    prefetchPages(index);
    baselineRef.current = step.enter ? step.enter() : null;
    setFlash(false);
    // 滚动定位改到「目标出现的那一刻」立刻执行（见跟踪 effect），
    // 不再用固定 700ms 等待——那段时间界面静止，是"步骤之间卡顿"的主要来源。
    scrolledRef.current = "";
  }, [active, index, step]);

  /* 目标矩形跟踪 + 自动推进检测
   *  丝滑化三原则（2026-10-14 重做）：
   *   ① 首测即落位——不再要求"连续两次测量一致"，目标一出现就立刻把聚光灯放到位，
   *      消除"内容早已就绪、高亮还在缓慢过渡"的延迟（旧实现至少滞后 1 个轮询周期）；
   *   ② 大位移立即响应、微抖动才去抖——位移 > MOVE_EPSILON 直接落位，小于它才要求
   *      连续两次一致，兼顾"跟手"与"不抖"；
   *   ③ 读布局一次算一次——每个 tick 只做一次 getBoundingClientRect，
   *      滚动/缩放事件经 rAF 合并、passive 监听，避免滚动时每事件强制同步布局。 */
  useEffect(() => {
    if (!active || !step) return undefined;
    let advancing = false;
    let missSince = 0;
    let lastKey = "";
    let stableCount = 0;
    let pollTimer = null;
    let idle = false;
    let raf = 0;
    const measure = () => {
      const el = step.resolve ? step.resolve() : (step.target ? document.querySelector(step.target) : null);
      const box = el ? el.getBoundingClientRect() : null;
      const shown = Boolean(box && box.width > 0 && box.height > 0);
      if (!shown) {
        // 目标暂未出现（如跨页面加载中）：短暂保留旧位置后隐藏聚光灯，避免旧位置滞留造成"高亮跟不上页面"
        missSince = missSince || Date.now();
        lastKey = "";
        stableCount = 0;
        const missed = Date.now() - missSince;
        if (missed > MISS_HIDE_MS) setRect(null);
        if (missed > 5000) setStuck(true);
        // 该步在当前模式下不存在（如自定义筛选没有"专题"）→ 自动跳过，不卡住用户
        if (step.autoSkipIfMissing && missed > 2200 && !advancing) {
          advancing = true;
          setFlashText("当前模式下没有这一步，已自动跳过");
          setFlash(true);
          setTimeout(() => go(1), FLASH_HOLD_MS);
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
      const next = { top: box.top, left: box.left, width: box.width, height: box.height };
      const key = `${Math.round(next.top)}|${Math.round(next.left)}|${Math.round(next.width)}|${Math.round(next.height)}`;
      setRect((prev) => {
        if (!prev) return next;                       // ① 首次落位：立即
        const moved = Math.abs(prev.top - next.top) > MOVE_EPSILON
          || Math.abs(prev.left - next.left) > MOVE_EPSILON
          || Math.abs(prev.width - next.width) > MOVE_EPSILON
          || Math.abs(prev.height - next.height) > MOVE_EPSILON;
        const same = Math.abs(prev.top - next.top) < 1
          && Math.abs(prev.left - next.left) < 1
          && Math.abs(prev.width - next.width) < 1
          && Math.abs(prev.height - next.height) < 1;
        if (same) return prev;
        // ② 大位移立即跟手；微小抖动需连续两次测量一致（去抖）
        if (moved) { lastKey = key; stableCount = 0; return next; }
        if (key === lastKey) stableCount += 1; else { lastKey = key; stableCount = 0; }
        return stableCount >= 1 ? next : prev;
      });
      // 位置稳定后降低轮询频率，减少主线程占用
      if (!idle && key === lastKey && stableCount >= 4 && pollTimer) {
        idle = true;
        clearInterval(pollTimer);
        pollTimer = setInterval(tick, POLL_IDLE_MS);
      }
    };
    const checkAdvance = () => {
      if (!advancing && step.advance && step.advance(baselineRef.current)) {
        advancing = true;
        setFlashText("操作完成，继续下一步");
        setFlash(true);
        setTimeout(() => go(1), FLASH_HOLD_MS);
      }
    };
    // 本步可能因为筛选条件过窄而走不通（如"生成文献目录"为空）：给一个自动兜底，
    // 由步骤自己决定怎么恢复，教程负责提示与冷却，避免用户卡在这一步。
    let recoverUntil = 0;
    const checkRecover = () => {
      if (advancing || !step.recover || Date.now() < recoverUntil) return;
      let outcome = null;
      try { outcome = step.recover(); } catch { outcome = null; }
      if (!outcome) return;
      recoverUntil = Date.now() + RECOVER_COOLDOWN_MS;
      setFlashText(outcome.message || "已自动调整并重试");
      setFlash(true);
    };
    // 阅读器内步骤的守卫：卡片阅读被关闭（例如用户按 Esc —— 教程故意把 Esc 交给底层）
    // 时，这些步骤的目标元素全部消失。处理顺序：先替用户重试打开阅读器（实测手动点
    // 「开始卡片阅读」一定有效），重试仍失败才整段跳过并明确告知。
    let readerMissSince = 0;
    let readerRecoverCount = 0;
    const checkReaderGuard = () => {
      if (!step.needsReader || advancing) return;
      if (visible(".card-reader")) { readerMissSince = 0; return; }
      readerMissSince = readerMissSince || Date.now();
      if (Date.now() - readerMissSince < READER_GRACE_MS) return;
      const startBtn = byText("button", "开始卡片阅读");
      if (startBtn && !startBtn.disabled && readerRecoverCount < READER_RECOVER_TRIES) {
        readerRecoverCount += 1;
        readerMissSince = 0;
        clickIf(() => byText("button", "开始卡片阅读"));
        setFlashText("正在打开卡片阅读…");
        setFlash(true);
        return;
      }
      advancing = true;
      setFlashText("卡片阅读已关闭，已跳过阅读器内的步骤（想重看可点「上一步」）");
      setFlash(true);
      const target = nextStepOutsideReader(index);
      setTimeout(() => setIndex(target), FLASH_HOLD_MS);
    };
    // 推送设置段的守卫：未登录个人账户时设置页是"游客模式"占位，该段所有目标都不存在
    let accountMissSince = 0;
    const checkAccountGuard = () => {
      if (!step.needsAccount || advancing) return;
      if (loggedIn()) { accountMissSince = 0; return; }
      accountMissSince = accountMissSince || Date.now();
      if (Date.now() - accountMissSince < READER_GRACE_MS) return;
      advancing = true;
      setFlashText("未登录个人账户，已跳过推送设置（注册后可在使用说明页重看教程）");
      setFlash(true);
      const target = nextStepOutsideAccount(index);
      setTimeout(() => setIndex(target), FLASH_HOLD_MS);
    };
    const tick = () => { if (document.hidden) return; measure(); checkAdvance(); checkReaderGuard(); checkAccountGuard(); checkRecover(); };
    /** 滚动/缩放等高频事件：合并到一帧只跑一次，且监听器为 passive */
    const schedule = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; tick(); });
    };
    tick();
    raf = requestAnimationFrame(() => { raf = 0; tick(); });
    pollTimer = setInterval(tick, POLL_MS);
    window.addEventListener("resize", schedule, { passive: true });
    window.addEventListener("scroll", schedule, { passive: true, capture: true });
    window.addEventListener("hashchange", schedule);
    document.addEventListener("visibilitychange", schedule);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      if (pollTimer) clearInterval(pollTimer);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, { capture: true });
      window.removeEventListener("hashchange", schedule);
      document.removeEventListener("visibilitychange", schedule);
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

  // 聚光灯矩形：无目标（跨页加载中 / 居中步）时退化为"整屏遮罩"（顶条铺满、其余为 0），
  // 四块遮罩条**始终挂载**——这样"挖孔"是平滑开合，而不是 dim ↔ 四条之间的硬切换（闪一下）。
  const hole = rect && !step.center ? rect : null;
  const viewportW = typeof window === "undefined" ? 0 : window.innerWidth;
  const viewportH = typeof window === "undefined" ? 0 : window.innerHeight;

  return (
    <div className="tour" role="dialog" aria-modal="false" aria-label="新手教程">
      {step.center ? (
        <div className="tour-dim" aria-hidden="true" />
      ) : (
        <>
          <div className="tour-band" style={{ left: 0, top: 0, width: "100%", height: `${hole ? Math.max(0, hole.top) : viewportH}px` }} aria-hidden="true" />
          <div className="tour-band" style={{ left: 0, top: `${hole ? hole.top + hole.height : viewportH}px`, width: "100%", height: `${hole ? Math.max(0, viewportH - hole.top - hole.height) : 0}px` }} aria-hidden="true" />
          <div className="tour-band" style={{ left: 0, top: `${hole ? hole.top : 0}px`, width: `${hole ? Math.max(0, hole.left) : 0}px`, height: `${hole ? hole.height : 0}px` }} aria-hidden="true" />
          <div className="tour-band" style={{ left: `${hole ? hole.left + hole.width : viewportW}px`, top: `${hole ? hole.top : 0}px`, width: `${hole ? Math.max(0, viewportW - hole.left - hole.width) : 0}px`, height: `${hole ? hole.height : 0}px` }} aria-hidden="true" />
          {hole && (
            <div className="tour-ring" style={{ left: `${hole.left - 5}px`, top: `${hole.top - 5}px`, width: `${hole.width + 10}px`, height: `${hole.height + 10}px` }} aria-hidden="true" />
          )}
        </>
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
          {!hole && !step.center && (
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
