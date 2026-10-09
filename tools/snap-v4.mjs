// v4 视觉自检：骰子动画中段 / 中央办公区 / 大号棋子
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const SHOTS = join(ROOT, "docs", "shots");

const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto("file:///" + join(ROOT, "dist/monopoly-office.html").replace(/\\/g, "/"));
await page.waitForTimeout(500);
await page.click('.mode-card[data-mode="solo"]');
await page.waitForTimeout(200);
await page.click("#startBtn");
await page.waitForTimeout(700);

// 1. 掷骰子 → 在摇晃阶段（~400ms）截帧看动画演出
await page.evaluate(() => {
  const g = window.__game;
  g.board.diceMs = 3000; // 拉长便于截帧观察摇晃相
  const cur = g.state.players[g.state.meta.currentSeat];
  g.dispatch({ type: "ROLL_DICE", playerId: cur.id });
});
await page.waitForTimeout(900);
await page.screenshot({ path: join(SHOTS, "v4-01-dice-roll.png") });
await page.waitForTimeout(3000); // 等动画走完

// 清掉弹窗
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

// 2. 全盘：木地板 + 十字走廊 + 徽章 + 大号棋子
await page.screenshot({ path: join(SHOTS, "v4-02-board.png") });

// 3. 中央办公区特写
const box = await page.locator(".board-wrap").boundingBox();
if (box) {
  const s = Math.min(box.width, box.height);
  await page.screenshot({
    path: join(SHOTS, "v4-03-center-zoom.png"),
    clip: { x: box.x + box.width / 2 - s * 0.32, y: box.y + box.height / 2 - s * 0.32, width: s * 0.64, height: s * 0.64 },
  });
}

await browser.close();
console.log("✅ v4 截图完成");
