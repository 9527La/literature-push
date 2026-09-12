import fs from "node:fs";

// The four publisher buckets are an editorial decision, not something to infer
// at render time: JMPSCE is crawled through IEEE Xplore but published by State
// Grid, so it belongs to "other". Writing the group next to each journal keeps
// that rule in one place.
const GROUP_BY_NAME = {
  "IEEE Transactions on Power Systems": "ieee",
  "IEEE Transactions on Smart Grid": "ieee",
  "IEEE Transactions on Power Delivery": "ieee",
  "IEEE Transactions on Sustainable Energy": "ieee",
  "IEEE Transactions on Energy Conversion": "ieee",
  "Applied Energy": "elsevier",
  "Energy": "elsevier",
  "International Journal of Electrical Power & Energy Systems": "elsevier",
  "Renewable Energy": "elsevier",
  "Journal of Modern Power Systems and Clean Energy": "other",
  "电力系统自动化": "cn",
  "中国电机工程学报": "cn",
  "电网技术": "cn",
  "电工技术学报": "cn",
  "高电压技术": "cn"
};

const file = "server/journals.js";
const lines = fs.readFileSync(file, "utf8").split("\n");
const out = [];
const seen = [];

for (const line of lines) {
  out.push(line);
  const match = line.match(/^\s{4}name: "(.+)",\s*$/);
  if (!match) continue;
  const name = match[1];
  const group = GROUP_BY_NAME[name];
  if (!group) {
    console.log("NO_GROUP_FOR:", name);
    continue;
  }
  out.push(`    group: "${group}",`);
  seen.push(`${name} -> ${group}`);
}

fs.writeFileSync(file, out.join("\n"));
console.log(seen.join("\n"));
console.log("entries:", seen.length);
