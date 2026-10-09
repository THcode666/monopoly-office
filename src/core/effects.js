// 效果解释器：把 JSON 里的 effects 数组应用到 state 上。
// 纯函数 —— 修改传入的 draft（调用方已 clone），返回 diff 列表。

import { clone, clamp, round2 } from "./util.js";

// shield（折叠伞）的本地实现，避免 effects ↔ cards 的 import 环。
const hasShield = (p) => p.grants.some((g) => g.op === "shield");
function consumeShield(p) {
  const g = p.grants.find((g) => g.op === "shield");
  if (!g) return false;
  g.count = (g.count || 1) - 1;
  if (g.count <= 0) p.grants.splice(p.grants.indexOf(g), 1);
  return true;
}

export const OPS = new Set([
  "cash", "deposit", "transferCash", "cashLossRatio", "payRent",
  "rankCheck", "rankCoefficientDelta", "salaryCoefficientDelta",
  "stat", "passiveIncome", "livingCostDelta", "loanRateDelta",
  "skipNext", "moveTo", "loan", "repay", "drawCard", "none",
]);

// resolveEffects(state, effects, ctx, diff)
// ctx: { actorId, rngRef: {rng}, data, log }
export function resolveEffects(state, effects, ctx, diff) {
  if (!effects) return;
  for (const eff of effects) applyEffect(state, eff, ctx, diff);
}

function applyEffect(state, eff, ctx, diff) {
  if (!eff || !OPS.has(eff.op)) return;
  const me = ctx.actorId;
  const data = ctx.data;

  switch (eff.op) {
    case "none":
      break;

    case "cash": {
      const p = byId(state, me);
      if (!p) break;
      // 折叠伞：挡下一次负面事件的现金损失
      if (eff.delta < 0 && hasShield(p)) {
        consumeShield(p);
        ctx.log && ctx.log(`${p.name} 撑开折叠伞，挡下了 ${-eff.delta} 元损失`);
        diff.push({ t: "shield", id: me });
        break;
      }
      const before = p.cash;
      p.cash = round2(p.cash + eff.delta);
      diff.push({ t: "cash", id: me, from: before, to: p.cash });
      break;
    }

    case "deposit": {
      const p = byId(state, me);
      if (!p) break;
      const d = eff.delta;
      // 存款不能为负：从现金补足
      if (p.deposit + d < 0) {
        const need = -(p.deposit + d);
        if (p.cash >= need) {
          p.cash = round2(p.cash - need);
          p.deposit = 0;
        } else {
          break;
        }
      } else {
        p.deposit = round2(p.deposit + d);
      }
      diff.push({ t: "deposit", id: me, to: p.deposit });
      break;
    }

    case "payRent": {
      // 按当前所在格子的 rent 扣现金，不足额按实际余额扣
      const p = byId(state, me);
      if (!p) break;
      const tileId = eff.tileId != null ? eff.tileId : p.pos;
      const tile = state.board.tiles.find((t) => t.id === tileId);
      const rent = eff.delta || (tile && tile.payload.rent) || 0;
      const actual = Math.min(p.cash, rent);
      p.cash = round2(p.cash - actual);
      diff.push({ t: "cash", id: me, to: p.cash });
      ctx.log && ctx.log(`${p.name} 支付房租 ${Math.round(actual)} 元`);
      break;
    }

    case "cashLossRatio": {
      const p = byId(state, me);
      if (!p) break;
      // 折叠伞同样挡比例损失（裁员卡 -25% 现金这类）
      if (hasShield(p)) {
        consumeShield(p);
        ctx.log && ctx.log(`${p.name} 撑开折叠伞，挡下了一次比例现金损失`);
        diff.push({ t: "shield", id: me });
        break;
      }
      const loss = Math.min(p.cash, Math.max(0, p.cash * (eff.ratio || 0)));
      p.cash = round2(p.cash - loss);
      diff.push({ t: "cash", id: me, to: p.cash });
      ctx.log && ctx.log(`${p.name} 损失现金 ${Math.round(loss)} 元`);
      break;
    }

    case "transferCash": {
      // 从 target 扣，给 actor。目标不足额时按实际余额扣，不产生负现金穿透。
      const targets = resolveTargets(state, eff.target, me, ctx);
      for (const t of targets) {
        if (t.id === me) continue;
        const amount = Math.min(t.cash, Math.abs(eff.delta || 0));
        t.cash = round2(t.cash - amount);
        diff.push({ t: "cash", id: t.id, to: t.cash });
        // 37.5% 回流给 actor（背锅侠卡面：对方 -8000 / 自己 +3000，即 8000×0.375）
        const back = Math.round(amount * 0.375);
        const me2 = byId(state, me);
        if (me2) {
          me2.cash = round2(me2.cash + back);
          diff.push({ t: "cash", id: me, to: me2.cash });
        }
        ctx.log && ctx.log(`${t.name} 被扣 ${Math.round(amount)} 元`);
      }
      break;
    }

    case "rankCoefficientDelta": {
      const p = byId(state, me);
      if (!p) break;
      p.rankCoefficient = round2(Math.max(0.3, p.rankCoefficient + eff.delta));
      diff.push({ t: "rankCoefficient", id: me, to: p.rankCoefficient });
      break;
    }

    case "salaryCoefficientDelta": {
      const p = byId(state, me);
      if (!p) break;
      p.salaryCoefficient = round2(Math.max(0.4, p.salaryCoefficient + eff.delta));
      diff.push({ t: "salaryCoefficient", id: me, to: p.salaryCoefficient });
      break;
    }

    case "stat": {
      const p = byId(state, me);
      if (!p) break;
      p.stats[eff.key] = clamp((p.stats[eff.key] || 0) + eff.delta, 0, 100);
      diff.push({ t: "stat", id: me, key: eff.key, to: p.stats[eff.key] });
      break;
    }

    case "passiveIncome": {
      const p = byId(state, me);
      if (!p) break;
      p.passiveIncome = round2((p.passiveIncome || 0) + eff.delta);
      diff.push({ t: "passiveIncome", id: me, to: p.passiveIncome });
      break;
    }

    case "livingCostDelta": {
      const p = byId(state, me);
      if (!p) break;
      p.livingCostDelta = round2(clamp((p.livingCostDelta || 0) + eff.delta, -0.5, 1.5));
      diff.push({ t: "livingCostDelta", id: me, to: p.livingCostDelta });
      break;
    }

    case "loanRateDelta": {
      const p = byId(state, me);
      if (!p) break;
      p.loanRateDelta = round2((p.loanRateDelta || 0) + eff.delta);
      diff.push({ t: "loanRateDelta", id: me, to: p.loanRateDelta });
      break;
    }

    case "rankCheck": {
      rankCheck(state, me, eff.delta || 1, ctx, diff);
      break;
    }

    case "skipNext": {
      const p = byId(state, me);
      if (!p) break;
      p.flags.skipNextTurn = (p.flags.skipNextTurn || 0) + (eff.count || 1);
      diff.push({ t: "flags", id: me });
      break;
    }

    case "moveTo": {
      const p = byId(state, me);
      if (!p) break;
      p.pos = eff.tileId;
      diff.push({ t: "move", id: me, to: p.pos, teleport: true });
      break;
    }

    case "loan": {
      const p = byId(state, me);
      if (!p) break;
      const principal = eff.principal || 0;
      p.loan.principal = round2(p.loan.principal + principal);
      p.loan.monthsLeft = Math.max(p.loan.monthsLeft, eff.months || 12);
      p.cash = round2(p.cash + principal);
      diff.push({ t: "loan", id: me, to: p.loan });
      diff.push({ t: "cash", id: me, to: p.cash });
      break;
    }

    case "repay": {
      const p = byId(state, me);
      if (!p) break;
      const amt = Math.min(p.cash, eff.principal || p.loan.principal);
      p.cash = round2(p.cash - amt);
      p.loan.principal = round2(Math.max(0, p.loan.principal - amt));
      diff.push({ t: "loan", id: me, to: p.loan });
      diff.push({ t: "cash", id: me, to: p.cash });
      break;
    }

    case "drawCard": {
      const n = eff.count || 1;
      const deck = ctx.deckApi(state, eff.deck, ctx, diff);
      for (let i = 0; i < n; i++) deck();
      break;
    }
  }
}

// 按净资产门槛升/降职级。direction: +1 升, -1 降
export function rankCheck(state, playerId, direction, ctx, diff) {
  const p = byId(state, playerId);
  if (!p) return;
  const ranks = ctx.data.config.ranks;
  let idx = ranks.findIndex((r) => r.id === p.rankId);
  if (idx < 0) idx = 0;
  const nw = ctx.netWorth(state, playerId);
  const target = idx + direction;
  if (target < 0 || target >= ranks.length) return;

  // 升职有门槛；降职无条件
  if (direction > 0 && nw < ranks[target].minNetWorth) {
    ctx.log && ctx.log(`${p.name} 资产还不够升到 ${ranks[target].name}`);
    return;
  }
  p.rankId = ranks[target].id;
  p.rankCoefficient = ranks[target].coefficient;
  diff.push({ t: "rank", id: playerId, to: p.rankId });
  ctx.log && ctx.log(
    `${p.name} ${direction > 0 ? "升职为" : "降职为"} ${ranks[target].name}`
  );
}

// target 解析：self / randomOther / richest / poorest / other / pick
export function resolveTargets(state, target, selfId, ctx) {
  const alive = state.players.filter((p) => p.alive && p.id !== selfId);
  switch (target) {
    case "self":
      return state.players.filter((p) => p.id === selfId);
    case "randomOther": {
      if (!alive.length) return [];
      const [, r] = ctx.pickRandom(alive.length);
      ctx.rngRef.rng = r;
      return [alive[ctx.lastPick]];
    }
    case "richest": {
      const sorted = state.players
        .filter((p) => p.alive && p.id !== selfId)
        .sort((a, b) => ctx.netWorth(state, b.id) - ctx.netWorth(state, a.id));
      return sorted.slice(0, 1);
    }
    case "poorest": {
      const sorted = state.players
        .filter((p) => p.alive && p.id !== selfId)
        .sort((a, b) => ctx.netWorth(state, a.id) - ctx.netWorth(state, b.id));
      return sorted.slice(0, 1);
    }
    case "other":
    case "pick":
      return alive.slice(0, 1);
    default:
      return [];
  }
}

function byId(state, id) {
  return state.players.find((p) => p.id === id);
}
