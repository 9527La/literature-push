/**
 * 用**生产代码路径**核对摘要窗口与生成耗时（不发信）。
 *
 * 直接调用 server/digest.js 的 generateWeeklyDigestMarkdown，配上某个真实账户的推送设置，
 * 输出：条数、窗口范围、富化/翻译次数、耗时。用于验证「立即发送」不再超时、条数已收口。
 *
 * 用法（远端项目根目录）：
 *   .runtime\node\node.exe scripts\verify-digest-window.mjs [userId] [days]
 *   userId 默认 account:1；days 默认 7
 */
import "dotenv/config";
import { getUserSettings } from "../server/db.js";
import { generateWeeklyDigestMarkdown } from "../server/digest.js";

const userId = process.argv[2] || "account:1";
const days = Number(process.argv[3] || 7);

const settings = getUserSettings(userId);
console.log(`账户 ${userId}：频率=${settings.pushFrequency} 过滤="${settings.pushJournalFilter || "(全部已订阅)"}" 期刊数=${settings.journals.length}`);
console.log(`今天=${new Date().toISOString().slice(0, 10)}，窗口 ${days} 天\n`);

const started = Date.now();
const digest = await generateWeeklyDigestMarkdown(settings, { days });
const elapsed = ((Date.now() - started) / 1000).toFixed(1);

console.log(`耗时            ${elapsed}s`);
console.log(`窗口            ${digest.range.startDate} ~ ${digest.range.endDate}`);
console.log(`文献数量        ${digest.count}`);
console.log(`富化次数        ${digest.enrichmentAttemptCount}（应为 0：不再实时联网抓取）`);
console.log(`翻译次数        ${digest.translationAttemptCount}`);
console.log(`完整性过滤掉    ${digest.excludedIncompleteCount}`);
console.log(`超出上限省略    ${digest.omittedCompleteCount}`);
console.log(`文件            ${digest.filePath}`);
