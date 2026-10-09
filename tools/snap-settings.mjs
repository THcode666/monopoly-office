// 设置面板截图脚本：进游戏 → 点击齿轮 → 截图
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHOTS = join(__dirname, "../docs/shots");
mkdirSync(SHOTS, { recursive: true });

const URL = process.argv[2] || "http://127.0.0.1:8901/";
const TAG = process.argv[3] || "set";

const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
page.on("console", (m) => console.log("CONSOLE:", m.type(), m.text()));

await page.goto(URL, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2000);  // 单文件应用 + esbuild bundle，需要等 JS 执行
await page.evaluate(() => {
  // 清掉任何残留 localStorage（避免上次测试干扰本次）
  localStorage.clear();
});
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(2000);

// 调试：截图看实际页面状态
await page.screenshot({ path: join(SHOTS, `${TAG}-00-debug.png`), fullPage: true });
const body = await page.evaluate(() => document.body.innerHTML.length);
const html = await page.evaluate(() => document.documentElement.outerHTML.length);
console.log(`DEBUG: html=${html} body=${body}`);
const hasGrid = await page.evaluate(() => !!document.querySelector(".mode-grid"));
console.log(`DEBUG: has mode-grid = ${hasGrid}`);

await page.waitForSelector(".mode-grid", { timeout: 12000 });
await page.click('.mode-card[data-mode="solo"]');
await page.waitForTimeout(150);
await page.click("#startBtn");
await page.waitForSelector("#app.ready", { timeout: 6000 });
await page.waitForTimeout(700);

// 1) 顶栏特写：看新加的齿轮按钮
const topbar = page.locator("#topbar").first();
await topbar.screenshot({ path: join(SHOTS, `${TAG}-01-topbar.png`) });

// 2) 完整棋盘 + 顶栏（带齿轮）
await page.screenshot({ path: join(SHOTS, `${TAG}-02-board.png`), fullPage: false });

// 3) 点齿轮，弹设置面板
await page.click("#btnSettings");
await page.waitForSelector(".overlay.show .set-wrap", { timeout: 4000 });
await page.waitForTimeout(400);
await page.screenshot({ path: join(SHOTS, `${TAG}-03-modal.png`), fullPage: false });

// 4) 改选项 - hidden checkbox 用 evaluate 直接改 + dispatch change
await page.evaluate(() => {
  const sf = document.getElementById("setSfx");
  if (sf) { sf.checked = false; sf.dispatchEvent(new Event("change")); }
  const fc = document.getElementById("setFocus");
  if (fc) { fc.checked = true; fc.dispatchEvent(new Event("change")); }
});
await page.click('.seg button[data-speed="0.5"]'); // 选慢
await page.waitForTimeout(200);
await page.screenshot({ path: join(SHOTS, `${TAG}-04-modal-changed.png`), fullPage: false });

// 5) 保存
await page.click('.overlay.show button[data-foot="save"]');
await page.waitForTimeout(400);

// 6) 验证顶栏音效图标已变 🔇
await topbar.screenshot({ path: join(SHOTS, `${TAG}-05-after-save.png`) });

await browser.close();
console.log(`OK: ${TAG} screenshots done`);
