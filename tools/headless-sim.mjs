// 无头模拟：在 Node 里跑 N 局，不启动 UI。
// 输出：终局回合分布、破产率、资产量级、卡牌触发分布、职级分布。
// 这是调数值的主要依据——比拍脑袋定 appreciation 靠谱得多。
//
// 运行：node tools/headless-sim.mjs [局数]

import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// ── 加载数据 ──
function load(name) {
  return JSON.parse(readFileSync(join(ROOT, "data", `${name}.json`), "utf8"));
}
const raw = {
  config: load("config"),
  board: load("board"),
  events: load("events"),
  opportunity: load("cards.opportunity"),
  fate: load("cards.fate"),
  item: load("cards.item"),
  aiProfiles: load("ai_profiles"),
  uiText: load("ui_text"),
};
const data = {
  config: raw.config,
  board: raw.board,
  cards: { opportunity: raw.opportunity.cards, fate: raw.fate.cards, item: raw.item.cards },
  events: raw.events.pools,
  aiProfiles: raw.aiProfiles,
  uiText: raw.uiText,
};
data.config.__events = data.events;

// Windows 下绝对路径字符串不能直接 import，必须转 file:// URL
const imp = (rel) => import(pathToFileURL(join(ROOT, rel)).href);

const { reduce } = await imp("src/core/reducer.js");
const { playOut } = await imp("tools/harness.mjs");
const { validateData, validateStartingDeck } = await imp("src/data/schema.js");
const { netWorth } = await imp("src/core/economy.js");
const { PHASE } = await imp("src/core/actions.js");
const { decideActions } = await imp("src/core/ai.js");

// ── 先跑数据校验 ──
const errs = [...validateData(data), ...validateStartingDeck(data.config, data.cards)];
if (errs.length) {
  console.log("❌ 数据校验未通过：");
  errs.forEach((e) => console.log("   - " + e));
} else {
  console.log("✅ 数据校验通过");
}

// ── 模拟一局 ──
function simulate(seed, playerCount) {
  const profiles = data.aiProfiles.profiles;
  const players = [];
  for (let i = 0; i < playerCount; i++) {
    players.push({
      id: "p" + (i + 1),
      name: "AI" + (i + 1),
      avatar: profiles[i % 3].avatar,
      color: data.board.colorTokens[i % 6],
      isAI: true,
      aiProfile: profiles[i % profiles.length].id,
    });
  }

  const r = reduce(null, {
    type: "NEW_GAME", seed, players, mode: "solo",
    winCondition: "rounds", maxRounds: data.config.game.maxRounds,
  }, data);
  // 统一走 tools/harness.mjs 的共享驱动：这里曾自带一套老驱动，
  // TILE_EVENT 只认 kind:"buy"，买车格永远不成交（正是 harness 注释警告的"工具漂移"）。
  const final = playOut(reduce, decideActions, r.state, { data }).state;
  const state = final;

  return {
    seed,
    turns: Math.min(state.meta.turn, state.meta.maxRounds),
    winner: state.winner,
    players: state.players.map((p) => ({
      id: p.id, name: p.name, profile: p.aiProfile,
      alive: p.alive, cash: Math.round(p.cash), deposit: Math.round(p.deposit),
      netWorth: Math.round(netWorth(state, p.id)),
      rank: p.rankId, props: p.properties.length, vehicles: p.vehicles.length,
    })),
  };
}

// ── 统计 ──
const N = parseInt(process.argv[2] || "500", 10);
const PC = parseInt(process.argv[3] || "4", 10);

console.log(`\n模拟 ${N} 局 × ${PC} 名 AI ...\n`);
const t0 = Date.now();

const turnDist = [];
const bankruptCount = [];
const nwByProfile = { greedy: [], steady: [], spender: [] };
const rankDist = {};
let totalProps = 0, totalVehicles = 0, totalPlayers = 0;
let bankruptTotal = 0, bankruptStreak = 0;

for (let i = 0; i < N; i++) {
  const seed = 100000 + i * 7919;
  let res;
  try {
    res = simulate(seed, PC);
  } catch (e) {
    console.log(`✗ seed ${seed} 崩溃：${e.message}`);
    console.log(e.stack.split("\n").slice(0, 4).join("\n"));
    continue;
  }
  turnDist.push(res.turns);
  let bc = 0;
  for (const p of res.players) {
    totalPlayers++;
    totalProps += p.props;
    totalVehicles += p.vehicles;
    rankDist[p.rank] = (rankDist[p.rank] || 0) + 1;
    if (!p.alive) bc++;
    if (nwByProfile[p.profile]) nwByProfile[p.profile].push(p.netWorth);
  }
  bankruptCount.push(bc);
  bankruptTotal += bc;
  if (bc >= PC - 1) bankruptStreak++;
}

const elapsed = Date.now() - t0;
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const p50 = (a) => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)] || 0; };
const p90 = (a) => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length * 0.9)] || 0; };

console.log(`耗时 ${elapsed}ms（${(N / (elapsed / 1000)).toFixed(0)} 局/秒）\n`);
console.log("── 终局回合分布 ──");
console.log(`  平均 ${avg(turnDist).toFixed(1)} 回合 / 中位 ${p50(turnDist)} / p90 ${p90(turnDist)}（上限 ${data.config.game.maxRounds}）`);

console.log("\n── 破产情况 ──");
console.log(`  平均每局破产 ${(bankruptTotal / N).toFixed(2)} 人（共 ${PC} 人）`);
console.log(`  有人出局的比例 ${(bankruptCount.filter((x) => x > 0).length / N * 100).toFixed(1)}%`);
console.log(`  只剩 1 人的比例 ${(bankruptStreak / N * 100).toFixed(1)}%`);

console.log("\n── 净资产（按性格）──");
for (const [k, arr] of Object.entries(nwByProfile)) {
  if (!arr.length) continue;
  console.log(`  ${k.padEnd(8)} 平均 ${fmt(Math.round(avg(arr))).padStart(9)}  中位 ${fmt(p50(arr)).padStart(9)}  最高 ${fmt(Math.max(...arr)).padStart(9)}`);
}
const allNw = Object.values(nwByProfile).flat();
if (allNw.length) {
  console.log(`  ${"全部".padEnd(8)} 平均 ${fmt(Math.round(avg(allNw))).padStart(9)}  中位 ${fmt(p50(allNw)).padStart(9)}  最低 ${fmt(Math.min(...allNw)).padStart(9)}`);
}

console.log("\n── 职级分布 ──");
const rankNames = { intern: "实习生", specialist: "专员", supervisor: "主管", manager: "经理", director: "总监" };
for (const [k, v] of Object.entries(rankDist).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${(rankNames[k] || k).padEnd(4)} ${(v / totalPlayers * 100).toFixed(1)}%`);
}

console.log("\n── 资产持有 ──");
console.log(`  人均房产 ${(totalProps / totalPlayers).toFixed(2)} 套，人均车辆 ${(totalVehicles / totalPlayers).toFixed(2)} 辆`);

function fmt(n) {
  if (n >= 100000000) return (n / 100000000).toFixed(2) + "亿";
  if (n >= 10000) return (n / 10000).toFixed(1) + "万";
  return String(n);
}
