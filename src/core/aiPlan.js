// AI 目标规划：解决第 2 步发现的 P0 —— 单步贪心导致三性格行为趋同。
//
// 病因：decideActions 只看「当前现金 vs 房价」，买不起就攒钱，攒到能买就全款买光，
// 买完现金归零，下回合触发取款/贷款，陷入「清仓—借钱」循环。
// 性格权重的差异被这个循环完全吸收，所以三种性格净资产差异 <3%。
//
// 修法：开局生成一份 40 回合的目标曲线，决策时对照「离下一个里程碑还差多少、
// 还剩几回合」，而不是「现在够不够」。
//
// 设计取舍：计划存在 player 对象里（跟着 state 走），
// 这样伪联机回放与断线重连天然同步，无需额外传输。

import { nextFloat, weightedPick } from "./rng.js";
import { netWorth, monthlySalary } from "./economy.js";

// ── 计划生成 ──
// 依据性格权重决定「买几个、什么时候买、留多少现金」，生成里程碑列表。
export function buildPlan(state, playerId, data) {
  const p = state.players.find((x) => x.id === playerId);
  if (!p) return null;
  const prof = data.aiProfiles.profiles.find((x) => x.id === p.aiProfile)
    || data.aiProfiles.profiles[0];
  const w = prof.weights;
  const maxRounds = state.meta.maxRounds;
  const salary0 = monthlySalary(state, playerId);

  // 目标净资产曲线：起点是当前净资产，终点是「按理想路径能到多少」
  // 贪心型终点最高，消费型最低但会中途买房，稳健型平滑
  const startNW = netWorth(state, playerId);
  let targetNW;
  if (w.buyProperty > 0.8) targetNW = startNW + salary0 * maxRounds * 0.85;
  else if (w.buyProperty > 0.5) targetNW = startNW + salary0 * maxRounds * 0.65;
  else targetNW = startNW + salary0 * maxRounds * 0.45;

  // 现金地板曲线：随回合线性抬升。
  // 最初设成 salary×1.2，实测把地板抬到近 8000，导致 AI 全程买不起房、
  // 地产玩法完全失效。10 个月的短局里过度防守 = 不投资，故压到 0.45 倍月薪起。
  const floorBase = Math.max(2500, Math.round(salary0 * 0.45));
  const cashFloorCurve = (turn) =>
    Math.round(floorBase * (1 + (turn / maxRounds) * 1.2));

  // 挑选目标资产：按「租金回报率」排序，性格权重影响激进程度
  const targets = pickTargets(state, p, prof, w, data);
  const [f, r] = nextFloat(state.meta.rngState);
  state.meta.rngState = r;

  // 分配购买回合：贪心型早买（回本时间长），稳健型分散
  const schedule = spreadSchedule(targets.length, maxRounds, w.buyProperty, f);

  // 期望被踩次数（供 shouldBuy 用同一口径评估 ROI）
  //
  // 公式：对手总行程 / 格子数 / 月数
  //   对手总行程 = 平均骰子 × 总回合数 × 对手数 = 3.5 × 40 × 3 = 420 格次
  //   每格整局被踩 420/40 = 10.5 次，摊到 10 个月 → 1.05 次/月
  // 注意这里除的是「月数」(maxRounds/roundsPerMonth)，不是 turns，
  // 第 3 步初版误用 maxRounds 当分母，导致期望值虚高 2.5 倍（ROI 54% 的假象）。
  const avgDice = 3.5;
  const playersCount = Math.max(1, state.players.filter((x) => x.alive).length - 1);
  const months = Math.max(1, maxRounds / state.config.game.roundsPerMonth);
  const expectedVisits =
    (avgDice * maxRounds * playersCount) / state.board.tiles.length / months;

  return {
    targetNW: Math.round(targetNW),
    // 函数无法序列化，现金地板由 turnCashFloor(plan, turn) 现算。
    // 这里只存常数 floorBase。
    floorBase,
    expectedVisits,
    milestones: targets.map((t, i) => ({
      tileId: t.tileId,
      name: t.name,
      price: t.price,
      rent: t.rent,
      // 目标回合：加一点抖动，避免所有 AI 卡点完全一致
      round: Math.max(2, schedule[i] + Math.floor(f * 3) - 1),
      done: false,
    })),
    // 存款目标：稳健型定一个存款里程碑
    depositTarget: w.deposit > 0.6 ? Math.round(salary0 * 6) : 0,
    depositDone: false,
    aggression: w.buyProperty,
    riskTolerance: w.takeLoan,
  };
}

// 计划里的现金地板（不能用函数，因为要序列化进 state）
export function turnCashFloor(plan, turn, maxRounds) {
  return Math.round(plan.floorBase * (1 + (turn / maxRounds) * 1.2));
}

// 按性格挑目标资产：按「期望年化收益」排序，而不是按静态租金/房价比。
//
// 关键：期望收益 = rent × 期望被踩次数 × 12。期望被踩次数由格子位置决定
// （回合起点 0 附近与几个大转弯处更容易被经过），所以位置选择成为真实策略维度。
// 只用 rent/price 排序会让所有资产看起来一样（第 3 步实测：AI 只挑同一个格子）。
export function pickTargets(state, p, prof, w, data) {
  const avgDice = 3.5;
  const turnsPerMonth = data.config.game.roundsPerMonth;
  const totalTurns = state.meta.maxRounds;
  const playersCount = Math.max(1, state.players.filter((x) => x.alive).length - 1);
  const months = Math.max(1, totalTurns / turnsPerMonth);

  const buyable = state.board.tiles
    .filter((t) => (t.type === "property" || t.type === "company")
      && t.owner == null
      && !(p.properties || []).some((x) => x.tileId === t.id))
    .map((t) => {
      const price = t.payload.price;
      const rent = t.payload.rent || 0;
      // 期望被踩次数：对手总行程 / 格子数 / 月数，再按位置热度加权
      const baseVisits = (avgDice * totalTurns * playersCount)
        / state.board.tiles.length / months;
      const heat = tileHeat(state, t.id);
      const visits = baseVisits * heat;
      const annualIncome = rent * visits * turnsPerMonth;
      return {
        tileId: t.id, name: t.name, price, rent,
        roi: annualIncome / price,
        heat, visits,
      };
    });

  const want = w.buyProperty > 0.8 ? 4 : w.buyProperty > 0.6 ? 3 : w.buyProperty > 0.4 ? 2 : 1;
  const sorted = buyable.sort((a, b) => b.roi - a.roi);
  return sorted.slice(0, Math.min(want, sorted.length));
}

// 格子热度：0 号（起点）附近与四角转弯处更容易被经过。
// 数据说话：40 格地图上，均匀分布时被踩各 1.05 次/月；
// 但玩家每回合都从当前位置出发，走 1~6 格，起点附近的格子被经过概率显著更高。
function tileHeat(state, id) {
  const size = state.board.tiles.length;
  if (id === 0) return 1.6;                    // 起点：每回合都可能路过
  const dStart = Math.min(id, size - id);      // 到起点的环距
  if (dStart <= 6) return 1.3;                 // 起点周边
  // 4 个 25%/50%/75%/起点 附近的整段（转弯处必然被经过）
  if (Math.abs(id % 10) === 0) return 1.25;    // 整十的整数倍 = 转角
  return 1.0;
}

// 把 want 个购买回合铺在 [start, maxRounds*0.85] 区间
// aggression 越高越靠前（早买回本时间长）
function spreadSchedule(n, maxRounds, aggression, jitter) {
  if (n <= 0) return [];
  const end = Math.round(maxRounds * 0.82);
  const start = 3;
  if (n === 1) return [Math.round(start + (end - start) * (1.2 - aggression) * 0.8)];
  const out = [];
  for (let i = 0; i < n; i++) {
    // 贪心型（前段密集），稳健型（均匀分散）
    const t = i / (n - 1);
    const shaped = aggression > 0.8 ? Math.pow(t, 0.7) : t;
    out.push(Math.round(start + (end - start) * shaped));
  }
  return out.sort((a, b) => a - b);
}

// ── 计划推进 ──
// 当前该推进的里程碑：第一个未完成的。
// 不按回合过滤 —— AI 只有走到那个格子才可能买下，
// 回合条件由 shouldBuy 里的 left（剩余回合）判断更准确。
export function currentMilestone(plan, turn) {
  if (!plan) return null;
  for (const m of plan.milestones) {
    if (!m.done) return m;
  }
  return null;
}

// 距离终局还有几回合 —— 决定「现在买不起还来不来得及」
export function turnsLeft(state) {
  return Math.max(0, state.meta.maxRounds - state.meta.turn);
}
