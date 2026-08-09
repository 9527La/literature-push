import "dotenv/config";
import { ELECTRICAL_FILTER_KEYWORDS } from "./utils.js";

export const DEFAULT_JOURNALS = [
  {
    name: "IEEE Transactions on Power Systems",
    issns: ["0885-8950", "1558-0679"]
  },
  {
    name: "IEEE Transactions on Smart Grid",
    issns: ["1949-3053", "1949-3061"]
  },
  {
    name: "IEEE Transactions on Power Delivery",
    issns: ["0885-8977", "1937-4208"]
  },
  {
    name: "IEEE Transactions on Sustainable Energy",
    issns: ["1949-3029", "1949-3037"]
  },
  {
    name: "IEEE Transactions on Energy Conversion",
    issns: ["0885-8969", "1558-0059"]
  },
  {
    name: "Applied Energy",
    issns: ["0306-2619", "1872-9118"],
    filterKeywords: ELECTRICAL_FILTER_KEYWORDS
  },
  {
    name: "Energy",
    issns: ["0360-5442", "1751-4223", "1751-4231"],
    filterKeywords: ELECTRICAL_FILTER_KEYWORDS
  },
  {
    name: "International Journal of Electrical Power & Energy Systems",
    issns: ["0142-0615", "1879-3517"]
  },
  {
    name: "Renewable Energy",
    issns: ["0960-1481", "1879-0682"],
    filterKeywords: ELECTRICAL_FILTER_KEYWORDS
  },
  {
    name: "Journal of Modern Power Systems and Clean Energy",
    issns: ["2196-5420", "2196-5625"]
  }
];

export const DEFAULT_JOURNAL_BY_NAME = new Map(DEFAULT_JOURNALS.map((journal) => [journal.name, journal]));

export const config = {
  port: Number(process.env.PORT || 4177),
  clientOrigin: process.env.CLIENT_ORIGIN || "http://127.0.0.1:5173",
  ieeeApiKey: process.env.IEEE_API_KEY || "",
  elsevierApiKey: process.env.ELSEVIER_API_KEY || "",
  publicDataSources: (process.env.PUBLIC_DATA_SOURCES || "crossref,openalex")
    .split(",")
    .map((source) => source.trim().toLowerCase())
    .filter(Boolean),
  crossrefMailto: process.env.CROSSREF_MAILTO || "",
  crawlerEnabled: String(process.env.CRAWLER_ENABLED || "true").toLowerCase() === "true",
  crawlerTimeoutMs: Number(process.env.CRAWLER_TIMEOUT_MS || 12000),
  translationProvider: process.env.TRANSLATION_PROVIDER || "auto",
  libreTranslateUrl: (process.env.LIBRETRANSLATE_URL || "https://libretranslate.com").replace(/\/$/, ""),
  libreTranslateApiKey: process.env.LIBRETRANSLATE_API_KEY || "",
  myMemoryEmail: process.env.MYMEMORY_EMAIL || "",
  baiduTranslateAppId: process.env.BAIDU_TRANSLATE_APPID || "",
  baiduTranslateKey: process.env.BAIDU_TRANSLATE_KEY || "",
  refreshCron: process.env.REFRESH_CRON || "0 8 * * *",
  lookbackDays: Number(process.env.LOOKBACK_DAYS || 45),
  
  // Legacy weekly digest settings (kept for backward compatibility)
  weeklyDigestCron: process.env.WEEKLY_DIGEST_CRON || process.env.MAIL_WEEKLY_CRON || "0 8 * * 1",
  weeklyDigestDays: Number(process.env.WEEKLY_DIGEST_DAYS || process.env.MAIL_WEEKLY_DAYS || 7),
  weeklyDigestLimit: Number(process.env.WEEKLY_DIGEST_LIMIT || process.env.MAIL_WEEKLY_LIMIT || 0),
  weeklyDigestTranslationLanguage:
    process.env.WEEKLY_DIGEST_TRANSLATION_LANGUAGE || process.env.MAIL_TRANSLATION_LANGUAGE || "zh",
  weeklyDigestDir: process.env.WEEKLY_DIGEST_DIR || "data/digests",
  weeklyDigestTranslateMissingLimit: Number(process.env.WEEKLY_DIGEST_TRANSLATE_MISSING_LIMIT || 20),
  weeklyDigestEnrichMissingLimit: Number(process.env.WEEKLY_DIGEST_ENRICH_MISSING_LIMIT || 50),
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
