/**
 * 小程序运行配置。
 * BASE_URL 是网站后端（CF 隧道域名）。正式发布前必须：
 *   1) 确认该域名已完成 ICP 备案；
 *   2) 在微信公众平台 → 开发管理 → 开发设置 → 服务器域名，把 https://lhmktz.top
 *      加入 request 合法域名（小程序后台与校验脚本同源口径）。
 * 开发阶段用开发者工具勾选「不校验合法域名」即可直连。
 */
export const BASE_URL = "https://lhmktz.top";

/** 网页端地址（登录页引导注册、详情页「在网页打开」提示用）。 */
export const WEB_URL = BASE_URL;
