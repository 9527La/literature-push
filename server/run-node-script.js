// 测试辅助：在隔离目录里跑一段 ESM 脚本，返回 { status, stdout, stderr }。
//
// 为什么不用 spawnSync：本机（Windows）环境下 Node 的**同步** spawn 会一律报
// EBUSY（CreateProcess 同步路径被环境拦截，cmd/whoami 也一样，异步 execFile
// 正常）。DB 集成类用例统一走这里，等价于旧 spawnSync 的退出码/输出语义；
// 异步实现在远端 PowerShell 环境同样可用。
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function runNodeScript(script, options = {}) {
  const { cwd, env } = options;
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      ["--input-type=module", "--eval", script],
      { cwd, env, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }
    );
    return { status: 0, stdout: stdout || "", stderr: stderr || "" };
  } catch (error) {
    const status = Number.isInteger(error.code) ? error.code : 1;
    return { status, stdout: error.stdout || "", stderr: error.stderr || String(error.message || error) };
  }
}
