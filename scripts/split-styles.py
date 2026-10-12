#!/usr/bin/env python3
"""P6：styles.css 分区拆分（一次性脚本）。

按既有 section 横幅边界把 6408 行单文件拆为 12 个 partial，顺序与原文件
逐字节一致（拆分后可用 sha256 校验拼接结果 == 原文件）。styles.css 自身
只剩 @import 清单——Vite 构建时会按 import 顺序原样内联，级联关系不变。

后续新增规则一律追加到 99-tail.css 末尾（与原「文件末尾追加」惯例同一级联
位置），不要再往 styles.css 里写规则。
"""
import hashlib
import os

SRC = os.path.join(os.path.dirname(__file__), "..", "src", "styles.css")
OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "src", "styles")

# (文件名, 起始行[1-based], 结束行[1-based, 含]) —— 边界取自 section 横幅
PARTS = [
    ("00-tokens.css",      1,   171),   # Design Tokens + Reset & Base
    ("10-shell.css",       172,  512),  # App Shell + Top Navigation
    ("20-feedback.css",    513,  599),  # Toast queue + Skeleton cards
    ("30-feed.css",        600,  1260), # Main Content + Feed Layout + Content Main + Article List
    ("40-dialog.css",      1261, 1464), # Article Dialog
    ("50-stats.css",       1465, 1986), # Stats View
    ("60-settings.css",    1987, 2376), # Settings View + Push Settings
    ("70-help.css",        2377, 2440), # Help View
    ("80-animations.css",  2441, 2626), # Animations + Update Modal + Email Status
    ("90-highlight.css",   2627, 2915), # Highlight
    ("95-theme.css",       2916, 4161), # Technical archive theme
    ("99-tail.css",        4162, 6408), # PC interaction layer + 全部历史追加段 + 媒体查询 + 卡片动效
]

HEADERS = {
    "00-tokens.css": "设计令牌 + 重置 + 基础排版（:root / body / 焦点环 / skip-link）",
    "10-shell.css": "应用外壳 + 顶栏导航（.app-shell / .topbar / .nav / .nav-menu）",
    "20-feedback.css": "Toast 队列 + 骨架屏（.toast / .skeleton）",
    "30-feed.css": "文献库主区（.content-layout / .filter-panel / .article-list / .article）",
    "40-dialog.css": "文献摘要弹窗（.article-dialog / .abstract-panel / .related-articles）",
    "50-stats.css": "关键词统计视图（.stats-view / .wordcloud / .cooccurrence-*）",
    "60-settings.css": "文献推送设置（.settings-view / .settings-section / push-*）",
    "70-help.css": "使用说明（.help-view / .help-section）",
    "80-animations.css": "动效 + 版本更新弹窗 + 邮箱状态提示",
    "90-highlight.css": "搜索高亮（.keyword-tag-highlight / mark）",
    "95-theme.css": "Technical archive 主题（第二版令牌与皮肤，晚于 00 生效）",
    "99-tail.css": "交互层 + 期刊身份/五色系 + 全部历史追加段 + 媒体查询 + 卡片动效（新规则追加到本文件末尾）",
}


def main():
    with open(SRC, "r", encoding="utf-8") as f:
        lines = f.readlines()
    assert len(lines) == 6408, f"unexpected line count: {len(lines)}"

    os.makedirs(OUT_DIR, exist_ok=True)
    for name, start, end in PARTS:
        chunk = lines[start - 1:end]
        header = (
            "/* ═══════════════════════════════════════════════════════════\n"
            f"   {name} — {HEADERS[name]}\n"
            "   P6 分区拆分（2026-10-12）：由 styles.css 按原 section 边界拆出，\n"
            "   顺序与原文件一致；新规则请追加到 99-tail.css 末尾。\n"
            "   ═══════════════════════════════════════════════════════════ */\n"
        )
        with open(os.path.join(OUT_DIR, name), "w", encoding="utf-8", newline="") as f:
            f.write(header)
            f.writelines(chunk)

    # 拼接校验：去掉新加的头注释后，内容必须与原文件逐字节一致
    original = "".join(lines)
    rebuilt = []
    for name, start, end in PARTS:
        with open(os.path.join(OUT_DIR, name), "r", encoding="utf-8", newline="") as f:
            content = f.read()
        # 头注释固定 6 行
        rebuilt.append(content.split("═══ */\n", 1)[1])
    joined = "".join(rebuilt)
    same = joined == original
    print("concat == original:", same)
    if not same:
        print("orig sha256:", hashlib.sha256(original.encode("utf-8")).hexdigest())
        print("join sha256:", hashlib.sha256(joined.encode("utf-8")).hexdigest())
        raise SystemExit(1)

    index = (
        "/* ═══════════════════════════════════════════════════════════\n"
        "   styles.css — 分区索引（P6，2026-10-12）\n"
        "   本文件只维护 @import 清单；规则一律写在 src/styles/*.css，\n"
        "   新增规则追加到 99-tail.css 末尾（保持历史级联位置）。\n"
        "   ═══════════════════════════════════════════════════════════ */\n"
    )
    for name, _, _ in PARTS:
        index += f'@import "./styles/{name}";\n'
    with open(SRC, "w", encoding="utf-8", newline="") as f:
        f.write(index)
    print(f"split into {len(PARTS)} partials; styles.css now {len(index.splitlines())} lines")


if __name__ == "__main__":
    main()
