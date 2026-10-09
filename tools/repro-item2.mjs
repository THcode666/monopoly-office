// 在每个 phase 下测道具：找出哪个 phase 会卡死
import { chromium } from "playwright";
const URL = process.argv[2] || "http://127.0.0.1:8901/";
const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));

await page.goto(URL, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(2000);
await page.waitForSelector(".mode-grid", { timeout: 12000 });
await page.click('.mode-card[data-mode="solo"]');
await page.click("#startBtn");
await page.waitForSelector("#app.ready", { timeout: 8000 });
await page.waitForTimeout(800);

// 推进到 POST_ACTION：掷骰 → 清弹窗
const advanced = await page.evaluate(async () => {
  const g = window.__game;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const byText = (sel, t) => [...document.querySelectorAll(sel)].find((x) => x.textContent.includes(t));
  const closeM = () => {
    const a = document.querySelector(".overlay.show [data-act]");
    if (a) { a.click(); return true; }
    const f = document.querySelector(".overlay.show [data-foot]");
    if (f) { f.click(); return true; }
    return false;
  };
  for (let i = 0; i < 100; i++) {
    const open = document.getElementById("modalLayer").classList.contains("show");
    if (open) { closeM(); await sleep(50); continue; }
    if (g.state.meta.phase === "ROLL") {
      const rb = byText(".actionbar button", "掷骰子");
      if (rb) { rb.click(); await sleep(200); continue; }
    }
    if (g.state.meta.phase === "POST_ACTION" && !g.state.pending.modal) break;
    await sleep(50);
  }
  return g.state.meta.phase;
});
console.log("推进到的 phase:", advanced);

if (advanced !== "POST_ACTION") {
  console.log("没推进到 POST_ACTION，无法测");
} else {
  // 塞道具，在 POST_ACTION 下测
  await page.evaluate(() => {
    const g = window.__game;
    g.state.players[0].cards.item = ["coffee", "slack", "umbrella"];
    g.render();
  });
  await page.waitForTimeout(200);
  console.log("道具栏槽位数:", await page.locator(".inv-slot.filled").count());

  for (const it of ["coffee", "slack", "umbrella"]) {
    const before = await page.evaluate(() => {
      const g = window.__game;
      return { phase: g.state.meta.phase, n: g.state.players[0].cards.item.length,
               modal: g.state.pending.modal?.kind || null };
    });
    const idx = await page.evaluate((id) => {
      const slots = [...document.querySelectorAll(".inv-slot.filled")];
      return slots.findIndex((s) => s.dataset.card?.includes(id));
    }, it);
    if (idx < 0) { console.log(`  ${it}: 找不到槽位`); continue; }

    await page.evaluate((i) => document.querySelectorAll(".inv-slot.filled")[i]?.click(), idx);
    await page.waitForTimeout(1500);

    const after = await page.evaluate(() => {
      const g = window.__game;
      return {
        phase: g.state.meta.phase, n: g.state.players[0].cards.item.length,
        modalOpen: document.getElementById("modalLayer").classList.contains("show"),
        modalKind: g.state.pending.modal?.kind || null,
        modalTitle: g.state.pending.modal?.title || null,
        btnCount: document.querySelectorAll(".actionbar button").length,
        toasts: [...document.querySelectorAll(".toast")].map(t => t.textContent),
      };
    });
    console.log(`  ${it}: ${before.phase}(${before.n}) → ${after.phase}(${after.n}) ` +
      `${after.n < before.n ? "已消耗" : "❌未消耗"} modal=${after.modalKind || "-"}${after.modalOpen ? "★弹窗卡住" : ""} ` +
      `btn=${after.btnCount} toast=${after.toasts.join("/") || "-"}`);
    if (after.modalOpen) {
      // 尝试点掉
      await page.evaluate(() => {
        const f = document.querySelector(".overlay.show [data-foot]") || document.querySelector(".overlay.show [data-act]");
        if (f) f.click();
      });
      await page.waitForTimeout(500);
      const still = await page.evaluate(() => document.getElementById("modalLayer").classList.contains("show"));
      console.log(`     → 尝试点掉后: ${still ? "★仍然卡住" : "已关闭"}`);
    }
  }
}

if (errs.length) {
  console.log("\n★ JS 异常:");
  for (const e of [...new Set(errs)].slice(0, 5)) console.log("   ", e);
}
await browser.close();