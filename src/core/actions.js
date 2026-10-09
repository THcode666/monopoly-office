// Action 类型常量 + creator + 阶段白名单。
// 白名单是防作弊与防 UI bug 的第一道闸：不在当前 phase 允许列表里的 action 一律拒绝。

export const PHASE = {
  TURN_START: "TURN_START",
  ROLL: "ROLL",
  MOVING: "MOVING",
  TILE_EVENT: "TILE_EVENT",
  POST_ACTION: "POST_ACTION",
  TURN_END: "TURN_END",
  MONTH_SETTLE: "MONTH_SETTLE",
  BANKRUPT_CHECK: "BANKRUPT_CHECK",
  GAME_OVER: "GAME_OVER",
};

export const A = {
  NEW_GAME: "NEW_GAME",
  ROLL_DICE: "ROLL_DICE",
  RESOLVE_MOVE: "RESOLVE_MOVE",
  RESOLVE_TILE: "RESOLVE_TILE",
  DISMISS_MODAL: "DISMISS_MODAL",
  USE_ITEM: "USE_ITEM",
  PLAY_CARD: "PLAY_CARD",
  BUY_PROPERTY: "BUY_PROPERTY",
  BUY_VEHICLE: "BUY_VEHICLE",
  DEPOSIT: "DEPOSIT",
  WITHDRAW: "WITHDRAW",
  PROPOSE_TRADE: "PROPOSE_TRADE",
  RESPOND_TRADE: "RESPOND_TRADE",
  CANCEL_TRADE: "CANCEL_TRADE",
  END_TURN: "END_TURN",
  AI_DECIDE: "AI_DECIDE",
  CLAIM_ASSET: "CLAIM_ASSET",
  LOAN_REQ: "LOAN_REQ",
  DRAW_CARD: "DRAW_CARD",
  // 仅用于 tools/human-sim.mjs 模拟真人的非理性冲动消费。
  // 走正规 action 通道，保证 reducer 之外没有旁路改状态（伪联机一致性要求）。
  IMPULSE_SPEND: "IMPULSE_SPEND",
};

// 每个阶段允许的 action。系统内部 action（RESOLVE_*）不在这里，由引擎直接调用。
export const PHASE_ALLOWED = {
  TURN_START: [A.ROLL_DICE, A.USE_ITEM, A.PLAY_CARD, A.END_TURN, A.AI_DECIDE],
  ROLL: [A.ROLL_DICE, A.USE_ITEM, A.PLAY_CARD, A.AI_DECIDE],
  MOVING: [A.BUY_VEHICLE, A.AI_DECIDE],
  TILE_EVENT: [
    A.RESOLVE_TILE, A.BUY_PROPERTY, A.BUY_VEHICLE,
    A.USE_ITEM, A.PLAY_CARD, A.DISMISS_MODAL, A.AI_DECIDE,
  ],
  POST_ACTION: [
    A.USE_ITEM, A.PLAY_CARD, A.DEPOSIT, A.WITHDRAW,
    A.PROPOSE_TRADE, A.RESPOND_TRADE, A.CANCEL_TRADE,
    A.BUY_PROPERTY, A.BUY_VEHICLE, A.DISMISS_MODAL,
    A.LOAN_REQ, A.IMPULSE_SPEND, A.END_TURN, A.AI_DECIDE,
  ],
  TURN_END: [],
  MONTH_SETTLE: [],
  BANKRUPT_CHECK: [A.CLAIM_ASSET],
  GAME_OVER: [A.NEW_GAME],
};

export const isAllowed = (phase, type) => (PHASE_ALLOWED[phase] || []).includes(type);

export const make = {
  newGame: (p) => ({ type: A.NEW_GAME, ...p }),
  rollDice: (p) => ({ type: A.ROLL_DICE, ...p }),
  useItem: (p) => ({ type: A.USE_ITEM, ...p }),
  playCard: (p) => ({ type: A.PLAY_CARD, ...p }),
  buyProperty: (tileId) => ({ type: A.BUY_PROPERTY, tileId }),
  buyVehicle: (tileId, optionId) => ({ type: A.BUY_VEHICLE, tileId, optionId }),
  deposit: (amount) => ({ type: A.DEPOSIT, amount }),
  withdraw: (amount) => ({ type: A.WITHDRAW, amount }),
  proposeTrade: (p) => ({ type: A.PROPOSE_TRADE, ...p }),
  respondTrade: (tradeId, accept) => ({ type: A.RESPOND_TRADE, tradeId, accept }),
  cancelTrade: (tradeId) => ({ type: A.CANCEL_TRADE, tradeId }),
  endTurn: () => ({ type: A.END_TURN }),
  loanReq: (amount) => ({ type: A.LOAN_REQ, amount }),
  drawCard: (deckName) => ({ type: A.DRAW_CARD, deckName }),
  aiDecide: (playerId) => ({ type: A.AI_DECIDE, playerId }),
  dismissModal: () => ({ type: A.DISMISS_MODAL }),
  claimAsset: (p) => ({ type: A.CLAIM_ASSET, ...p }),
};
