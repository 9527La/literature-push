import { ELECTRICAL_FILTER_KEYWORDS } from "./utils.js";

// Journal-specific identifiers only; shared collection policies live in publishers.js.
export const DEFAULT_JOURNALS = [
  {
    publisher: "ieee",
    platform: "ieee",
    name: "IEEE Transactions on Power Systems",
    group: "ieee",
    issns: ["0885-8950", "1558-0679"]
  },
  {
    publisher: "ieee",
    platform: "ieee",
    name: "IEEE Transactions on Smart Grid",
    group: "ieee",
    issns: ["1949-3053", "1949-3061"]
  },
  {
    publisher: "ieee",
    platform: "ieee",
    name: "IEEE Transactions on Power Delivery",
    group: "ieee",
    issns: ["0885-8977", "1937-4208"]
  },
  {
    publisher: "ieee",
    platform: "ieee",
    name: "IEEE Transactions on Sustainable Energy",
    group: "ieee",
    issns: ["1949-3029", "1949-3037"]
  },
  {
    publisher: "ieee",
    platform: "ieee",
    name: "IEEE Transactions on Energy Conversion",
    group: "ieee",
    issns: ["0885-8969", "1558-0059"]
  },
  {
    publisher: "elsevier",
    platform: "elsevier",
    name: "Applied Energy",
    group: "elsevier",
    issns: ["0306-2619", "1872-9118"],
    filterKeywords: ELECTRICAL_FILTER_KEYWORDS
  },
  {
    publisher: "elsevier",
    platform: "elsevier",
    name: "Energy",
    group: "elsevier",
    issns: ["0360-5442", "1751-4223", "1751-4231"],
    filterKeywords: ELECTRICAL_FILTER_KEYWORDS
  },
  {
    publisher: "elsevier",
    platform: "elsevier",
    name: "International Journal of Electrical Power & Energy Systems",
    group: "elsevier",
    issns: ["0142-0615", "1879-3517"]
  },
  {
    publisher: "elsevier",
    platform: "elsevier",
    name: "Renewable Energy",
    group: "elsevier",
    issns: ["0960-1481", "1879-0682"],
    filterKeywords: ELECTRICAL_FILTER_KEYWORDS
  },
  {
    publisher: "ieee",
    platform: "ieee",
    name: "Journal of Modern Power Systems and Clean Energy",
    group: "other",
    issns: ["2196-5420", "2196-5625"]
  },
  {
    name: "电力系统自动化",
    group: "cn",
    issns: ["1000-1026"],
    platform: "wanfang",
    wanfangId: "dlxtzdh"
  },
  {
    name: "中国电机工程学报",
    group: "cn",
    issns: ["0258-8013"],
    platform: "wanfang",
    wanfangId: "zgdjgcxb"
  },
  {
    name: "电网技术",
    group: "cn",
    issns: ["1000-3673"],
    platform: "wanfang",
    wanfangId: "dwjs"
  },
  {
    name: "电工技术学报",
    group: "cn",
    issns: ["1000-6753"],
    platform: "wanfang",
    wanfangId: "dgjsxb"
  },
  {
    name: "高电压技术",
    group: "cn",
    issns: ["1003-6520"],
    platform: "wanfang",
    wanfangId: "gdyjs"
  }
];

export const DEFAULT_JOURNAL_BY_NAME = new Map(DEFAULT_JOURNALS.map((journal) => [journal.name, journal]));

