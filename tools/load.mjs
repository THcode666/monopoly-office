// 共享数据装载 + 对局入口。三个工具共用，避免各写一份。
// 用法：
//   const h = await loadHarness();
//   const r = h.reduce(null, h.newGame(seed, players), h.data);
//   const { state } = h.playOut(r.state);

import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { playOut } from "./harness.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const imp = (rel) => import(pathToFileURL(join(ROOT, rel)).href);

export async function loadHarness() {
  const read = (n) => JSON.parse(readFileSync(join(ROOT, "data", `${n}.json`), "utf8"));
  const config = read("config");
  config.__events = read("events").pools;
  const data = {
    config,
    board: read("board"),
    cards: {
      opportunity: read("cards.opportunity").cards,
      fate: read("cards.fate").cards,
      item: read("cards.item").cards,
    },
    events: config.__events,
    aiProfiles: read("ai_profiles"),
    uiText: read("ui_text"),
  };

  const { reduce } = await imp("src/core/reducer.js");
  const { decideActions } = await imp("src/core/ai.js");
  const { netWorth, monthlyRentIncome, monthlySalary } = await imp("src/core/economy.js");
  const { validateData, validateStartingDeck } = await imp("src/data/schema.js");

  return {
    data, reduce, decideActions, netWorth, monthlyRentIncome, monthlySalary,
    validateData, validateStartingDeck,
    newGame: (seed, players, extra = {}) => ({
      type: "NEW_GAME", seed, players,
      mode: extra.mode || "solo",
      winCondition: extra.winCondition || "rounds",
      maxRounds: extra.maxRounds || data.config.game.maxRounds,
    }),
    playOut: (state, opts = {}) => playOut(reduce, decideActions, state, { data, ...opts }),
  };
}

export const PROFILES = ["greedy", "steady", "spender"];

export function mkProfiles(n, board) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const prof = PROFILES[i % PROFILES.length];
    out.push({
      id: "p" + (i + 1), name: prof, isAI: true, aiProfile: prof,
      color: board.colorTokens[i % board.colorTokens.length],
    });
  }
  return out;
}
