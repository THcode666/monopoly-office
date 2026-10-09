// 只截棋盘 canvas 的大图（不缩放），看名牌是否画出来了
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const __dirname = dirname(fileURLToPath(import.meta.url));
const SHOTS = join(__dirname, "../docs/shots");
mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
await page.goto(process.argv[2] || "http://127.0.0.1:8901/", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(2000);
await page.waitForSelector(".mode-grid", { timeout: 12000 });
await page.click('.mode-card[data-mode="solo"]');
await page.click("#startBtn");
await page.waitForSelector("#app.ready", { timeout: 8000 });
await page.waitForTimeout(1000);

// 走几步，让棋子分散在不同格子
await page.evaluate(async () => {
  const g = window.__game;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const byText = (sel, t) => [...document.querySelectorAll(sel)].find((x) => x.textContent.includes(t));
  for (let round = 0; round < 3; round++) {
    for (let i = 0; i < 100; i++) {
      const open = document.getElementById("modalLayer").classList.contains("show");
      if (open) {
        const a = document.querySelector(".overlay.show [data-act]") || document.querySelector(".overlay.show [data-foot]");
        if (a) a.click();
        await sleep(40); continue;
      }
      break;
    }
    const rb = byText(".actionbar button", "掷骰子");
    if (rb) rb.click();
    await sleep(400);
    for (let i = 0; i < 40; i++) {
      const open = document.getElementById("modalLayer").classList.contains("show");
      if (open) {
        const a = document.querySelector(".overlay.show [data-act]") || document.querySelector(".overlay.show [data-foot]");
        if (a) a.click();
        await sleep(40); continue;
      }
      break;
    }
    const et = byText(".actionbar button", "结束回合");
    if (et) et.click();
    await sleep(1600);
  }
});

await page.waitForTimeout(500);
// 关掉所有弹窗（结算/事件），确保棋盘无遮挡
await page.evaluate(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 30; i++) {
    const open = document.getElementById("modalLayer").classList.contains("show");
    if (!open) break;
    const x = document.querySelector(".modal-x") || document.querySelector(".overlay.show [data-foot]");
    if (x) x.click();
    await sleep(80);
  }
});
await page.waitForTimeout(400);
const cv = page.locator("#board");
await cv.screenshot({ path: join(SHOTS, "board-zoom.png") });
console.log("OK: board-zoom.png");
await browser.close();