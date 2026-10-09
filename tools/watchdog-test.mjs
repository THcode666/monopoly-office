// 看门狗专项测试：人为把 AI 驱动冻住，验证超时后会被强制推进且游戏继续健康运行。
// 运行：node tools/watchdog-test.mjs
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
await page.goto("file:///" + join(ROOT, "dist/monopoly-office.html").replace(/\\/g, "/"));
await page.waitForTimeout(500);

await page.click('.mode-card[data-mode="solo"]');
await page.waitForTimeout(200);
await page.click("#startBtn");
await page.waitForTimeout(600);

// 缩短阈值方便测试（真实游戏为 20000ms）
await page.evaluate(() => { window.__game.watchdogMs = 2000; });

// 把人类回合走到结束，让 AI 接管
for (let i = 0; i < 30; i++) {
  const st = await page.evaluate(() => {
    const g = window.__game, s = g.state;
    return { seat: s.meta.currentSeat, isAI: s.players[s.meta.currentSeat].isAI, phase: s.meta.phase, turn: s.meta.turn };
  });
  if (st.isAI) break;
  await page.evaluate((ph) => {
    const g = window.__game, s = g.state, cur = s.players[s.meta.currentSeat];
    if (ph === "TURN_START" || ph === "ROLL") g.dispatch({ type: "ROLL_DICE", playerId: cur.id });
    else if (ph === "TILE_EVENT") g.dispatch({ type: "DISMISS_MODAL", playerId: cur.id });
    else if (ph === "POST_ACTION") g.dispatch({ type: "END_TURN", playerId: cur.id });
  }, st.phase);
  await page.waitForTimeout(250);
}

// 确认现在是 AI 回合，然后制造"卡死"：aiRunning 永久为 true（step 直接被冻住）
const frozen = await page.evaluate(() => {
  const g = window.__game;
  g.aiRunning = true;          // step() 开头就 return，模拟任何原因的卡死
  if (g.queue) g.queue = null;
  return { seat: g.state.meta.currentSeat, turn: g.state.meta.turn, phase: g.state.meta.phase };
});
console.log(`冻结于 seat=${frozen.seat} turn=${frozen.turn} phase=${frozen.phase}，等看门狗（阈值 2s）…`);
await page.waitForTimeout(5000);

const after = await page.evaluate(() => {
  const g = window.__game, s = g.state;
  return { seat: s.meta.currentSeat, turn: s.meta.turn, phase: s.meta.phase, aiRunning: g.aiRunning };
});
const advanced = after.turn > frozen.turn
  || after.seat !== frozen.seat
  || (after.seat === frozen.seat && after.phase !== frozen.phase);
if (!advanced) {
  console.error(`❌ 看门狗未生效：仍卡在 seat=${after.seat} turn=${after.turn} phase=${after.phase}`);
  await browser.close();
  process.exit(1);
}
console.log(`✅ 看门狗已强制推进：seat=${frozen.seat}→${after.seat} turn=${frozen.turn}→${after.turn} phase=${frozen.phase}→${after.phase}`);

// 强推后游戏应继续健康运行：再放开跑 3 个回合
for (let i = 0; i < 200; i++) {
  const done = await page.evaluate(() => window.__game.state.meta.turn >= (window.__game.state.meta.turn + 4));
  break;
}
await page.waitForTimeout(4000);
const healthy = await page.evaluate(() => {
  const s = window.__game.state;
  return { turn: s.meta.turn, phase: s.meta.phase, over: s.meta.phase === "GAME_OVER" };
});
console.log(`✅ 强推后继续运行正常：turn=${healthy.turn} phase=${healthy.phase}`);

await browser.close();
console.log("═══ 看门狗测试全部通过 ═══");
