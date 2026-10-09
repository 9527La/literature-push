// 一次性：把 settings 表 refreshCron 更新为 0 5 * * *（刷新提前到 AI 日报之前）。
// 用法：node scripts/update-refresh-cron.mjs "0 5 * * *"
import { DatabaseSync } from "node:sqlite";

const cron = process.argv[2] || "0 5 * * *";
if (!/^\S+\s+\S+\s+\S+\s+\S+\s+\S+$/.test(cron)) {
  console.error("invalid cron:", cron);
  process.exit(1);
}
const db = new DatabaseSync("data/literature.sqlite");
db.prepare("INSERT INTO settings (key, value) VALUES ('refreshCron', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(cron);
const row = db.prepare("SELECT value FROM settings WHERE key = 'refreshCron'").get();
console.log("refreshCron =", row.value);
