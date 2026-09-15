import path from "node:path";
import dotenv from "dotenv";
import { projectRoot } from "./paths.js";

// 显式从仓库根目录读取 .env，不再依赖进程的工作目录；否则服务被以其它
// CWD 启动时读不到 ADMIN_TOKEN_SECRET 等密钥，登录接口会返回 500。
dotenv.config({ path: path.join(projectRoot, ".env") });

export { DEFAULT_JOURNALS, DEFAULT_JOURNAL_BY_NAME } from "./journals.js";

export const config = {
  port: Number(process.env.PORT || 4177),
  clientOrigin: process.env.CLIENT_ORIGIN || "http://127.0.0.1:5173",
  // The passport opens the site; it is deliberately separate from personal accounts.
  adminPassport: process.env.ADMIN_PASSPORT || "shenchao",
  userPassport: process.env.USER_PASSPORT || "lhmktz",
  passportTokenTtlHours: Number(process.env.PASSPORT_TOKEN_TTL_HOURS || 24),
  maxPersonalAccounts: Number(process.env.MAX_PERSONAL_ACCOUNTS || 40),
  maxActiveIps: Number(process.env.MAX_ACTIVE_IPS || 20),
  adminPassword: process.env.ADMIN_PASSWORD || "",
  adminTokenSecret: process.env.ADMIN_TOKEN_SECRET || process.env.ADMIN_PASSWORD || "",
  adminTokenTtlHours: Number(process.env.ADMIN_TOKEN_TTL_HOURS || 12),
  userTokenTtlDays: Number(process.env.USER_TOKEN_TTL_DAYS || 30),
  superAdminUsername: process.env.SUPER_ADMIN_USERNAME || "沈超2024",
  ieeeApiKey: process.env.IEEE_API_KEY || "",
  elsevierApiKey: process.env.ELSEVIER_API_KEY || "",
  // OpenAlex 自 2026-02 起要求所有生产请求带 API key，并改为按日额度计费。
  // 没有 key 时会落到一个极小的匿名共享额度上，额度一空整个接口立刻返回
  // HTTP 429「Insufficient budget」，表现为关键词/摘要补全全线失败。
  openAlexApiKey: process.env.OPENALEX_API_KEY || "",
  publicDataSources: (process.env.PUBLIC_DATA_SOURCES || "crossref,openalex")
    .split(",")
    .map((source) => source.trim().toLowerCase())
    .filter(Boolean),
  crossrefMailto: process.env.CROSSREF_MAILTO || "",
  crawlerEnabled: String(process.env.CRAWLER_ENABLED || "true").toLowerCase() === "true",
  crawlerTimeoutMs: Number(process.env.CRAWLER_TIMEOUT_MS || 12000),
  semanticScholarRequestIntervalMs: Number(process.env.SEMANTIC_SCHOLAR_REQUEST_INTERVAL_MS || 1100),
  // Last-resort browser crawler. It is serialized and deliberately slow so it
  // does not burst against Semantic Scholar when DOI APIs and publisher pages fail.
  semanticScholarWebFallbackEnabled: String(process.env.SEMANTIC_SCHOLAR_WEB_FALLBACK_ENABLED || "true").toLowerCase() === "true",
  semanticScholarWebRequestIntervalMs: Number(process.env.SEMANTIC_SCHOLAR_WEB_REQUEST_INTERVAL_MS || 12000),
  semanticScholarWebTimeoutMs: Number(process.env.SEMANTIC_SCHOLAR_WEB_TIMEOUT_MS || 30000),
  semanticScholarBrowserExecutable: process.env.SEMANTIC_SCHOLAR_BROWSER_EXECUTABLE || "",
  translationProvider: String(process.env.TRANSLATION_PROVIDER || "auto").trim().toLowerCase(),
  // 自动链路的候选与顺序。火山、LibreTranslate、MyMemory 已暂停：前者的临时令牌
  // 失效，后两者逐分片请求且在本环境是 403 / 当日额度用尽，留在链路里只会在
  // 兜底时白白打掉几十次请求。需要时用 TRANSLATION_PROVIDER 显式指定单一路径，
  // 或用 TRANSLATION_PROVIDERS 临时把它们加回来。
  translationProviders: String(process.env.TRANSLATION_PROVIDERS || "tencent,baidu")
    .split(",").map((item) => item.trim().toLowerCase()).filter(Boolean),
  volcengineAccessKeyId: process.env.VOLCENGINE_ACCESS_KEY_ID || "",
  volcengineSecretAccessKey: process.env.VOLCENGINE_SECRET_ACCESS_KEY || "",
  volcengineRegion: process.env.VOLCENGINE_REGION || "cn-north-1",
  volcengineService: process.env.VOLCENGINE_SERVICE || "translate",
  volcengineEndpoint: (process.env.VOLCENGINE_TRANSLATE_ENDPOINT || "https://translate.volcengineapi.com").replace(/\/$/, ""),
  // Keep a single process-wide request lane for each provider.  The interval
  // is measured between request starts, so concurrent page preparation jobs
  // cannot burst past the provider quota.
  volcengineRequestIntervalMs: Number(process.env.VOLCENGINE_REQUEST_INTERVAL_MS || 250),
  libreTranslateUrl: (process.env.LIBRETRANSLATE_URL || "https://libretranslate.com").replace(/\/$/, ""),
  libreTranslateApiKey: process.env.LIBRETRANSLATE_API_KEY || "",
  myMemoryEmail: process.env.MYMEMORY_EMAIL || "",
  baiduTranslateAppId: process.env.BAIDU_TRANSLATE_APPID || "",
  baiduTranslateKey: process.env.BAIDU_TRANSLATE_KEY || "",
  // 125 ms is a conservative eight requests per second ceiling for Baidu's
  // advanced endpoint.  Set to 0 only when the account's quota explicitly
  // permits a higher rate.
  baiduTranslateRequestIntervalMs: Number(process.env.BAIDU_TRANSLATE_REQUEST_INTERVAL_MS || 125),
  // 百度翻译没有额度查询接口（控制台的用量每 5 分钟才刷新一次），所以这里按
  // 「本地记账 + 可配置上限」显示。默认为个人认证高级版的 100 万字符/月；
  // 未认证标准版是 5 万，企业尊享版是 200 万，0 表示只统计不限制。
  baiduMonthlyCharLimit: Number(process.env.BAIDU_MONTHLY_CHAR_LIMIT ?? 1000000),
  // 腾讯云机器翻译。免费额度为每月 500 万字符，用尽后按 58 元/百万字符计费，
  // 所以除了密钥还要有预算闸：tencentMonthlyCharBudget 是本地硬上限，默认
  // 480 万（低于免费额度），一旦触及就停止调用而不是继续花钱。
  tencentSecretId: process.env.TENCENT_SECRET_ID || "",
  tencentSecretKey: process.env.TENCENT_SECRET_KEY || "",
  tencentRegion: process.env.TENCENT_REGION || "ap-guangzhou",
  // 默认接口限频 5 次/秒，250ms 间隔留出余量。
  tencentRequestIntervalMs: Number(process.env.TENCENT_REQUEST_INTERVAL_MS || 250),
  tencentMonthlyCharBudget: Number(process.env.TENCENT_MONTHLY_CHAR_BUDGET ?? 4800000),
  refreshCron: process.env.REFRESH_CRON || "0 8 * * *",
  collectionMaxRecords: Math.max(1, Math.min(10000, Number(process.env.COLLECTION_MAX_RECORDS || 1000))),
  lookbackDays: Number(process.env.LOOKBACK_DAYS || 45),
  
  // Legacy weekly digest settings (kept for backward compatibility)
  weeklyDigestCron: process.env.WEEKLY_DIGEST_CRON || process.env.MAIL_WEEKLY_CRON || "0 8 * * 1",
  weeklyDigestDays: Number(process.env.WEEKLY_DIGEST_DAYS || process.env.MAIL_WEEKLY_DAYS || 7),
  weeklyDigestLimit: Number(process.env.WEEKLY_DIGEST_LIMIT || process.env.MAIL_WEEKLY_LIMIT || 0),
  // Translation is intentionally one-way: English source text -> Chinese.
  // Ignore legacy environment overrides that requested English output.
  weeklyDigestTranslationLanguage: "zh",
  weeklyDigestDir: process.env.WEEKLY_DIGEST_DIR || "data/digests",
  weeklyDigestTranslateMissingLimit: Number(process.env.WEEKLY_DIGEST_TRANSLATE_MISSING_LIMIT || 20),
  weeklyDigestEnrichMissingLimit: Number(process.env.WEEKLY_DIGEST_ENRICH_MISSING_LIMIT || 50),
  pagePrepareConcurrency: Number(process.env.PAGE_PREPARE_CONCURRENCY || 2),
  pagePrepareMaxItems: Number(process.env.PAGE_PREPARE_MAX_ITEMS || 50),
  weeklyDigestEmailEnabled: String(process.env.WEEKLY_DIGEST_EMAIL_ENABLED || "true").toLowerCase() === "true",
  
  // New push settings defaults
  pushEnabled: String(process.env.PUSH_ENABLED || "false").toLowerCase() === "true",
  pushFrequency: process.env.PUSH_FREQUENCY || "weekly", // daily, weekly, monthly
  pushCron: process.env.PUSH_CRON || "0 8 * * 1",
  pushDays: Number(process.env.PUSH_DAYS || 7),
  pushIncludeFile: String(process.env.PUSH_INCLUDE_FILE || "true").toLowerCase() === "true",
  pushIncludeAbstract: String(process.env.PUSH_INCLUDE_ABSTRACT || "true").toLowerCase() === "true",
  pushIncludeKeywords: String(process.env.PUSH_INCLUDE_KEYWORDS || "true").toLowerCase() === "true",
  pushIncludeTranslation: String(process.env.PUSH_INCLUDE_TRANSLATION || "true").toLowerCase() === "true",
  pushJournalFilter: process.env.PUSH_JOURNAL_FILTER || "", // comma-separated journal names, empty = all subscribed
  
  smtp: {
    host: process.env.SMTP_HOST || "",
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || "false").toLowerCase() === "true",
    user: process.env.SMTP_USER || "",
    pass: process.env.SMTP_PASS || "",
    from: process.env.MAIL_FROM || process.env.SMTP_USER || "",
    to: process.env.MAIL_TO || ""
  }
};
