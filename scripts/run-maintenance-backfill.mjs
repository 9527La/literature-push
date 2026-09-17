// 远端无人值守补齐驱动器。
//
// 为什么要走「服务内的管理作业」而不是另起一个 CLI 进程：
//   · 单进程写库，不会出现两个进程同时写 SQLite 的锁竞争；
//   · 浏览器兜底是全局串行节流队列，同进程才能共享，不会自己撞自己；
//   · 管理中心的进度面板能直接看到进展。
//
// 单次作业有 60 分钟上限（server/maintenance.js），所以这里负责「跑完一趟再起一趟」，
// 直到缺口归零或连续多趟没有任何进展为止。
//
// 用法（远端）：
//   .runtime\node\node.exe --no-warnings=ExperimentalWarning scripts\run-maintenance-backfill.mjs
// 环境变量：
//   BACKFILL_MAX_RUNS        最多起几趟（默认 12）
//   BACKFILL_NO_PROGRESS_RUNS 连续几趟零进展就收工（默认 2）
//   BACKFILL_POLL_MS         轮询间隔（默认 30000）
import { config } from "../server/config.js";

const BASE = `http://127.0.0.1:${config.port || 4177}`;
const MAX_RUNS = Number(process.env.BACKFILL_MAX_RUNS || 12);
const NO_PROGRESS_LIMIT = Number(process.env.BACKFILL_NO_PROGRESS_RUNS || 2);
const POLL_MS = Number(process.env.BACKFILL_POLL_MS || 30000);
const TASK = process.env.BACKFILL_TASK || "metadata";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const stamp = () => new Date().toLocaleString("sv-SE").replace("T", " ");

let token = "";

async function login() {
  const response = await fetch(`${BASE}/api/gate/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ passport: config.adminPassport })
  });
  if (!response.ok) throw new Error(`通行证登录失败 ${response.status}`);
  const data = await response.json();
  token = data?.token || "";
  if (!token) throw new Error("通行证登录未返回 token");
}

async function api(path, init = {}) {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "content-type": "application/json", "x-passport-token": token, ...(init.headers || {}) }
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  return { status: response.status, data };
}

async function startRun() {
  const { status, data } = await api("/api/admin/maintenance", {
    method: "POST",
    body: JSON.stringify({ task: TASK })
  });
  if (status === 202) return { started: true };
  if (status === 409) return { started: false, busy: true };
  throw new Error(`启动作业失败 ${status}: ${JSON.stringify(data)}`);
}

async function readState() {
  const { status, data } = await api("/api/admin/maintenance");
  if (status !== 200) throw new Error(`读取作业状态失败 ${status}`);
  return data?.state || null;
}

function gapOf(state) {
  if (!state) return null;
  const backlog = state.remainingBacklog || {};
  const abstracts = Number(backlog.abstracts ?? state.remaining ?? 0);
  const keywords = Number(backlog.keywords ?? 0);
  return Number.isFinite(abstracts + keywords) ? abstracts + keywords : null;
}

async function main() {
  await login();
  console.log(`[${stamp()}] 已登录管理端，目标 ${BASE}，任务 ${TASK}`);

  let runs = 0;
  let noProgress = 0;
  let bestGap = Number.POSITIVE_INFINITY;

  while (runs < MAX_RUNS) {
    const state = await readState();
    if (state?.running) {
      console.log(
        `[${stamp()}] 作业进行中 已处理 ${state.processed}/${state.total} 成功 ${state.succeeded} 失败 ${state.failed} 剩余 ${state.remaining}`
      );
      await sleep(POLL_MS);
      continue;
    }

    const gap = gapOf(state);
    if (runs > 0) {
      if (gap === null || gap >= bestGap) {
        noProgress += 1;
        console.log(`[${stamp()}] 本趟无进展（缺口 ${gap}，历史最优 ${bestGap}），计数 ${noProgress}/${NO_PROGRESS_LIMIT}`);
      } else {
        noProgress = 0;
        bestGap = gap;
      }
      if (noProgress >= NO_PROGRESS_LIMIT) {
        console.log(`[${stamp()}] 连续 ${NO_PROGRESS_LIMIT} 趟无进展，收工。`);
        break;
      }
    }

    runs += 1;
    const started = await startRun();
    if (!started.started) {
      console.log(`[${stamp()}] 已有作业在运行，等待后重试`);
      await sleep(POLL_MS);
      runs -= 1;
      continue;
    }
    console.log(`[${stamp()}] 启动第 ${runs}/${MAX_RUNS} 趟；最近一次缺口 ${gap ?? "未知"}`);
    await sleep(POLL_MS);
  }

  const final = await readState();
  console.log(
    `[${stamp()}] 结束。共起 ${runs} 趟；最终状态 ${final?.status || "无"}，已处理 ${final?.processed ?? 0}，成功 ${final?.succeeded ?? 0}，失败 ${final?.failed ?? 0}，剩余 ${final?.remaining ?? 0}`
  );
}

main().catch((error) => {
  console.error(`[${stamp()}] 驱动器异常：${error.message}`);
  process.exit(1);
});
