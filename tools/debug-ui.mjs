// 定点排查：为什么点掉弹窗后 phase 还停在 TILE_EVENT
import { chromium } from "playwright";

const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const logs = [];
page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => logs.push(`[PAGEERROR] ${e.message}\n${(e.stack || "").split("\n").slice(0, 4).join("\n")}`));

await page.goto("http://127.0.0.1:8901/dist/monopoly-office.html");
await page.waitForSelector(".mode-grid");
await page.click('.mode-card[data-mode="solo"]');
await page.click("#startBtn");
await page.waitForSelector("#app.ready");
await page.waitForTimeout(500);

const dump = async (tag) => {
  const st = await page.evaluate(() => {
    const g = window.__game;
    return g && g.state ? {
      phase: g.state.meta.phase,
      turn: g.state.meta.turn,
      seq: g.state.meta.seq,
      modal: g.state.pending.modal ? g.state.pending.modal.kind : null,
      curSeat: g.state.meta.currentSeat,
      curName: g.state.players[g.state.meta.currentSeat]?.name,
      isAI: g.state.players[g.state.meta.currentSeat]?.isAI,
      overlay: !!document.querySelector(".overlay.show"),
      footBtns: [...document.querySelectorAll(".overlay.show [data-foot]")].map((b) => b.dataset.foot),
      optBtns: [...document.querySelectorAll(".overlay.show [data-act]")].map((b) => b.dataset.act),
      actions: [...document.querySelectorAll(".actionbar button")].map((b) => b.textContent),
    } : null;
  });
  console.log(`\n--- ${tag} ---`);
  console.log(JSON.stringify(st, null, 1));
  return st;
};

await dump("开局");
await page.locator(".actionbar button", { hasText: "掷骰子" }).first().click();
await page.waitForTimeout(1200);
await dump("掷骰后");

// 点掉弹窗
const foot = page.locator(".overlay.show [data-foot]");
const opt = page.locator(".overlay.show [data-act]");
if (await foot.count()) { console.log("\n点页脚按钮:", await foot.first().textContent()); await foot.first().click(); }
else if (await opt.count()) { console.log("\n点选项按钮:", await opt.first().getAttribute("data-act")); await opt.first().click(); }
await page.waitForTimeout(800);
await dump("关弹窗后");

if (logs.length) {
  console.log("\n--- 控制台 ---");
  logs.slice(-14).forEach((l) => console.log(l.slice(0, 200)));
}
await browser.close();
