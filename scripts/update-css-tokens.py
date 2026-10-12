#!/usr/bin/env python3
"""A1/A3：CSS 令牌与标题选择器的配对更新（一次性脚本）。

1. A1 对比度：--text-tertiary #7d8592(≈3.7:1) → #6b7280(≈4.8:1)；
   四个未达 AA 的方向色按最小幅度加深（白底 12px 粗体 chip 文字需 ≥4.5:1）。
2. A3 标题层级：JSX 里 h3→h2 / h4→h3 的改动，此处同步改配对选择器，
   避免旧选择器失联。
"""
import os
import sys

STYLES = os.path.join(os.path.dirname(__file__), "..", "src", "styles")

# (文件, old, new, 期望次数)
RENAMES = [
    # A3：弹窗标题 h3→h2、摘要/相关文献 h4→h3
    ("40-dialog.css", ".dialog-header h3 {", ".dialog-header h2 {", 1),
    ("40-dialog.css", ".abstract-panel h4 {", ".abstract-panel h3 {", 1),
    ("99-tail.css", ".abstract-panel h4 {", ".abstract-panel h3 {", 1),
    ("99-tail.css", ".related-articles h4 {", ".related-articles h3 {", 1),    # A3：共现面板 h4→h3
    ("50-stats.css", ".cooccurrence-header h4 {", ".cooccurrence-header h3 {", 1),
    # A3：设置页小节 h4→h2
    ("60-settings.css", ".settings-section h4 {", ".settings-section h2 {", 1),
    # A3：使用说明小节 h3→h2（含 svg 规则）
    ("70-help.css", ".help-section h3 {", ".help-section h2 {", 1),
    ("70-help.css", ".help-section h3 svg {", ".help-section h2 svg {", 1),
    # A3：版本更新弹窗标题 h3→h2
    ("80-animations.css", ".update-dialog-header h3 {", ".update-dialog-header h2 {", 1),
]

TOKEN_EDITS = [
    ("00-tokens.css", "--text-tertiary: #7d8592;", "--text-tertiary: #6b7280;"),
    ("00-tokens.css", "--dir-power_quality: #A8842C;", "--dir-power_quality: #8F6E22;"),
    ("00-tokens.css", "--dir-transport: #B3662E;", "--dir-transport: #A85D29;"),
    ("00-tokens.css", "--dir-ies: #7E7A26;", "--dir-ies: #767222;"),
    ("00-tokens.css", "--dir-other: #767B82;", "--dir-other: #6E737C;"),
]


def main():
    failures = []
    for name, old, new, expected in RENAMES:
        path = os.path.join(STYLES, name)
        with open(path, "r", encoding="utf-8", newline="") as f:
            content = f.read()
        count = content.count(old)
        if count != expected:
            failures.append(f"{name}: '{old}' found {count}, expected {expected}")
            continue
        content = content.replace(old, new)
        with open(path, "w", encoding="utf-8", newline="") as f:
            f.write(content)
        print(f"OK  {name}: {old} -> {new} ({count})")

    for name, old, new in TOKEN_EDITS:
        path = os.path.join(STYLES, name)
        with open(path, "r", encoding="utf-8", newline="") as f:
            content = f.read()
        if content.count(old) != 1:
            failures.append(f"{name}: '{old}' found {content.count(old)}, expected 1")
            continue
        content = content.replace(old, new)
        with open(path, "w", encoding="utf-8", newline="") as f:
            f.write(content)
        print(f"OK  {name}: {old} -> {new}")

    if failures:
        print("\nFAILURES:")
        for f in failures:
            print(" -", f)
        sys.exit(1)
    print("\nall css token/selector updates applied")


if __name__ == "__main__":
    main()
