import { useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";

/**
 * 导航下拉组面板（S1：自 main.jsx 拆出；U2/A6：补全 WAI-ARIA menu 键盘模式）。
 *
 * portal 到 body —— .nav 是横向滚动的裁剪容器，面板挂在里面会被 overflow
 * 裁掉；因此用 fixed 定位按触发按钮的视口坐标锚定。顶栏本身 fixed，页面
 * 滚动不改变按钮位置；窗口 resize / 导航横滚时由 TopNav 关闭。
 *
 * 键盘模式（打开时由 TopNav 传 autoFocus）：
 *   ↑↓ 在菜单项间循环（roving tabindex）、Home/End 跳首尾、
 *   Esc 关闭并把焦点还给触发按钮、Tab 关闭并让焦点回到触发按钮后继续。
 * 鼠标悬停打开时不抢焦点（autoFocus=false），但首项仍可 Tab 进入。
 */
export default function NavGroupPanel({
  anchorRef,
  triggerRef,
  autoFocus = false,
  labelledBy = "",
  onMouseEnter,
  onMouseLeave,
  onDismiss,
  children
}) {
  const menuRef = useRef(null);
  const rect = anchorRef.current?.getBoundingClientRect();

  useEffect(() => {
    const menu = menuRef.current;
    if (!menu) return undefined;
    const items = Array.from(menu.querySelectorAll('[role="menuitem"]'));
    if (!items.length) return undefined;
    // roving tabindex：任意时刻只有一项可 Tab 进入。
    items.forEach((item, index) => { item.tabIndex = index === 0 ? 0 : -1; });
    if (autoFocus) items[0].focus();

    function focusItem(index) {
      const next = (index + items.length) % items.length;
      items.forEach((item, i) => { item.tabIndex = i === next ? 0 : -1; });
      items[next].focus();
    }

    function handleKeyDown(event) {
      const current = items.indexOf(document.activeElement);
      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          focusItem(current + 1);
          break;
        case "ArrowUp":
          event.preventDefault();
          focusItem(current - 1);
          break;
        case "Home":
          event.preventDefault();
          focusItem(0);
          break;
        case "End":
          event.preventDefault();
          focusItem(items.length - 1);
          break;
        case "Escape":
          event.preventDefault();
          onDismiss?.({ restoreFocus: true });
          break;
        case "Tab":
          // 焦点移出菜单即关闭；归还给触发按钮，避免焦点掉到 body。
          event.preventDefault();
          onDismiss?.({ restoreFocus: true });
          break;
        default:
          break;
      }
    }
    menu.addEventListener("keydown", handleKeyDown);
    return () => menu.removeEventListener("keydown", handleKeyDown);
  }, [autoFocus, onDismiss]);

  if (!rect) return null;
  return createPortal(
    <div
      ref={menuRef}
      className="nav-menu"
      role="menu"
      aria-labelledby={labelledBy || undefined}
      style={{ left: Math.max(12, Math.round(rect.left)), top: Math.round(rect.bottom + 6) }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {children}
    </div>,
    document.body
  );
}
