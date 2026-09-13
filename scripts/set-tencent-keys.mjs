import fs from "node:fs";

/**
 * Write the Tencent Cloud credentials from a CSV export into .env.
 *
 * The values are never printed: the only output is the key name and its length,
 * so this can be run in a session whose transcript the user can see.
 *
 * Usage: node scripts/set-tencent-keys.mjs <path-to-SecretKey.csv>
 */
const csvPath = process.argv[2];
if (!csvPath) {
  console.error("用法: node scripts/set-tencent-keys.mjs <SecretKey.csv>");
  process.exit(2);
}

const raw = fs.readFileSync(csvPath, "utf8").replace(/^\uFEFF/, "");
const lines = raw.split(/\r?\n/).filter((line) => line.trim());
const header = lines[0].split(",").map((cell) => cell.trim());
const values = lines[1].split(",").map((cell) => cell.trim());
const pick = (name) => values[header.findIndex((column) => column.toLowerCase() === name.toLowerCase())] || "";

const secretId = pick("SecretId");
const secretKey = pick("SecretKey");
if (!secretId || !secretKey) {
  console.error("未能在 CSV 中找到 SecretId / SecretKey 两列");
  process.exit(3);
}
if (!/^AKID/i.test(secretId)) {
  console.error(`SecretId 前缀不是 AKID 开头（实际 ${secretId.slice(0, 4)}…），请确认导出的是永久密钥而不是临时凭证`);
  process.exit(4);
}

const additions = [
  ["TENCENT_SECRET_ID", secretId],
  ["TENCENT_SECRET_KEY", secretKey],
  // ap-guangzhou / ap-shanghai / ap-beijing 均可，就近选择延迟更低。
  ["TENCENT_REGION", "ap-guangzhou"],
  // 免费额度为每月 500 万字符。把本地闸门设在 480 万，留 20 万字符余量，
  // 这样即使控制台开着后付费也不会在无人察觉时开始扣费。
  ["TENCENT_MONTHLY_CHAR_BUDGET", "4800000"]
];

const envPath = ".env";
let content = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
const report = [];

for (const [key, value] of additions) {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, "m");
  if (pattern.test(content)) {
    const existing = content.match(pattern)[0];
    if (existing === line) {
      report.push(`${key}: 已是最新（未改动）`);
      continue;
    }
    content = content.replace(pattern, line);
    report.push(`${key}: 已更新（长度 ${value.length}）`);
  } else {
    if (content && !content.endsWith("\n")) content += "\n";
    content += `${line}\n`;
    report.push(`${key}: 已新增（长度 ${value.length}）`);
  }
}

fs.writeFileSync(envPath, content);
console.log(report.join("\n"));
console.log(`写入完成：${envPath}`);
