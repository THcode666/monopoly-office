// 人类行为模拟：验证破产机制（graceRounds 宽限期是否合理）。
//
// 为什么需要：AI 会自动取款/贷款，永不破产，所以模拟里破产率恒为 0。
// 这条数据对真人对局不具参考性 —— 真人会冲动消费（买车、买衣服、打命运卡），
// 会因为一张裁员卡现金流断裂。本模块在 AI 决策之上叠加"人类冲动"层。
//
// 用法：node tools/human-sim.mjs [局数] [人数]

import { loadHarness, mkProfiles, PROFILES } from "./load.mjs";

const h = await loadHarness();
const { data, reduce, netWorth } = h;
const { PHASE } = await import(
  new URL("../src/core/actions.js", import.meta.url).href
);
const { decideActions } = await import(
  new URL("../src/core/ai.js", import.meta.url).href
);

const N = parseInt(process.argv[2] || "400", 10);
const PC = parseInt(process.argv[3] || "4", 10);

// 冲动行为表：真人会干的、不理性的事
//
// 注意：这里不能借用游戏内 action 来"模拟消费" —— WITHDRAW 是把存款变现金，
// 不减少净资产，纯属没花钱。第 3 步初版就犯了这个错，导致模拟零破产、
// 破产机制完全没被验证。真正的冲动消费必须直接改现金，
// 所以这里用 __impulse 标记，让驱动层直接扣钱。
const IMPULSE = [
  // 1. 冲动买车（看到车就上，不管月供）
  { p: 0.10, run: (s, p) => {
      const t = s.board.tiles.find((x) => x.type === "vehicle");
      return !!t && p.pos === t.id && p.cash > 8000;
    },
    do: (s) => {
      const t = s.board.tiles.find((x) => x.type === "vehicle");
      const opt = t.payload.options[t.payload.options.length - 1];
      return { type: "BUY_VEHICLE", tileId: t.id, optionId: opt.id };
    } },
  // 2. 剁手（买衣服/数码，年终奖一到就花）
  { p: 0.26, run: (s, p) => p.cash > 5000,
    do: () => ({ type: "IMPULSE_SPEND", amount: 6000 + Math.floor(rnd() * 12000) }) },
  // 3. 无脑打命运卡（"搏一把"）
  { p: 0.14, run: (s, p) => p.cards.fate.length > 0 && p.cash > 15000,
    do: (s, p) => ({ type: "PLAY_CARD", cardId: p.cards.fate[0] }) },
  // 4. 请客吃饭（社交支出）
  { p: 0.16, run: (s, p) => p.cash > 3000,
    do: () => ({ type: "IMPULSE_SPEND", amount: 3000 + Math.floor(rnd() * 6000) }) },
  // 5. 正常结束回合
  { p: 0.24, run: () => true, do: () => ({ type: "END_TURN" }) },
];

// 冲动金额用的随机源（只影响模拟，不影响游戏确定性）
let rndState = 12345;
const STATS={impulse:0,impulseAmt:0,endTurn:0,postAction:0,minCash:1e9};
function rnd() {
  rndState = (rndState * 1103515245 + 12345) & 0x7fffffff;
  return rndState / 0x7fffffff;
}

// 带冲动的对局驱动
function playHuman(seed) {
  const players = mkProfiles(PC, data.board);
  const r = reduce(null, h.newGame(seed, players), data);
  let s = r.state;
  let g = 0, q = [];

  while (s.meta.phase !== PHASE.GAME_OVER && g++ < 20000) {
    const p = s.players[s.meta.currentSeat];
    if (!p) break;
    const phase = s.meta.phase;
    let act = null;

    if (q.length && q[0].__for === p.id && (q[0].__any || q[0].__phase === phase)) {
      act = q.shift();
      act.playerId = p.id;
      delete act.__for; delete act.__any; delete act.__phase;
    } else if (phase === PHASE.TURN_START || phase === PHASE.ROLL) {
      act = { type: "ROLL_DICE", playerId: p.id };
    } else if (phase === PHASE.TILE_EVENT || phase === PHASE.MOVING) {
      const acts = decideActions(s, p.id, data) || [];
      const buy = acts.find((a) => a.type === "BUY_PROPERTY" || a.type === "BUY_VEHICLE");
      act = buy ? { ...buy, playerId: p.id } : { type: "DISMISS_MODAL", playerId: p.id };
      if (buy) q = [{ type: "DISMISS_MODAL", __for: p.id, __any: true }];
    } else if (phase === PHASE.POST_ACTION) {
      // 用「累积阈值」而不是逐项独立判断：逐项 g2 < imp.p 会让冲动消费
      // 每回合触发率只有 max(p)×0.35 ≈ 9%，收入 6336 完全盖得住，
      // 模拟结果仍是零破产（初版就踩了这个坑）。
      const [f, r2] = rand(s.meta.rngState);
      s.meta.rngState = r2;
      if (f < 0.45) {
        // 从冲动池里按权重抽一个（累积阈值法）
        let acc = 0;
        const [pick, r3] = rand(s.meta.rngState);
        s.meta.rngState = r3;
        for (const imp of IMPULSE) {
          acc += imp.p;
          if (pick < acc) {
            if (imp.run(s, p)) { act = { ...imp.do(s, p), playerId: p.id }; STATS.impulse++; if(act.amount) STATS.impulseAmt+=act.amount; }
            break;
          }
        }
      }
      if (!act) {
        STATS.postAction++; STATS.minCash=Math.min(STATS.minCash,p.cash);
        const acts = decideActions(s, p.id, data) || [{ type: "END_TURN" }];
        const [first, ...rest] = acts;
        q = rest.map((a) => ({ ...a, __for: p.id, __phase: PHASE.POST_ACTION }));
        act = { ...first, playerId: p.id };
      }
    } else if ([PHASE.TURN_END, PHASE.MONTH_SETTLE, PHASE.BANKRUPT_CHECK].includes(phase)) {
      continue;
    } else break;

    const rr = reduce(s, act, data);
    if (rr.reject) break;
    s = rr.state;
    if ([PHASE.TURN_END, PHASE.MONTH_SETTLE, PHASE.BANKRUPT_CHECK].includes(s.meta.phase)) q = [];
  }
  return s;
}

function rand(rng) {
  rng = (rng + 0x6d2b79f5) >>> 0;
  let t = rng;
  t = Math.imul(t ^ (t >>> 15), 1 | t);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  const v = (t ^ (t >>> 14)) >>> 0;
  return [v / 4294967296, rng];
}

console.log(`\n${N} 局 · ${PC} 人 · 人类行为模拟（含 35% 冲动决策）\n`);

let totalDead = 0, players = 0, withBankrupt = 0;
let warnSeen = 0, rescued = 0, pawnedCount = 0;
const deadByProfile = {};
const deadTurn = [];

for (let i = 0; i < N; i++) {
  const s = playHuman(500000 + i * 7919);
  const alive = s.players.filter((p) => p.alive).length;
  const dead = s.players.filter((p) => !p.alive).length;
  totalDead += dead;
  players += s.players.length;
  if (dead > 0) withBankrupt++;
  for (const p of s.players) {
    if (!p.alive) {
      deadByProfile[p.aiProfile] = (deadByProfile[p.aiProfile] || 0) + 1;
      if (p.bankruptAtRound) deadTurn.push(p.bankruptAtRound);
    }
    if (p.flags && p.flags.warnMonth) warnSeen++;
  }
  for (const line of s.log) {
    if (String(line.text || "").includes("变卖资产")) pawnedCount++;
  }
}

const deadRate = totalDead / players;
console.log("── 驱动诊断 ──");
console.log(`  POST_ACTION 次数 ${STATS.postAction}, 冲动次数 ${STATS.impulse}, 冲动总额 ${STATS.impulseAmt}, 最低现金 ${Math.round(STATS.minCash)}`);
console.log("");
console.log("── 破产统计 ──");
console.log(`  破产总人数        ${totalDead} / ${players} 人（${(deadRate * 100).toFixed(1)}%）`);
console.log(`  出现破产的局      ${(withBankrupt / N * 100).toFixed(1)}%`);
console.log(`  宽限期触发人次    ${warnSeen}`);
console.log(`  被清算变卖次数    ${pawnedCount}`);
if (deadTurn.length) {
  const avg = deadTurn.reduce((a, b) => a + b, 0) / deadTurn.length;
  console.log(`  平均破产回合      ${avg.toFixed(1)} / 40`);
}

console.log("\n── 各性格破产率 ──");
for (const pr of PROFILES) {
  const d = deadByProfile[pr] || 0;
  const total = N * Math.ceil(PC / PROFILES.length);
  console.log(`  ${pr.padEnd(9)} ${(d / N * 100).toFixed(1)}%`);
}

console.log("\n── 判定 ──");
if (deadRate === 0) {
  console.log("  [X] 仍然零破产 —— 破产机制未被触发，graceRounds 无从验证");
  console.log("      可能原因：冲动层不够激进，或收入相对支出过高");
} else if (deadRate < 0.05) {
  console.log("  [!] 破产率偏低（<5%）。真人局可能更有风险，但也可能是稳态设计");
  console.log("      建议：确认宽限期是否让玩家有充分的补救时间");
} else if (deadRate <= 0.25) {
  console.log("  [OK] 破产率健康（5%~25%）。有淘汰张力但不至于频繁出局");
} else {
  console.log("  [!] 破产率偏高（>25%）。可能过于惩罚，休闲玩家会不适应");
}
