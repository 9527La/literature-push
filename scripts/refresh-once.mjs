// 一次性：手动触发一次文献刷新（等价于 cron 到点执行）。
// 用法：node scripts/refresh-once.mjs
import { refreshArticles } from "../server/refresh.js";
await refreshArticles();
console.log("REFRESH DONE");
