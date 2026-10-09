// 经济系统：月薪计算、净资产计算、月度结算管线（顺序固定，便于单测）。

import { round2, clamp } from "./util.js";

// 月薪 = 基础工资 × 职级系数 × 加薪系数 × (1 - 税率)
export function monthlySalary(state, playerId) {
  const p = playerOf(state, playerId);
  const cfg = state.config;
  const rank = cfg.ranks.find((r) => r.id === p.rankId) || cfg.ranks[0];
  const rate = cfg.economy.loanInterestRate + (p.loanRateDelta || 0);
  const gross = cfg.economy.baseSalary * rank.coefficient * p.salaryCoefficient;
  const net = gross * (1 - cfg.economy.salaryTaxRate);
  return round2(net);
}

// 生活开销 = 职级基础开销 × (1 + 玩家永久修正) × 车辆减免
export function monthlyLiving(state, playerId) {
  const p = playerOf(state, playerId);
  const cfg = state.config;
  const rank = cfg.ranks.find((r) => r.id === p.rankId) || cfg.ranks[0];
  let cost = cfg.economy.livingCostByRank[rank.name] || 1000;
  cost *= 1 + (p.livingCostDelta || 0);

  // 车辆抵扣（livingDiscount 直接减额，封顶不超过开销本身）
  const discount = p.vehicles.reduce((s, v) => s + (v.livingDiscount || 0), 0);
  cost -= discount;

  // 本月道具：餐补券（减半）/ 摸鱼（全免）
  if (p.grants.some((g) => g.op === "exemptLiving")) cost = 0;
  else if (p.grants.some((g) => g.op === "halveLiving")) cost = round2(cost * 0.5);

  return round2(Math.max(0, cost));
}

// 月供合计（房贷 + 车贷）
export function monthlyDebt(state, playerId) {
  const p = playerOf(state, playerId);
  let total = 0;
  for (const prop of p.properties) total += prop.monthly || 0;
  for (const v of p.vehicles) total += v.monthly || 0;
  total += p.loan.monthly || 0;
  return round2(total);
}

// 收租收入 = Σ (各房产 baseRent × 持有加成 × 本月被踩次数)
// 地皮每月被踩期望约 1.05 次（40 格地图、40 回合、平均骰子 3.5），
// 所以热门地皮能产生稳定现金流，冷门地皮接近空置 —— 位置选择有实际收益。
// 持有加成必须与 reducer.payRentTo 同口径（每月 +2%），
// 否则"路过被踩的租金"和"月末结算的租金"是两个数。
export function monthlyRentIncome(state, playerId) {
  const p = playerOf(state, playerId);
  let total = 0;
  for (const prop of p.properties) {
    const visits = prop.visitsThisMonth || 0;
    const upgrade = 1 + (prop.upgradeMonths || 0) * 0.02;
    total += (prop.rent || 0) * upgrade * visits;
  }
  return round2(total);
}

export function depositInterest(state, playerId) {
  const p = playerOf(state, playerId);
  return round2(p.deposit * state.config.economy.depositInterestRate);
}

export function loanInterest(state, playerId) {
  const p = playerOf(state, playerId);
  const rate = state.config.economy.loanInterestRate + (p.loanRateDelta || 0);
  return round2(p.loan.principal * rate);
}

// 净资产 = 现金 + 存款 + 房产估值 + 车辆估值
// 净资产 = 现金 + 存款 + 房产估值 + 车辆估值 − 全部负债
//
// 负债必须扣。第 2 步实测发现这里漏了 loan.principal 和房贷/车贷剩余本金的扣除，
// 导致 AI「只要借钱净资产就涨」——借 3.8 万凭空造出 3.8 万净资产，
// 贪婪型因此拿到 82% 胜率。这是平衡性的头号漏洞。
export function netWorth(state, playerId) {
  const p = playerOf(state, playerId);
  if (!p) return 0;

  let assets = p.cash + p.deposit;
  for (const prop of p.properties) assets += currentPropertyValue(p, prop);
  for (const veh of p.vehicles) assets += currentVehicleValue(veh);

  const debt = totalDebt(p);
  return round2(assets - debt);
}

// 总负债 = 消费贷本金 + 各房产未还本金 + 各车辆未还本金
export function totalDebt(p) {
  let d = p.loan.principal || 0;
  for (const prop of p.properties) {
    // mortgageRatio 决定首付，余下部分是贷款；monthsLeft 为 0 表示全款
    const financed = prop.financed || 0;
    d += financed;
  }
  for (const veh of p.vehicles) {
    d += veh.financed || 0;
  }
  return d;
}

// 资产估值 = 买入价 × (1 + 月升值率)^持有月数
//
// 第 3 步实测：只靠租金，40 回合（10 个月）内回本要 72 个月，地产结构上跑不起来。
// 而且原先只有 0.25%/月的线性升值，10 个月才涨 2.5%，买房毫无吸引力
// —— AI 系统性避开地产（每局只买 0.06 套）。
//
// 修法：区分两种持有者
//   - 短线（持有 < 3 个月）：只有基础升值，几乎无利可图，鼓励"别乱囤"
//   - 长线（持有 >= 3 个月）：享受持有溢价，对应现实中"捂盘等涨"的逻辑
// 这样"什么时候买"成为真正的策略，而不是无脑早买。
export function currentPropertyValue(p, prop) {
  const held = Math.max(0, (prop.heldMonths || 0));
  const base = p.meta.appreciation || 0;
  // 持有满 3 个月解锁溢价，第 6 个月达到满额
  const tier = held >= 6 ? 3 : held >= 4 ? 2 : held >= 3 ? 1 : 0;
  const bonus = base * HOLDING_BONUS[tier];
  return round2(prop.price * (1 + base * held) * (1 + bonus * held));
}

// 持有期溢价倍率（0/1/2/3 月 → 0/1/2/3 倍基础升值率）
const HOLDING_BONUS = [0, 1, 2, 3];

export function currentVehicleValue(veh) {
  const held = veh.heldMonths || 0;
  return round2(veh.price * Math.pow(1 - (veh.depreciation || 0.02), held));
}

// 月度结算管线。返回明细报告（UI 直接展示，也是单测的断言对象）。
export function settleMonth(state, playerId, diff, log) {
  const p = playerOf(state, playerId);
  const e = state.config.economy;
  const r = {
    month: p.meta.month,
    player: p.name,
    salary: 0, rentIncome: 0, living: 0, debt: 0,
    interestPaid: 0, interestEarned: 0, passive: 0,
    net: 0, assetChange: 0, rankUp: null, rankDown: null,
    rescued: 0, pawned: [],
  };

  // 1. 应发工资
  r.salary = monthlySalary(state, playerId);
  p.cash = round2(p.cash + r.salary);

  // 2. 收租收入（先算，清零放在最后——顺序错了租金会永远收不到）
  r.rentIncome = monthlyRentIncome(state, playerId);
  p.cash = round2(p.cash + r.rentIncome);

  // 2b. 卡片带来的被动收入
  r.passive = round2(p.passiveIncome || 0);
  p.cash = round2(p.cash + r.passive);

  // 3. 生活开销
  r.living = monthlyLiving(state, playerId);
  p.cash = round2(p.cash - r.living);

  // 4. 债务支出
  r.debt = monthlyDebt(state, playerId);
  p.cash = round2(p.cash - r.debt);

  // 5. 贷款利息
  r.interestPaid = loanInterest(state, playerId);
  p.cash = round2(p.cash - r.interestPaid);

  // 6. 存款利息
  r.interestEarned = depositInterest(state, playerId);
  p.deposit = round2(p.deposit + r.interestEarned);

  r.net = round2(
    r.salary + r.rentIncome + r.passive + r.interestEarned
    - r.living - r.debt - r.interestPaid
  );

  // 7. 债务递减（房贷/车贷按购买时记录的 monthsLeft 递减）
  for (const prop of p.properties) {
    if (prop.monthsLeft > 0) {
      prop.monthsLeft--;
      if (prop.monthsLeft === 0) {
        // 贷款还完，房产归属确定
        prop.monthly = 0;
        prop.principalLeft = 0;
      }
    }
  }
  if (p.loan.monthsLeft > 0) {
    p.loan.monthsLeft--;
    if (p.loan.monthsLeft === 0) {
      p.loan.monthly = 0;
      p.loan.principal = 0;
    }
  }

  // 8. 资产重估 + 折旧
  const nwBefore = netWorth(state, playerId);
  p.meta.appreciation = e.propertyAppreciation;
  for (const v of p.vehicles) v.heldMonths = (v.heldMonths || 0) + 1;
  // visitsThisMonth 在收租计算后才清零（见 settleMonth 开头）。
  // 第 2 步曾在这里写 occupiedMonths - 1，导致「被踩 +1、月末 -1」净效果恒为 0，
  // 收租永远收不到 —— 地产玩法整体失效。
  for (const prop of p.properties) {
    if (prop.upgradeMonths != null) prop.upgradeMonths += 1;
    // 持有月数用于估值分层，必须每月递增
    prop.heldMonths = (prop.heldMonths || 0) + 1;
  }
  const nwAfter = netWorth(state, playerId);
  r.assetChange = round2(nwAfter - nwBefore);

  // 9. 职级判定（仅自动升职，不自动降职）
  const before = p.rankId;
  tryAutoPromote(state, playerId, log);

  // 10. 清零本月租约计数（收租已在第 2 步算过）+ 清理道具效果
  for (const prop of p.properties) {
    prop.visitsThisMonth = 0;
  }
  p.grants = p.grants.filter((g) => g.op !== "exemptLiving" && g.op !== "halveLiving");

  if (nwAfter > nwBefore + 1) r.rankUp = p.rankId;
  if (before !== p.rankId && !r.rankUp) r.rankDown = p.rankId;

  return r;
}

function tryAutoPromote(state, playerId, log) {
  const p = playerOf(state, playerId);
  const ranks = state.config.ranks;
  let idx = ranks.findIndex((r) => r.id === p.rankId);
  if (idx < 0) idx = 0;
  const nw = netWorth(state, playerId);
  while (idx + 1 < ranks.length && nw >= ranks[idx + 1].minNetWorth) {
    idx++;
    p.rankId = ranks[idx].id;
    p.rankCoefficient = ranks[idx].coefficient;
    log && log(`${p.name} 自动升职为 ${ranks[idx].name}`);
  }
}

function playerOf(state, id) {
  return state.players.find((p) => p.id === id);
}
