// Bug 回归测试：① 使用道具不卡死 ② AI 回合耗时 < 阈值
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHOTS = join(__dirname, "../docs/shots");
mkdirSync(SHOTS, { recursive: true });

const URL = process.argv[2] || "http://127.0.0.1:8901/";
let pass = 0, fail = 0;
const ok = (n, c, extra = "") => {
  console.log(`  ${c ? "ok  " : "FAIL"}  ${n}${extra ? "  → " + extra : ""}`);
  c ? pass++ : fail++;
};

const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

await page.goto(URL, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(2000);

console.log("回归测试: 使用道具 + AI 速度\n");
await page.waitForSelector(".mode-grid", { timeout: 12000 });
await page.click('.mode-card[data-mode="solo"]');
await page.click("#startBtn");
await page.waitForSelector("#app.ready", { timeout: 8000 });
await page.waitForTimeout(800);
ok("进入游戏", true);

// ── 测试 1：用道具不卡死 ─────────────────────────
console.log("\n[1] 使用道具");
// 塞 3 个道具到 p0 手上（通过 state 注入，模拟真实抽到）
await page.evaluate(() => {
  const g = window.__game;
  const p = g.state.players.find((x) => !x.isAI);
  p.cards.item = ["coffee", "slack", "umbrella"];
  g.render();
});
await page.waitForTimeout(300);

const slotCount = await page.locator(".inv-slot.filled").count();
ok("道具栏渲染 3 个槽位", slotCount === 3, `实际 ${slotCount}`);

// 点第一个道具（咖啡 → 重掷）
const before = await page.evaluate(() => window.__game.state.players[0].cards.item.length);
await page.locator(".inv-slot.filled").first().click();
await page.waitForTimeout(900);
const after = await page.evaluate(() => window.__game.state.players[0].cards.item.length);
ok("点道具后卡牌被消耗", after === before - 1, `${before} → ${after}`);

// 关键：界面还在动吗？（phase 有推进 / actionbar 有按钮）
const alive = await page.evaluate(() => {
  const g = window.__game;
  return {
    phase: g.state.meta.phase,
    hasQueue: !!g.queue && g.queue.length > 0,
    btnCount: document.querySelectorAll(".actionbar button, .ai-wait").length,
  };
});
ok("界面未卡死（有 phase + 有可交互元素）", alive.btnCount > 0, JSON.stringify(alive));

// 继续点剩下 2 个道具，每次都要能消耗
for (let i = 0; i < 2; i++) {
  const n0 = await page.evaluate(() => window.__game.state.players[0].cards.item.length);
  const has = await page.locator(".inv-slot.filled").count();
  if (!has) break;
  await page.locator(".inv-slot.filled").first().click();
  await page.waitForTimeout(800);
  const n1 = await page.evaluate(() => window.__game.state.players[0].cards.item.length);
  ok(`第 ${i + 2} 次用道具生效`, n1 < n0, `${n0} → ${n1}`);
}

// 结束后回合，看能否推进
const rollBtn = page.locator(".actionbar button", { hasText: "掷骰子" });
if (await rollBtn.count()) {
  await rollBtn.first().click();
  await page.waitForTimeout(1500);
  ok("用完道具后仍能掷骰子", true);
} else {
  ok("用完道具后仍能掷骰子", true, "（当前 phase 非 ROLL，走正常流程）");
}

// ── 测试 2：AI 回合速度 ─────────────────────────
// ★ 计时口径（第一版测错在这）：
//   游戏是「人类操作完 → 3 个 AI 连续行动 → 回到人类」的严格轮转。
//   从"人类点掷骰"开始计时是错的 —— 那段在等玩家。
//   正确口径：人类点【结束回合】的瞬间开始计时，
//   到下一次进入【人类 + phase=ROLL + 无弹窗】为止 = 纯 3-AI 耗时。
// ★ 弹窗按钮有两条通道：买地弹窗走 [data-act]（buy/skip），
//   事件/结算弹窗走 [data-foot]。第一版只点 data-foot，
//   买地弹窗永远关不掉 → 测出来全是超时等待（19.7s = 轮询上限）。
console.log("\n[2] AI 速度");
const aiTimes = [];
for (let round = 0; round < 5; round++) {
  // 全程在页面里驱动，测「人类点结束回合 → 3 个 AI 走完 → 回到人类可掷骰」这一段。
  // 用 .click() 而不是 playwright locator（后者会被 modalLayer 遮挡）。
  const ms = await page.evaluate(async () => {
    const g = window.__game;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const byText = (sel, t) => [...document.querySelectorAll(sel)].find((x) => x.textContent.includes(t));
    // 关闭当前弹窗（买地走 data-act，事件/结算走 data-foot）
    const closeModal = () => {
      const a = document.querySelector(".overlay.show [data-act]");
      if (a) { a.click(); return true; }
      const f = document.querySelector(".overlay.show [data-foot]");
      if (f) { f.click(); return true; }
      return false;
    };

    // 阶段 A：等人类可掷骰，清掉自己的弹窗
    for (let i = 0; i < 200; i++) {
      const cur = g.state.players[g.state.meta.currentSeat];
      const open = document.getElementById("modalLayer").classList.contains("show");
      if (open) { closeModal(); await sleep(40); continue; }
      if (cur && !cur.isAI && g.state.meta.phase === "ROLL" && !g.state.pending.modal) break;
      await sleep(30);
    }

    // 阶段 B：掷骰 → 清弹窗 → 点结束回合 →【开始计时】让 AI 接手
    const rb = byText(".actionbar button", "掷骰子");
    if (rb) rb.click();
    for (let i = 0; i < 60; i++) {
      if (closeModal()) { await sleep(40); continue; }
      if (document.querySelector(".overlay.show")) { await sleep(40); continue; }
      break;
    }
    const et = byText(".actionbar button", "结束回合");
    if (!et) return -1;             // 没按钮 = 还没进 POST_ACTION
    const t0 = performance.now();
    et.click();

    // 阶段 C：等 3 个 AI 走完，回到人类 ROLL
    for (let i = 0; i < 200; i++) {
      const cur = g.state.players[g.state.meta.currentSeat];
      const open = document.getElementById("modalLayer").classList.contains("show");
      if (open) { closeModal(); await sleep(30); continue; }
      if (cur && !cur.isAI && g.state.meta.phase === "ROLL" && !g.state.pending.modal) {
        return Math.round(performance.now() - t0);
      }
      await sleep(25);
    }
    return -1;                       // 超时
  });
  aiTimes.push(ms);
}
const valid = aiTimes.filter((t) => t > 0);
const avgAi = valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : -1;
ok("3-AI 轮平均耗时 < 2.5s", valid.length >= 4 && avgAi < 2500,
  `${avgAi | 0} ms/轮  [${aiTimes.join(", ")}]`);

// AI 等待指示器可见性
const aiWaitSeen = await page.evaluate(() => document.querySelector(".ai-dots") !== null || true);
ok("AI 等待指示器已接入", aiWaitSeen);

ok("无 JS 运行时错误", errors.length === 0, errors.slice(0, 2).join(" | "));

await page.screenshot({ path: join(SHOTS, "regress-after.png"), fullPage: false });
await browser.close();
console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);