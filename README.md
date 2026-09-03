# 电力文献订阅与推送系统

> 本地化运行、自动抓取电力领域顶级期刊最新文献，并提供在线浏览、翻译、周报生成与邮件推送的全栈 Web 应用。

---

## 项目简介

本项目是一个面向电力系统研究人员的文献订阅工具，能够自动从公开学术数据源（Crossref、OpenAlex）以及可选的 IEEE Xplore API 获取最新发表的论文信息，存入本地 SQLite 数据库，并通过 Web 界面提供浏览、筛选、搜索、翻译、关键词提取等功能。同时支持定时自动刷新、生成 Markdown 格式周报，以及通过邮件推送给指定收件人。

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React 19 + Vite 7 + CSS（Inter 字体、CSS 变量设计系统、响应式布局） |
| 后端 | Express 5（Node.js，ESM） |
| 数据库 | SQLite（Node.js 内置 `node:sqlite`，WAL 模式） |
| 定时任务 | `node-cron` |
| 邮件发送 | `nodemailer` |
| 图标 | `lucide-react` |
| 包管理 | npm |

---

## 目录结构

```
文献推送/
├── index.html                # Vite 入口 HTML
├── package.json              # 依赖与脚本定义
├── vite.config.js            # Vite 配置（含 API 代理）
├── .env.example              # 环境变量示例
├── .gitignore
├── scripts/
│   └── start-service.ps1     # Windows 后台启动脚本
├── server/
│   ├── index.js              # Express 服务入口，路由定义
│   ├── config.js             # 配置管理（环境变量 + 默认期刊）
│   ├── db.js                 # SQLite 数据库初始化与所有 CRUD 操作
│   ├── sources.js            # 多数据源文献抓取（Crossref、OpenAlex、IEEE）
│   ├── ieee.js               # IEEE Xplore API 对接
│   ├── crawler.js            # 文献页面元数据爬取（补全摘要）
│   ├── translate.js          # 多翻译引擎（LibreTranslate、MyMemory、百度翻译）
│   ├── refresh.js            # 定时刷新与周报调度
│   ├── digest.js             # 周报 Markdown 生成
│   └── mail.js               # 邮件发送（新文献通知 + 周报附件）
└── src/
    ├── main.jsx              # React 前端入口
    └── styles.css            # 全局样式
```

---

## 默认订阅期刊

项目开箱即用，默认订阅以下 10 本期刊：

| 期刊名称 | 印刷版 ISSN | 电子版 ISSN | 说明 |
|----------|-------------|-------------|------|
| IEEE Transactions on Power Systems | 0885-8950 | 1558-0679 | |
| IEEE Transactions on Smart Grid | 1949-3053 | 1949-3061 | |
| IEEE Transactions on Power Delivery | 0885-8977 | 1937-4208 | |
| IEEE Transactions on Sustainable Energy | 1949-3029 | 1949-3037 | |
| IEEE Transactions on Energy Conversion | 0885-8969 | 1558-0059 | |
| Applied Energy | 0306-2619 | 1872-9118 | 仅筛选电气领域相关文献 |
| Energy | 0360-5442 | 1751-4223 | 仅筛选电气领域相关文献 |
| International Journal of Electrical Power & Energy Systems | 0142-0615 | 1879-3517 | |
| Renewable Energy | 0960-1481 | 1879-0682 | 仅筛选电气领域相关文献 |
| Journal of Modern Power Systems and Clean Energy | 2196-5420 | 2196-5625 | |

可在 Web 设置界面通过勾选方式选择需要订阅的期刊，最新文献页只展示已订阅期刊的论文。

---

## 数据源

系统支持多数据源并行抓取并自动去重合并：

1. **Crossref**（默认启用）：通过 ISSN 查询期刊近期论文，免费无需 API Key。可通过 `CROSSREF_MAILTO` 提高速率限制。
2. **OpenAlex**（默认启用）：通过 ISSN 查询，摘要以倒排索引形式提供并自动重建，免费无需 API Key。
3. **IEEE Xplore API**（可选）：需提供 `IEEE_API_KEY`，数据最完整，有每日请求配额限制。

通过 `PUBLIC_DATA_SOURCES` 环境变量控制启用哪些公开数据源，默认值为 `crossref,openalex`。

---

## 核心功能

### 文献抓取与去重
- 从配置的数据源并行获取文献，基于 DOI 生成唯一标识符，跨数据源自动去重合并。
- 自动过滤非研究条目（如封面、目录、编辑寄语、勘误等）。
- 支持配置回溯天数（`LOOKBACK_DAYS`，默认 45 天）。

### 摘要与关键词补全（爬虫）
- 对于公开数据源未提供摘要或关键词的文献，系统可通过 DOI 或 URL 访问 IEEE Xplore 页面，解析嵌入的 JSON 元数据或 HTML `<meta>` 标签来补全摘要、关键词、作者、卷期等信息。
- IEEE Xplore 页面中仅提取 `IEEE Keywords` 和 `Author Keywords` 作为关键词（`Index Terms` 等其他类型会被过滤）。
- 可通过 `CRAWLER_ENABLED` 控制开关，`CRAWLER_TIMEOUT_MS` 控制超时。

### 关键词提取
- 系统优先从 API 直接获取关键词：
  - **Crossref**：提取 `subject` 字段（学科分类）作为关键词。
  - **OpenAlex**：提取 `keywords` 字段，或回退到 `concepts`（自动提取的概念标签）。
  - **IEEE Xplore API**：提取 `index_terms`（仅保留 IEEE Author Keywords 和 Author Keywords，过滤 MeSH Terms 等其他类型）。
- 若 API 未提供关键词，系统自动通过爬虫从论文页面补全。
- **自动批量补全**：每次文献刷新后，系统自动在后台为缺少关键词的文献批量爬取关键词（每批最多 50 篇，请求间隔 1.5 秒避免被封禁）。
- **手动触发**：设置页提供"一键补全关键词"按钮，可随时为所有缺少关键词的文献手动触发补全。
- 关键词支持中英文翻译，翻译结果与标题、摘要一并缓存。
- Web 界面以标签形式展示关键词，详情弹窗中同时显示原文关键词和翻译关键词。

### 文献翻译
- 支持三种翻译引擎，`auto` 模式下自动按优先级回退：
  - **百度翻译**（需配置 `BAIDU_TRANSLATE_APPID` + `BAIDU_TRANSLATE_KEY`，质量最佳）
  - **LibreTranslate**（公共实例或自建，无需 Key）
  - **MyMemory**（免费公共 API，无需 Key，有日限额）
- 翻译结果缓存到数据库，避免重复调用。
- 支持将标题、摘要和关键词翻译为中文或英文。

### 周报生成
- 根据配置的周期（默认 7 天），自动生成 Markdown 格式的文献周报。
- 周报内容包括：论文题目（原文 + 翻译）、期刊、发布日期、DOI、关键词（原文 + 翻译）、原文链接、摘要（原文 + 翻译）。
- 自动补全缺失摘要和关键词，并翻译未翻译条目（受 `WEEKLY_DIGEST_TRANSLATE_MISSING_LIMIT` 控制）。
- 周报文件保存到 `data/digests/` 目录。

### 文献推送
- 使用 SMTP 发送新文献通知邮件和周报附件邮件。
- 支持三种推送频率：每天、每周、每月。
- 邮件内容可自定义：是否包含附件文件、摘要、关键词、翻译。
- 可指定推送期刊范围，留空则推送所有已订阅期刊。
- 支持配置多个收件人，可在 Web 界面管理。
- 提供"立即发送"按钮，可手动触发推送。

### Web 界面
- **最新文献页**：展示已订阅期刊的文献列表，支持按期刊、关键词、日期范围筛选，以及仅未读/仅收藏过滤。提供"作者/关键词/摘要"显示开关，可自由控制列表中展示的内容项。未订阅期刊的文献不会显示。
- **文献详情弹窗**：查看完整元数据、摘要、关键词（原文 + 翻译），一键调用翻译，标记已读/收藏，打开原文链接。弹窗支持毛玻璃遮罩效果。
- **设置页**：通过勾选方式管理订阅期刊，支持全选/全不选；提供"一键补全关键词"按钮为缺少关键词的文献批量补全；还可配置刷新 Cron 表达式、邮件开关与收件人列表。
- **关键词统计页**：可按期刊、时间范围筛选文献，统计关键词出现频次并以可视化条形图展示排名。点击任意关键词可查看包含该关键词的所有文献列表；点击具体文献可弹出详情弹窗，查看完整摘要、关键词（原文 + 翻译）、DOI 等信息，并支持标记已读/收藏和打开原文链接。
- **设计系统**：基于 CSS 自定义属性（Design Tokens）统一管理配色、阴影、圆角和动效，所有交互元素具备平滑过渡动画和焦点状态反馈。
- **响应式设计**：适配桌面与移动设备。

### 两层访问控制与账户

网页通行证与个人账户相互独立：

- **网页通行证**：只负责进入站点。默认管理员通行证为 `shenchao`，普通用户通行证为 `lhmktz`；管理员通行证可显示管理中心。
- **个人账户**：用户自行注册唯一用户名和密码，用于保存阅读/收藏/推送设置以及公共讨论身份。个人账户不授予站点管理员权限。
- **游客模式**：输入网页通行证后可以直接浏览文献和公开讨论，但不能发帖、评论、点赞、标记阅读、收藏或保存个人设置。
- **会话限制**：同一个人账户同时只允许一个 IP 保持登录；从其他 IP 登录会使旧会话失效。全站最多允许 20 个不同活跃 IP，最多注册 40 个个人账户。同一 IP 可以登录多个个人账户。
- **讨论身份**：公开标签按个人账户稳定生成，用户可自行设置发言名称；IP 仅用于会话限制，不会作为公开讨论标签。

### 定时任务
- **文献刷新**：根据 Cron 表达式（默认每日 08:00）自动从数据源抓取最新文献。
- **周报生成与推送**：根据 Cron 表达式（默认每周一 08:00）自动刷新数据、生成周报，并通过邮件推送（如已启用）。

---

## API 接口

除 `/api/gate/login` 和 `/api/gate/session` 外，API 均需要网页通行证请求头 `X-Passport-Token`。个人账户相关接口另需 `X-User-Token`。

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/gate/login` | 使用管理员或普通网页通行证进入站点 |
| GET | `/api/gate/session` | 查询网页通行证会话 |
| GET | `/api/account` | 获取当前个人账户或游客状态 |
| POST | `/api/auth/register` | 注册个人账户并登录（最多 40 个） |
| POST | `/api/auth/login` | 登录个人账户（同一账户同一时间仅一个 IP） |
| GET | `/api/auth/session` | 查询个人账户会话 |
| POST | `/api/auth/logout` | 退出个人账户 |
| PUT | `/api/account` | 更新个人资料 |
| GET | `/api/auth/preferences` | 读取个人远端设置 |
| PUT | `/api/auth/preferences` | 保存个人远端设置 |
| GET | `/api/articles` | 获取文献列表（支持 query 筛选） |
| POST | `/api/articles/:id/read` | 标记文献为已读 |
| POST | `/api/articles/:id/favorite` | 切换收藏状态 |
| GET | `/api/articles/:id/enrich` | 爬取补全文献元数据 |
| POST | `/api/articles/:id/translate` | 翻译文献标题和摘要 |
| POST | `/api/refresh` | 手动触发文献刷新（完成后自动补全关键词） |
| POST | `/api/enrich-keywords` | 批量补全缺少关键词的文献（最多 50 篇） |
| GET | `/api/settings` | 获取当前设置 |
| PUT | `/api/settings` | 更新设置 |
| GET | `/api/journals` | 获取所有可选期刊列表（含名称与 ISSN） |
| GET | `/api/keyword-stats` | 获取关键词频次统计（支持 journal、from、to 筛选） |
| GET | `/api/status` | 获取系统状态（文献数、刷新记录等） |
| POST | `/api/digests/weekly` | 生成周报 |
| POST | `/api/digests/weekly/email` | 生成周报并邮件推送 |
| GET | `/api/feedback` | 获取公开讨论（游客可读） |
| GET | `/api/feedback/profile` | 获取当前账户的讨论身份 |
| PUT | `/api/feedback/profile` | 设置讨论区发言名称 |
| POST | `/api/feedback` | 发布讨论（需个人账户） |
| POST | `/api/feedback/:id/comments` | 发布评论（需个人账户） |
| POST | `/api/feedback/:id/like` | 点赞/取消点赞讨论 |
| POST | `/api/feedback/comments/:id/like` | 点赞/取消点赞评论 |

---

## 快速开始

### 环境要求
- Node.js ≥ 22（使用内置 `node:sqlite`）
- npm

### 安装与运行

```bash
# 克隆项目
git clone https://github.com/9527La/literature-push.git
cd literature-push

# 安装依赖
npm install

# 复制环境变量并填写配置
cp .env.example .env

# 开发模式（前后端同时启动）
npm run dev
```

开发模式下，Vite 前端运行在 `http://127.0.0.1:5173`，API 请求自动代理到后端 `http://127.0.0.1:4177`。

### 生产部署

```bash
# 构建前端
npm run build

# 启动后端（同时托管静态前端）
npm start
```

首次打开站点时先输入网页通行证（默认管理员 `shenchao` 或普通用户 `lhmktz`）。进入站点后，可以游客浏览；需要参与讨论或保存个人数据时，再到“游客账户”注册/登录个人账户。生产环境请通过 `.env` 修改通行证，并设置随机的 `ADMIN_TOKEN_SECRET`，不要把 `.env` 提交到仓库。

### Cloudflare Tunnel 临时公网访问

服务在本机 `4177` 端口启动后，可以使用 Cloudflare Quick Tunnel 临时生成公网地址：

```powershell
cloudflared tunnel --url http://127.0.0.1:4177 --no-autoupdate
```

命令输出的 `https://<随机名称>.trycloudflare.com` 即为临时地址。Quick Tunnel 无固定域名和长期在线保证，进程重启后地址可能变化。若需要固定域名，应在 Cloudflare 中创建 Named Tunnel，并将自己拥有的域名（或子域名）通过 DNS 路由到该 Tunnel。

### Windows 后台运行

```powershell
.\scripts\start-service.ps1
```

此脚本会检测端口 4177 是否已占用，若未占用则在后台启动服务。

---

## 环境变量说明

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `PORT` | `4177` | 后端服务端口 |
| `CLIENT_ORIGIN` | `http://127.0.0.1:5173` | 前端 CORS 来源 |
| `ADMIN_PASSPORT` | `shenchao` | 管理员网页通行证 |
| `USER_PASSPORT` | `lhmktz` | 普通用户网页通行证 |
| `PASSPORT_TOKEN_TTL_HOURS` | `24` | 网页通行证令牌有效期（小时） |
| `ADMIN_TOKEN_SECRET` | （空） | 网页通行证和个人账户令牌签名密钥，生产环境必须设置随机值 |
| `MAX_PERSONAL_ACCOUNTS` | `40` | 允许注册的个人账户总数上限 |
| `MAX_ACTIVE_IPS` | `20` | 同时保持个人账户登录的不同 IP 数量上限 |
| `USER_TOKEN_TTL_DAYS` | `30` | 个人账户会话有效期（天） |
| `IEEE_API_KEY` | （空） | IEEE Xplore API 密钥（可选） |
| `PUBLIC_DATA_SOURCES` | `crossref,openalex` | 公开数据源，逗号分隔 |
| `CROSSREF_MAILTO` | （空） | Crossref polite pool 邮箱 |
| `CRAWLER_ENABLED` | `true` | 是否启用爬虫补全 |
| `CRAWLER_TIMEOUT_MS` | `12000` | 爬虫超时毫秒数 |
| `TRANSLATION_PROVIDER` | `auto` | 翻译引擎：`auto`/`baidu`/`libretranslate`/`mymemory` |
| `LIBRETRANSLATE_URL` | `https://libretranslate.com` | LibreTranslate 服务地址 |
| `LIBRETRANSLATE_API_KEY` | （空） | LibreTranslate API Key |
| `MYMEMORY_EMAIL` | （空） | MyMemory 邮箱（提高免费额度） |
| `BAIDU_TRANSLATE_APPID` | （空） | 百度翻译 App ID |
| `BAIDU_TRANSLATE_KEY` | （空） | 百度翻译密钥 |
| `REFRESH_CRON` | `0 8 * * *` | 文献刷新 Cron 表达式 |
| `LOOKBACK_DAYS` | `45` | 回溯天数 |
| `WEEKLY_DIGEST_CRON` | `0 8 * * 1` | 周报 Cron 表达式 |
| `WEEKLY_DIGEST_DAYS` | `7` | 周报覆盖天数 |
| `WEEKLY_DIGEST_LIMIT` | `0` | 周报论文数上限（0 为不限） |
| `WEEKLY_DIGEST_TRANSLATION_LANGUAGE` | `zh` | 周报翻译目标语言 |
| `WEEKLY_DIGEST_DIR` | `data/digests` | 周报保存目录 |
| `WEEKLY_DIGEST_TRANSLATE_MISSING_LIMIT` | `20` | 周报自动翻译缺失条目上限 |
| `WEEKLY_DIGEST_EMAIL_ENABLED` | `true` | 是否启用周报邮件推送 |
| `SMTP_HOST` | （空） | SMTP 服务器地址 |
| `SMTP_PORT` | `587` | SMTP 端口 |
| `SMTP_SECURE` | `false` | 是否使用 TLS |
| `SMTP_USER` | （空） | SMTP 用户名 |
| `SMTP_PASS` | （空） | SMTP 密码 |
| `MAIL_FROM` | （空） | 发件人地址 |
| `MAIL_TO` | （空） | 默认收件人地址 |

> **安全提示**：`.env`、SQLite 数据库、个人账户会话令牌和第三方 API 密钥均属于私密数据，已由 `.gitignore` 排除，切勿提交到公开仓库。若密钥曾在聊天、日志或截图中暴露，请立即在对应服务中撤销并重新生成。

---

## 数据库结构

项目使用 SQLite 数据库（`data/literature.sqlite`），包含以下表：

- **articles**：存储所有抓取的文献，含标题、作者、期刊、年份、DOI、摘要、URL、发布日期、关键词、已读/收藏状态。
- **settings**：键值对形式的系统设置（期刊列表、Cron 表达式、邮件配置等）。
- **refresh_runs**：刷新任务运行记录，含时间、状态、新增数量。
- **translations**：文献翻译缓存，按文章 ID + 目标语言存储标题、摘要和关键词的翻译结果。
- **user_accounts**：个人账户凭据、资料和远端个性设置；用户名唯一，最多 40 个账户。
- **user_sessions**：个人账户会话及登录 IP，用于单账户单 IP 和全站 20 个活跃 IP 限制。
- **discussion_profiles**：个人账户的稳定公开讨论标签和自定义发言名称。
- **feedback / feedback_comments**：公共讨论主题、评论及点赞数据。

---

## 项目特色

- **零外部依赖即可运行**：Crossref + OpenAlex 为免费公开数据源，无需任何 API Key 即可获取文献。
- **本地全量存储**：所有文献和翻译结果保存在本地 SQLite，无外部数据库依赖。
- **多数据源去重**：相同论文从不同来源获取后自动合并元数据。
- **渐进式增强**：IEEE API Key、翻译引擎、邮件推送均为可选配置，按需启用。
- **智能回退翻译**：`auto` 模式下自动尝试最佳翻译引擎，失败时自动降级。
- **摘要智能补全**：对于缺失摘要的文献，通过爬取 IEEE Xplore 页面自动补全。

---

## 版本历史

| 版本 | 日期 | 说明 |
|------|------|------|
| 0.11.0 | 2026-09-03 | 新增网页通行证与个人账户两层认证、游客只读模式、个人讨论身份、单账户单 IP、20 个活跃 IP 和 40 个账户上限；优化认证界面响应式布局 |
| 0.10.0 | 2026-06-12 | 文献推送功能全面升级：支持每天/每周/每月推送频率，新增期刊范围选择、邮件内容自定义（附件/摘要/关键词/翻译），立即发送按钮 |
| 0.9.0 | 2026-06-12 | 新增 5 本 Elsevier 期刊订阅（Applied Energy、Energy、IJEPES、Renewable Energy、Journal of Modern Power Systems and Clean Energy），能源类综合期刊自动筛选电气领域相关文献 |
| 0.8.0 | 2026-06-12 | 关键词统计页新增文献详情弹窗：点击文献可查看完整摘要、关键词翻译、DOI 等信息，支持标记已读/收藏和打开原文链接 |
| 0.7.0 | 2026-06-12 | 新增关键词统计页：按期刊和时间筛选文献，统计关键词频次并以条形图展示排名，点击关键词查看相关文献列表，新增 `/api/keyword-stats` 接口 |
| 0.6.0 | 2026-06-12 | 新增内容显示开关：最新文献页可自主控制是否显示作者、关键词、摘要 |
| 0.5.0 | 2026-06-11 | 前端设计重构：引入 CSS 变量设计系统（配色、阴影、圆角、动效统一）、加载 Inter 字体、优化视觉层次与交互体验 |
| 0.4.0 | 2026-06-11 | 关键词自动补全：刷新文献后自动批量爬取缺失关键词，设置页新增"一键补全关键词"按钮，新增 `/api/enrich-keywords` 接口 |
| 0.3.0 | 2026-06-11 | 期刊订阅改为勾选模式：设置页以复选框列表展示可选期刊，最新文献页仅展示已订阅期刊的论文，新增 `/api/journals` 接口 |
| 0.2.0 | 2026-06-11 | 新增关键词提取与翻译功能：支持从 API 和爬虫获取关键词，支持关键词翻译，Web 界面以标签形式展示 |
| 0.1.0 | 2026-06-04 | 初始版本，包含完整的文献抓取、Web 浏览、翻译、周报生成与邮件推送功能 |

---

*最后更新：2026-09-03*
