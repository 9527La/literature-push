import { useEffect, useRef, useState } from "react";
import {
  BarChart3,
  BookOpen,
  Check,
  ChevronDown,
  CircleUserRound,
  HelpCircle,
  Library,
  MessageSquare,
  Newspaper,
  Settings,
  ShieldCheck,
  Sparkles,
  Star,
  UserRound
} from "lucide-react";
import NavGroupPanel from "./NavGroupPanel.jsx";
import BrandMark from "../../components/BrandMark.jsx";

/**
 * 顶栏导航（S1：自 main.jsx 拆出）。
 *
 * 收编了原来散在 App 里的四段逻辑：导航横滚边缘渐隐、下拉组单开互斥
 * （hover 即开 / 离组 200ms 收 / 点击切换 / 外点·Esc·resize·横滚关闭）、
 * ARIA menu 键盘模式（U2/A6）与懒加载 chunk 预取（P1：hover/focus 到
 * 入口即 import()，切视图时 chunk 基本已就绪）。
 *
 * V2：导航文字包在 .nav-label 里，≤1339px 时 CSS 切为仅图标
 * （按钮带 title + aria-label，可访问名不丢）。
 */

// 与 main.jsx 的 lazy() 一一对应：预取只是提前触发同一次动态 import。
const VIEW_MODULES = {
  reports: () => import("../reports/ReportsView.jsx"),
  news: () => import("../news/DailyNewsView.jsx"),
  stats: () => import("../stats/StatsView.jsx"),
  favorites: () => import("../favorites/FavoritesView.jsx"),
  settings: () => import("../settings/SettingsView.jsx"),
  account: () => import("../account/AccountView.jsx"),
  feedback: () => import("../feedback/FeedbackView.jsx"),
  help: () => import("../help/HelpView.jsx"),
  admin: () => import("../admin/AdminView.jsx")
};

function prefetchView(view) {
  const load = VIEW_MODULES[view];
  if (load) load().catch(() => {});
}

function NavButton({ view, active, onClick, icon: Icon, label, badge, prefetch = true }) {
  return (
    <button
      className={active ? "active" : ""}
      onClick={onClick}
      title={label}
      aria-label={badge ? `${label}，${badge} 篇未读` : label}
      onMouseEnter={prefetch ? () => prefetchView(view) : undefined}
      onFocus={prefetch ? () => prefetchView(view) : undefined}
    >
      <Icon size={16} aria-hidden="true" />
      <span className="nav-label">{label}</span>
      {badge > 0 && <span className="nav-badge" aria-hidden="true">{badge}</span>}
    </button>
  );
}

export default function TopNav({
  activeView,
  account,
  status,
  loading,
  onSwitchView,
  onRefresh,
  onLeaveWebsite
}) {
  const navRef = useRef(null);
  const [navEdges, setNavEdges] = useState({ left: false, right: false });
  const [openGroup, setOpenGroup] = useState(null);
  const openGroupRef = useRef(null);
  const groupOpenedAtRef = useRef(0);
  const groupAutoFocusRef = useRef(false);
  const digestGroupBtnRef = useRef(null);
  const personalGroupBtnRef = useRef(null);
  const groupCloseTimersRef = useRef({});

  // 顶部导航横向溢出的可发现性（2026-10-01）：窄窗口下 tabs 被裁剪且滚动条
  // 隐藏，观感是「栏目被遮盖」。边缘渐隐由 .nav-wrap.can-left/can-right 渲染，
  // 滚轮纵向增量转横向滚动（wheel 必须非 passive 才能 preventDefault）。
  useEffect(() => {
    const el = navRef.current;
    if (!el) return undefined;
    const update = () => {
      const max = el.scrollWidth - el.clientWidth;
      setNavEdges({ left: el.scrollLeft > 4, right: el.scrollLeft < max - 4 });
    };
    update();
    const onWheel = (event) => {
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      const max = el.scrollWidth - el.clientWidth;
      if (max <= 0) return;
      const next = Math.max(0, Math.min(max, el.scrollLeft + event.deltaY));
      if (next !== el.scrollLeft) {
        el.scrollLeft = next;
        event.preventDefault();
      }
    };
    el.addEventListener("scroll", update, { passive: true });
    el.addEventListener("wheel", onWheel, { passive: false });
    const observer = new ResizeObserver(update);
    observer.observe(el);
    window.addEventListener("resize", update);
    return () => {
      el.removeEventListener("scroll", update);
      el.removeEventListener("wheel", onWheel);
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [account.is_admin]);

  const applyOpenGroup = (key, { autoFocus = false } = {}) => {
    openGroupRef.current = key;
    groupAutoFocusRef.current = autoFocus;
    setOpenGroup(key);
  };
  const openGroupMenu = (key, { autoFocus = false } = {}) => {
    clearTimeout(groupCloseTimersRef.current[key]);
    if (openGroupRef.current !== key) groupOpenedAtRef.current = performance.now();
    applyOpenGroup(key, { autoFocus });
  };
  const scheduleCloseGroup = (key) => {
    clearTimeout(groupCloseTimersRef.current[key]);
    groupCloseTimersRef.current[key] = setTimeout(() => {
      if (openGroupRef.current === key) applyOpenGroup(null);
    }, 200);
  };
  const closeGroup = ({ restoreFocus = false } = {}) => {
    const key = openGroupRef.current;
    if (!key) return;
    clearTimeout(groupCloseTimersRef.current[key]);
    applyOpenGroup(null);
    if (restoreFocus) {
      const trigger = key === "digest" ? digestGroupBtnRef.current : personalGroupBtnRef.current;
      trigger?.focus?.();
    }
  };
  const toggleGroup = (key, { autoFocus = false } = {}) => {
    clearTimeout(groupCloseTimersRef.current[key]);
    if (openGroupRef.current === key) {
      // hover 刚打开（<400ms）时的点击视为「确认」而不是关闭，避免一闪而过。
      if (performance.now() - groupOpenedAtRef.current < 400) return;
      closeGroup();
      return;
    }
    groupOpenedAtRef.current = performance.now();
    applyOpenGroup(key, { autoFocus });
  };

  // 2026-10-08 导航分组：顶栏五个入口 = 文献库 / 资讯汇总▾ / 公共讨论 / 使用说明 / 个人中心▾。
  // 下拉组单开互斥：hover 进组即开、离组 200ms 后收，点击切换；
  // 外点 / Esc / 窗口 resize / 导航横滚时关闭（openGroup 非空才挂监听）。
  useEffect(() => {
    if (openGroup === null) return undefined;
    const onPointerDown = (event) => {
      if (!event.target.closest(".nav-group") && !event.target.closest(".nav-menu")) closeGroup();
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") closeGroup({ restoreFocus: true });
    };
    const onScrollOrResize = () => closeGroup();
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onScrollOrResize);
    navRef.current?.addEventListener("scroll", onScrollOrResize);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onScrollOrResize);
      navRef.current?.removeEventListener("scroll", onScrollOrResize);
    };
  }, [openGroup]);

  function switchView(view) {
    onSwitchView(view);
    closeGroup();
  }

  function renderGroupButton(key, label, Icon, btnRef) {
    return (
      <button
        className="group-btn"
        aria-haspopup="true"
        aria-expanded={openGroup === key}
        aria-controls={`nav-menu-${key}`}
        title={label}
        ref={btnRef}
        onClick={(event) => toggleGroup(key, { autoFocus: event.detail === 0 })}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            openGroupMenu(key, { autoFocus: true });
          }
        }}
        onMouseEnter={() => openGroupMenu(key)}
        onMouseLeave={() => scheduleCloseGroup(key)}
      >
        <Icon size={16} aria-hidden="true" />
        <span className="nav-label">{label}</span>
        <ChevronDown size={14} className="chev" aria-hidden="true" />
      </button>
    );
  }

  function renderMenuItem(key, view, label, Icon, extra = null) {
    const active = activeView === view;
    return (
      <button
        key={view}
        className={`nav-menu-item${active ? " active" : ""}`}
        role="menuitem"
        onClick={() => switchView(view)}
        onMouseEnter={() => prefetchView(view)}
      >
        <Icon size={16} aria-hidden="true" />
        <span className="menu-label">{label}</span>
        {extra}
        {active && <Check size={15} className="menu-check" aria-hidden="true" />}
      </button>
    );
  }

  return (
    <header className="topbar">
      <div className="topbar-row-main">
        <div className="topbar-left">
          <div className="brand">
            <BrandMark size={26} />
            <span>电气前沿速递</span>
          </div>
          <div className={`nav-wrap${navEdges.left ? " can-left" : ""}${navEdges.right ? " can-right" : ""}`}>
            <nav className="nav" aria-label="主导航" ref={navRef}>
              <NavButton
                view="feed"
                active={activeView === "feed"}
                onClick={() => switchView("feed")}
                icon={Library}
                label="文献库"
                prefetch={false}
              />
              <div
                className={`nav-group${openGroup === "digest" ? " open" : ""}${["reports", "news", "stats"].includes(activeView) ? " active" : ""}`}
                onMouseEnter={() => openGroupMenu("digest")}
                onMouseLeave={() => scheduleCloseGroup("digest")}
              >
                {renderGroupButton("digest", "资讯汇总", BookOpen, digestGroupBtnRef)}
                {openGroup === "digest" && (
                  <NavGroupPanel
                    anchorRef={digestGroupBtnRef}
                    triggerRef={digestGroupBtnRef}
                    labelledBy="nav-menu-digest-title"
                    autoFocus={groupAutoFocusRef.current}
                    onMouseEnter={() => openGroupMenu("digest")}
                    onMouseLeave={() => scheduleCloseGroup("digest")}
                    onDismiss={closeGroup}
                  >
                    <span id="nav-menu-digest-title" className="sr-only">资讯汇总</span>
                    {renderMenuItem("digest", "reports", "研究速览", Sparkles)}
                    {renderMenuItem("digest", "news", "每日资讯", Newspaper)}
                    {renderMenuItem("digest", "stats", "关键词统计", BarChart3)}
                  </NavGroupPanel>
                )}
              </div>
              <NavButton
                view="feedback"
                active={activeView === "feedback"}
                onClick={() => switchView("feedback")}
                icon={MessageSquare}
                label="公共讨论"
              />
              <NavButton
                view="help"
                active={activeView === "help"}
                onClick={() => switchView("help")}
                icon={HelpCircle}
                label="使用说明"
              />
              <div
                className={`nav-group${openGroup === "personal" ? " open" : ""}${["favorites", "settings", "account", "admin"].includes(activeView) ? " active" : ""}`}
                onMouseEnter={() => openGroupMenu("personal")}
                onMouseLeave={() => scheduleCloseGroup("personal")}
              >
                {renderGroupButton("personal", "个人中心", CircleUserRound, personalGroupBtnRef)}
                {openGroup === "personal" && (
                  <NavGroupPanel
                    anchorRef={personalGroupBtnRef}
                    triggerRef={personalGroupBtnRef}
                    labelledBy="nav-menu-personal-title"
                    autoFocus={groupAutoFocusRef.current}
                    onMouseEnter={() => openGroupMenu("personal")}
                    onMouseLeave={() => scheduleCloseGroup("personal")}
                    onDismiss={closeGroup}
                  >
                    <span id="nav-menu-personal-title" className="sr-only">个人中心</span>
                    {renderMenuItem("personal", "favorites", "收藏文献", Star)}
                    {renderMenuItem("personal", "settings", "文献推送", Settings)}
                    {renderMenuItem("personal", "account", "个人账户", UserRound, account.authenticated ? <span className="menu-sub">{account.username}</span> : null)}
                    {account.is_admin && (
                      <>
                        <div className="nav-menu-sep" role="separator" />
                        {renderMenuItem("personal", "admin", "管理中心", ShieldCheck)}
                      </>
                    )}
                  </NavGroupPanel>
                )}
              </div>
            </nav>
          </div>
        </div>
        <div className="topbar-right">
          {account.is_admin && (
            <button className="primary" onClick={onRefresh} disabled={loading} title="立即刷新文献数据">
              {loading ? "刷新中" : "立即刷新"}
            </button>
          )}
          <button className="secondary topbar-exit" type="button" onClick={onLeaveWebsite} title="退出网页">退出网页</button>
        </div>
      </div>
      {/* 顶栏统计胶囊已移入管理中心（2026-09-28 用户要求）：数据源仍为 /api/status。 */}
    </header>
  );
}
