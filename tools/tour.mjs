// 完整游戏截图脚本：从开局到专注模式 5 张关键截图
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHOTS = join(__dirname, "../docs/shots");
mkdirSync(SHOTS, { recursive: true });

const URL = process.argv[2] || "http://127.0.0.1:8901/";
const TAG = process.argv[3] || "tour";
const browser = await chromium.launch({ channel: "msedge" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));

// 清旧 localStorage，再进
await page.goto(URL, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(2000);

// 1) 开局面板
await page.waitForSelector(".mode-grid", { timeout: 12000 });
await page.screenshot({ path: join(SHOTS, `${TAG}-1-setup.png`), fullPage: false });

// 2) 进游戏 - 单人 + 4 AI
await page.click('.mode-card[data-mode="solo"]');
await page.waitForTimeout(200);
await page.click("#startBtn");
await page.waitForSelector("#app.ready", { timeout: 8000 });
await page.waitForTimeout(1200);  // 等棋盘画完
await page.screenshot({ path: join(SHOTS, `${TAG}-2-board.png`), fullPage: false });

// 3) 玩家面板特写
const side = page.locator(".side").first();
await side.screenshot({ path: join(SHOTS, `${TAG}-3-panel.png`) });

// 4) 道具栏 + 棋盘左下特写
const inv = page.locator("#inventory").first();
await inv.screenshot({ path: join(SHOTS, `${TAG}-4-inventory.png`) });

// 5) 顶栏特写
const top = page.locator("#topbar").first();
await top.screenshot({ path: join(SHOTS, `${TAG}-5-topbar.png`) });

// 6) 专注模式
await page.keyboard.press("F11");
await page.waitForTimeout(600);
await page.screenshot({ path: join(SHOTS, `${TAG}-6-focus.png`), fullPage: false });
await page.keyboard.press("Escape");  // 退出

// 7) 弹窗——掷骰子，事件弹窗
await page.waitForTimeout(400);
await page.locator(".actionbar button", { hasText: "掷骰子" }).first().click();
await page.waitForTimeout(2200);  // 等摇骰动画
// 关掉任何弹窗
let tries = 0;
while (await page.locator(".overlay.show [data-foot]").count() > 0 && tries < 5) {
  await page.locator(".overlay.show [data-foot]").first().click();
  await page.waitForTimeout(600);
  tries++;
}
await page.screenshot({ path: join(SHOTS, `${TAG}-7-after-roll.png`), fullPage: false });

// 8) 帮助按钮
await page.click("#btnHelp");
await page.waitForTimeout(600);
await page.screenshot({ path: join(SHOTS, `${TAG}-8-help.png`), fullPage: false });
await page.locator(".overlay.show [data-foot]").first().click();
await page.waitForTimeout(400);

// 9) 设置面板
await page.click("#btnSettings");
await page.waitForTimeout(600);
await page.screenshot({ path: join(SHOTS, `${TAG}-9-settings.png`), fullPage: false });
await page.locator(".overlay.show [data-foot]").last().click();
await page.waitForTimeout(400);

await browser.close();
console.log(`OK: ${TAG} screenshots done`);
