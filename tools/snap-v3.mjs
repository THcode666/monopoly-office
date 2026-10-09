// v3 视觉自检截图：跑一段真实对局，抓棋盘 / 弹窗 / 面板的成品效果。
// 运行：node tools/snap-v3.mjs
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const SHOTS = join(ROOT, "docs", "shots");
mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto("file:///" + join(ROOT, "dist/monopoly-office.html").replace(/\\/g, "/"));
await page.waitForTimeout(600);

// 1. 开局设置界面
await page.screenshot({ path: join(SHOTS, "v3-01-setup.png") });

// 选单人模式并开始
await page.click('.mode-card[data-mode="solo"]');
await page.waitForTimeout(300);
await page.click("#startBtn");
await page.waitForTimeout(900);

// 2. 初始棋盘（新棋子 + 中央水印 + 起点箭头）
await page.screenshot({ path: join(SHOTS, "v3-02-board-start.png") });

// 3. 用页面内驱动快速推进 26 回合（AI 自动走，人类回合由脚本代打）
await page.evaluate(async () => {
  const g = window.__game;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const guardDead = () => !g.state || g.state.meta.phase === "GAME_OVER";
  for (let i = 0; i < 4000 && g.state.meta.turn < 27 && !guardDead(); i++) {
    const s = g.state;
    const cur = s.players[s.meta.currentSeat];
    if (!cur) break;
    if (cur.isAI) { g.step(); await sleep(24); continue; }
    const ph = s.meta.phase;
    if (ph === "TURN_START" || ph === "ROLL") { g.dispatch({ type: "ROLL_DICE", playerId: cur.id }); }
    else if (ph === "TILE_EVENT") {
      const m = s.pending.modal;
      if (m && m.kind === "buy" && cur.cash > m.price) g.dispatch({ type: "BUY_PROPERTY", tileId: m.tileId, playerId: cur.id });
      else if (m && m.kind === "vehicle") {
        // 挑最便宜的车买，制造"有车"的画面
        const opts = (s.board.tiles.find((t) => t.id === m.tileId)?.payload?.options) || [];
        const cheap = opts.slice().sort((a, b) => a.price - b.price)[0];
        if (cheap && cur.cash > cheap.price * 0.3 + 6000) g.dispatch({ type: "BUY_VEHICLE", tileId: m.tileId, optionId: cheap.id, playerId: cur.id });
        else g.dispatch({ type: "DISMISS_MODAL", playerId: cur.id });
      }
      else g.dispatch({ type: "DISMISS_MODAL", playerId: cur.id });
    }
    else if (ph === "POST_ACTION") g.dispatch({ type: "END_TURN", playerId: cur.id });
    else await sleep(16);
    await sleep(16);
  }
});
await page.waitForTimeout(1200);

// 截图前清掉残留弹窗（命运/事件等），避免遮罩把画面压暗
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
});
await page.waitForTimeout(300);
await page.screenshot({ path: join(SHOTS, "v3-03-board-mid.png") });

// 4. 玩家面板特写（星标 + 金色描边）
const side = await page.locator(".side").boundingBox();
if (side) {
  await page.screenshot({
    path: join(SHOTS, "v3-04-panel.png"),
    clip: { x: side.x - 8, y: side.y - 8, width: side.width + 16, height: Math.min(side.height + 16, 900) },
  });
}

// 5. 已购地皮特写：验证"小房子 + 玩家色旗帜"归属标记与新棋子
await page.evaluate(() => {
  const g = window.__game;
  const owned = g.state.board.tiles.findIndex((t) => t.owner);
  if (owned >= 0) g.board.setHighlight(owned);
});
await page.waitForTimeout(200);
const boardBox = await page.locator(".board-wrap").boundingBox();
if (boardBox) {
  await page.screenshot({
    path: join(SHOTS, "v3-06-owned-zoom.png"),
    clip: { x: boardBox.x, y: boardBox.y, width: Math.min(boardBox.width, 900), height: Math.min(boardBox.height, 880) },
  });
}

// 6. 帮助弹窗（金色饰条效果）
await page.evaluate(() => { document.querySelectorAll(".overlay.show [data-foot], .overlay.show .modal-x").forEach((b) => b.click()); });
await page.waitForTimeout(250);
await page.click("#btnHelp");
await page.waitForTimeout(400);
await page.screenshot({ path: join(SHOTS, "v3-05-help.png") });

await browser.close();
console.log("✅ 截图完成：" + SHOTS);
