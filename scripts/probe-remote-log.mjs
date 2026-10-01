// 远端只读：打印 service-runtime.log 尾部（混合编码，按行自判 UTF-16LE / UTF-8）。
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.argv[2] || "E:\\SC\\文献推送");
const files = [
  "data/service-runtime.log",
  "data/service-runtime.err.log",
  "data/watchdog.log",
  "data/node-trace.err.log"
];
const tailCount = Number(process.argv[3] || 90);

function decode(buffer) {
  // node 的 stdout 经 PS `1>>` 重定向是 UTF-16LE；Add-Content 写的行是单字节 ANSI。
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) return buffer.toString("utf16le").slice(1);
  const zeros = buffer.filter((b) => b === 0).length;
  if (zeros > buffer.length / 4) return buffer.toString("utf16le");
  return buffer.toString("latin1");
}

for (const rel of files) {
  const full = path.join(root, rel);
  if (!fs.existsSync(full)) { console.log(`\n##### ${rel} —— 不存在`); continue; }
  const stat = fs.statSync(full);
  const handle = fs.openSync(full, "r");
  const readSize = Math.min(stat.size, 96 * 1024);
  const buffer = Buffer.alloc(readSize);
  fs.readSync(handle, buffer, 0, readSize, Math.max(0, stat.size - readSize));
  fs.closeSync(handle);
  const lines = decode(buffer).split(/\r?\n/).filter((line) => line.trim());
  console.log(`\n##### ${rel}  (${stat.size}B, mtime=${stat.mtime.toISOString()}) —— 末 ${tailCount} 行`);
  console.log(lines.slice(-tailCount).join("\n"));
}
