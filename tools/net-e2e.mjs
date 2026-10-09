// 联机端到端测试：热座模式 + 伪联机回合包导出/导入。
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const SHOTS = join(ROOT, "docs/shots");
mkdirSync(SHOTS, { recursive: true });

const URL = "http://127.0.0.1:8901/dist/monopoly-office.html";
const errors = [];
const ok = (c, m) => { console.log(`  ${c ? "ok  " : "FAIL"} ${m}`); if (!c) errors.push(m); };

const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));

// ── 1. 热座模式 4 人 ──
console.log("\n[1] 本地热座 4 人");
await page.goto(URL);
await page.waitForSelector(".mode-grid");
await page.click('.mode-card[data-mode="hotseat"]');
await page.waitForTimeout(200);
await page.click('#countSeg button[data-n="4"]');
await page.waitForTimeout(200);

const cnt = await page.evaluate(() => {
  const g = window.__game;
  return document.querySelectorAll('[data-pick]').length;
});
ok(cnt === 3, `热座设置面板渲染 ${cnt} 个其他玩家输入框（期望 3）`);

await page.click("#startBtn");
await page.waitForSelector("#app.ready");
await page.waitForTimeout(500);

const nPlayers = await page.locator(".pcard").count();
ok(nPlayers === 4, `玩家卡数量 ${nPlayers}（期望 4）`);

const allHuman = await page.evaluate(() =>
  window.__game.state.players.every((p) => !p.isAI)
);
ok(allHuman, "全部为人类玩家（无 AI）");

// 交接提示
const handoff = await page.locator(".overlay.show .modal-title").textContent().catch(() => "");
ok(/交给下一位/.test(handoff || ""), `轮到自己时不弹交接提示（${handoff}）`);

// 点掉交接提示并掷骰
const go = page.locator(".overlay.show [data-foot]");
if (await go.count()) await go.first().click();
await page.waitForTimeout(400);
const rollBtn = page.locator(".actionbar button", { hasText: "掷骰子" });
ok(await rollBtn.count() > 0, "操作区出现掷骰子按钮");
await rollBtn.first().click();
await page.waitForTimeout(1000);

// 下一位玩家应出现交接提示
const modalShown = await page.locator(".overlay.show").count();
const phaseAfter = await page.evaluate(() => window.__game.state.meta.phase);
ok(modalShown > 0 || phaseAfter === "TILE_EVENT",
  `落位后进入事件弹窗或等待（phase=${phaseAfter}）`);
await page.screenshot({ path: join(SHOTS, "04-hotseat.png") });

// ── 2. 伪联机：导出回合包 ──
console.log("\n[2] 局域网模式 · 回合包导出");
await page.goto(URL);
await page.waitForSelector(".mode-grid");
await page.click('.mode-card[data-mode="lan"]');
await page.waitForTimeout(300);
const roomShown = await page.locator("#roomId").inputValue().catch(() => "");
ok(/^[A-Z2-9]{4}$/.test(roomShown || ""), `自动生成 4 位房号：${roomShown}`);
await page.click("#startBtn");
await page.waitForSelector("#app.ready");
await page.waitForTimeout(600);
// 热座交接弹窗会挡按钮，先关掉
const foot = page.locator(".overlay.show [data-foot]");
if (await foot.count()) await foot.first().click();
await page.waitForTimeout(300);

const hasExport = await page.locator("#btnExport").count();
const hasImport = await page.locator("#btnImport").count();
ok(hasExport > 0, "顶栏有「导出回合包」按钮");
ok(hasImport > 0, "顶栏有「导入回合包」按钮");

// 打开导出弹窗，验证内容与状态哈希
await page.click("#btnExport");
await page.waitForTimeout(400);
const pkgInfo = await page.evaluate(() => {
  const g = window.__game;
  const s = g.state;
  // 直接调 exportPassPackage 拿数据
  return { turn: s.meta.turn, seq: s.meta.seq, modalTitle: document.querySelector(".modal-title")?.textContent };
});
ok(/回合包/.test(pkgInfo.modalTitle || ""), `导出弹窗标题：${pkgInfo.modalTitle}`);
await page.screenshot({ path: join(SHOTS, "05-passexport.png") });

// 拿到包内容并测试重放一致性
const replay = await page.evaluate(async () => {
  const g = window.__game;
  const mod = window.__serialize, red = window.__reduce;
  const pkg = mod.exportPassPackage(g.state, 0);
  const fresh = red(null, {
    type: "NEW_GAME", seed: g.state.meta.seed,
    players: g.state.players.map((p) => ({
      id: p.id, name: p.name, avatar: p.avatar, color: p.color,
      isAI: p.isAI, aiProfile: p.aiProfile,
    })),
    mode: g.state.meta.mode, winCondition: g.state.meta.winCondition,
    maxRounds: g.state.meta.maxRounds,
  }, g.data).state;
  const r = mod.importPassPackage(pkg, fresh, g.data, red.reduce);
  return { ok: r.ok, reason: r.reason || "", hash: pkg.stateHash, actions: pkg.actions.length };
});
ok(replay.ok, `回合包重放校验通过（${replay.actions} 个 action，哈希 ${replay.hash}）`);

// 篡改测试
const tamper = await page.evaluate(async () => {
  const g = window.__game;
  const mod = window.__serialize, red = window.__reduce;
  const pkg = mod.exportPassPackage(g.state, 0);
  const before = mod.exportPassPackage(g.state, 0);
  // 改一个数字
  const txt = JSON.stringify(pkg);
  const bad = JSON.parse(txt);
  bad.stateHash = "fnv1a-deadbeef";
  const fresh = red(null, {
    type: "NEW_GAME", seed: g.state.meta.seed,
    players: g.state.players.map((p) => ({ id: p.id, name: p.name, isAI: p.isAI, aiProfile: p.aiProfile })),
    mode: g.state.meta.mode, maxRounds: g.state.meta.maxRounds,
  }, g.data).state;
  const r = mod.importPassPackage(bad, fresh, g.data, red.reduce);
  return { ok: r.ok, reason: r.reason || "" };
});
ok(!tamper.ok, `篡改哈希的包被拒绝：${tamper.reason.slice(0, 60)}`);

await browser.close();

console.log("");
if (errors.length) {
  console.log(`❌ ${errors.length} 个问题`);
  errors.forEach((e) => console.log("   - " + e.slice(0, 140)));
  process.exit(1);
}
console.log("✅ 联机端到端测试通过");
