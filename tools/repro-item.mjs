// 复现：人类回合点道具栏 → 是否卡死
import { chromium } from "playwright";
const URL = process.argv[2] || "http://127.0.0.1:8901/";
const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errs.push("console: " + m.text()); });

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

// 塞一堆道具到 p0
await page.evaluate(() => {
  const g = window.__game;
  const p = g.state.players.find((x) => !x.isAI);
  p.cards.item = ["coffee", "slack", "umbrella", "energyDrink", "mealVoucher", "annualLeave"];
  g.render();
});
await page.waitForTimeout(300);

console.log("初始状态:", JSON.stringify(await page.evaluate(() => {
  const g = window.__game;
  return {
    phase: g.state.meta.phase,
    items: g.state.players[0].cards.item.slice(),
    modal: g.state.pending.modal?.kind || null,
  };
})));

// 逐个点道具，看每次之后状态
const items = ["coffee", "slack", "umbrella", "energyDrink", "mealVoucher", "annualLeave"];
for (const it of items) {
  const before = await page.evaluate(() => {
    const g = window.__game;
    return { phase: g.state.meta.phase, n: g.state.players[0].cards.item.length, q: g.queue?.length ?? null };
  });
  // 找对应道具槽位点击
  const idx = await page.evaluate((id) => {
    const slots = [...document.querySelectorAll(".inv-slot.filled")];
    return slots.findIndex((s) => s.dataset.card?.includes(id));
  }, it);

  if (idx < 0) { console.log(`  ${it}: 槽位未找到，跳过`); continue; }
  await page.evaluate((i) => document.querySelectorAll(".inv-slot.filled")[i]?.click(), idx);
  await page.waitForTimeout(1200);

  const after = await page.evaluate(() => {
    const g = window.__game;
    const modalOpen = document.getElementById("modalLayer").classList.contains("show");
    return {
      phase: g.state.meta.phase,
      n: g.state.players[0].cards.item.length,
      q: g.queue?.length ?? null,
      modalOpen,
      modalKind: g.state.pending.modal?.kind || null,
      modalTitle: g.state.pending.modal?.title || null,
      btnCount: document.querySelectorAll(".actionbar button").length,
      toasts: [...document.querySelectorAll(".toast")].map(t => t.textContent),
    };
  });
  const consumed = after.n < before.n;
  console.log(`  ${it}: ${before.phase}(${before.n}) → ${after.phase}(${after.n})  ` +
    `${consumed ? "已消耗" : "❌未消耗"}  modal=${after.modalKind || "-"}${after.modalOpen ? "(弹窗开着!)" : ""} ` +
    `btn=${after.btnCount} q=${after.q} ${after.toasts.length ? "toast=" + after.toasts.join("/") : ""}`);

  // 如果卡死（弹窗开着但按钮点不动），强制关掉继续测
  if (after.modalOpen) {
    await page.evaluate(() => {
      const f = document.querySelector(".overlay.show [data-foot]") || document.querySelector(".overlay.show [data-act]");
      if (f) f.click();
    });
    await page.waitForTimeout(400);
  }
}

if (errs.length) {
  console.log("\n★ JS 异常:");
  for (const e of [...new Set(errs)].slice(0, 5)) console.log("   ", e);
} else {
  console.log("\n无 JS 异常");
}

await browser.close();