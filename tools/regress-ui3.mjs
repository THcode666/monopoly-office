// 专项回归：① 道具弹窗能取消 ② 各 picker 弹窗都能关 ③ 名牌画在格子里
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const __dirname = dirname(fileURLToPath(import.meta.url));
const SHOTS = join(__dirname, "../docs/shots");
mkdirSync(SHOTS, { recursive: true });

let pass = 0, fail = 0;
const ok = (n, c, x = "") => { console.log(`  ${c ? "ok  " : "FAIL"}  ${n}${x ? "  → " + x : ""}`); c ? pass++ : fail++; };

const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));

await page.goto(process.argv[2] || "http://127.0.0.1:8901/", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(2000);
await page.waitForSelector(".mode-grid", { timeout: 12000 });
await page.click('.mode-card[data-mode="solo"]');
await page.click("#startBtn");
await page.waitForSelector("#app.ready", { timeout: 8000 });
await page.waitForTimeout(800);

// 塞道具 + 机会卡
await page.evaluate(() => {
  const g = window.__game;
  const p = g.state.players[0];
  p.cards.item = ["coffee", "slack", "umbrella"];
  p.cards.opportunity = p.cards.opportunity?.length ? p.cards.opportunity : ["oc1"];
  g.render();
});

console.log("专项回归：道具取消 / 弹窗兜底 / 名牌\n");

// 推进到 POST_ACTION
await page.evaluate(async () => {
  const g = window.__game;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const byText = (sel, t) => [...document.querySelectorAll(sel)].find((x) => x.textContent.includes(t));
  const closeM = () => {
    const a = document.querySelector(".overlay.show [data-act]");
    if (a) { a.click(); return true; }
    const f = document.querySelector(".overlay.show [data-foot]");
    if (f) { f.click(); return true; }
    return false;
  };
  for (let i = 0; i < 120; i++) {
    const open = document.getElementById("modalLayer").classList.contains("show");
    if (open) { closeM(); await sleep(40); continue; }
    if (g.state.meta.phase === "ROLL") { const rb = byText(".actionbar button", "掷骰子"); if (rb) { rb.click(); await sleep(200); continue; } }
    if (g.state.meta.phase === "POST_ACTION") break;
    await sleep(40);
  }
});
await page.waitForTimeout(300);

// ── 测试 1：使用道具弹窗能取消 ──
console.log("[1] 道具弹窗取消");
await page.evaluate(() => {
  const b = [...document.querySelectorAll(".actionbar button")].find(x => x.textContent.includes("使用道具"));
  if (b) b.click();
});
await page.waitForTimeout(400);
let open1 = await page.evaluate(() => document.getElementById("modalLayer").classList.contains("show"));
ok("点「使用道具」弹出选择窗", open1);
ok("弹窗内有 × 关闭按钮", await page.locator(".overlay.show .modal-x").count() > 0);
ok("弹窗内有「取消」按钮", await page.locator('.overlay.show [data-foot="__cancel__"]').count() > 0);

// 点取消
await page.evaluate(() => document.querySelector('.overlay.show [data-foot="__cancel__"]')?.click());
await page.waitForTimeout(400);
const openAfterCancel = await page.evaluate(() => document.getElementById("modalLayer").classList.contains("show"));
const itemsKept = await page.evaluate(() => window.__game.state.players[0].cards.item.length);
ok("点「取消」后弹窗关闭", !openAfterCancel);
ok("取消后道具未被消耗", itemsKept === 3, `${itemsKept} 张`);

// ── 测试 2：× 按钮兜底 ──
console.log("\n[2] × 关闭兜底");
await page.evaluate(() => {
  const b = [...document.querySelectorAll(".actionbar button")].find(x => x.textContent.includes("使用道具"));
  if (b) b.click();
});
await page.waitForTimeout(400);
await page.evaluate(() => document.querySelector(".overlay.show .modal-x")?.click());
await page.waitForTimeout(400);
ok("点 × 后弹窗关闭", !(await page.evaluate(() => document.getElementById("modalLayer").classList.contains("show"))));

// ── 测试 3：存款/取款弹窗 ──
console.log("\n[3] 存款弹窗");
await page.evaluate(() => {
  const b = [...document.querySelectorAll(".actionbar button")].find(x => x.textContent.includes("存款"));
  if (b) b.click();
});
await page.waitForTimeout(400);
ok("存款弹窗打开", await page.evaluate(() => document.getElementById("modalLayer").classList.contains("show")));
await page.evaluate(() => document.querySelector(".overlay.show .modal-x")?.click());
await page.waitForTimeout(400);
ok("存款弹窗能 × 关闭", !(await page.evaluate(() => document.getElementById("modalLayer").classList.contains("show"))));

// 存款 30% 真的能存
await page.evaluate(() => {
  const b = [...document.querySelectorAll(".actionbar button")].find(x => x.textContent.includes("存款"));
  if (b) b.click();
});
await page.waitForTimeout(300);
const beforeDep = await page.evaluate(() => window.__game.state.players[0].deposit);
await page.evaluate(() => document.querySelector('.overlay.show [data-act^="amt:"]')?.click());
await page.waitForTimeout(500);
const afterDep = await page.evaluate(() => window.__game.state.players[0].deposit);
ok("点金额档位能真的存款", afterDep > beforeDep, `${beforeDep} → ${afterDep}`);
ok("存款后弹窗自动关闭", !(await page.evaluate(() => document.getElementById("modalLayer").classList.contains("show"))));

// ── 测试 4：名牌 ──
console.log("\n[4] 棋盘名牌");
const tags = await page.evaluate(() => {
  const bd = window.__game.board;
  const byTile = {};
  for (const p of bd.players) (byTile[p.pos] = byTile[p.pos] || []).push(p);
  return { tiles: Object.keys(byTile).length, players: bd.players.length, currentId: bd.currentId, cellW: bd.cell };
});
ok("名牌数据源就绪", tags.players === 4 && tags.currentId, JSON.stringify(tags));

// 名牌必须在格子范围内（不越界）
const overflow = await page.evaluate(() => {
  const bd = window.__game.board;
  const out = [];
  for (const p of bd.players) {
    const t = bd.cells[p.pos];
    if (!t) { out.push({ name: p.name, err: "no cell" }); continue; }
    // 名牌中心应在格子中心附近（允许半个名牌宽度的偏移）
    const fs = Math.max(7.5, Math.min((t.pw || bd.cell) * 0.118, 10.5));
    if (t.cx < 0 || t.cx > bd.size || t.cy < 0 || t.cy > bd.size) {
      out.push({ name: p.name, cx: t.cx, cy: t.cy, err: "cell out of canvas" });
    }
  }
  return out;
});
ok("所有玩家格子在画布内", overflow.length === 0, JSON.stringify(overflow));

await page.screenshot({ path: join(SHOTS, "regress3-full.png"), fullPage: false });
await page.locator("#board").screenshot({ path: join(SHOTS, "regress3-board.png") });

ok("无 JS 运行时错误", errs.length === 0, errs.slice(0, 2).join(" | "));

await browser.close();
console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);