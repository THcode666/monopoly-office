// 截一组 baseline 截图：开局面板 + 棋盘 + 玩家面板
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHOTS = join(__dirname, "../docs/shots");
mkdirSync(SHOTS, { recursive: true });

const URL = process.argv[2] || "http://127.0.0.1:8901/";
const TAG = process.argv[3] || "shot";
const WITH_FOCUS = process.argv[4] === "focus";

const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));

await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForSelector(".mode-grid", { timeout: 8000 });
await page.screenshot({ path: join(SHOTS, `${TAG}-01-setup.png`), fullPage: false });

await page.click('.mode-card[data-mode="solo"]');
await page.waitForTimeout(200);
await page.click("#startBtn");
await page.waitForSelector("#app.ready", { timeout: 6000 });
await page.waitForTimeout(800);  // 等棋盘画完
await page.screenshot({ path: join(SHOTS, `${TAG}-02-board.png`), fullPage: false });

// 触发一个弹窗：掷骰子 → 让事件弹窗出来
await page.locator(".actionbar button", { hasText: "掷骰子" }).first().click();
await page.waitForTimeout(1000);
await page.screenshot({ path: join(SHOTS, `${TAG}-03-modal.png`), fullPage: false });

// 关掉弹窗
const cont = page.locator(".overlay.show [data-foot]");
if (await cont.count()) { await cont.first().click(); await page.waitForTimeout(400); }

// 截一张"面板特写"（右侧面板）
const side = await page.locator(".side").first();
await side.screenshot({ path: join(SHOTS, `${TAG}-04-panel.png`) });

// 截"底部操作区"
const actionbar = await page.locator(".actionbar").first();
await actionbar.screenshot({ path: join(SHOTS, `${TAG}-05-actions.png`) });

// 切专注模式
if (WITH_FOCUS) {
  await page.keyboard.press("F11");
  await page.waitForTimeout(500);  // 等过渡
  await page.screenshot({ path: join(SHOTS, `${TAG}-06-focus.png`), fullPage: false });
}

await browser.close();
console.log(`OK: ${TAG} screenshots done`);
