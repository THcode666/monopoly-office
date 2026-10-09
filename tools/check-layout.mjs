// 独立验证棋盘布局：40 格、id 唯一连续、坐标不越界、全部在外环上。
//
// 关键：布局以 board.json 的 grid 坐标为唯一事实来源（board.js 现在也是这么读的）。
// 早期版本用手算 id 公式，结果与实际 grid 不符，漏掉 2 格导致棋盘出现空洞。
//
// 用法：node tools/check-layout.mjs

import { readFileSync } from "node:fs";

const board = JSON.parse(readFileSync("data/board.json", "utf8"));
const n = board.grid.cols;
const size = board.tiles.length;

const errs = [];
const ok = (c, m) => { console.log(`  ${c ? "ok  " : "FAIL"} ${m}`); if (!c) errs.push(m); };

console.log(`\n棋盘布局检查（${n}×${n}，${size} 格）\n`);

ok(size === n * 4 - 4, `格子数 ${size} = n×4−4 = ${n * 4 - 4}`);
ok(size >= 40 && size <= 50, `格子数在 40~50 区间（${size}）`);

const ids = board.tiles.map((t) => t.id);
ok(new Set(ids).size === size, `id 唯一（${new Set(ids).size}/${size}）`);

let continuous = true;
for (let i = 0; i < size; i++) if (ids[i] !== i) { continuous = false; break; }
ok(continuous, "id 是 0..n-1 的连续整数（环形移动依赖）");

const oob = board.tiles.filter((t) =>
  !Array.isArray(t.grid) || t.grid.length !== 2 ||
  t.grid[0] < 0 || t.grid[0] >= n || t.grid[1] < 0 || t.grid[1] >= n);
ok(oob.length === 0, `坐标不越界（越界 ${oob.length} 个）`);

const onRing = board.tiles.filter((t) => {
  const c = t.grid[0], r = t.grid[1];
  return c !== 0 && c !== n - 1 && r !== 0 && r !== n - 1;
});
ok(onRing.length === 0, `全部落在外环上（内环 ${onRing.length} 个）` +
  (onRing.length ? "：" + onRing.map((t) => t.name).join(",") : ""));

const noCoord = new Set();
let dupCoord = 0;
for (const t of board.tiles) {
  const k = t.grid.join(",");
  if (noCoord.has(k)) dupCoord++;
  noCoord.add(k);
}
ok(dupCoord === 0, `坐标不重复（重复 ${dupCoord} 个）`);

const need = ["start", "company", "rent", "eat", "clothes", "vehicle", "property",
  "promotion", "demotion", "raise", "cut", "chance", "fate", "vacation"];
const types = new Set(board.tiles.map((t) => t.type));
const missing = need.filter((t) => !types.has(t));
ok(missing.length === 0, `14 种格子类型齐全${missing.length ? "，缺 " + missing.join(",") : ""}`);

// 装饰不能压在外环格子上
const tileCoords = new Set(board.tiles.map((t) => t.grid.join(",")));
const clash = (board.decor || []).filter((d) => tileCoords.has(d.grid.join(",")));
ok(clash.length === 0, `装饰不压格子（重叠 ${clash.length} 个）`);

const decorNeeded = ["cubicle", "teaRoom", "meetingRoom", "bossOffice"];
const kinds = new Set((board.decor || []).map((d) => d.kind));
const missDecor = decorNeeded.filter((k) => !kinds.has(k));
ok(missDecor.length === 0, `工位/茶水间/会议室/老板办公室齐全${missDecor.length ? "，缺 " + missDecor.join(",") : ""}`);

console.log("");
if (errs.length) {
  console.log(`FAIL ${errs.length} 项`);
  process.exit(1);
}
console.log("ok   布局全部通过");
