// 远端只读：测 SMTP 是否可用（只握手，不发信），并计时。
// 用法：<node> probe-remote-smtp.mjs
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { createRequire } from "node:module";

const root = path.resolve(process.argv[2] || "E:\\SC\\文献推送");
const env = Object.fromEntries(
  fs.readFileSync(path.join(root, ".env"), "utf8").split(/\r?\n/)
    .filter((line) => line.trim() && !line.trim().startsWith("#"))
    .map((line) => {
      const index = line.indexOf("=");
      return [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^["']|["']$/g, "")];
    })
);

const host = env.SMTP_HOST || "smtp.qq.com";
const port = Number(env.SMTP_PORT || 465);
console.log(`SMTP: ${host}:${port}  secure=${env.SMTP_SECURE}  user=${env.SMTP_USER}`);
console.log(`SMTP_PASS 长度=${(env.SMTP_PASS || "").length}  首尾是否有空格=${env.SMTP_PASS !== (env.SMTP_PASS || "").trim()}`);

// 1) 裸 TCP 握手，看端口是否被校园网拦
const tcp = await new Promise((resolve) => {
  const started = Date.now();
  const socket = net.connect({ host, port });
  socket.setTimeout(15000);
  socket.once("connect", () => { const ms = Date.now() - started; socket.destroy(); resolve({ ok: true, ms }); });
  socket.once("timeout", () => { socket.destroy(); resolve({ ok: false, error: `TCP 握手超时（>15s）`}); });
  socket.once("error", (error) => resolve({ ok: false, error: error.code || error.message }));
});
console.log(tcp.ok ? `  ok   TCP ${host}:${port} 连通（${tcp.ms}ms）` : `  FAIL TCP ${host}:${port} —— ${tcp.error}`);

// 2) nodemailer verify()
const require = createRequire(path.join(root, "package.json"));
const nodemailer = require("nodemailer");
const transporter = nodemailer.createTransport({
  host,
  port,
  secure: String(env.SMTP_SECURE).toLowerCase() === "true",
  auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
  connectionTimeout: 20000,
  greetingTimeout: 20000,
  socketTimeout: 30000
});
const started = Date.now();
try {
  await transporter.verify();
  console.log(`  ok   SMTP verify() 通过（${Date.now() - started}ms）`);
} catch (error) {
  console.log(`  FAIL SMTP verify()（${Date.now() - started}ms）：${error.code || ""} ${error.message}`);
}
transporter.close();
