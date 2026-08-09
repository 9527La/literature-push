<!--
  使用说明（部署时此文件内容会自动推送给所有用户）：
  - 每次部署前，编辑下方内容，写好本次更新说明
  - 支持 Markdown 格式：标题（##）、列表（- ）、加粗（**text**）、行内代码（`code`）、链接（[text](url)）
  - 用 --- 分隔不同版本的记录，部署脚本只会提取第一个分隔线之前的内容
  - 部署后旧内容会自动保留在分隔线下方，作为历史记录
-->

## 新功能

- 新增使用说明页面，介绍系统所有功能和使用方式
- 周报邮箱新增已保存状态显示，方便查看是否已填写
- 测试周报改为近一个月文献范围
- **文献推送功能全面升级**：
  - 周报递送更名为"文献推送"
  - 新增推送期刊范围选择，可指定特定期刊进行推送
  - 支持三种推送频率：每天、每周、每月
  - 邮件内容可自定义：附件文件、摘要、关键词、翻译
  - 新增"立即发送"按钮，可手动触发推送
- 新增 5 本 Elsevier 期刊订阅：**Applied Energy**、**Energy**、**IJEPES**、**Renewable Energy**、**Journal of Modern Power Systems and Clean Energy**
  - Applied Energy、Energy、Renewable Energy 为能源类综合期刊，系统自动筛选电气领域相关文献（含 power grid、electric、microgrid、renewable energy、energy storage、smart grid 等关键词）
  - IJEPES 和 Journal of Modern Power Systems and Clean Energy 为电气电力专业期刊，无需筛选

## 优化

- 部署脚本自动读取 CHANGELOG.md 作为版本更新通知
- 版本弹窗支持 Markdown 格式渲染
- 增强 Elsevier 期刊元数据提取：
  - 新增 Elsevier 专用解析器，支持 JSON-LD 结构化数据和 Elsevier meta 标签
  - OpenAlex 数据源增强：使用 `primary_topic` 和高分 `concepts` 作为关键词补充
  - 改进爬虫 User-Agent 和请求头，提高 Elsevier 页面访问成功率

---

<!-- 以下为历史更新记录，部署时不会推送给用户 -->

## 2026.06.12

- 新增关键词统计页，支持按期刊和时间筛选关键词频次
- 新增内容显示开关：可自由控制作者、关键词、摘要的显示
- 新增关键词和期刊多选筛选，支持按相关性排序
- 搜索词和选中关键词在文献中高亮显示
- 新增用户周报邮箱和意见反馈功能
- 页面导航移至顶部，筛选面板移至左侧
- 支持局域网内其他设备访问
