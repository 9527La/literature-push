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
| 后台任务阻塞同步 | `Cannot synchronize while a background job is running for this project` | 先 `sc_job_list` 找出本项目全部任务（服务 + 隧道），逐个 `sc_job_cancel` |
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
sc_project_sync(local_path=".", remote_project="文献推送", conflict_policy="fail", delete_removed=false, timeout_seconds=0)
```

保持默认的 `conflict_policy=fail` 与 `delete_removed=false`：前者保护远端 `data/`、`.env`，后者不会误删远端独有文件。

### 步骤 3 — 远端构建 + 测试 + 自检

```
sc_run: Set-Location 'E:\SC\文献推送'; powershell -NoProfile -ExecutionPolicy Bypass -File scripts\redeploy.ps1 -NoRestart
```

这一步完成 `npm run build`、`npm test` 与 `dist\index.html` 校验，并把过程写进 `data\logs\redeploy.log`。
`package.json` / `package-lock.json` 有变化时加 `-InstallDeps`（执行 `npm ci`）。

### 步骤 4 — 重启服务任务

```
sc_job_start(label="literature-service", python_env=false):
  Set-Location 'E:\SC\文献推送'; & 'E:\SC\文献推送\.runtime\node\node.exe' --no-warnings=ExperimentalWarning '.\server\index.js'
```

用 `sc_job_status` / `sc_job_logs` 确认端口 4177 已在监听、日志里出现“电力文献服务器运行在 …”。

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
| `Cannot synchronize while a background job is running for this project.` | 本项目还有 running 的任务 | `sc_job_list` + `sc_job_cancel` |
| `'node' 不是内部或外部命令` | npm 子进程没继承 Node 路径 | PATH 前置 `.runtime\node;node_modules\.bin`，或直接跑 `scripts\redeploy.ps1` |
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
- 端口变化 → 远端 `.env` 的 `PORT`，同时用 `redeploy.ps1 -Port <端口>` 做自检。
- 想要固定域名，需要 Cloudflare Zone + Named Tunnel；Quick Tunnel 地址本身不固定。