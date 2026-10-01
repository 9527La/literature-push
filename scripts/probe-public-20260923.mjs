/**
 * 公网地址探测：确认隧道背后跑的就是刚部署的版本。
 * 本机 curl / schannel 走 https 会撞证书吊销检查（CRYPT_E_REVOCATION_OFFLINE），
 * 用 Node 的 fetch 绕开这套 Windows 证书栈。
 */
import { writeFileSync } from "node:fs";

const target = process.argv[2] || "https://lhmktz.top";
const lines = [];

async function probe(name, url) {
  const started = Date.now();
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(25000) });
    const text = await response.text();
    let version = "";
    try { version = JSON.parse(text).version; } catch { /* 非 JSON 就算了 */ }
    const line = `${name} HTTP ${response.status} ${Date.now() - started}ms version=${version || "(n/a)"} bytes=${text.length}`;
    lines.push(line);
    console.log(line);
  } catch (error) {
    const line = `${name} FAILED ${Date.now() - started}ms ${error?.name}: ${error?.message}`;
    lines.push(line);
    console.log(line);
  }
}

await probe("public", `${target}/version.json`);
await probe("public-home", `${target}/`);
await probe("lan", "http://192.168.31.233:4177/version.json");

writeFileSync("artifacts/probe-public-20260923.txt", lines.join("\n") + "\n", "utf8");
