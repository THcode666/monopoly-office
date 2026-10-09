// reducer：状态变更的唯一入口。纯函数（外部传入的 state 不会被修改）。
// 返回 { state, diff, reject }。diff 是扁平操作列表，供 UI 打补丁与联机同步。

import { clone, round2 } from "./util.js";
import { PHASE, A, isAllowed, PHASE_ALLOWED } from "./actions.js";
import { nextInt, nextFloat, weightedPick, seedFromString } from "./rng.js";
import { resolveEffects, rankCheck } from "./effects.js";
import { settleMonth, netWorth, monthlySalary, monthlyLiving, monthlyDebt } from "./economy.js";
import { checkBankrupt } from "./bankruptcy.js";
import { buildDecks, drawCard, resolveCard, tickGrants, consumeGrant, hasGrant } from "./cards.js";
import { decideActions, markMilestone, markDeposit } from "./ai.js";
import { buildPlan } from "./aiPlan.js";

// ──────────────────────────── 主入口 ────────────────────────────

export function reduce(prevState, action, data) {
  if (action.type === A.NEW_GAME) return newGame(action, data);

  // 阶段白名单：非法 action 直接拒绝，这是防作弊与防 UI bug 的闸门
  if (!isAllowed(prevState.meta.phase, action.type)) {
    return { state: prevState, diff: [], reject: `当前阶段 ${prevState.meta.phase} 不允许 ${action.type}` };
  }
  // 回合归属校验：只能操作自己的回合
  if (needsOwnership(action.type)) {
    const cur = currentPlayer(prevState);
    if (cur && action.playerId && action.playerId !== cur.id) {
      return { state: prevState, diff: [], reject: "不是你的回合" };
    }
  }

  const state = clone(prevState);
  const diff = [];
  const ctx = makeCtx(state, data, diff);

  const r = dispatch(state, action, ctx, diff);
  if (r === false) return { state: prevState, diff: [], reject: "动作非法" };

  state.meta.seq++;
  state.actionLog.push({ seq: state.meta.seq, seat: state.meta.currentSeat, action: action });
  if (state.actionLog.length > 500) state.actionLog.shift();
  // 日志必须有上限：state.log 每次 reduce 都会被深拷贝，
  // 无上限增长会让模拟变成 O(n²)（实测 300 局从 4 秒变 30+ 秒）。
  if (state.log.length > 200) state.log.splice(0, state.log.length - 200);
  state.meta.rngState = ctx.rngRef.rng;

  recomputeAll(state);
  return { state, diff, reject: null };
}

const needsOwnership = (t) =>
  [A.ROLL_DICE, A.USE_ITEM, A.PLAY_CARD, A.BUY_PROPERTY, A.BUY_VEHICLE,
   A.DEPOSIT, A.WITHDRAW, A.END_TURN, A.LOAN_REQ, A.DISMISS_MODAL,
   A.PROPOSE_TRADE, A.RESPOND_TRADE, A.CANCEL_TRADE, A.IMPULSE_SPEND].includes(t);

// ──────────────────────────── 开局 ────────────────────────────

function newGame(action, data) {
  const cfg = action.config || data.config;
  const seed = action.seed >>> 0;
  const state = {
    meta: {
      seed, rngState: seed,
      phase: PHASE.TURN_START,
      turn: 1, month: 1, roundInMonth: 1,
      currentSeat: 0, seq: 0,
      fromMonthSettle: false,
      version: data.uiText.version || "1.0.0",
      appreciation: cfg.economy.propertyAppreciation,
      mode: action.mode || "solo",
      winCondition: action.winCondition || cfg.winCondition.default,
      maxRounds: action.maxRounds || cfg.game.maxRounds,
    },
    config: clone(cfg),
    board: clone(data.board),
    players: [],
    decks: {},
    pending: { modal: null, trade: null, bankrupt: null },
    log: [],
    actionLog: [],
    report: null,
  };

  for (const [i, ps] of action.players.entries()) {
    state.players.push(makePlayer(ps, i, cfg, data, state));
  }

  state.decks = buildDecks(state, data.cards);

  // AI 玩家开局生成目标计划（第 3 步 P0 修复）。
  // 计划存在 player 对象里，跟着 state 走 → 伪联机回放/断线重连自动同步。
  for (const p of state.players) {
    if (p.isAI) p.aiPlan = buildPlan(state, p.id, data);
  }

  // 起手道具
  const starting = cfg.startingDeck && cfg.startingDeck.item;
  if (starting) {
    for (const p of state.players) {
      for (const id of starting) p.cards.item.push(id);
    }
  }

  state.log.push({
    seq: 0, round: 1, seat: 0,
    text: `游戏开始，${state.players.length} 名玩家各持 ${cfg.economy.initialCash} 元入场。`,
    kind: "system",
  });
  recomputeAll(state);
  advancePhase(state, makeCtx(state, data, []), data);
  return { state, diff: [], reject: null };
}

function makePlayer(spec, seat, cfg, data, state) {
  const p = {
    id: spec.id,
    seat,
    name: spec.name,
    avatar: spec.avatar || "panda",
    color: spec.color || data.board.colorTokens[seat % 6],
    isAI: !!spec.isAI,
    aiProfile: spec.aiProfile || null,
    alive: true,
    pos: 0,
    cash: cfg.economy.initialCash,
    deposit: cfg.economy.initialDeposit,
    loan: { principal: 0, monthsLeft: 0, monthly: 0 },
    properties: [],
    vehicles: [],
    rankId: "intern",
    rankCoefficient: 0.6,
    salaryCoefficient: 1.0,
    salaryCoefficientHistory: [],
    cards: { opportunity: [], fate: [], item: [] },
    grants: [],
    flags: { skipNextTurn: false, lastWarn: false, offline: false },
    stats: { face: 0, energy: 60, mood: 50 },
    passiveIncome: 0,
    livingCostDelta: 0,
    loanRateDelta: 0,
    meta: { month: 1, appreciation: cfg.economy.propertyAppreciation },
    bankruptAtRound: null,
    aiPlan: null,
  };
  return p;
}

// ──────────────────────────── 上下文 ────────────────────────────

function makeCtx(state, data, diff) {
  const rngRef = { rng: state.meta.rngState, lastPick: 0 };
  const logs = [];
  return {
    state, data, diff, rngRef,
    log: (t) => { logs.push(t); state.log.push({ seq: state.meta.seq, round: state.meta.turn, seat: state.meta.currentSeat, text: t, kind: "info" }); },
    netWorth: (st, id) => netWorth(st, id),
    pickRandom: (n) => { const [i, r] = nextInt(rngRef.rng, n); rngRef.lastPick = i - 1; return [i, r]; },
    deckApi: (st, deckName, c, d) => () => {
      const card = drawCard(st, deckName, c, d);
      if (card) {
        const p = st.players.find((x) => x.id === c.actorId);
        if (p) {
          if (card.timing === "immediate") {
            resolveCard(st, card, c.actorId, c, d);
          } else {
            p.cards[card.deck].push(card.id);
            c.log(`${p.name} 获得【${card.name}】`);
            d.push({ t: "card", id: p.id, deck: card.deck, cardId: card.id });
          }
        }
      }
    },
  };
}

// ──────────────────────────── action 分派 ────────────────────────────

function dispatch(state, action, ctx, diff) {
  const p = currentPlayer(state);

  switch (action.type) {
    case A.ROLL_DICE: return onRollDice(state, p, ctx, diff);
    case A.BUY_PROPERTY: return onBuyProperty(state, p, action, ctx, diff);
    case A.BUY_VEHICLE: return onBuyVehicle(state, p, action, ctx, diff);
    case A.DEPOSIT: return onDeposit(state, p, action, ctx, diff);
    case A.WITHDRAW: return onWithdraw(state, p, action, ctx, diff);
    case A.LOAN_REQ: return onLoan(state, p, action, ctx, diff);
    case A.USE_ITEM: return onUseItem(state, p, action, ctx, diff);
    case A.PLAY_CARD: return onPlayCard(state, p, action, ctx, diff);
    case A.PROPOSE_TRADE: return onProposeTrade(state, p, action, ctx, diff);
    case A.RESPOND_TRADE: return onRespondTrade(state, p, action, ctx, diff);
    case A.CANCEL_TRADE: return onCancelTrade(state, p, action, ctx, diff);
    case A.DISMISS_MODAL: return onDismiss(state, p, ctx, diff);
    case A.CLAIM_ASSET: return onClaimAsset(state, p, action, ctx, diff);
    case A.END_TURN: return onEndTurn(state, p, ctx, diff);
    case A.IMPULSE_SPEND: return onImpulseSpend(state, p, action, ctx, diff);
    case A.AI_DECIDE: return onAiDecide(state, action, ctx, diff);
    case A.RESOLVE_TILE: return true; // 由引擎驱动
    default: return true;
  }
}

// ── 掷骰 ──
function onRollDice(state, p, ctx, diff) {
  if (!p) return false;
  // 咖啡等道具的重掷：掷两次取较高值。
  // 旧版只消费 grant 后照常掷一次，"重掷"没有任何实际效果（道具白用）。
  // 取 max 是对"可重掷一次"的确定性近似：人类与 AI 走同一通道，无需额外交互阶段。
  let dice;
  if (hasGrant(p, "reroll")) {
    consumeGrant(p, "reroll", 1);
    const [d1, r1] = nextInt(state.meta.rngState, 6);
    const [d2, r2] = nextInt(r1, 6);
    state.meta.rngState = r2;
    dice = Math.max(d1, d2);
    ctx.log(`${p.name} 灌了杯咖啡，掷 ${d1} 重掷得 ${d2}，取 ${dice}！`);
  } else {
    const [d, r] = nextInt(state.meta.rngState, 6);
    state.meta.rngState = r;
    dice = d;
  }

  const bonus = consumeGrantCount(p, "moveBonus");
  const steps = dice + bonus;
  diff.push({ t: "dice", id: p.id, value: dice, bonus });
  state.pending.dice = dice;

  const from = p.pos;
  const size = state.board.tiles.length;
  let to = (from + steps) % size;
  const crossedStart = from + steps >= size;

  state.pending.move = { from, to, steps, crossedStart };
  p.pos = to;
  diff.push({ t: "move", id: p.id, from, to, steps });

  state.log.push({
    seq: state.meta.seq, round: state.meta.turn, seat: state.meta.currentSeat,
    text: `${p.name} 掷出 ${dice}${bonus ? ` +${bonus}（道具）` : ""}，移动 ${steps} 格 → ${state.board.tiles[to].name}`,
    kind: "move",
  });

  state.meta.phase = PHASE.TILE_EVENT;
  resolveTile(state, p, ctx, diff);
  return true;
}

function consumeGrantCount(p, op) {
  const g = p.grants.find((x) => x.op === op);
  if (!g) return 0;
  const n = g.count || 1;
  g.count -= 1;
  if (g.count <= 0) p.grants.splice(p.grants.indexOf(g), 1);
  return n;
}

// ── 落位事件 ──
function resolveTile(state, p, ctx, diff) {
  const tile = state.board.tiles[p.pos];

  // 摸鱼道具：跳过移动效果
  if (hasGrant(p, "skipMove")) {
    consumeGrant(p, "skipMove", 1);
    ctx.log(`${p.name} 摸了会儿鱼，这格跳过。`);
    state.pending.modal = { kind: "skip", title: "摸鱼成功", text: "你把格子摸了，利润保住了。" };
    return;
  }

  // 经过起点发薪
  if (state.pending.move && state.pending.move.crossedStart && tile.type !== "start") {
    const bonus = state.board.tiles[0].payload.salaryBonus || 0;
    p.cash = round2(p.cash + bonus);
    ctx.log(`${p.name} 经过起点，补贴 ${bonus} 元`);
    diff.push({ t: "cash", id: p.id, to: p.cash });
  }

  const ev = buildTileEvent(state, tile, ctx, diff);
  state.pending.modal = ev;
}

function buildTileEvent(state, tile, ctx, diff) {
  const p = currentPlayer(state);
  const pool = state.config.__events;

  switch (tile.type) {
    case "start": {
      // 落在起点也发起步补贴。旧版只有"路过"才发，正好落在起点反而一分没有，
      // 与格面文案（+2000）自相矛盾。
      const bonus = tile.payload.salaryBonus || 0;
      if (bonus > 0) {
        p.cash = round2(p.cash + bonus);
        diff.push({ t: "cash", id: p.id, to: p.cash });
        ctx.log(`${p.name} 正好落在起点，领补贴 ${bonus} 元`);
      }
      return { kind: "event", title: tile.name, text: tile.payload.text, icon: "start" };
    }

    case "company":
    case "property": {
      if (tile.owner == null) {
        return {
          kind: "buy", title: tile.name, icon: "house",
          text: `${tile.payload.text}\n价格 ${tile.payload.price} 元，月供 ${Math.round(tile.payload.mortgage ? tile.payload.mortgage * 0.01 : 0)} 元/月。`,
          tileId: tile.id, price: tile.payload.price,
        };
      }
      if (tile.owner === p.id) {
        return { kind: "event", title: tile.name, text: "这是你的地皮，什么也没发生。", icon: "house" };
      }
      return payRentTo(state, tile, p, ctx, diff);
    }

    case "chance":
    case "fate": {
      const deckName = tile.type;
      const card = drawCard(state, deckName, ctx, diff);
      if (!card) return { kind: "event", title: tile.name, text: "牌堆空了，什么也没发生。" };
      if (card.timing === "immediate") {
        resolveCard(state, card, p.id, ctx, diff);
        return { kind: "card", title: tile.name, deck: deckName, cardName: card.name, text: card.text, detail: card.detail, icon: card.icon };
      }
      p.cards[card.deck].push(card.id);
      diff.push({ t: "card", id: p.id, deck: card.deck, cardId: card.id });
      return { kind: "card", title: tile.name, deck: deckName, cardName: card.name, text: card.text, detail: card.detail, icon: card.icon };
    }

    case "vehicle":
      // 买车格必须弹购买窗。旧版落进 default 分支只显示一句文案，
      // kind:"vehicle" 的购买弹窗永远造不出来 —— 两个买车格形同虚设，
      // onBuyVehicle / 看车 UI 全部不可达。
      return {
        kind: "vehicle", title: tile.name, icon: "car", tileId: tile.id,
        text: tile.payload.text, options: tile.payload.options || [],
      };

    default: {
      // 从事件池按 tile.type 抽
      const list = (pool && pool[tile.type]) || [];
      if (!list.length) {
        return { kind: "event", title: tile.name, text: tile.payload.text || "平静地走过去了。" };
      }
      const [ev, r] = weightedPick(ctx.rngRef.rng, list);
      ctx.rngRef.rng = r;
      if (!ev) return { kind: "event", title: tile.name, text: tile.payload.text || "" };

      // 替换 {tileId} 占位
      const effects = (ev.effects || []).map((e) => ({
        ...e,
        delta: e.delta,
        tileId: e.op === "payRent" ? tile.id : e.tileId,
      }));
      resolveEffects(state, effects, { ...ctx, actorId: p.id }, diff);
      return { kind: "event", title: tile.name, text: (ev.text || [tile.payload.text]).join("\n"), icon: ev.icon };
    }
  }
}

function payRentTo(state, tile, p, ctx, diff) {
  const owner = state.players.find((x) => x.id === tile.owner);
  if (!owner) return { kind: "event", title: tile.name, text: tile.payload.text || "" };
  let rent = tile.payload.rent || 0;
  const prop = owner.properties.find((x) => x.tileId === tile.id);
  if (prop) rent = Math.round(rent * (1 + (prop.upgradeMonths || 0) * 0.02));
  const actual = Math.min(p.cash, rent);
  p.cash = round2(p.cash - actual);
  owner.cash = round2(owner.cash + actual);
  diff.push({ t: "cash", id: p.id, to: p.cash });
  diff.push({ t: "cash", id: owner.id, to: owner.cash });
  if (prop) prop.visitsThisMonth = (prop.visitsThisMonth || 0) + 1;
  ctx.log(`${p.name} 向 ${owner.name} 支付租金 ${Math.round(actual)} 元${actual < rent ? "（现金不足，未付满）" : ""}`);
  return {
    kind: "rent", title: tile.name, icon: "rent",
    text: `${p.name} 落在了 ${owner.name} 的 ${tile.name}，租金 ${rent} 元。`,
    amount: Math.round(actual), ownerName: owner.name,
  };
}

// ── 买地 ──
function onBuyProperty(state, p, action, ctx, diff) {
  const tile = state.board.tiles.find((t) => t.id === action.tileId);
  if (!tile || tile.owner != null) return false;
  if (tile.type !== "property" && tile.type !== "company") return false;

  const price = tile.payload.price;
  const e = state.config.economy;
  const down = Math.round(price * (1 - e.mortgageRatio)); // 首付比例
  const term = e.mortgageMonths || 36;

  // 杠杆约束：负债 / (净资产 + 本次贷款) 不能超过上限。
  //
  // 口径说明：loanMaxRatio 0.6 指的是「总负债占总资产 60%」，不是「贷款额不超过净资产 60%」。
  // 首套房的贷款额几乎等于房价，而起手净资产才 2 万，用旧口径算杠杆率必然 > 1，
  // 结果所有人第一套房都买不起（实测 500 局零购房、对局卡在 turn 3）。
  const extraLoan = price - down;
  if (extraLoan > 0) {
    let maxRatio = 0.6;
    const profiles = (ctx.data && ctx.data.aiProfiles && ctx.data.aiProfiles.profiles) || [];
    if (p.isAI && p.aiProfile) {
      const prof = profiles.find((x) => x.id === p.aiProfile);
      if (prof && prof.thresholds) maxRatio = prof.thresholds.loanMaxRatio;
    } else if (profiles.length) {
      maxRatio = Math.max(...profiles.map((x) => (x.thresholds && x.thresholds.loanMaxRatio) || 0.6));
    }
    maxRatio = Math.min(maxRatio, 0.75); // 硬上限 75%

    // 分母用「净资产 + 本次贷款」= 买房后的总资产（贷款注入现金后资产增加）
    const nwBefore = netWorth(state, p.id);
    const postAssets = nwBefore + extraLoan;
    const postDebt = p.loan.principal + extraLoan;
    if (postAssets <= 0 || postDebt / postAssets > maxRatio) {
      state.pending.modal = {
        kind: "error", title: "杠杆过高",
        text: `这笔贷款会让负债率达到 ${Math.round((postDebt / postAssets) * 100)}%，`
          + `超过你 ${Math.round(maxRatio * 100)}% 的上限。再攒攒，或者找个有钱的爸妈（开玩笑的）。`,
      };
      return false;
    }
  }

  // 现金只付首付，其余进负债 —— 与 ai.js 的 shouldBuy 同一口径。
  // 之前这里要求全款（p.cash >= price），而 AI 按首付判断，
  // 两套标准不一致导致 AI 反复尝试买房被拒（实测卡在 turn 6）。
  if (p.cash < down) {
    state.pending.modal = {
      kind: "error", title: "现金不足",
      text: `首付需 ${down} 元，还差 ${Math.ceil(down - p.cash)} 元。`,
    };
    return false;
  }

  p.cash = round2(p.cash - down);
  const loanPart = extraLoan;              // 贷款部分：首付之外的
  const r = e.loanInterestRate;
  const monthly = loanPart > 0
    ? Math.round((loanPart * r) / (1 - Math.pow(1 + r, -term)))
    : 0;
  p.properties.push({
    tileId: tile.id, name: tile.name, type: tile.type,
    price, rent: tile.payload.rent || 0, group: tile.payload.group,
    monthly, monthsLeft: monthly > 0 ? term : 0,
    financed: loanPart,           // 计入 netWorth 的负债项
    boughtMonth: p.meta.month, heldMonths: 0, visitsThisMonth: 0,
    mortgage: down, upgradeMonths: 0,
  });
  tile.owner = p.id;
  diff.push({ t: "cash", id: p.id, to: p.cash });
  diff.push({ t: "buyProperty", id: p.id, tileId: tile.id });
  ctx.log(`${p.name} 买下了 ${tile.name}（${price} 元，月供 ${monthly} 元）`);
  markMilestone(p.id, tile.id, state);
  state.pending.modal = { kind: "event", title: "成交", text: `${tile.name} 归你了。每月收租 ${tile.payload.rent} 元。`, icon: "house" };
  return true;
}

// ── 买车 ──
// 与买房同一套口径：付首付，其余进负债。第 4 步统一，
// 之前车是全款、房是首付，导致 AI 与规则的判断标准不一致。
function onBuyVehicle(state, p, action, ctx, diff) {
  const tile = state.board.tiles.find((t) => t.id === action.tileId);
  if (!tile || tile.type !== "vehicle") return false;
  const opt = (tile.payload.options || []).find((o) => o.id === action.optionId);
  if (!opt) return false;

  const e = state.config.economy;
  const down = Math.round(opt.price * (1 - e.mortgageRatio));
  const vehLoan = opt.price - down;

  // 杠杆约束与买房同一口径：负债/(净资产+本次贷款) <= 上限
  if (vehLoan > 0) {
    let maxRatio = 0.6;
    const profiles = (ctx.data && ctx.data.aiProfiles && ctx.data.aiProfiles.profiles) || [];
    if (p.isAI && p.aiProfile) {
      const prof = profiles.find((x) => x.id === p.aiProfile);
      if (prof && prof.thresholds) maxRatio = prof.thresholds.loanMaxRatio;
    } else if (profiles.length) {
      maxRatio = Math.max(...profiles.map((x) => (x.thresholds && x.thresholds.loanMaxRatio) || 0.6));
    }
    maxRatio = Math.min(maxRatio, 0.75);
    const postAssets = netWorth(state, p.id) + vehLoan;
    const postDebt = p.loan.principal + vehLoan
      + p.vehicles.reduce((s2, v) => s2 + (v.financed || 0), 0);
    if (postAssets <= 0 || postDebt / postAssets > maxRatio) {
      state.pending.modal = {
        kind: "error", title: "车贷也批不下",
        text: `买车会让负债率达到 ${Math.round((postDebt / postAssets) * 100)}%，超过你的上限。`,
      };
      return false;
    }
  }

  if (p.cash < down) {
    state.pending.modal = {
      kind: "error", title: "现金不足",
      text: `首付需 ${down} 元，还差 ${Math.ceil(down - p.cash)} 元。`,
    };
    return false;
  }

  p.cash = round2(p.cash - down);

  // 月供按 loan 与 vehicleMonths 重算，不用 JSON 里的 monthly 硬编码值，
  // 否则改利率时车贷月供不会跟着变。
  const term = e.vehicleMonths || 24;
  const r = e.loanInterestRate;
  const monthly = vehLoan > 0
    ? Math.round((vehLoan * r) / (1 - Math.pow(1 + r, -term)))
    : 0;

  p.vehicles.push({
    id: opt.id, name: opt.name, price: opt.price,
    monthly, monthsLeft: monthly > 0 ? term : 0,
    livingDiscount: opt.livingDiscount || 0,
    depreciation: opt.depreciation || 0.02, heldMonths: 0,
    financed: vehLoan,
    face: opt.face || 0, mood: opt.mood || 0, tag: opt.tag || "",
  });

  // 非财务收益立即生效：车带来的面子与心情是「买车」玩法的核心价值，
  // 否则车只是纯负债，AI 与玩家都不会买（第 3 步实测人均 0.14 辆）。
  if (opt.face) p.stats.face = Math.min(100, (p.stats.face || 0) + opt.face);
  if (opt.mood) p.stats.mood = Math.min(100, (p.stats.mood || 0) + opt.mood);

  diff.push({ t: "cash", id: p.id, to: p.cash });
  diff.push({ t: "buyVehicle", id: p.id, vehicleId: opt.id });
  ctx.log(`${p.name} 买了${opt.name}（${opt.price} 元，月供 ${monthly} 元）`);
  state.pending.modal = {
    kind: "event", title: "提车",
    text: `${opt.name} 停在了公司车位上。\n`
      + `月供 ${monthly} 元，每月省生活开销 ${opt.livingDiscount} 元，`
      + `面子 +${opt.face}，心情 +${opt.mood}。\n${opt.tag || ""}`,
    icon: "car",
  };
  return true;
}

function onDeposit(state, p, action, ctx, diff) {
  const amt = Math.min(Math.round(action.amount), p.cash);
  if (amt <= 0) return false;
  p.cash = round2(p.cash - amt);
  p.deposit = round2(p.deposit + amt);
  diff.push({ t: "cash", id: p.id, to: p.cash });
  diff.push({ t: "deposit", id: p.id, to: p.deposit });
  markDeposit(p.id, state);
  return true;
}

function onWithdraw(state, p, action, ctx, diff) {
  const amt = Math.min(Math.round(action.amount), p.deposit);
  if (amt <= 0) return false;
  p.deposit = round2(p.deposit - amt);
  p.cash = round2(p.cash + amt);
  diff.push({ t: "cash", id: p.id, to: p.cash });
  diff.push({ t: "deposit", id: p.id, to: p.deposit });
  return true;
}

function onLoan(state, p, action, ctx, diff) {
  const amt = Math.round(action.amount || 0);
  if (amt <= 0 || amt > 100000) return false;
  p.cash = round2(p.cash + amt);
  p.loan.principal = round2(p.loan.principal + amt);
  p.loan.monthsLeft = 12;
  p.loan.monthly = Math.round(amt / 12);
  diff.push({ t: "cash", id: p.id, to: p.cash });
  diff.push({ t: "loan", id: p.id, to: p.loan });
  ctx.log(`${p.name} 贷款 ${amt} 元，分 12 期`);
  return true;
}

function onUseItem(state, p, action, ctx, diff) {
  const idx = p.cards.item.indexOf(action.cardId);
  if (idx < 0) return false;
  const def = state.decks.item.catalog[action.cardId];
  if (!def) return false;
  p.cards.item.splice(idx, 1);
  resolveCard(state, def, p.id, ctx, diff);

  // 茶水间情报：peekRichest grant 旧版发出后无任何消费方（纯死数据）。
  // 现在直接把首富的资产明细放进弹窗，兑现卡面"查看最高净资产玩家的资产"。
  if (action.cardId === "gossipCard") {
    const rich = state.players
      .filter((x) => x.alive && x.id !== p.id)
      .sort((a, b) => netWorth(state, b.id) - netWorth(state, a.id))[0];
    if (rich) {
      consumeGrant(p, "peekRichest", 1);
      state.pending.modal = {
        kind: "peek", title: "茶水间情报", icon: "eye",
        text: `${rich.name} 的家底被你看光了：`,
        target: {
          name: rich.name, netWorth: netWorth(state, rich.id),
          cash: rich.cash, deposit: rich.deposit,
          properties: rich.properties.map((x) => x.name),
          vehicles: rich.vehicles.map((v) => v.name),
        },
      };
    }
  }

  diff.push({ t: "useCard", id: p.id, cardId: action.cardId });
  return true;
}

function onPlayCard(state, p, action, ctx, diff) {
  // 在机会/命运两个牌堆里找这张卡
  let usedDeck = null;
  let found = -1;
  for (const dn of ["opportunity", "fate"]) {
    const i = p.cards[dn].indexOf(action.cardId);
    if (i >= 0) { usedDeck = dn; found = i; break; }
  }
  if (found === null || found < 0) return false;
  p.cards[usedDeck].splice(found, 1);
  const def = state.decks[usedDeck].catalog[action.cardId];
  state.decks[usedDeck].discard.push(action.cardId);
  if (def) resolveCard(state, def, p.id, ctx, diff);
  diff.push({ t: "useCard", id: p.id, cardId: action.cardId });
  return true;
}

// ── 交易 ──
function onProposeTrade(state, p, action, ctx, diff) {
  const to = state.players.find((x) => x.id === action.toId);
  if (!to || !to.alive) return false;
  state.pending.trade = {
    id: `t${state.meta.seq + 1}`,
    fromId: p.id, toId: to.id,
    offer: action.offer || {}, want: action.want || {},
    status: "pending",
  };
  diff.push({ t: "trade", id: p.id, status: "proposed" });
  return true;
}

function onRespondTrade(state, p, action, ctx, diff) {
  const tr = state.pending.trade;
  if (!tr || tr.id !== action.tradeId) return false;
  if (tr.toId !== p.id) return false;
  if (!action.accept) {
    tr.status = "rejected";
    ctx.log(`${p.name} 拒绝了交易`);
  } else {
    applyTrade(state, tr, ctx, diff);
    tr.status = "done";
    ctx.log("交易达成");
  }
  state.pending.trade = null;
  diff.push({ t: "trade", id: p.id, status: tr.status });
  return true;
}

function applyTrade(state, tr, ctx, diff) {
  const A1 = state.players.find((x) => x.id === tr.fromId);
  const B = state.players.find((x) => x.id === tr.toId);
  // 现金
  const cash = (tr.offer.cash || 0) - (tr.want.cash || 0);
  if (cash > 0 && A1.cash < cash) return;
  if (cash < 0 && B.cash < -cash) return;
  A1.cash = round2(A1.cash - cash);
  B.cash = round2(B.cash + cash);
  // 房产
  for (const tid of tr.offer.properties || []) moveAsset(state, A1, B, tid);
  for (const tid of tr.want.properties || []) moveAsset(state, B, A1, tid);
  // 车辆
  for (const vid of tr.offer.vehicles || []) moveVehicle(state, A1, B, vid);
  for (const vid of tr.want.vehicles || []) moveVehicle(state, B, A1, vid);
  diff.push({ t: "cash", id: A1.id, to: A1.cash });
  diff.push({ t: "cash", id: B.id, to: B.cash });
}

function moveAsset(state, from, to, tileId) {
  const i = from.properties.findIndex((x) => x.tileId === tileId);
  if (i < 0) return;
  const prop = from.properties.splice(i, 1)[0];
  prop.heldMonths = 0;
  to.properties.push(prop);
  const tile = state.board.tiles.find((t) => t.id === tileId);
  if (tile) tile.owner = to.id;
  // 房贷跟随房产转移：接收方接手剩余本金，但月供要按对方现金重算，
  // 否则接收方可能因月供过高而立刻破产。
  if (prop.financed > 0) {
    const rate = state.config.economy.loanInterestRate;
    const monthsLeft = Math.max(1, prop.monthsLeft);
    prop.monthly = Math.round((prop.financed * rate) / (1 - Math.pow(1 + rate, -monthsLeft)));
  }
}

function moveVehicle(state, from, to, vid) {
  const i = from.vehicles.findIndex((x) => x.id === vid);
  if (i < 0) return;
  const v = from.vehicles.splice(i, 1)[0];
  v.heldMonths = 0;
  to.vehicles.push(v);
}

function onCancelTrade(state, p, action, ctx, diff) {
  if (state.pending.trade && state.pending.trade.fromId === p.id) {
    state.pending.trade = null;
    return true;
  }
  return false;
}

// ── 关闭弹窗 / 结束回合 ──
function onDismiss(state, p, ctx, diff) {
  state.pending.modal = null;
  if (state.meta.phase === PHASE.TILE_EVENT) {
    state.meta.phase = PHASE.POST_ACTION;
  }
  return true;
}

function onEndTurn(state, p, ctx, diff) {
  // 现金为负时立刻进入破产检查。
  // 原先只在 TURN_START 检查，导致玩家在 POST_ACTION 冲动消费后
  // 现金已经为负，却还能正常掷骰、交易、直到下个回合才被判负 ——
  // 破产机制事实上被架空（human-sim 实测最低现金 −4156 却零破产、宽限期零触发）。
  state.meta.phase = p.cash < 0 ? PHASE.BANKRUPT_CHECK : PHASE.TURN_END;
  advancePhase(state, ctx, ctx.data);
  return true;
}

function onClaimAsset(state, p, action, ctx, diff) {
  // 破产清算由引擎自动执行，玩家手动变卖在 POST_ACTION 可用
  return true;
}

// 冲动消费：仅供 tools/human-sim.mjs 模拟真人的非理性行为。
// 走正规 action 通道而不是让工具直接改 state —— 旁路改状态会绕过 reducer，
// 与「一切状态变更都走 dispatch」的架构原则冲突，也会让伪联机哈希校验失效。
function onImpulseSpend(state, p, action, ctx, diff) {
  const amount = Math.max(0, Math.round(action.amount || 0));
  if (!amount) return true;
  const actual = Math.min(p.cash, amount);
  p.cash = round2(p.cash - actual);
  p.stats.mood = Math.max(0, Math.min(100, (p.stats.mood || 50) + 4));
  diff.push({ t: "cash", id: p.id, to: p.cash });
  ctx.log(`${p.name} 冲动消费 ${Math.round(actual)} 元（爽是爽了）`);
  return true;
}

// ── AI ──
function onAiDecide(state, action, ctx, diff) {
  // 只执行第一个 action，其余由调度器（main.step / harness）继续驱动。
  // 旧版会把剩余动作塞进 state.pending.aiQueue —— 没有任何消费方，
  // 纯属每次 reduce 都要深拷贝的死重。
  const acts = decideActions(state, action.playerId, ctx.data);
  if (acts.length) {
    return dispatch(state, acts[0], ctx, diff);
  }
  return true;
}

// ──────────────────────────── 阶段推进 ────────────────────────────

// diff 从 ctx 里拿，不要单独传参 —— 之前单独传导致签名不匹配、
// 月末结算分支一直崩，表现为"工资从不发放"。
function advancePhase(state, ctx, data) {
  const diff = ctx.diff;
  let guard = 0;
  while (guard++ < 200) {
    const phase = state.meta.phase;
    const p = currentPlayer(state);

    switch (phase) {
      case PHASE.TURN_START: {
        if (!p) { state.meta.phase = PHASE.GAME_OVER; break; }
        tickGrants(p);
        // 跳过本回合
        if (p.flags.skipNextTurn) {
          p.flags.skipNextTurn = false;
          ctx.log(`${p.name} 请假/公休，跳过本回合`);
          state.meta.phase = PHASE.END_TURN;
          break;
        }
        if (p.cash < 0) { state.meta.phase = PHASE.BANKRUPT_CHECK; break; }
        state.meta.phase = PHASE.ROLL;
        break;
      }

      case PHASE.ROLL:
        return; // 等玩家掷骰

      case PHASE.TILE_EVENT:
        if (!state.pending.modal) { state.meta.phase = PHASE.POST_ACTION; break; }
        return; // 等玩家关弹窗

      case PHASE.POST_ACTION:
        return; // 等玩家结束回合

      case PHASE.TURN_END: {
        nextSeat(state);
        if (checkGameEnd(state, ctx)) { state.meta.phase = PHASE.GAME_OVER; break; }
        // 月内计数 +1；每 roundsPerMonth 回合结算一次
        state.meta.roundInMonth++;
        if (state.meta.roundInMonth > state.config.game.roundsPerMonth) {
          state.meta.phase = PHASE.MONTH_SETTLE;
        } else {
          state.meta.phase = PHASE.TURN_START;
        }
        break;
      }

      case PHASE.MONTH_SETTLE: {
        const reports = [];
        const settledMonth = state.meta.month; // 结算的是"当前月"，不能写 meta.month - 1
        for (const pl of state.players.filter((x) => x.alive)) {
          reports.push(settleMonth(state, pl.id, diff, ctx.log));
          pl.meta.month++;
          pl.meta.appreciation = state.config.economy.propertyAppreciation;
        }
        state.report = { month: settledMonth, reports };
        state.meta.fromMonthSettle = true; // 标记本次清算来自月末
        state.meta.phase = PHASE.BANKRUPT_CHECK;
        break;
      }

      case PHASE.BANKRUPT_CHECK: {
        let anyDead = false;
        for (const pl of state.players.filter((x) => x.alive)) {
          const r = checkBankrupt(state, pl.id);
          if (r.bankrupt) {
            anyDead = true;
            ctx.log(`${pl.name} 破产出局了（第 ${state.meta.turn} 回合）`);
            diff.push({ t: "bankrupt", id: pl.id });
          } else if (r.warned) {
            ctx.log(`${pl.name} 现金为负，进入宽限期——请在下个月前自救`);
            diff.push({ t: "warn", id: pl.id });
          } else if (r.pawned.length) {
            ctx.log(`${pl.name} 变卖资产 ${r.pawned.length} 项，勉强过关`);
          }
        }
        if (anyDead) {
          state.meta.phase = PHASE.BANKRUPT_CHECK;
          // 清掉死人的地皮
          for (const pl of state.players) {
            if (!pl.alive) for (const prop of pl.properties) {
              const tile = state.board.tiles.find((t) => t.id === prop.tileId);
              if (tile) tile.owner = null;
            }
            pl.properties = [];
          }
          if (checkGameEnd(state, ctx)) { state.meta.phase = PHASE.GAME_OVER; break; }
          state.meta.phase = PHASE.TURN_START;
          break;
        }
        // 收尾：区分「月末清算」与「回合末清算（现金为负）」
        // 只有月末那一次才推进月份 —— 本阶段现在也从 onEndTurn 进入，
        // 若无条件 month++ 会导致每回合加月，10 个月变成 160 个月。
        if (state.meta.fromMonthSettle) {
          state.meta.fromMonthSettle = false;
          state.meta.roundInMonth = 1;
          state.meta.month++;
          state.meta.phase = PHASE.TURN_START;
        } else {
          state.meta.phase = PHASE.TURN_END;
        }
        break;
      }
      case PHASE.GAME_OVER:
        return;

      default:
        state.meta.phase = PHASE.TURN_START;
    }
  }
}

function nextSeat(state) {
  const n = state.players.length;
  for (let i = 1; i <= n; i++) {
    const seat = (state.meta.currentSeat + i) % n;
    const p = state.players[seat];
    if (p && p.alive) {
      state.meta.currentSeat = seat;
      state.meta.turn++;
      if (state.meta.turn > state.meta.maxRounds) {
        state.meta.phase = PHASE.GAME_OVER;
      }
      return;
    }
  }
  state.meta.phase = PHASE.GAME_OVER;
}

function checkGameEnd(state, ctx) {
  const alive = state.players.filter((p) => p.alive);

  // 破产淘汰制：人数只剩配置的下限就结束。
  // 注意单人练习（1 人开局）不算"只剩 1 人"，否则开局即终局。
  if (state.players.length > 1 && alive.length <= 1) {
    state.winner = alive[0] ? alive[0].id : null;
    ctx.log && ctx.log(`${alive[0] ? alive[0].name : "无人"} 是最后的胜者`);
    return true;
  }

  // 固定回合数制：回合耗尽时按净资产定胜负
  if (state.meta.turn > state.meta.maxRounds) {
    const sorted = state.players.slice().sort(
      (a, b) => netWorth(state, b.id) - netWorth(state, a.id)
    );
    state.winner = sorted[0] ? sorted[0].id : null;
    ctx.log && ctx.log(`${state.meta.maxRounds} 回合结束，${sorted[0] ? sorted[0].name : "无人"} 资产最高`);
    return true;
  }
  return false;
}

// ──────────────────────────── 工具 ────────────────────────────

function currentPlayer(state) {
  return state.players[state.meta.currentSeat] || null;
}

function recomputeAll(state) {
  for (const p of state.players) {
    p.netWorth = netWorth(state, p.id);
  }
}
