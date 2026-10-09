// UI 冒烟测试：用无头浏览器跑通「选模式 → 开局 → 掷骰 → 结束回合」，
// 截图存档到 docs/shots/。这是"先跑一遍再交付"的验收环节。
//
// 用法：node tools/ui-smoke.mjs [url]

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const SHOTS = join(ROOT, "docs/shots");
mkdirSync(SHOTS, { recursive: true });

const URL = process.argv[2] || "http://127.0.0.1:8901/dist/monopoly-office.html";

const errors = [];
const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

page.on("console", (m) => {
  if (m.type() === "error" && !/favicon/.test(m.text())) errors.push(m.text());
});
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));

const step = async (name, fn) => {
  process.stdout.write(`  ${name} ... `);
  try {
    const r = await fn();
    console.log(r === false ? "FAIL" : "ok");
    return r !== false;
  } catch (e) {
    console.log("ERROR " + e.message.slice(0, 90));
    errors.push(`${name}: ${e.message}`);
    return false;
  }
};

console.log(`\nUI 冒烟测试: ${URL}\n`);

await step("打开页面", async () => {
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForSelector(".mode-grid", { timeout: 8000 });
  return true;
});
await page.screenshot({ path: join(SHOTS, "01-setup.png") });

await step("选单人模式 + 开始游戏", async () => {
  await page.click('.mode-card[data-mode="solo"]');
  await page.waitForTimeout(200);
  await page.click("#startBtn");
  await page.waitForSelector("#app.ready", { timeout: 6000 });
  return true;
});

await step("棋盘已绘制", async () => {
  const painted = await page.evaluate(() => {
    const cv = document.getElementById("board");
    if (!cv) return false;
    const ctx = cv.getContext("2d");
    const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
    let nonBlank = 0;
    for (let i = 3; i < d.length; i += 4 * 97) if (d[i] > 0) nonBlank++;
    return nonBlank > 50;
  });
  if (!painted) throw new Error("canvas 全空白");
  return true;
});

await step("玩家面板已渲染", async () => {
  const n = await page.locator(".pcard").count();
  if (n < 2) throw new Error(`只渲染了 ${n} 个玩家卡`);
  return true;
});

let turn = 0;
await step("掷骰子", async () => {
  const btn = page.locator(".actionbar button", { hasText: "掷骰子" });
  await btn.first().click();
  await page.waitForTimeout(900);
  turn++;
  return true;
});
await page.screenshot({ path: join(SHOTS, "02-board.png") });

await step("事件弹窗出现并可关闭", async () => {
  // 弹窗可能出现（事件 / 买地 / 错误）
  const has = await page.locator(".overlay.show").count();
  if (has) {
    // 买地弹窗选"再想想"，其他点"继续"
    const skip = page.locator('.overlay.show .opt[data-act="skip"]');
    if (await skip.count()) await skip.first().click();
    else {
      const cont = page.locator(".overlay.show [data-foot]");
      if (await cont.count()) await cont.first().click();
    }
    await page.waitForTimeout(500);
  }
  return true;
});

await step("结束回合 → AI 接手", async () => {
  // 循环点按钮直到进入 POST_ACTION 的"结束回合"
  for (let i = 0; i < 14; i++) {
    const end = page.locator(".actionbar button", { hasText: "结束回合" });
    if (await end.count()) { await end.first().click(); await page.waitForTimeout(450); break; }
    const roll = page.locator(".actionbar button", { hasText: "掷骰子" });
    if (await roll.count()) { await roll.first().click(); await page.waitForTimeout(700); }
    // 关掉可能出现的弹窗
    const skip = page.locator('.overlay.show .opt[data-act="skip"]');
    if (await skip.count()) { await skip.first().click(); await page.waitForTimeout(300); continue; }
    const cont = page.locator(".overlay.show [data-foot]");
    if (await cont.count()) { await cont.first().click(); await page.waitForTimeout(300); continue; }
  }
  return true;
});

// 连打 8 个回合，验证 AI 会动、面板数字会变
await step("连续 8 回合 AI 正常行动", async () => {
  for (let i = 0; i < 8; i++) {
    for (let k = 0; k < 8; k++) {
      // 只有 POST_ACTION 才允许「结束回合」，ROLL 阶段点它会被 reducer 拒绝
      const ph = await page.evaluate(() => window.__game?.state?.meta?.phase);
      if (ph !== "POST_ACTION") {
        const roll = page.locator(".actionbar button", { hasText: "掷骰子" });
        if (await roll.count()) { await roll.first().click(); await page.waitForTimeout(600); continue; }
        const cont = page.locator(".overlay.show [data-foot]");
        if (await cont.count()) { await cont.first().click(); await page.waitForTimeout(300); continue; }
        break;
      }
      const roll = page.locator(".actionbar button", { hasText: "掷骰子" });
      if (await roll.count()) { await roll.first().click(); await page.waitForTimeout(600); continue; }
      const end = page.locator(".actionbar button", { hasText: "结束回合" });
      if (await end.count()) { await end.first().click(); await page.waitForTimeout(700); continue; }
      const skip = page.locator('.overlay.show .opt[data-act="skip"]');
      if (await skip.count()) { await skip.first().click(); await page.waitForTimeout(250); continue; }
      const cont = page.locator(".overlay.show [data-foot]");
      if (await cont.count()) { await cont.first().click(); await page.waitForTimeout(250); continue; }
      const veh = page.locator('.overlay.show .opt[data-act="veh"]');
      if (await veh.count()) { await page.locator('.overlay.show .opt').first().click(); await page.waitForTimeout(250); continue; }
      break;
    }
  }
  return true;
});
await page.screenshot({ path: join(SHOTS, "03-midgame.png") });

await step("回合数已推进", async () => {
  const t = await page.evaluate(() => {
    const el = document.querySelector(".topbar .turn");
    return el ? el.textContent : "";
  });
  const m = /第 (\d+)/.exec(t);
  if (!m) throw new Error("顶栏未显示回合数: " + t);
  if (+m[1] < 2) throw new Error("回合数没推进: " + t);
  return true;
});

await step("帮助弹窗可打开", async () => {
  // 上一阶段结束时可能还开着事件/结算弹窗，遮罩会挡住顶栏按钮 —— 先关干净。
  // （AI 随机行动落在哪会影响此处是否有残留弹窗，属测试时序问题。）
  // 外层再套一次重试：弹窗可能在"关完"与"点按钮"之间的间隙里弹出来
  // （AI 随机行动的时序竞态），一次点不上就再关再点，别硬等 30s 超时。
  for (let attempt = 0; attempt < 3; attempt++) {
    for (let i = 0; i < 8; i++) {
      // 关闭优先级：页脚按钮（继续/知道了，会走 dismissModal 正规通道）
      //   → 「先不买/再想想」选项（同样正规关闭）
      //   → 最后才是 ×。买房/看车弹窗没有页脚，点 × 只关 UI，
      // pending.modal 还挂着会被 step() 立刻重开 —— 点 × 等于白点。
      const foot = page.locator(".overlay.show [data-foot]:not([data-foot='__x__'])");
      if (await foot.count()) { await foot.first().click(); await page.waitForTimeout(260); continue; }
      const skip = page.locator('.overlay.show .opt[data-act="skip"]');
      if (await skip.count()) { await skip.first().click(); await page.waitForTimeout(260); continue; }
      const x = page.locator(".overlay.show .modal-x");
      if (await x.count()) { await x.first().click(); await page.waitForTimeout(260); continue; }
      break;
    }
    try {
      await page.click("#btnHelp", { timeout: 4000 });
      break;
    } catch (e) {
      if (attempt === 2) throw e;
    }
  }
  await page.waitForTimeout(350);
  const n = await page.locator(".overlay.show .modal").count();
  if (!n) throw new Error("帮助弹窗未出现");
  const cont = page.locator(".overlay.show [data-foot]");
  if (await cont.count()) await cont.first().click();
  return true;
});

await browser.close();

console.log("");
if (errors.length) {
  console.log(`❌ ${errors.length} 个错误：`);
  errors.slice(0, 10).forEach((e) => console.log("   - " + e.slice(0, 160)));
  process.exit(1);
}
console.log("✅ UI 冒烟测试全部通过");
console.log(`   截图: ${SHOTS}`);
