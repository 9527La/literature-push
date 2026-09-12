import fs from "node:fs";

// One-pass type scale bump. A chained replace (10 -> 11, then 11 -> 12) would
// re-process values it had just written, so every value is mapped exactly once.
const MAP = {
  10: 12, 11: 12, 12: 13, 13: 14, 14: 15,
  15: 16, 16: 17, 18: 19, 19: 20, 20: 21, 21: 22, 22: 23, 26: 28
};

const file = "src/styles.css";
const before = fs.readFileSync(file, "utf8");
const seen = new Map();

const after = before.replace(/font-size: (\d+(?:\.\d+)?)px/g, (match, value) => {
  const key = Number(value);
  const next = MAP[key];
  if (!next) return match;
  seen.set(key, (seen.get(key) || 0) + 1);
  return `font-size: ${next}px`;
});

fs.writeFileSync(file, after);

const remaining = {};
for (const match of after.matchAll(/font-size: (\d+(?:\.\d+)?)px/g)) {
  remaining[match[1]] = (remaining[match[1]] || 0) + 1;
}

console.log("changed:", [...seen.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}->${MAP[k]} (${v})`).join(", "));
console.log("result:", Object.keys(remaining).sort((a, b) => a - b).map((k) => `${k}px x${remaining[k]}`).join(", "));
console.log("clamp/rem untouched:", (after.match(/font-size: (clamp|var|inherit)/g) || []).length);
