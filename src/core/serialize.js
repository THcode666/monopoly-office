// 序列化：存档、伪联机回合包、断线重连全量同步。
// hashState 是伪联机合法性的唯一判据。

import { hashState, stableStringify, clone } from "./util.js";

export function snapshot(state) {
  return clone(state);
}

export function restore(snap, data) {
  const s = clone(snap);
  s.config.__events = data.events;
  s.decks.opportunity.catalog = Object.fromEntries(
    (data.cards.opportunity || []).map((c) => [c.id, c])
  );
  s.decks.fate.catalog = Object.fromEntries(
    (data.cards.fate || []).map((c) => [c.id, c])
  );
  s.decks.item.catalog = Object.fromEntries(
    (data.cards.item || []).map((c) => [c.id, c])
  );
  return s;
}

// 增量同步：只算 meta + 玩家关键字段，供 ROOM_STATE 广播。
// 注意：catalog 是静态数据，不必每回合重传。
export function wireState(state) {
  return {
    meta: state.meta,
    pending: state.pending,
    log: state.log.slice(-30),
    report: state.report,
    winner: state.winner || null,
    board: { tiles: state.board.tiles.map((t) => ({ id: t.id, owner: t.owner })) },
    players: state.players,
    decks: {
      opportunity: { drawCount: state.decks.opportunity.draw.length, discardCount: state.decks.opportunity.discard.length },
      fate: { drawCount: state.decks.fate.draw.length, discardCount: state.decks.fate.discard.length },
      item: { drawCount: state.decks.item.draw.length, discardCount: state.decks.item.discard.length },
    },
  };
}

export function applyWire(prev, wire, data) {
  const s = clone(prev);
  s.meta = wire.meta;
  s.pending = wire.pending;
  s.log = wire.log;
  s.report = wire.report;
  s.winner = wire.winner;
  s.players = wire.players;
  for (const t of wire.board.tiles) {
    const tile = s.board.tiles.find((x) => x.id === t.id);
    if (tile) tile.owner = t.owner;
  }
  return s;
}

// ── 伪联机回合包 ──

export function exportPassPackage(state, sinceSeq = 0) {
  const actions = state.actionLog.filter((a) => a.seq > sinceSeq);
  const next = nextActor(state);
  // 包里必须带完整状态快照：seed 由 Date.now() 生成，接收方不可能重放出
  // 同一开局，光传 action 对方根本无法应用。旧版 UI 还传 sinceSeq=meta.seq，
  // 过滤后 action 列表恒为空 —— 导入必然校验失败，伪联机完全不可用。
  // 快照剥掉可由本地 data 重建的静态部分（牌堆 catalog、config.__events），
  // 由 restore() 重新挂载。注意 config 本体必须保留：restore() 要往
  // s.config.__events 写事件池，整个删掉 config 会让恢复直接崩。
  const snap = clone(state);
  delete snap.decks.opportunity.catalog;
  delete snap.decks.fate.catalog;
  delete snap.decks.item.catalog;
  delete snap.config.__events;
  snap.log = snap.log.slice(-50);
  snap.actionLog = [];
  return {
    type: "pass-package",
    room: state.meta.room || "",
    version: state.meta.version,
    seed: state.meta.seed,
    seq: state.meta.seq,
    turn: state.meta.turn,
    month: state.meta.month,
    stateHash: hashState(publicView(state)),
    state: snap,
    actions,
    nextActor: next,
    expectAction: expectActionOf(state),
    exportedAt: state.meta.turn,
  };
}

// 只有"对局结果有影响"的部分参与哈希，排除日志/序列号/时间戳。
// 否则接收方哪怕只多了条日志也会判定不一致。
export function publicView(state) {
  return {
    seed: state.meta.seed,
    turn: state.meta.turn,
    fromMonthSettle: !!state.meta.fromMonthSettle,
    month: state.meta.month,
    currentSeat: state.meta.currentSeat,
    rngState: state.meta.rngState,
    board: state.board.tiles.map((t) => ({ id: t.id, owner: t.owner })),
    players: state.players.map((p) => ({
      id: p.id, seat: p.seat, pos: p.pos, cash: p.cash, deposit: p.deposit,
      alive: p.alive, rankId: p.rankId, salaryCoefficient: p.salaryCoefficient,
      rankCoefficient: p.rankCoefficient, loan: p.loan,
      properties: p.properties.map((x) => ({ tileId: x.tileId, monthsLeft: x.monthsLeft, visitsThisMonth: x.visitsThisMonth || 0, financed: x.financed || 0 })),
      vehicles: p.vehicles.map((v) => ({
        id: v.id, heldMonths: v.heldMonths, financed: v.financed || 0,
        monthly: v.monthly || 0, monthsLeft: v.monthsLeft || 0,
        face: v.face || 0, mood: v.mood || 0,
      })),
      cards: p.cards, grants: p.grants, flags: p.flags,
      passiveIncome: p.passiveIncome, livingCostDelta: p.livingCostDelta, loanRateDelta: p.loanRateDelta,
      // aiPlan 参与哈希：AI 计划不同会导致后续决策不同，必须纳入一致性校验
      aiPlan: p.aiPlan ? {
        targetNW: p.aiPlan.targetNW, floorBase: p.aiPlan.floorBase,
        expectedVisits: p.aiPlan.expectedVisits,
        milestones: p.aiPlan.milestones,
        depositTarget: p.aiPlan.depositTarget, depositDone: p.aiPlan.depositDone,
      } : null,
    })),
  };
}

export function importPassPackage(pkg, prevState, data, reducer) {
  if (!pkg || pkg.type !== "pass-package") {
    return { ok: false, reason: "不是有效的回合包文件" };
  }
  const localVer = (prevState && prevState.meta.version) || data.uiText.version;
  if (pkg.version !== localVer) {
    return { ok: false, reason: `版本不符：包 ${pkg.version} vs 本地 ${localVer}` };
  }

  // 新版通道：直接恢复包里的状态快照，再做哈希自检。
  // 不要求接收方有同种子开局 —— 对方拿到文件就能接着玩。
  if (pkg.state) {
    let s;
    try {
      s = restore(pkg.state, data);
    } catch (e) {
      return { ok: false, reason: "状态快照损坏，无法恢复：" + e.message };
    }
    const localHash = hashState(publicView(s));
    if (localHash !== pkg.stateHash) {
      return {
        ok: false,
        reason: `状态校验失败：快照哈希 ${localHash}，包声明 ${pkg.stateHash}（文件可能被改动）`,
      };
    }
    return { ok: true, state: s, actor: pkg.nextActor };
  }

  // 旧版兜底：按 action 重放（要求与发送方同种子、同数据文件）。
  let s = prevState;
  for (const a of pkg.actions) {
    const r = reducer(s, a.action, data);
    if (r.reject) return { ok: false, reason: `重放失败（seq ${a.seq}）：${r.reject}` };
    s = r.state;
  }
  const localHash = hashState(publicView(s));
  if (localHash !== pkg.stateHash) {
    return {
      ok: false,
      reason: `状态校验失败：本机重放得 ${localHash}，包里是 ${pkg.stateHash}`,
    };
  }
  return { ok: true, state: s, actor: pkg.nextActor };
}

function nextActor(state) {
  const p = state.players[state.meta.currentSeat];
  if (!p) return null;
  return { seat: p.seat, playerId: p.id, name: p.name };
}

function expectActionOf(state) {
  switch (state.meta.phase) {
    case "ROLL": return "ROLL_DICE";
    case "TILE_EVENT": return "DISMISS_MODAL";
    case "POST_ACTION": return "END_TURN";
    default: return "END_TURN";
  }
}

export { hashState, stableStringify };
