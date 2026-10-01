// 只读核查：期刊目录里的 JMPSCE 是「本就无入库文献」还是「被误删」。
// 对比一次性修复前的快照与当前库，看刊名数、JMPSCE、Power System Technology、电网技术的变化。
import { DatabaseSync } from "node:sqlite";

const DATA = "E:/SC/文献推送/data/";

for (const file of ["literature.sqlite", "predelete-snapshot.sqlite"]) {
  try {
    const db = new DatabaseSync(DATA + file, { readOnly: true });
    const labels = db.prepare("SELECT COUNT(*) AS c FROM (SELECT journal FROM articles GROUP BY journal)").get().c;
    const likes = (pattern) => db.prepare("SELECT COUNT(*) AS c FROM articles WHERE journal LIKE ?").get(pattern).c;
    const exact = (name) => db.prepare("SELECT COUNT(*) AS c FROM articles WHERE journal = ?").get(name).c;
    console.log(`--- ${file} ---`);
    console.log(`  刊名数=${labels}  JMPSCE=${likes("%Modern Power%")}  PST=${likes("%Power System Technology%")}  电网技术=${exact("电网技术")}`);
    const powerish = db.prepare("SELECT journal, COUNT(*) AS c FROM articles WHERE journal LIKE ? GROUP BY journal ORDER BY c DESC").all("%Power%");
    console.log(`  含 Power 的刊名：${powerish.map((r) => `${r.journal}(${r.c})`).join(", ") || "无"}`);
    db.close();
  } catch (error) {
    console.log(`--- ${file} ---`);
    console.log(`  ERR ${error.message}`);
  }
}
