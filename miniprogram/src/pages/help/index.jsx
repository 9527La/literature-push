import { View, Text, RichText } from "@tarojs/components";
import { markdownToNodes } from "../../lib/md.js";

const HELP_MARKDOWN = `
## 定位

本小程序是**电力文献网页端**的移动伴侣，仅面向**网页端注册用户**（无游客态）。注册请在网页端完成，小程序使用同一套通行证与个人账户登录，收藏、已读、订阅全部实时同步。

## 主要功能

- **最新文献**：17 本电力期刊新论文流，支持搜索、AI 方向筛选、期刊组筛选、日期区间、未读过滤；点卡片看全文摘要与元数据，长按快捷标记已读/收藏。
- **研究速览**：AI 周报/月报与方向专报，三字段速评卡（对象/方法/结论）+ 完整报告正文。
- **每日资讯**：电力能源政策与行业新闻日更。
- **收藏**：分组管理（全部 / 未分组 / 自建分组），长按卡片移动分组或取消收藏。
- **推送设置**：期刊订阅开关、邮件推送计划、推送邮箱。

## 与网页端的差异

- 批量选择、批量补全准备、键盘快捷键在移动端不提供；
- 引文导出改为**复制 BibTeX / RIS 到剪贴板**；
- 关键词统计与管理中心仅保留在**网页端**；
- 外部链接以「复制链接」方式提供。

## 数据口径

文献日期统一采用后端 \`display_date\`（首次公开日期优先）；「other」方向默认不出现在列表与筛选中；所有统计与列表口径与网页端一致。
`;

export default function HelpPage() {
  return (
    <View className="page-body">
      <View className="card">
        <RichText nodes={markdownToNodes(HELP_MARKDOWN)} />
      </View>
      <View className="center hint">电力文献 · 内部使用</View>
    </View>
  );
}
