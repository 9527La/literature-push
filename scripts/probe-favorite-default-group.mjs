// 只读验证（用临时库）：删除「默认收藏夹」后它会不会自己回来。
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const workdir = mkdtempSync(path.join(tmpdir(), "favorite-probe-"));
process.chdir(workdir);
process.env.LITERATURE_DATA_DIR = workdir;

const mod = await import("../server/db.js");
const account = mod.createUserAccount({ username: "probe", passwordHash: "h", passwordSalt: "s", registeredIp: "1.2.3.4" });
const userId = `account:${account.id}`;

const show = (label) => {
  const favorites = mod.getUserFavorites(userId);
  console.log(`${label}  groups=${JSON.stringify(favorites.groups.map((g) => `${g.name}(${g.count})`))}  defaultGroupId=${favorites.defaultGroupId}`);
};
show("① 新建账户后       ");
const groups = mod.getUserFavorites(userId).groups;
const defaultGroup = groups.find((g) => g.name === "默认收藏夹");
console.log(`   删除返回值 = ${mod.deleteFavoriteGroup(userId, defaultGroup.id)}`);
show("② 删除默认收藏夹后  ");
mod.getUserFavorites(userId);
show("③ 再读一次后        ");
console.log(`   默认分组 id 是否复用同一个：${mod.getUserFavorites(userId).groups.find((g) => g.name === "默认收藏夹")?.id === defaultGroup.id}`);

mod.db.close();
delete process.env.LITERATURE_DATA_DIR;
process.chdir(path.dirname(workdir));
rmSync(workdir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
