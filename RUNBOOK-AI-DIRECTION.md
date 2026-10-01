# RUNBOOK — AI 研究方向分类（WorkBuddy 定时任务执行手册）

> ⚠️ **本文档已被 `literature-ai-jobs` Skill 取代（2026-09-28）**：方向分类现在统一由
> `.workbuddy/skills/literature-ai-jobs/SKILL.md`（根目录镜像 `RUNBOOK-AI-JOBS.md`）第 4 节执行，
> 周日定时任务同时承担方向分类（classify）与一周论文速览（digest）两项作业。
> 本文保留为历史档案，**不要再按本文配置定时任务**。
>
> **本文档是「文献推送·AI 研究方向分类」定时任务的唯一执行依据。**
> 执行会话（WorkBuddy 定时任务，模型 Hy3）动手前必须完整通读本文档；任务提示词只做摘要与指路，一切细节以本文为准。
> 版本：2026-09-28 · 维护方式：方向体系若增删，须同步修改本文第 3 节与 `server/directions.js`

---

## 1. 背景与架构（一段话）

文献推送网站（前端 React+Vite，后端 Node+SQLite，部署在 SC 远端 Windows 主机）需要给每篇文献标注一个电力系统研究方向。分类不由服务器调用任何 LLM API 完成，而是**由本 WorkBuddy 定时任务的执行会话（你）亲自完成**：通过 sc-remote 连接器在远端导出待分类文章 → 你逐篇阅读并分类 → 结果 JSON 传回远端 → 远端脚本写库。全程零 API key、零外部调用。

- 远端项目目录：`E:\SC\文献推送`（SSH 5514@192.168.31.233，经 sc-remote MCP 连接器操作）
- 远端 Node：`.runtime\node\node.exe`（远端 PATH 里没有 node，必须用它）
- 数据库：远端 `data\literature.sqlite`（**生产数据，只能经本文档的脚本访问**）
- 涉及脚本（三件套，均已随仓库同步到远端 `scripts\`）：
  - `migrate-directions.mjs` — 幂等迁移，给 articles 表加 6 个分类列（首次部署跑一次，重跑无害）
  - `export-direction-batch.mjs` — 导出待分类文章 JSON
  - `apply-directions.mjs` — 把分类结果写回数据库（带白名单校验与 manual 保护）

## 2. 方向体系（15 个，分类时唯一白名单）

key 必须逐字取自下表第一列。`server/directions.js` 是代码侧真值，本表与其同步。

| key | 名称 | 定义（判归依据） | 典型信号词 |
|---|---|---|---|
| distributed-gen | 分布式电源与并网 | 分布式光伏/风电等**电源侧**的并网运行、消纳能力、接入系统方案与场站控制 | distributed generation, grid integration, curtailment, 消纳, 并网, 新能源场站 |
| storage | 储能系统 | 电池/氢等储能系统的容量配置、运行优化、状态估计、寿命与安全 | BESS, state of charge, capacity allocation, 储能, 容量配置 |
| market | 电力市场与机制 | 电能量/辅助服务市场、竞价出清、定价结算、机制设计与激励相容 | electricity market, bidding, tariff, ancillary services, 电力市场, 电价, 辅助服务 |
| transmission | 输电网运行与规划 | 输电系统经济调度、机组组合、潮流、状态估计、网架规划 | OPF, unit commitment, SCED/SCUC, power flow, 潮流, 机组组合 |
| distribution | 配电网运行与规划 | 配电网重构、网架/容量规划、电压与网损优化、馈线与软开关 | reconfiguration, feeder, soft open point, 配电网, 馈线, 重构, 台区 |
| microgrid | 微电网与虚拟电厂 | 微电网/VPP 能量管理、多主体聚合、并离网控制、聚合商运营、需求响应 | microgrid, VPP, EMS, aggregation, demand response, 微电网, 虚拟电厂, 聚合 |
| forecasting | 预测与数据驱动 | 负荷/出力/电价预测，及 ML/DL 在电力系统中的数据驱动应用 | forecasting, LSTM, deep learning, 负荷预测, 深度学习 |
| stability | 电力系统稳定性 | 功角/频率/电压稳定、低频与次同步振荡、暂态稳定、惯量与阻尼 | small-signal, transient stability, oscillation, damping, 低频振荡, 次同步, 惯量 |
| protection | 继电保护与故障诊断 | 保护原理、故障检测/定位/测距、行波、设备故障诊断 | relay, fault location, traveling wave, 保护, 行波, 测距 |
| power-quality | 电能质量 | 谐波、电压暂降、闪变、三相不平衡的机理与治理 | harmonics, voltage sag, flicker, 谐波, 电能质量, 电压暂降 |
| hv | 高电压与绝缘 | 绝缘材料与特性、局部放电、过电压防护、防雷、高压试验 | insulation, partial discharge, overvoltage, lightning, 绝缘, 局部放电, 过电压 |
| power-electronics | 电力电子装备 | 变换器拓扑与控制、MMC、调制策略、宽禁带器件、装置本体 | converter, MMC, modulation, SiC, GaN, 变流器, 逆变器, 调制 |
| transport | 电动汽车与电气化 | 充电设施规划、充电负荷建模、车网互动、交通电气化供电 | EV charging, V2G, charging station, 电动汽车, 充电桩, 车网互动 |
| ies | 综合能源系统 | 电-热-气-氢多能耦合、P2G、热电联产、区域综合能源优化 | integrated energy, P2G, CHP, hydrogen, 综合能源, 多能互补, 氢能 |
| other | 其他/交叉 | 以上均不适配时才用（电机电器本体、超导、非电力装置等）。**预期占比 <10%**。被判为 other 的文献**默认不进入正式列表/推送/关键词统计**（数据保留在库；管理端与方向统计仍可见；筛选显式选「其他」可查看） | — |

## 3. 分类标准（判定规则，必须遵守）

1. **先识别研究问题，再匹配方向**：看论文"解决什么问题、服务什么对象"，不看用了什么方法。用 LSTM 做负荷预测 → `forecasting`（不是"AI"方向）；用深度学习做稳定性评估 → `stability`。
2. **主方向唯一**，取论文核心贡献所服务的方向；**次方向 0–2 个**，且不得与主方向重复。
3. **置信度语义**：
   - 0.90–1.00：标题/关键词明确命中方向核心词，主题单一；
   - 0.70–0.89：主题清楚，但需结合摘要推断；
   - 0.50–0.69：跨方向主题，凭贡献主旨判断；
   - <0.60：apply 脚本自动给该行 reason 加 `[待复核]` 前缀，无需你处理。
4. **输入只有标题+关键词**（无摘要）时，置信度原则上 ≤0.70。
5. **other 的使用门槛**：仅当 14 个方向确实都不适配。单纯"信息不足"应给最接近的方向 + 低置信，而不是 other。
6. **reason ≤30 字**，写清判归依据（例："共享储能容量配置与运行优化"）。禁止"人工智能分类""电力系统论文"这类空话。
7. 语言无关：中英文文献同标准；摘要可能是英文原文或中文译文，不影响判定。
8. 边界速查：风机/光伏**本体**（叶片、MPPT 电路）→ `power-electronics` 或 `other`；电缆**绝缘本体** → `hv`，电缆对配网运行的影响 → `distribution`；充电桩**电力电子拓扑** → `power-electronics`，充电设施规划与充电负荷 → `transport`；氢能全链条 → `ies`。

## 4. 每周执行流程（标准循环，逐步执行）

> 单次会话最多处理 **400 篇**（上下文保护）。每周增量约 300–400 篇，一轮即可收口；存量首跑见第 6 节。

**步骤 0 — 前置检查**
调用 sc-remote 的 `sc_status` 确认连接可用。不可用 → 按第 7 节异常处理，立即汇报终止。

**步骤 1 — 远端导出**
`sc_run`，命令（PowerShell）：

```
Set-Location 'E:\SC\文献推送'; & .runtime\node\node.exe scripts\export-direction-batch.mjs --limit 400
```

成功输出形如 `exported=400 remaining_before=3977 with_abstract=333 out=E:\SC\文献推送\data\direction-batch.json`。若报 `no such column: research_direction`，先跑一次迁移（见第 7 节"首次部署"）。

**步骤 2 — 下载批次文件**
`sc_download`：远端 `E:\SC\文献推送\data\direction-batch.json` → 本地 `_direction-work\batch-<今日日期>.json`。文件约 300 KB、3000+ 行，**用 Read 分段（offset/limit）完整读完**，不许跳读。

**步骤 3 — 分类（每批 100 篇）**
按第 2、3 节标准逐篇分类，每 100 篇写一个本地结果文件（Write 工具）：`_direction-work\results-<今日日期>-<序号>.json`，格式见第 5 节。禁止凭标题猜摘要里没有的内容；禁止输出白名单以外的 key。

**步骤 4 — 上传写回**
对每个结果文件：`sc_upload` 上传到远端 `E:\SC\文献推送\data\direction-inbox.json`（覆盖上一批），然后 `sc_run`：

```
Set-Location 'E:\SC\文献推送'; & .runtime\node\node.exe scripts\apply-directions.mjs --file data\direction-inbox.json
```

输出统计 JSON：`updated / invalid / missing / skippedManual / coverage / pendingReview`。

**步骤 5 — 每批核对**
`updated` 必须等于该批条数、`invalid` 必须为 **0**。`invalid > 0` → 是格式错误，检查你的 JSON（常见：key 拼错、id 非整数），修正后重传该批；连续两次仍 invalid → 按第 7 节汇报。

**步骤 6 — 收尾判断**
重复步骤 1–5 直到导出 `exported=0`（无待分类）或本轮已处理满 400 篇。

**步骤 7 — 汇报**
```
【AI 方向分类周报】
- 本轮分类：N 篇（M 批）
- 库内覆盖：classified/total（较上次 +N）
- 待复核：<0.6 置信 N 篇
- 方向分布 Top5：储能 86 / 配电网 64 / ...
- 异常与处理：无 / 描述
```

## 5. 输出 JSON 契约（严格一致，apply 脚本按此解析）

```json
{
  "results": [
    {
      "id": 3977,
      "direction": "storage",
      "secondary": ["distribution", "market"],
      "confidence": 0.92,
      "reason": "共享储能容量配置与运行优化"
    }
  ]
}
```

字段规则：`id` = 导出文件中的整数 id，原样带回；`direction` = 第 2 节白名单 key（必填）；`secondary` = 0–2 个白名单 key 的数组，可省略；`confidence` = 0–1 数值（必填）；`reason` = ≤30 字依据（必填）。脚本侧兜底：secondary 非法项丢弃、confidence 截断到 [0,1]、reason 截断 200 字符——但这些是保险，不是许可。

## 6. 存量首跑（仅首次）

库内存量约 3 977 篇未分类。首跑方式：临时把定时任务频率调为**每天一次**（或在会话里手动说"按 RUNBOOK 跑一轮方向分类"），按第 4 节标准流程每轮 400 篇，约 10 轮收口；收口后把频率改回每周。首轮前必须先完成第 7 节的首次部署。

## 7. 异常处理与红线

**红线（绝对禁止）**
- ❌ 禁止绕过 apply 脚本直接 UPDATE/DELETE 远端数据库（包括 sqlite3 命令行、自写 SQL 脚本）。
- ❌ 禁止调用任何外部 LLM API、联网富化——分类由执行会话自身完成。
- ❌ 禁止使用 `sc_job_cancel`（会连带取消远端隧道与补全作业）。
- ❌ 禁止改远端 `.env`、`data\` 下其他文件、服务代码。
- ❌ 禁止在未通读本文档的情况下开始分类。

**异常处理**
| 情形 | 处置 |
|---|---|
| `sc_status` 不可用 / 远端连不上 | 汇报"本轮未执行+原因"，终止。下周自动重试（幂等，无副作用） |
| 报 `no such column: research_direction` | 首次部署未完成：`sc_run` 执行 `Set-Location 'E:\SC\文献推送'; & .runtime\node\node.exe scripts\migrate-directions.mjs`，成功后重试步骤 1 |
| 远端找不到 scripts 三件套 | 说明代码未同步，汇报并终止（不要自行在远端创建文件） |
| apply 连续两批 invalid > 0 | 停止写回，保留已写入部分（事务按批提交，安全），汇报已写入数与问题样本 |
| 会话中途被切断 | 无需补救——流水线幂等，下次执行自动从未分类处继续 |

**幂等性保证**：导出条件是 `research_direction IS NULL`，已分类（含人工改判 manual）的行永不重复处理、永不被覆盖。

## 附录 A · 定时任务配置（WorkBuddy「添加定时任务」界面）

| 项 | 值 |
|---|---|
| 名称 | 每周文献 AI 方向分类 |
| 模型 | Hy3 |
| 执行频率 | 每周 周日 23:00 |
| 关联目录 | 文献推送（本项目根目录） |
| 权限 | 允许完全访问 |

**提示词（原文粘贴）：**

```
阅读项目根目录的 RUNBOOK-AI-DIRECTION.md（全文通读），严格执行其中「每周执行流程」，完成本轮 AI 研究方向分类：sc-remote 连接远端 E:\SC\文献推送，导出待分类文章（每轮≤400 篇）→ 按文档第 2、3 节的方向体系与判定标准逐篇分类 → 按第 5 节 JSON 契约写结果文件 → 上传远端执行 apply-directions.mjs 写回并逐批核对 updated/invalid → 按第 7 节模板汇报。全程遵守文档红线：禁止绕过脚本直接改库、禁止外部 API、禁止 sc_job_cancel。sc-remote 不可用或远端脚本缺失时，汇报原因并终止，不做任何变通。
```

## 附录 B · 常见问题

- **为什么导出按 id 倒序？** 新文章 id 更大，优先处理最新文献，周任务一轮即可覆盖全部增量。
- **manual 怎么来的？** 未来前端摘要弹窗提供管理员下拉改判，写 `direction_source='manual'`；导出条件天然排除它们。
- **方向体系要调整怎么办？** 改 `server/directions.js` + 本文档第 2 节 + 前端 `src/lib/directions.js` 三处；已分类的 `ai` 行可整体重置重跑（`UPDATE articles SET research_direction=NULL WHERE direction_source='ai'`，由人工确认后执行，不是定时任务的职责）。
