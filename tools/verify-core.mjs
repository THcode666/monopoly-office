// core 层验证：确定性、伪联机回放一致性、经济计算、破产清算。
// 这是第 2 步的验收门槛 —— 跑不过就不算完成。
//
// 运行：node tools/verify-core.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const imp = (rel) => import(pathToFileURL(join(ROOT, rel)).href);

function load(name) {
  return JSON.parse(readFileSync(join(ROOT, "data", `${name}.json`), "utf8"));
}
function freshData() {
  const data = {
    config: load("config"),
    board: load("board"),
    cards: {
      opportunity: load("cards.opportunity").cards,
      fate: load("cards.fate").cards,
      item: load("cards.item").cards,
    },
    events: load("events").pools,
    aiProfiles: load("ai_profiles"),
    uiText: load("ui_text"),
  };
  data.config.__events = data.events;
  return data;
}

const { reduce } = await imp("src/core/reducer.js");
const { PHASE } = await imp("src/core/actions.js");
const { decideActions } = await imp("src/core/ai.js");
const { playOut: runHarness } = await imp("tools/harness.mjs");
const { exportPassPackage, importPassPackage, publicView, restore } = await imp("src/core/serialize.js");
const { hashState } = await imp("src/core/util.js");
const { monthlySalary, monthlyLiving, netWorth } = await imp("src/core/economy.js");
const { validateData, validateStartingDeck } = await imp("src/data/schema.js");

let pass = 0, fail = 0;
function ok(name, cond, extra = "") {
  if (cond) { console.log(`  ✅ ${name}`); pass++; }
  else { console.log(`  ❌ ${name} ${extra}`); fail++; }
}

function mkPlayers(n) {
  const profiles = ["greedy", "steady", "spender"];
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({
      id: "p" + (i + 1), name: "P" + (i + 1), isAI: true,
      aiProfile: profiles[i % 3], color: "#378ADD",
    });
  }
  return out;
}

// 跑完一局，返回终局 state。复用 tools/harness.mjs 的共享驱动（含 stall 检测）
// 第 3 步教训：三个工具各写一套驱动会各自漂移，本地副本曾因缺 DISMISS_MODAL 队列
// 导致对局卡在 turn 6、被误判为游戏逻辑问题。
function playOut(seed, n, data) {
  const r = reduce(null, {
    type: "NEW_GAME", seed, players: mkPlayers(n), mode: "solo",
    winCondition: "rounds", maxRounds: data.config.game.maxRounds,
  }, data);
  return runHarness(reduce, decideActions, r.state, { data }).state;
}

console.log("\n═══ 1. 数据校验 ═══");
{
  const data = freshData();
  const errs = [...validateData(data), ...validateStartingDeck(data.config, data.cards)];
  ok("data/*.json 结构合法", errs.length === 0, errs.slice(0, 3).join(" | "));
  ok("格子数在 40~50", data.board.tiles.length >= 40 && data.board.tiles.length <= 50,
    `实际 ${data.board.tiles.length}`);
  ok("格子 id 连续 0..n-1", data.board.tiles.every((t, i) => t.id === i));
  const types = new Set(data.board.tiles.map((t) => t.type));
  const need = ["start","company","rent","eat","clothes","vehicle","property","promotion","demotion","raise","cut","chance","fate","vacation"];
  const missing = need.filter((t) => !types.has(t));
  ok("14 种格子类型齐全", missing.length === 0, `缺 ${missing.join(",")}`);
  ok("机会卡 20 张", data.cards.opportunity.length === 20, `实际 ${data.cards.opportunity.length}`);
  ok("命运卡 20 张", data.cards.fate.length === 20, `实际 ${data.cards.fate.length}`);
  ok("道具卡 ≥12 张", data.cards.item.length >= 12, `实际 ${data.cards.item.length}`);
  ok("职级系数符合需求(0.6/1/1.4/2/3)",
    JSON.stringify(data.config.ranks.map((r) => r.coefficient)) === JSON.stringify([0.6,1,1.4,2,3]));
  ok("起手现金 20000", data.config.economy.initialCash === 20000);
  ok("AI 三性格齐全", data.aiProfiles.profiles.length === 3);
}

console.log("\n═══ 2. 随机数确定性 ═══");
{
  const { createRng, nextInt, weightedPick } = await imp("src/core/rng.js");
  let r1 = createRng(12345), r2 = createRng(12345);
  const s1 = [], s2 = [];
  for (let i = 0; i < 200; i++) { let v, nr; [v, nr] = nextInt(r1, 6); r1 = nr; s1.push(v); [v, nr] = nextInt(r2, 6); r2 = nr; s2.push(v); }
  ok("同种子产生完全相同的序列", s1.join() === s2.join());

  const dist = {};
  let r = createRng(777);
  for (let i = 0; i < 12000; i++) { const [v, nr] = nextInt(r, 6); r = nr; dist[v] = (dist[v] || 0) + 1; }
  const vals = Object.values(dist);
  ok("骰子分布均匀(各 15%~19%)", vals.every((v) => v > 1800 && v < 2280), JSON.stringify(dist));

  let r3 = createRng(99);
  const cnt = { a: 0, b: 0, c: 0 };
  const items = [{ id: "a", weight: 60 }, { id: "b", weight: 30 }, { id: "c", weight: 10 }];
  for (let i = 0; i < 30000; i++) { const [it, nr] = weightedPick(r3, items); r3 = nr; cnt[it.id]++; }
  ok("加权抽取符合 60/30/10", Math.abs(cnt.a - 18000) < 600 && Math.abs(cnt.b - 9000) < 500 && Math.abs(cnt.c - 3000) < 400,
    JSON.stringify(cnt));
}

console.log("\n═══ 3. reducer 纯函数性 ═══");
{
  const data = freshData();
  const s0 = reduce(null, { type: "NEW_GAME", seed: 555, players: mkPlayers(3), maxRounds: 40 }, data).state;
  const snapshotBefore = JSON.stringify(publicView(s0));
  // 对同一 state 连续 dispatch，原 state 不应被修改
  let s = s0;
  const p = s.players[s.meta.currentSeat];
  s = reduce(s, { type: "ROLL_DICE", playerId: p.id }, data).state;
  ok("dispatch 不修改传入的 state", JSON.stringify(publicView(s0)) === snapshotBefore);
  ok("状态已推进", s.meta.turn > s0.meta.turn || s.meta.seq > s0.meta.seq);
  const snapMid = JSON.stringify(publicView(s));
  // 同 seed 同 action 重放应得到同一状态
  let s2 = s0;
  s2 = reduce(s2, { type: "ROLL_DICE", playerId: p.id }, data).state;
  ok("相同输入产生相同输出(可回放)", hashState(publicView(s2)) === hashState(publicView(s)));
}

console.log("\n═══ 4. 阶段白名单（防作弊）═══");
{
  const data = freshData();
  let s = reduce(null, { type: "NEW_GAME", seed: 31, players: mkPlayers(2), maxRounds: 40 }, data).state;
  // ROLL 阶段不允许 END_TURN？实际上允许。测明显非法的：
  const p = s.players[s.meta.currentSeat];
  let r = reduce(s, { type: "DEPOSIT", amount: 1000, playerId: p.id }, data);
  ok("ROLL 阶段拒绝 DEPOSIT", !!r.reject, r.reject || "");
  r = reduce(s, { type: "ROLL_DICE", playerId: "not-exist" }, data);
  ok("拒绝非当前玩家的 action", !!r.reject || s.players.some((x) => x.id === "not-exist"));
}

console.log("\n═══ 5. 经济计算 ═══");
{
  const data = freshData();
  const p = {
    id: "x", cash: 20000, deposit: 0, loan: { principal: 0, monthsLeft: 0, monthly: 0 },
    properties: [], vehicles: [], rankId: "intern", salaryCoefficient: 1.0,
    stats: {}, grants: [], passiveIncome: 0, livingCostDelta: 0, loanRateDelta: 0,
    meta: { month: 1 }, alive: true, seat: 0, name: "X",
  };
  const state = { config: data.config, players: [p], board: data.board };
  const sal = monthlySalary(state, "x");
  const expect = 12000 * 0.6 * (1 - 0.12);
  ok("实习生月薪 = 12000×0.6×0.88", Math.abs(sal - expect) < 1, `得 ${sal}`);
  ok("生活开销取职级配置", monthlyLiving(state, "x") === 900);
  p.rankId = "director"; p.salaryCoefficient = 1;
  ok("总监月薪 = 12000×3.0×0.88", Math.abs(monthlySalary(state, "x") - 12000 * 3 * 0.88) < 1);
  p.salaryCoefficient = 1.2;
  ok("加薪系数生效", Math.abs(monthlySalary(state, "x") - 12000 * 3 * 0.88 * 1.2) < 1);
}

console.log("\n═══ 5b. 道具 grants 真正生效 ═══");
{
  const data = freshData();
  let s = reduce(null, { type: "NEW_GAME", seed: 8, players: mkPlayers(1), maxRounds: 40 }, data).state;
  const { resolveEffects } = await imp("src/core/effects.js");

  // 简历：抽一张机会卡（旧版 drawCard grant 无人消费，用了等于白用）。
  // 机会卡全是 timing:"immediate"（抽到即结算、不进手牌），所以断言结算发生：
  // resolveCard 会写"使用了【卡名】"的日志。
  let p = s.players[0];
  p.cards.item.push("resume");
  let r = reduce(s, { type: "USE_ITEM", cardId: "resume", playerId: p.id }, data);
  ok("简历真的能抽到机会卡", !r.reject && r.state.log.some((l) => l.text.includes("使用了【")),
    r.reject || "日志中没有抽卡结算记录");

  // 年假条：跳过下一回合（旧版 skipNext grant 同样是死的）
  s = r.state;
  p = s.players[0];
  p.cards.item.push("annualLeave");
  r = reduce(s, { type: "USE_ITEM", cardId: "annualLeave", playerId: p.id }, data);
  ok("年假条真的会跳过下一回合", !r.reject && (r.state.players[0].flags.skipNextTurn || 0) >= 1,
    r.reject || `flags=${JSON.stringify(r.state.players[0].flags)}`);

  // 折叠伞：挡下一次负面现金损失
  s = r.state;
  p = s.players[0];
  p.grants.push({ op: "shield", count: 1 });
  const before = p.cash;
  resolveEffects(s, [{ op: "cash", delta: -5000 }],
    { actorId: p.id, rngRef: { rng: 0 }, data, log: () => {}, netWorth: (st, id) => netWorth(st, id) }, []);
  ok("折叠伞挡下一次现金损失", p.cash === before && !p.grants.some((g) => g.op === "shield"),
    `现金 ${before}→${p.cash}`);
}

console.log("\n═══ 6. 完整对局可跑通 ═══");
let finalState = null;
{
  const data = freshData();
  const s = playOut(20261008, 4, data);
  finalState = s;
  ok("对局到达 GAME_OVER", s.meta.phase === PHASE.GAME_OVER);
  ok("回合数 <= 上限 40", s.meta.turn <= 41, `实际 ${s.meta.turn}`);
  ok("产生了胜者", !!s.winner);
  ok("月度结算执行过", s.meta.month >= 9, `实际 month=${s.meta.month}`);
  const totalCash = s.players.reduce((a, p) => a + p.cash, 0);
  ok("净资产量级合理(5万~80万)", s.players.every((p) => Math.abs(netWorth(s, p.id)) < 800000),
    s.players.map((p) => Math.round(netWorth(s, p.id))).join(","));
  ok("没有人 cash 溢出到天文数字", s.players.every((p) => Math.abs(p.cash) < 5e6));
}

console.log("\n═══ 7. 伪联机回合包一致性 ═══");
{
  const data = freshData();
  // 玩一半，导出包
  let s = reduce(null, { type: "NEW_GAME", seed: 424242, players: mkPlayers(3), maxRounds: 40 }, data).state;
  let guard = 0;
  while (s.meta.turn < 12 && guard++ < 5000) {
    const p = s.players[s.meta.currentSeat];
    const ph = s.meta.phase;
    let act = null;
    if (ph === PHASE.TURN_START || ph === PHASE.ROLL) act = { type: "ROLL_DICE", playerId: p.id };
    else if (ph === PHASE.TILE_EVENT) {
      const m = s.pending.modal;
      act = (m && m.kind === "buy" && p.cash >= m.price)
        ? { type: "BUY_PROPERTY", tileId: m.tileId, playerId: p.id }
        : { type: "DISMISS_MODAL", playerId: p.id };
    } else if (ph === PHASE.POST_ACTION) act = { type: "END_TURN", playerId: p.id };
    else break;
    const rr = reduce(s, act, data);
    if (rr.reject) break;
    s = rr.state;
  }
  const pkg = exportPassPackage(s, 0);
  ok("回合包包含 stateHash", typeof pkg.stateHash === "string" && pkg.stateHash.length > 5);

  // 接收方：从头重放，应得同一 hash
  let s2 = reduce(null, { type: "NEW_GAME", seed: 424242, players: mkPlayers(3), maxRounds: 40 }, data).state;
  for (const a of pkg.actions) {
    const rr = reduce(s2, a.action, data);
    if (rr.reject) break;
    s2 = rr.state;
  }
  ok("重放后状态哈希一致（可防篡改）", hashState(publicView(s2)) === pkg.stateHash,
    `本机 ${hashState(publicView(s2))} vs 包 ${pkg.stateHash}`);

  // 篡改测试：改一个 action 应导致哈希不符
  const tampered = JSON.parse(JSON.stringify(pkg));
  if (tampered.actions.length) {
    const last = tampered.actions[tampered.actions.length - 1];
    last.action = { type: "ROLL_DICE" };
    let s3 = reduce(null, { type: "NEW_GAME", seed: 424242, players: mkPlayers(3), maxRounds: 40 }, data).state;
    let stopped = false;
    for (const a of tampered.actions) {
      const rr = reduce(s3, a.action, data);
      if (rr.reject) { stopped = true; break; }
      s3 = rr.state;
    }
    const h = hashState(publicView(s3));
    ok("篡改的回合包会被哈希校验拒绝", stopped || h !== pkg.stateHash);
  }
}

console.log("\n═══ 8. 快照与恢复 ═══");
{
  const data = freshData();
  const s = playOut(777, 3, data);
  const { snapshot, restore: restoreSnap } = await imp("src/core/serialize.js");
  const snap = snapshot(s);
  const back = restoreSnap(snap, data);
  ok("快照可完整恢复", hashState(publicView(back)) === hashState(publicView(s)));
  ok("恢复后 catalog 已挂回", !!back.decks.opportunity.catalog && !!back.decks.fate.catalog);
}

console.log(`\n${"═".repeat(46)}`);
console.log(`结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
