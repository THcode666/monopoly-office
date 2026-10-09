// AI 决策器：三种性格 → 目标计划 + 计划对照决策。
//
// 第 3 步重写说明：第 2 版的单步贪心导致三性格行为趋同（净资产差异 <3%），
// 根因是"买不起就攒钱、攒够就全款买光、买完归零"的循环。
// 本版改为：开局生成 40 回合目标计划（aiPlan.js），每回合对照计划纠偏。
// 决策问的是「离下一个里程碑还差多少、还剩几回合、现金地板是多少」，
// 而不再是「现在钱够不够」。

import { netWorth, monthlySalary, monthlyLiving, monthlyDebt } from "./economy.js";
import { hasGrant, consumeGrant } from "./cards.js";
import { PHASE } from "./actions.js";
import { nextFloat } from "./rng.js";
import { buildPlan, currentMilestone, turnCashFloor, turnsLeft } from "./aiPlan.js";

// 若玩家尚无计划（存档恢复等情况），现场生成一份
function ensurePlan(state, playerId, data) {
  const p = state.players.find((x) => x.id === playerId);
  if (!p) return null;
  if (!p.aiPlan) p.aiPlan = buildPlan(state, playerId, data);
  return p.aiPlan;
}

// 对外入口：保证决策不改变 rng 流。
// decideActions 会被 main.step / harness 在 reducer 之外调用，
// 旧版在里面为"要不要打命运卡"推进 rngState —— 这份消耗不进 actionLog，
// 接收方按 action 重放时无法复现同样的 rngState，伪联机哈希校验必然失败。
// 决策期的随机数是"私事"，用完还原。
export function decideActions(state, playerId, data) {
  const rng0 = state.meta.rngState;
  try {
    const acts = decideInner(state, playerId, data);
    // 金额为 0 的存取款会被 reducer 判非法（amt<=0 → return false），
    // 调度层反复重试就是活锁（seed 777 实测：里程碑差 4 毛钱时
    // Math.round(gap*0.8)===0，AI 永远取不出这笔钱也永远不结束回合）。
    // 出口处统一过滤，被滤掉后若没有 END_TURN 就补一个，保证回合能收尾。
    const ok = acts.filter((a) =>
      !((a.type === "DEPOSIT" || a.type === "WITHDRAW") && !(a.amount >= 1)));
    if (ok.length !== acts.length && !ok.some((a) => a.type === "END_TURN")) {
      ok.push({ type: "END_TURN" });
    }
    return ok;
  } finally {
    state.meta.rngState = rng0;
  }
}

function decideInner(state, playerId, data) {
  const p = state.players.find((x) => x.id === playerId);
  if (!p || !p.alive) return [];
  const prof = data.aiProfiles.profiles.find((x) => x.id === p.aiProfile)
    || data.aiProfiles.profiles[0];
  const w = { ...prof.weights };
  const th = { ...prof.thresholds };

  const plan = ensurePlan(state, playerId, data);
  if (!plan) return [{ type: "END_TURN" }];

  const nw = netWorth(state, playerId);
  const salary = monthlySalary(state, playerId);
  const living = monthlyLiving(state, playerId);
  const debt = monthlyDebt(state, playerId);
  const monthlyBurn = living + debt;
  const left = turnsLeft(state);
  const floor = turnCashFloor(plan, state.meta.turn, state.meta.maxRounds);

  // 距目标曲线还差多少 —— 用于判断"该不该加杠杆"
  const targetCurve = curveAt(plan, state.meta.turn, state.meta.maxRounds);
  const behindCurve = targetCurve > 0 ? (targetCurve - nw) / targetCurve : 0;

  // 现金告急：连下个月工资都撑不到
  const desperate = p.cash < monthlyBurn * 0.5;
  const debtRatio = nw > 0 ? p.loan.principal / nw : 0;

  const ctx = { state, data, prof, w, th, plan, log: () => {} };
  const out = [];
  const phase = state.meta.phase;

  // ── 落位阶段：买地 / 买车 ──
  if (phase === PHASE.TILE_EVENT || phase === PHASE.MOVING) {
    const tile = state.board.tiles.find((t) => t.id === p.pos);
    if (tile) {
      if ((tile.type === "property" || tile.type === "company") && tile.owner == null) {
        // 第 3 步教训：死守"计划里程碑"会让 AI 错过所有机会。
        // 实测里程碑定在第 4/18/27/34 回合，但 AI 未必在那时走到那个格子，
        // 结果 400 局只买到 0.07 套 —— 计划变成了枷锁而不是指引。
        // 改为：只要路过的可购资产符合条件就买（计划只用于排序与优先级）。
        const ms = currentMilestone(plan, state.meta.turn);
        const price = tile.payload.price;
        const rent = tile.payload.rent || 0;
        if (shouldBuy(state, p, price, rent, plan, floor, salary, left, w, th, ms)) {
          out.push({ type: "BUY_PROPERTY", tileId: tile.id });
        }
      }
      if (tile.type === "vehicle") {
        const choice = pickVehicle(tile, w, p.stats);
        if (choice) {
          // 按首付判断（与 reducer.onBuyVehicle 同一口径）
          const downRatio = 1 - state.config.economy.mortgageRatio;
          const down = Math.round(choice.price * downRatio);
          // 车的两条购买逻辑：
          //   投资视角：生活减免 × 剩余月数能收回半价（10 个月短局里几乎只有长持才成立）
          //   消费视角：keepCash 低（愿意为面子/心情花钱）且这台车情绪价值够
          // 旧公式 livingDiscount×2 >= price×0.1 要求 10 个月省回 20% 车价，
          // 全地图没有车能满足（最便宜的也要 27 个月）→ 300 局人均 0.00 辆，买车格形同虚设。
          const monthsLeft = Math.max(1, Math.round(left / state.config.game.roundsPerMonth));
          const savedTotal = (choice.livingDiscount || 0) * monthsLeft;
          const asInvestment = savedTotal >= choice.price * 0.5;
          const asConsumption = w.keepCash < 0.25
            && ((choice.face || 0) + (choice.mood || 0)) >= 8;
          const worthIt = asInvestment || asConsumption;
          if (worthIt && p.cash >= down + floor * 0.3) {
            out.push({ type: "BUY_VEHICLE", tileId: tile.id, optionId: choice.id });
          }
        }
      }
    }
    out.push({ type: "DISMISS_MODAL" });
    return out;
  }

  // ── 回合后阶段 ──
  if (phase === PHASE.POST_ACTION) {
    // 1. 紧急自救优先于一切
    if (desperate) {
      if (p.deposit > 2000) {
        out.push({ type: "WITHDRAW", amount: Math.min(p.deposit, Math.round(monthlyBurn)) });
        out.push({ type: "END_TURN" });
        return out;
      }
      if (debtRatio < th.loanMaxRatio) {
        out.push({ type: "LOAN_REQ", amount: Math.round(monthlyBurn * 2) });
        out.push({ type: "END_TURN" });
        return out;
      }
    }

    // 2. 为下一个里程碑攒钱：现金低于地板且买不起目标 → 攒
    const ms = currentMilestone(plan, state.meta.turn);
    const buyingSoon = ms && ms.round - state.meta.turn <= 3;

    if (ms && buyingSoon) {
      const gap = ms.price - p.cash;
      // 差得不多 → 卖资产凑（贪婪型更愿意这么干）
      if (gap > 0 && gap < ms.price * 0.35 && w.buyProperty > 0.6 && p.properties.length > 1) {
        out.push({ type: "END_TURN" });
        return out;
      }
      // 落后于曲线 → 该出手了，用存款/贷款补足
      if (gap > 0 && p.cash < ms.price) {
        if (behindCurve > 0.25 && p.deposit > 5000) {
          out.push({ type: "WITHDRAW", amount: Math.min(p.deposit, Math.round(gap * 0.8)) });
          out.push({ type: "END_TURN" });
          return out;
        }
        if (behindCurve > 0.35 && debtRatio < th.loanMaxRatio * 0.8) {
          out.push({ type: "LOAN_REQ", amount: Math.round(gap * 0.7) });
          out.push({ type: "END_TURN" });
          return out;
        }
      }
    }

    // 3. 用道具
    const item = bestItem(state, p, w, ms);
    if (item) {
      out.push({ type: "USE_ITEM", cardId: item.id, targetId: playerId });
      return out;
    }

    // 4. 打机会卡
    const opp = bestCard(state, p, "opportunity", w.cardOpportunity);
    if (opp) {
      out.push({ type: "PLAY_CARD", cardId: opp.id, targetId: playerId });
      return out;
    }

    // 5. 命运卡：现金厚实且性格倾向高才打（用 seeded rng）
    if (p.cash > monthlyBurn * 3) {
      const fate = bestCard(state, p, "fate", w.cardFate);
      if (fate) {
        const [f, r] = nextFloat(state.meta.rngState);
        state.meta.rngState = r;
        if (f < w.cardFate * 0.35) {
          out.push({ type: "PLAY_CARD", cardId: fate.id, targetId: playerId });
          return out;
        }
      }
    }

    // 6. 存款里程碑（稳健型）
    if (plan.depositTarget && !plan.depositDone && p.cash > plan.depositTarget * 1.3) {
      out.push({ type: "DEPOSIT", amount: Math.min(p.cash - floor, plan.depositTarget) });
      out.push({ type: "END_TURN" });
      return out;
    }

    // 7. 常规节流：现金高于地板 + 一个安全垫才存
    const idle = p.cash - floor - monthlyBurn;
    if (w.deposit > 0.4 && idle > 12000) {
      out.push({ type: "DEPOSIT", amount: Math.round(idle * 0.6) });
    }

    // 8. 提前到达目标后，考虑加仓（贪婪型会主动买第二套）
    const idleAfterGoal = !currentMilestone(plan, state.meta.turn) && p.cash > floor * 2.5;
    if (idleAfterGoal && p.deposit > 20000 && w.deposit > 0.5) {
      out.push({ type: "WITHDRAW", amount: 10000 });
    }

    out.push({ type: "END_TURN" });
    return out;
  }

  return [{ type: "END_TURN" }];
}

// 目标净资产曲线：按回合线性插值
function curveAt(plan, turn, maxRounds) {
  const t = Math.max(0, Math.min(1, turn / maxRounds));
  return plan.targetNW * t;
}

  // 买房决策：对照计划，而不是"有钱就买"
  function shouldBuy(state, p, price, rent, plan, floor, salary, left, w, th, ms) {
    const nw = netWorth(state, p.id);

    // 现金地板判断必须按【首付】算，不是全款。
    // 第 3 步实测这个 bug 导致 AI 永远认为"买房=掏空现金"：
    // 现金 56000、房价 70000、首付只要 21000，却被算成 56000-70000=-14000 而拒绝。
    // 结果 AI 系统性放弃地产（每局 0.06 套），整个地产玩法闲置。
    const downRatio = 1 - state.config.economy.mortgageRatio; // mortgageRatio=0.7 → 首付 30%
    const down = Math.round(price * downRatio);
    const afterDown = p.cash - down;

    // 首付付不起 → 需要贷款，先算回本与杠杆是否划算
    if (afterDown < 0) {
      const extraLoan = -afterDown;
      // 回本周期必须落在剩余回合内，否则买了也白买
      const annualIncome = rent * plan.expectedVisits * 12;
      const paybackMonths = Math.ceil(price / Math.max(1, annualIncome / 12));
      if (paybackMonths > left) return false;
      // 杠杆口径必须与 reducer.onBuyProperty 完全一致：
      // postDebt = 已有消费贷本金 + 本次贷款（旧版漏了已有本金，AI 自以为批得过，
      // reducer 实际拒绝 → 共享驱动/主循环里反复碰壁）。
      const postAssets = nw + extraLoan;
      const postDebt = p.loan.principal + extraLoan;
      const postDebtRatio = postAssets > 0 ? postDebt / postAssets : 1;
      if (postDebtRatio > Math.min(th.loanMaxRatio, 0.75)) return false;
      // 保守型不接受纯举债买房
      if (w.takeLoan < 0.3 && p.loan.principal > 0) return false;
    } else {
      // 付得起首付：买完仍要守住现金地板（剩 6 回合内可放弃地板，反正没时间回本了）
      if (afterDown < floor && left > 6) return false;
      // 掏空现金去买房且不贷款 = 不划算
      if (afterDown < floor * 0.5 && price > salary * 3) return false;
    }

  // 回报率必须跑赢存款（用期望被踩次数，与 pickTargets 同一口径）
  const roi = (rent * plan.expectedVisits * 12) / price;
  const depositRoi = state.config.economy.depositInterestRate * 12;
  if (roi < depositRoi * 0.9) return false;

  // 越过下一级职级门槛的房产额外加分
  const ranks = state.config.ranks;
  const idx = ranks.findIndex((r) => r.id === p.rankId);
  const nextRank = ranks[idx + 1];
  if (nextRank && nw < nextRank.minNetWorth && nw + price >= nextRank.minNetWorth) return true;

  // 否则按性格权重决定：贪心型买得多，稳健型要求回报率更高
  const threshold = 0.0025 + (1 - w.buyProperty) * 0.004;
  return roi > depositRoi + threshold;
}

// 选车：贪婪/消费型买最贵的（看面子），稳健型买最划算的（按"生活减免回本周期"）
function pickVehicle(tile, w, stats) {
  const opts = (tile.payload.options || []).filter(Boolean);
  if (!opts.length) return null;
  if (w.buyProperty > 0.8) return opts[opts.length - 1];
  if (w.buyProperty > 0.5) {
    // 中档：面子与回本周期取平衡
    const mid = opts[Math.floor(opts.length / 2)];
    return mid;
  }
  // 稳健型：选每月省下的最多（回本最快）的
  return opts.slice().sort((a, b) =>
    (b.livingDiscount || 0) / b.price - (a.livingDiscount || 0) / a.price
  )[0];
}

function bestItem(state, p, w, ms) {
  if (w.useItem < 0.5) return null;
  const hand = p.cards.item || [];
  // 攒钱买楼时不喝咖啡
  if (ms && p.cash < ms.price && hand.includes("coffee")) return null;
  for (const id of hand) {
    return { id };
  }
  return null;
}

function bestCard(state, p, deck, weight) {
  if (weight < 0.4) return null;
  const hand = p.cards[deck] || [];
  if (!hand.length) return null;
  return { id: hand[0] };
}

// ── 里程碑完成回调：买下后标记，供 UI 与后续决策参考 ──
export function markMilestone(playerId, tileId, state) {
  const p = state.players.find((x) => x.id === playerId);
  if (!p || !p.aiPlan) return;
  const m = p.aiPlan.milestones.find((x) => x.tileId === tileId);
  if (m) m.done = true;
}

export function markDeposit(playerId, state) {
  const p = state.players.find((x) => x.id === playerId);
  if (!p || !p.aiPlan) return;
  if (p.deposit >= p.aiPlan.depositTarget) p.aiPlan.depositDone = true;
}
