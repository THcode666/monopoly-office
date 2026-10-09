// v5 视觉自检：Q版人物 / 结算领奖台 / 道具栏
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const SHOTS = join(ROOT, "docs", "shots");

const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto("file:///" + join(ROOT, "dist/monopoly-office.html").replace(/\\/g, "/"));
await page.waitForTimeout(600);

// 1. 设置页：人物选择器
await page.screenshot({ path: join(SHOTS, "v5-01-setup.png") });

await page.click('.mode-card[data-mode="solo"]');
await page.waitForTimeout(300);
await page.screenshot({ path: join(SHOTS, "v5-02-setup-chars.png") });
await page.click("#startBtn");
await page.waitForTimeout(800);

// 2. 棋盘：人物棋子 + 玩家卡人物头像
await page.screenshot({ path: join(SHOTS, "v5-03-board.png") });

// 3. 强制结算：把 maxRounds 压到当前回合，结束当前回合即触发 GAME_OVER
await page.evaluate(() => {
  for (let i = 0; i < 8; i++) {
    const foot = document.querySelector(".overlay.show [data-foot]:not([data-foot='__x__'])");
    if (foot) { foot.click(); continue; }
    const skip = document.querySelector('.overlay.show .opt[data-act="skip"]');
    if (skip) { skip.click(); continue; }
    const x = document.querySelector(".overlay.show .modal-x");
    if (x) { x.click(); continue; }
    break;
  }
  const g = window.__game;
  g.state.meta.maxRounds = g.state.meta.turn; // 本回合结束即终局
});
await page.waitForTimeout(200);
// 循环驱动直到终局（回合推进要经过 掷骰→事件→结束 多步，其中还夹着 AI 回合）
for (let i = 0; i < 30; i++) {
  const st = await page.evaluate(() => {
    const g = window.__game, s = g.state;
    if (s.meta.phase === "GAME_OVER") return { over: true };
    const cur = s.players[s.meta.currentSeat];
    const ph = s.meta.phase;
    if (ph === "POST_ACTION") g.dispatch({ type: "END_TURN", playerId: cur.id });
    else if (ph === "TILE_EVENT") g.dispatch({ type: "DISMISS_MODAL", playerId: cur.id });
    else if (ph === "ROLL" || ph === "TURN_START") g.dispatch({ type: "ROLL_DICE", playerId: cur.id });
    return { over: s.meta.phase === "GAME_OVER", ph };
  });
  if (st.over) break;
  await page.waitForTimeout(350);
}
await page.waitForTimeout(1200);

const over = await page.evaluate(() => window.__game.state.meta.phase === "GAME_OVER");
console.log("GAME_OVER:", over);
await page.screenshot({ path: join(SHOTS, "v5-04-gameover.png") });

await browser.close();
console.log("✅ v5 截图完成");
