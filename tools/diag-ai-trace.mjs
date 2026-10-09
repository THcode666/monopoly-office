// AI 三轮耗时诊断：逐采样看状态在哪一步停住
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

// 人类掷骰，然后采样 AI 阶段
const rb = page.locator(".actionbar button", { hasText: "掷骰子" });
if (await rb.count()) await rb.first().click();
await page.waitForTimeout(400);
// 清人类弹窗 —— ★ buy 弹窗是 [data-act]，事件弹窗是 [data-foot]，两种都要点
for (let k = 0; k < 30; k++) {
  const act = page.locator(".overlay.show [data-act]");
  if (await act.count()) { await act.first().click(); await page.waitForTimeout(150); continue; }
  const f = page.locator(".overlay.show [data-foot]");
  if (await f.count()) { await f.first().click(); await page.waitForTimeout(150); continue; }
  break;
}
// 点结束回合，把控制权交给 AI —— 采样从这里开始
const et = page.locator(".actionbar button", { hasText: "结束回合" });
if (await et.count()) {
  await et.first().click();
  console.log("→ 已点结束回合，AI 接手");
} else {
  console.log("→ 找不到结束回合按钮！当前 actionbar:", await page.locator(".actionbar").first().innerText());
}

const samples = await page.evaluate(async () => {
  const g = window.__game;
  const out = [];
  const errs = [];
  // 把 setTimeout 包一层，抓异步回调里的异常
  window.addEventListener("error", (e) => errs.push(e.message + " @ " + e.filename + ":" + e.lineno));
  window.addEventListener("unhandledrejection", (e) => errs.push("rej: " + e.reason));

  const t0 = performance.now();
  const iv = setInterval(() => {
    const cur = g.state.players[g.state.meta.currentSeat];
    out.push({
      t: Math.round(performance.now() - t0),
      seat: g.state.meta.currentSeat,
      ai: cur?.isAI ? 1 : 0,
      who: cur?.name?.slice(0, 4),
      phase: g.state.meta.phase,
      modal: g.state.pending?.modal?.kind || null,
      q: g.queue ? g.queue.length : null,
      run: g.aiRunning ? 1 : 0,
      anim: g.board.anim.size,
      dice: g.board.dice ? 1 : 0,
    });
  }, 100);
  await new Promise((r) => setTimeout(r, 6000));
  clearInterval(iv);
  return { out, errs };
});

if (samples.errs.length) {
  console.log("★ 捕获到 JS 异常:");
  for (const e of samples.errs.slice(0, 5)) console.log("   ", e);
}
const samples2 = samples.out;

// 只打变化点
let prev = null;
console.log("时间(ms)  座位 AI 玩家   phase     modal   q run anim dice");
for (const s of samples2) {
  const sig = `${s.seat}|${s.phase}|${s.modal}|${s.q}|${s.run}|${s.anim}|${s.dice}`;
  if (sig !== prev) {
    console.log(
      String(s.t).padStart(6),
      String(s.seat).padStart(5),
      String(s.ai).padStart(3),
      (s.who || "").padStart(6),
      s.phase.padEnd(9),
      String(s.modal || "-").padEnd(8),
      String(s.q ?? "-").padStart(2),
      String(s.run).padStart(3),
      String(s.anim).padStart(4),
      String(s.dice).padStart(4),
    );
    prev = sig;
  }
}
await page.waitForTimeout(1500);
// ★ 直接测：给 setTimeout 打补丁，追踪 AI 定时器回调到底有没有执行
const probe = await page.evaluate(async () => {
  const g = window.__game;
  const log = [];
  const origST = window.setTimeout;
  let aiTimerCount = 0, aiTimerFired = 0;
  window.setTimeout = function (fn, ms, ...args) {
    if (ms === 16 || ms === 90) {
      aiTimerCount++;
      const id = aiTimerCount;
      return origST(function () {
        aiTimerFired++;
        try { return fn.apply(this, args); }
        finally { log.push(`timer#${id} fired, aiRunning now=${g.aiRunning}`); }
      }, ms);
    }
    return origST(fn, ms, ...args);
  };
  // 强制解锁让它重新起一个定时器
  g.aiRunning = false;
  await new Promise((r) => origST(r, 500));
  log.push(`AI 定时器: 创建 ${aiTimerCount} 个, 触发 ${aiTimerFired} 个`);
  log.push(`最终状态: seat=${g.state.meta.currentSeat} phase=${g.state.meta.phase} aiRunning=${g.aiRunning}`);
  window.setTimeout = origST;
  return log;
});
console.log("★ 定时器探针:");
for (const l of probe) console.log("   ", l);

await browser.close();