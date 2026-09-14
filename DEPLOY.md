# 部署手册（SC 远端）

本手册固化「开发机改代码 → Git 交付 → 远端同步 → 构建 → 重启 → 冒烟」的完整流程，
把容易踩的坑写成可执行步骤。配套脚本：`scripts/redeploy.ps1`。

## 1. 拓扑与前提

| 项目 | 值 |
| --- | --- |
| 开发机目录 | `E:\Users\admin\文档\文献推送` |
| 远端目录 | `E:\SC\文献推送`（SC Remote Runner 的固定映射） |
| 远端主机 | `5514@192.168.31.233` |
| 代码交付 | GitHub `9527La/literature-push`，远端只接受同步过来的代码 |
| 服务端口 | `4177` |
| 本机访问 | `http://127.0.0.1:4177` |
| 局域网访问 | `http://192.168.31.233:4177` |
| 公网访问 | Cloudflare Quick Tunnel，**每次重启都会更换地址** |

前提与边界：

- 代码只通过 Git 交付：开发机提交并推送，部署主机同步同一份代码，不接受在远端手工改文件。
- 同步会排除 `node_modules/`、`.env`、`data/`、`dist/`、`.git/`、`artifacts/`；远端各自保留自己的副本。
- 远端 `PATH` 里没有 node/npm，一律使用仓库自带的 `.runtime\node\node.exe` 与 `.runtime\node\npm.cmd`。
- 远端 `.env` 与 `data/` 是生产数据，同步和部署脚本都不会覆盖它们。

## 2. 三个必须记住的坑

| 坑 | 现象 | 处理 |
| --- | --- | --- |
| 后台任务忽略工作目录 | 远端命令实际在 `C:\Windows\System32\spool\drivers\x64\3` 下执行 | 命令第一条必须是 `Set-Location 'E:\SC\文献推送'`；`scripts\redeploy.ps1` 已内置 |
| 后台任务阻塞同步 | `Cannot synchronize while a background job is running for this project` | 先 `sc_job_list` 找出本项目全部任务（服务 + 隧道），逐个 `sc_job_cancel`。**该门禁只在「确有文件要传」时触发**：零增量同步会提前返回（仅刷新基线），不被拦截，任务在跑也可安全执行 |
| 脚本编码 | PowerShell 5.1 把无 BOM 的 UTF-8 `.ps1` 当 ANSI 读，含中文时报语法错误（例如在 `}` 行失败） | 仓库内 `.ps1` 一律保存为 **UTF-8 with BOM** |

附带注意：

- `sc_run` 的输出是 CRLF，并会追加 `System.Threading.Tasks.VoidTaskResult`，不要按单行 JSON 解析。
- 复杂多语句命令偶尔在远端 shell 静默失败：拆成多条，或写进脚本再执行。
- 不要把 `.env` 里的通行证、token、翻译密钥打印到输出里。

## 3. 标准流程

### 步骤 0 — 开发机：确认要部署的提交

```powershell
git status --porcelain -b      # 必须干净
git log --oneline -1           # 记下提交号
git push origin main
```

### 步骤 1 — 取消本项目的全部后台任务

`sc_job_list(limit=120)` → 找到本项目的 job id（服务与隧道都要）→ `sc_job_cancel(job_id)`。
只取消本项目；只要还有 running 的任务，下一步同步就会被拒绝。

### 步骤 2 — 同步代码

```
sc_project_sync(
  local_path="E:\\Users\\admin\\文档\\文献推送",
  remote_project="文献推送",
  conflict_policy="fail",
  delete_removed=false,
  timeout_seconds=0
)
```

用**绝对路径**而不是 `local_path="."`：`"."` 是相对连接器的第一个本地根目录解析的，写错根目录会把别的目录同步进来。
保持默认的 `conflict_policy=fail` 与 `delete_removed=false`：前者保护远端 `data/`、`.env`，后者不会误删远端独有文件。

若报 `Remote project has changes that would be overwritten ... : version.json`，说明远端那份被远端改过（通常是上一次部署写回的版本信息）。
先备份再决定：把远端文件复制到 `E:\SC\.sc-remote-runner\temp\`，确认本地版本更新后再用 `conflict_policy="local_wins"` 重跑。

### 步骤 3 — 远端构建 + 测试

```
sc_run: Set-Location 'E:\SC\文献推送'; powershell -NoProfile -ExecutionPolicy Bypass -File scripts\redeploy.ps1 -NoRestart
```

这一步完成 `npm run build`、`npm test` 与 `dist\index.html` 校验，并把过程写进 `data\logs\redeploy.log`。
`package.json` / `package-lock.json` 有变化时加 `-InstallDeps`（执行 `npm ci`）。

因为步骤 1 已经把托管任务停掉，此时 4177 端口是空的：脚本会输出
「端口 4177 未监听：-NoRestart 模式不重启服务，跳过冒烟自检」并**以 0 退出**，
这是预期行为，真正的冒烟自检放在步骤 6。

只想跑构建与测试、完全跳过端口等待时，改用 `-SkipVerify`（跳过端口等待与冒烟自检，不跳过构建和测试）。

### 步骤 4 — 重启服务任务

```
sc_job_start(label="literature-service", python_env=false):
  Set-Location 'E:\SC\文献推送'; & 'E:\SC\文献推送\.runtime\node\node.exe' --no-warnings=ExperimentalWarning '.\server\index.js'
```

用 `sc_job_status` 确认任务处于 `running`，再用步骤 6 的 `-VerifyOnly` 确认端口 4177 已在监听、接口可访问。

注意：服务任务（`node`）的 `sc_job_logs` 常常 **stdout 与 stderr 同时为空**，这是托管子进程没有把控制台刷进任务日志所致，不代表启动失败。
**不要**据此判断服务是否起来了，一律以 `-VerifyOnly` 的端口与接口检查为准。
想确认端口持有者时用 `Get-Process node | Select-Object Id,StartTime`，其 `StartTime` 应与任务的 `StartedAt` 一致（同时也能证明上一次被取消的任务没有留下僵尸进程）。

### 步骤 5 — 重启隧道任务

```
sc_job_start(label="cloudflared-tunnel", python_env=false):
  & 'E:\SC\文献推送\.runtime\cloudflared\cloudflared.exe' tunnel --url http://127.0.0.1:4177 --no-autoupdate
```

地址在 `sc_job_logs(stream="stderr")` 里，形如 `https://xxxx.trycloudflare.com`。地址每次重启都会变，必须重新取。

### 步骤 6 — 冒烟自检

```
sc_run: Set-Location 'E:\SC\文献推送'; powershell -NoProfile -ExecutionPolicy Bypass -File scripts\redeploy.ps1 -VerifyOnly
```

再用浏览器打开新的隧道地址确认公网可达。

### 步骤 7 — 通知使用者

把新的隧道地址、版本号（`/version.json` 里的 `version`）和本次更新说明发出去。

## 4. 冒烟检查清单

`scripts/redeploy.ps1 -VerifyOnly` 已覆盖前 7 项：

| 检查 | 期望 |
| --- | --- |
| `GET /` | 200，且含前端挂载节点 `id="root"` |
| `GET /assets/*`（首页引用的前 3 个） | 200 |
| `GET /version.json` | 200，`version` 为本次发布的版本号 |
| `POST /api/gate/login` | 200，返回 token（失败即说明 `.env` 密钥没被读到） |
| `GET /api/gate/session`（带 `x-passport-token`） | 200，`authenticated=true` |
| `GET /api/status`（带 `x-passport-token`） | 200，`articleCount > 0` |
| 端口 4177 | 有监听进程 |

需要手工确认的两项：

```powershell
# 公网地址可达（把 URL 换成本次隧道地址）
(Invoke-WebRequest -Uri 'https://xxxx.trycloudflare.com/version.json' -UseBasicParsing -TimeoutSec 30).Content
# 局域网地址可达
(Invoke-WebRequest -Uri 'http://192.168.31.233:4177/' -UseBasicParsing -TimeoutSec 30).StatusCode
```

## 5. 故障对照表

| 现象 | 根因 | 处理 |
| --- | --- | --- |
| 登录返回 500「外部服务暂时不可用」 | 服务进程读不到 `.env`（工作目录不对或文件缺失），`ADMIN_TOKEN_SECRET` 为空 | 确认服务以仓库根为工作目录启动（`server/paths.js` 已按模块路径解析 `.env` 与 `data/`）；检查远端 `.env` 的 `ADMIN_TOKEN_SECRET` / `ADMIN_PASSWORD` |
| `Cannot synchronize while a background job is running for this project.` | 本项目还有 running 的任务**且本次确有文件要传** | `sc_job_list` + `sc_job_cancel`；若只是零增量（`uploadedFiles: 0`）同步，不会触发此拦截 |
| `'node' 不是内部或外部命令` | npm 子进程没继承 Node 路径 | PATH 前置 `.runtime\node;node_modules\.bin`，或直接跑 `scripts\redeploy.ps1` |
| `!!! 端口 4177 在 60 秒内没有监听`（脚本以 1 退出） | 步骤 1 已停掉托管任务，`-NoRestart` 又不会把服务拉起来 | 升级后的脚本在 `-NoRestart` 下会跳过自检并以 0 退出；若仍报错说明是旧脚本，重新同步 `scripts\redeploy.ps1` 后再跑 |
| 远端命令在 `C:\Windows\System32\spool\drivers\x64\3` 下执行 | 后台任务忽略了 workdir | 显式 `Set-Location 'E:\SC\文献推送'` |
| `.ps1` 报语法错误、`)` 或 `}` 不匹配 | 无 BOM 的 UTF-8 被当作 ANSI 解析 | 重新保存为 UTF-8 with BOM |
| 首页 200 但静态资源 404 | 同步后没有重新 `npm run build` | 执行步骤 3 |
| `/api/status` 返回 401 | 请求没带 `x-passport-token` | 先 `POST /api/gate/login` 拿 token |
| 公网打不开 | 隧道任务没起，或地址已更换 | 执行步骤 5 并重新取地址 |
| 端口 4177 无监听 | 服务启动失败 | 看 `data\service-runtime.err.log` 与任务日志 |

## 6. 回滚

1. 开发机 `git revert <提交号>`（或 `git checkout <上一版提交> -- .` 后重新提交），推送。
2. 按步骤 1 → 7 重新部署。

远端一律不改文件：任何手工修改都会在下次同步时被 `conflict_policy=fail` 拦下。

## 7. 环境与依赖变化

- `package.json` / `package-lock.json` 变化 → `scripts\redeploy.ps1 -InstallDeps`。
- `.env` 变化 → 只改远端文件；同步不会覆盖，也不要把密钥提交进 Git。
- 翻译相关的环境变量（默认值即当前生产配置，通常不需要动）：

  | 变量 | 默认 | 作用 |
  | --- | --- | --- |
  | `TRANSLATION_PROVIDERS` | `tencent,baidu` | 自动链路的候选与顺序。火山、LibreTranslate、MyMemory 默认**不在**链路里 |
  | `TRANSLATION_PROVIDER` | `auto` | 显式指定单一路径（应急用），或填 `keyless` 走无密钥来源 |
  | `TENCENT_MONTHLY_CHAR_BUDGET` | `4800000` | 腾讯云本地月度硬上限，触及即拒发请求 |
  | `BAIDU_MONTHLY_CHAR_LIMIT` | `1000000` | 百度翻译本地月度上限（5 万标准版 / 100 万高级版 / 200 万尊享版，0 = 只统计） |

  两家都是「本地记账 + 硬上限」：百度没有额度查询接口，用量是本系统按提交字符数
  自己数出来的（落在 `data/translation-usage.json`，按自然月分桶），管理中心的
  百度额度条据此显示，并标注为本地记账。改上限后要重启服务才生效。
- 端口变化 → 远端 `.env` 的 `PORT`，同时用 `redeploy.ps1 -Port <端口>` 做自检。
- 想要固定域名，需要 Cloudflare Zone + Named Tunnel；Quick Tunnel 地址本身不固定。