// 破产清算：现金为负时按 liquidationOrder 依次变卖，仍为负则出局。
// 有 graceRounds 宽限期，避免卡在 0 附近被一张命运卡秒出局。

import { round2 } from "./util.js";
import { netWorth } from "./economy.js";

export function checkBankrupt(state, playerId) {
  const p = state.players.find((x) => x.id === playerId);
  // 三个返回分支的形状必须一致：调用方会无差别访问 .bankrupt/.warned/.pawned
  if (!p || !p.alive) return { bankrupt: false, warned: false, pawned: [], rescued: 0 };
  const cfg = state.config.game.bankruptcy;

  if (p.cash >= cfg.minCashAfterLiquidation) {
    p.flags.lastWarn = false;
    return { bankrupt: false, warned: false, pawned: [], rescued: 0 };
  }

  // 宽限期：第一次触发只警告，给玩家一次补救机会
  if (!p.flags.lastWarn && cfg.graceRounds > 0) {
    p.flags.lastWarn = true;
    p.flags.warnMonth = p.meta.month;
    return { bankrupt: false, warned: true, pawned: [], rescued: 0 };
  }

  // 清算
  const report = { bankrupt: false, rescued: 0, pawned: [] };

  for (const kind of cfg.liquidationOrder) {
    if (p.cash >= cfg.minCashAfterLiquidation) break;

    if (kind === "vehicle") {
      while (p.vehicles.length && p.cash < cfg.minCashAfterLiquidation) {
        const v = p.vehicles.pop();
        const value = round2(v.price * state.config.economy.sellPropertyRatio);
        p.cash = round2(p.cash + value);
        report.pawned.push({ kind: "vehicle", name: v.name, amount: value });
      }
    } else if (kind === "property") {
      // 从最贵的房产开始卖
      while (p.properties.length && p.cash < cfg.minCashAfterLiquidation) {
        p.properties.sort((a, b) => b.price - a.price);
        const prop = p.properties.shift();
        const value = round2(
          prop.price * state.config.economy.sellPropertyRatio
        );
        p.cash = round2(p.cash + value);
        // 释放服务器上的地皮归属
        const tile = state.board.tiles.find((t) => t.id === prop.tileId);
        if (tile && tile.owner === playerId) tile.owner = null;
        report.pawned.push({ kind: "property", name: prop.name, amount: value });
      }
    } else if (kind === "deposit") {
      if (p.deposit > 0 && p.cash < cfg.minCashAfterLiquidation) {
        const amount = p.deposit;
        p.cash = round2(p.cash + amount);
        p.deposit = 0;
        report.pawned.push({ kind: "deposit", name: "存款", amount });
      }
    }
  }

  // 清算后仍为负 → 破产
  if (p.cash < cfg.minCashAfterLiquidation) {
    p.alive = false;
    p.bankruptAtRound = state.meta.turn;
    report.bankrupt = true;
  } else {
    report.rescued = round2(-p.cash);
    p.flags.lastWarn = false;
  }

  return report;
}

// 玩家净资产（破产判定时用于"你其实有钱，只是现金周转不开"的判断展示）
export function worthOf(state, playerId) {
  return netWorth(state, playerId);
}
