// 单局追踪：逐步打印 phase 与 state 变化，定位推进卡点。
// 用法：node tools/trace.mjs [seed]

import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

function load(name) {
  return JSON.parse(readFileSync(join(ROOT, "data", `${name}.json`), "utf8"));
}
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

const imp = (rel) => import(pathToFileURL(join(ROOT, rel)).href);
const { reduce } = await imp("src/core/reducer.js");
const { PHASE } = await imp("src/core/actions.js");

const seed = parseInt(process.argv[2] || "100000", 10);

const players = [
  { id: "p1", name: "AI1", isAI: true, aiProfile: "greedy" },
  { id: "p2", name: "AI2", isAI: true, aiProfile: "steady" },
];

let r = reduce(null, {
  type: "NEW_GAME", seed, players, mode: "solo", winCondition: "rounds", maxRounds: 40,
}, data);
let state = r.state;
console.log(`开局 phase=${state.meta.phase} seat=${state.meta.currentSeat} turn=${state.meta.turn}`);
console.log(`牌堆 opportunity=${state.decks.opportunity.draw.length} fate=${state.decks.fate.draw.length} item=${state.decks.item.draw.length}`);

const seen = new Map();
for (let step = 0; step < 60; step++) {
  const p = state.players[state.meta.currentSeat];
  const phase = state.meta.phase;
  const key = `${phase}#${state.meta.currentSeat}`;
  seen.set(key, (seen.get(key) || 0) + 1);

  console.log(
    `[${String(step).padStart(2)}] phase=${phase.padEnd(15)} seat=${state.meta.currentSeat} ` +
    `turn=${String(state.meta.turn).padStart(2)} month=${state.meta.month} ` +
    `${p ? p.name : "-"} cash=${p ? Math.round(p.cash) : "-"} pos=${p ? p.pos : "-"}`
  );
  if (phase === PHASE.GAME_OVER) {
    console.log("GAME OVER, winner =", state.winner);
    break;
  }

  let act = null;
  if (phase === PHASE.TURN_START || phase === PHASE.ROLL) {
    act = { type: "ROLL_DICE", playerId: p.id };
  } else if (phase === PHASE.TILE_EVENT || phase === PHASE.MOVING) {
    const m = state.pending.modal;
    if (m && m.kind === "buy" && p.cash >= m.price) {
      act = { type: "BUY_PROPERTY", tileId: m.tileId, playerId: p.id };
    } else {
      act = { type: "DISMISS_MODAL", playerId: p.id };
    }
  } else if (phase === PHASE.POST_ACTION) {
    act = { type: "END_TURN", playerId: p.id };
  } else {
    console.log(`  ⤷ 无需动作（引擎自动推进）`);
    // 这些阶段应由 advancePhase 内部消化，如果出现在这里说明驱动有问题
    console.log(`  ⤷ pending=${JSON.stringify(state.pending).slice(0, 120)}`);
    break;
  }

  const rr = reduce(state, act, data);
  if (rr.reject) {
    console.log(`  ✗ 动作被拒: ${act.type} — ${rr.reject}`);
    break;
  }
  state = rr.state;
}

console.log("\n── 各 phase 出现次数 ──");
for (const [k, v] of [...seen.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
  console.log(`  ${k.padEnd(22)} ${v}`);
}
