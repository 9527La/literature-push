import path from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

// 运行期路径一律以仓库根目录为基准解析，而不是进程的工作目录。
// 否则服务被以其它 CWD 启动时（例如后台任务）会读到错误的 .env，
// 并把 data/ 建在别处。
export const projectRoot = path.resolve(moduleDir, "..");

export function resolveFromRoot(...segments) {
  return path.resolve(projectRoot, ...segments);
}

// 数据目录默认是 <仓库根>/data。测试或多实例部署可用 LITERATURE_DATA_DIR
// 指定一个绝对路径来隔离数据。
export function resolveDataDirectory() {
  const override = String(process.env.LITERATURE_DATA_DIR || "").trim();
  return override ? path.resolve(override) : resolveFromRoot("data");
}
