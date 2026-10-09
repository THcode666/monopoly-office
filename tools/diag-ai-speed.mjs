// AI 速度诊断：直接测 phase/turn 推进的真实耗时，定位卡点
import { chromium } from "playwright";
const URL = process.argv[2] || "http://127.0.0.1:8901/";
const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));

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

// 直接在页面里驱动：不用 UI 点击，纯测状态机推进速度
const result = await page.evaluate(async () => {
  const g = window.__game;
  const log = [];
  const t0 = performance.now();
  let lastTurn = g.state.meta.turn;
  let lastSeat = g.state.meta.currentSeat;

  // 观察 8 秒内状态推进情况，每 200ms 采样一次
  const samples = [];
  const iv = setInterval(() => {
    samples.push({
      t: Math.round(performance.now() - t0),
      turn: g.state.meta.turn,
      seat: g.state.meta.currentSeat,
      phase: g.state.meta.phase,
      hasModal: !!g.state.pending.modal,
      modalKind: g.state.pending?.modal?.kind,
      queue: g.queue ? g.queue.length : null,
      aiRunning: !!g.aiRunning,
      anim: g.board.anim.size,
    });
  }, 200);

  await new Promise((r) => setTimeout(r, 8000));
  clearInterval(iv);

  // 分析：有多少采样点状态没变（= 卡住）
  let stuck = 0;
  let prev = null;
  for (const s of samples) {
    const sig = `${s.turn}/${s.seat}/${s.phase}/${s.hasModal}`;
    if (sig === prev) stuck++;
    prev = sig;
  }
  return {
    total: Math.round(performance.now() - t0),
    samples: samples.length,
    stuck,
    stuckPct: Math.round(stuck / samples.length * 100),
    final: samples[samples.length - 1],
    timeline: samples.filter((_, i) => i % 3 === 0),
  };
});

console.log(JSON.stringify(result, null, 2));
await browser.close();