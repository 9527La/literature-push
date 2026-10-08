# 电力文献微信小程序（literature-mp）

Taro 4 + React 实现的微信小程序，对应设计方案 `../DESIGN-MINIPROGRAM.md` v1.1。
**仅面向网页端注册用户**（无游客态）；**关键词统计不纳入**（仅网页端）；管理中心/批量操作/快捷键不迁移。

## 目录结构

```
miniprogram/
├── project.config.json      # appid 先用 touristappid（游客模式），正式发布前替换
├── config/                  # Taro 编译配置（designWidth 375）
├── scripts/gen_tab_icons.py # TabBar 图标生成（纯 Python，零依赖）
└── src/
    ├── app.config.js        # 5 Tab + 12 页面 + lazyCodeLoading
    ├── app.scss             # 全局样式（tone/方向色板/卡片/弹层/markdown）
    ├── lib/                 # journal/directions/format/constants 自网站逐字平移
    │   ├── api.js           # Taro.request 传输层（双 token、20s 超时、CF 错误页识别、401 静默续登）
    │   ├── session.js       # 通行证+账户双凭据登录/静默续登/登出
    │   ├── md.js            # 极简 markdown → rich-text（速览/资讯正文）
    │   ├── prefs.js         # 显示开关 + 速览 chips 偏好（结构对齐网页端）
    │   └── export.js        # BibTeX/RIS 生成（复制到剪贴板，无文件下载）
    ├── components/          # ArticleCard / FilterSheet / BriefCard / States
    └── pages/               # feed / article / report / report-detail / news /
                             # news-detail / favorites / mine / settings / feedback / help / login
```

## 构建与预览

```bash
cd miniprogram
npm install
npm run dev:weapp     # watch 模式，产物在 dist/
```

1. 微信开发者工具 → 导入项目 → 目录选 `miniprogram`（自动读 project.config.json，miniprogramRoot=dist）；
2. 开发阶段在「详情 → 本地设置」勾选 **不校验合法域名**（直连 `https://lhmktz.top`）；
3. appid 当前为 `touristappid`（游客模式，无法真机预览）。在微信公众平台注册个人主体小程序后，把正式 appid 写入 `project.config.json`；
4. 首次登录需要：网页通行证 + 网页端注册的用户名/密码。

## 后端待办（客户端已就位，服务端暂不改）

| 项 | 说明 |
|---|---|
| `/api/auth/wx-session`（D3-B） | code2session 换发：小程序端 `Taro.login()` 的 code 换账户 token + 通行证 token。落地后把 `src/lib/session.js` 的 `WX_SESSION_ENABLED` 改为 `true` 即生效；此前静默续登走「本地凭据重登」 |
| request 合法域名 | 公众平台后台把 `https://lhmktz.top` 加入 request 合法域名（前提：域名 ICP 备案有效 + 小程序本体完成微信平台备案） |
| msgSecCheck | 公共讨论发帖/评论前在服务端接微信内容安全接口（M3） |
| 订阅消息模板 | 申请一次性订阅模板后填入 `pages/settings`，替换占位 toast |

## 已实现的口径约定（与网站一致）

- 日期一律 `display_date`（first_public_at 优先），前端 `format.js#articleDate` 平移未改；
- `other` 方向默认不出现在方向 chips（显式多选时可加回，与列表豁免口一致）；
- 期刊分组 tone 色（IEEE/爱思唯尔/中文/其他）逐字复用 `journal.js`；
- 收藏「未分组」是虚拟行，不自动建组；
- `/api/reports` meta 模式列表 + `/api/reports/detail?id=` 懒加载（paperBriefs v2 三字段卡）；
- 翻页 50/页、触底加载、20s 超时、过期响应丢弃（requestId 解耦）。

## 已知边界（后续里程碑）

- 速览详情的正文渲染用自研轻量 markdown（标题/列表/引用/加粗/行内码），表格按纯文本降级；如需完整 GFM 可引入 towxml；
- 批量选择/批量补全、个性化上传下载（`/api/auth/preferences`）暂未迁移；
- 公共讨论未接 msgSecCheck 前不建议在正式版开放发帖。
