// 卡牌引擎：牌堆管理、抽牌、卡牌结算、grants 能力授予。

import { nextFloat, nextInt, weightedPick, shuffle } from "./rng.js";
import { resolveEffects } from "./effects.js";
import { round2 } from "./util.js";

// 建立牌堆。牌数不足时循环补足到 config.decks 指定数量。
export function buildDecks(state, cardData) {
  const decks = {};
  for (const deckName of ["opportunity", "fate", "item"]) {
    const defs = cardData[deckName] || [];
    const want = state.config.decks[deckName] || defs.length;
    const pool = [];
    for (const c of defs) {
      const copies = c.maxCopies || 1;
      for (let i = 0; i < copies; i++) pool.push(c);
    }
    // 洗牌后取 want 张（不够就全要，不够再补）
    let draw = pool;
    let guard = 0;
    while (draw.length < want && guard < 50) {
      const r = shuffle(state.meta.rngState, pool);
      state.meta.rngState = r.rng;
      draw = draw.concat(r.arr);
      guard++;
    }
    decks[deckName] = {
      draw: draw.slice(0, want).map((c) => c.id),
      discard: [],
      catalog: Object.fromEntries(defs.map((c) => [c.id, c])),
    };
  }
  return decks;
}

// 抽一张牌。抽空则洗回弃牌堆。返回 [cardDef|null, logMsg]
export function drawCard(state, deckName, ctx, diff) {
  const deck = state.decks[deckName];
  if (!deck) return null;
  if (deck.draw.length === 0) {
    if (deck.discard.length === 0) return null;
    const r = shuffle(state.meta.rngState, deck.discard);
    state.meta.rngState = r.rng;
    deck.draw = r.arr;
    deck.discard = [];
  }
  const id = deck.draw.pop();
  const def = deck.catalog[id];
  return def || null;
}

// 结算一张卡：立即效果的 effects + grants 授予的能力。
// target 由调用方解析好传入。
export function resolveCard(state, cardDef, actorId, ctx, diff) {
  const p = state.players.find((x) => x.id === actorId);
  if (!p) return;

  // 选定目标
  const targetId = pickTarget(state, cardDef.target, actorId, ctx);

  const cardCtx = { ...ctx, actorId: targetId };
  resolveEffects(state, cardDef.effects, cardCtx, diff);

  // grants 授予能力
  if (cardDef.grants) {
    for (const g of cardDef.grants) {
      applyGrant(p, g, cardCtx, diff);
    }
  }

  ctx.log && ctx.log(`${p.name} 使用了【${cardDef.name}】`);
}

// grants 与 effects 的差别：grants 是"能力/状态"，需要在特定时机被消费。
function applyGrant(p, g, ctx, diff) {
  switch (g.op) {
    case "stat": {
      const v = (p.stats[g.key] || 0) + g.delta;
      p.stats[g.key] = Math.max(0, Math.min(100, v));
      break;
    }
    case "cash":
      p.cash = round2(p.cash + g.delta);
      break;
    case "passiveIncome":
      // 永久性月度被动收入（桌面绿植等），月末结算时发放
      p.passiveIncome = round2((p.passiveIncome || 0) + g.delta);
      diff.push({ t: "passiveIncome", id: p.id, to: p.passiveIncome });
      break;
    case "moveBonus":
      p.grants.push({ op: "moveBonus", count: g.count || 1, turnsLeft: 1 });
      break;
    case "drawCard": {
      // 立刻抽卡；非 immediate 的进手牌，immediate 的当场结算。
      // 旧版这里走 default 分支把 drawCard 塞进 grants 后无人消费 ——
      // 「简历」「简历镀金」的"抽机会卡"完全是死效果（用户反馈
      // "道具好像没什么用"的元凶之一）。
      const n = g.count || 1;
      for (let i = 0; i < n; i++) {
        const card = drawCard(ctx.state, g.deck, ctx, diff);
        if (!card) break;
        // 即时卡也推一条 card diff，让 UI 弹"抽到【xx】"的反馈
        diff.push({ t: "card", id: p.id, deck: g.deck, cardId: card.id, draw: true });
        if (card.timing === "immediate") {
          resolveCard(ctx.state, card, p.id, ctx, diff);
        } else {
          p.cards[card.deck].push(card.id);
        }
      }
      break;
    }
    case "skipNext": {
      // 同理：旧版 skipNext 作为 grant 塞进 grants 无人消费，
      // 「年假条」的"跳过下一回合"无效（事件池的 skipNext 走 effects 通道才是好的）。
      p.flags.skipNextTurn = (p.flags.skipNextTurn || 0) + (g.count || 1);
      diff.push({ t: "flags", id: p.id });
      break;
    }
    default:
      p.grants.push({ ...g, turnsLeft: g.turnsLeft || null });
  }
}

// 消耗一个 grant，返回是否成功
export function consumeGrant(p, op, count = 1) {
  const g = p.grants.find((x) => x.op === op && (x.count || 0) >= count);
  if (!g) return false;
  g.count -= count;
  if (g.count <= 0) {
    const i = p.grants.indexOf(g);
    p.grants.splice(i, 1);
  }
  return true;
}

export function hasGrant(p, op) {
  return p.grants.some((x) => x.op === op);
}

function pickTarget(state, target, actorId, ctx) {
  const others = state.players.filter((p) => p.alive && p.id !== actorId);
  switch (target) {
    case "self":
      return actorId;
    case "richest":
      return others.length
        ? others.slice().sort((a, b) => ctx.netWorth(state, b.id) - ctx.netWorth(state, a.id))[0].id
        : actorId;
    case "poorest":
      return others.length
        ? others.slice().sort((a, b) => ctx.netWorth(state, a.id) - ctx.netWorth(state, b.id))[0].id
        : actorId;
    case "randomOther":
    case "other":
    case "pick":
    default:
      return others.length ? others[0].id : actorId;
  }
}

// 每回合开始时递减 grants 的时限
export function tickGrants(p) {
  p.grants = p.grants.filter((g) => {
    if (g.turnsLeft == null) return true;
    g.turnsLeft--;
    return g.turnsLeft > 0;
  });
}
