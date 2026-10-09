// 共享对局驱动：verify-core / headless-sim / profile 三处共用同一套驱动逻辑。
//
// 为什么要抽出来：第 2 步教训 —— 工具里另写一套驱动/AI，结论对实际游戏无效，
// 而且三份副本各自漂移，profile.mjs 的循环 bug 曾让它空转到超时，
// 看起来像"性能问题"，实则是死循环。
//
// 关键：内置 stall 检测。任何「phase 不变且 seq 不前进」的迭代都算 stall，
// 连续 stall 超阈值立即退出并报错，绝不静默空转。

import { PHASE } from "../src/core/actions.js";

export const AUTO_PHASES = [PHASE.TURN_END, PHASE.MONTH_SETTLE, PHASE.BANKRUPT_CHECK];

// autoAct: (state, player, phase) => action | null
//   返回 null 表示"该阶段无需/不允许动作"，由引擎自动推进。
export function playOut(reduce, decideActions, startState, opts = {}) {
  const maxIter = opts.maxIter || 5000;
  const maxStall = opts.maxStall || 30;
  let s = startState;
  let queue = [];
  let iter = 0;
  let stall = 0;
  let lastKey = "";
  const trace = opts.onStep ? [] : null;
  // 被 reducer 拒绝过的购买（玩家:格:选项）不再重问 decideActions。
  // 没有这层记忆会出现活锁：想买 → 杠杆拒绝 → 关弹窗 → 同一状态再问还是想买 →
  // 无限循环（5000 步耗尽，seed 777 实测）。与主程序 autoResolveModal 的
  // autoTries>6 强制 dismiss 是同一个安全阀。
  const rejectedBuys = new Set();

  while (s.meta.phase !== PHASE.GAME_OVER && iter++ < maxIter) {
    const p = s.players[s.meta.currentSeat];
    if (!p) break;
    const phase = s.meta.phase;
    let act = null;

    // 队列优先（decideActions 可能返回多步，如 取款→结束回合）
    // __any 表示不限阶段（用于买房后关弹窗，此时 phase 可能已变）
    if (queue.length && queue[0].__for === p.id
        && (queue[0].__any || queue[0].__phase === phase)) {
      act = queue.shift();
      act = { ...act, playerId: p.id };
      delete act.__for; delete act.__any; delete act.__phase;
      if (!queue.length) queue = [];
    } else if (phase === PHASE.TURN_START || phase === PHASE.ROLL) {
      act = { type: "ROLL_DICE", playerId: p.id };
    } else if (phase === PHASE.TILE_EVENT || phase === PHASE.MOVING) {
      const acts = decideActions(s, p.id, opts.data) || [];
      const buy = acts.find((a) => (a.type === "BUY_PROPERTY" || a.type === "BUY_VEHICLE")
        && !rejectedBuys.has(`${p.id}:${a.tileId ?? "?"}:${a.optionId ?? "?"}`));
      if (buy) {
        // 买完之后必须再发 DISMISS_MODAL 关掉弹窗，否则 modal 残留、
        // 下一轮又会重复尝试买房并被拒（"工位左侧"卡在 turn 6 就是这么来的）。
        // 注意 phase 会随 modal 关闭而变（可能进 POST_ACTION），
        // 所以用 __any 标记表示不限 phase。
        act = { ...buy, playerId: p.id };
        queue = [{ type: "DISMISS_MODAL", __for: p.id, __any: true }];
      } else {
        act = { type: "DISMISS_MODAL", playerId: p.id };
      }
    } else if (phase === PHASE.POST_ACTION) {
      const acts = decideActions(s, p.id, opts.data);
      if (!acts || !acts.length) {
        act = { type: "END_TURN", playerId: p.id };
      } else {
        const [first, ...rest] = acts;
        queue = rest.map((a) => ({ ...a, __for: p.id, __phase: PHASE.POST_ACTION }));
        act = { ...first, playerId: p.id };
      }
    } else if (AUTO_PHASES.includes(phase)) {
      // 这些阶段由 reducer 的 advancePhase 在同一次 dispatch 内消化完毕。
      // 走到这里说明上一次 action 之后 phase 停在自动阶段 —— 正常，继续下一轮即可。
      // 注意不能 break，否则外层 while 会退出，而游戏其实还没结束
      // （第 3 步实测：turn=6 就返回，winner=undefined，3 人全存活）。
      stall = 0;
      lastKey = "";
      continue;
    } else {
      break;
    }

    // stall 检测：phase 与 seq 都没变 = 这一步没产生任何进展
    const key = `${phase}#${s.meta.currentSeat}#${s.meta.seq}`;
    if (key === lastKey) {
      if (++stall > maxStall) {
        throw new Error(`驱动停滞于 phase=${phase} seq=${s.meta.seq}（${stall} 次无进展），`
          + `player=${p.id} pending=${JSON.stringify(s.pending).slice(0, 160)}`);
      }
    } else {
      stall = 0;
      lastKey = key;
    }

    const r = reduce(s, act, opts.data);
    if (r.reject) {
      if (opts.onReject) opts.onReject(act, r.reject);
      queue = [];
      // 想做的动作被拒（典型：想买买不起 / 杠杆超限）。此时 pending.modal 还挂着，
      // 直接废弃整局会让统计里混进大量"半截局"——正确动作是关弹窗继续，
      // 与主程序 autoResolveModal 的强制 dismiss 安全阀同一思路。
      if (act.type === "BUY_PROPERTY" || act.type === "BUY_VEHICLE") {
        rejectedBuys.add(`${p.id}:${act.tileId ?? "?"}:${act.optionId ?? "?"}`);
      }
      if (act.type === "BUY_PROPERTY" || act.type === "BUY_VEHICLE"
          || act.type === "DEPOSIT" || act.type === "WITHDRAW"
          || act.type === "LOAN_REQ" || act.type === "PLAY_CARD" || act.type === "USE_ITEM") {
        const rd = reduce(s, { type: "DISMISS_MODAL", playerId: p.id }, opts.data);
        if (rd.reject) break;   // 连 DISMISS 都被拒（阶段不对）→ 真的走不下去了
        s = rd.state;
        stall = 0; lastKey = "";
        continue;
      }
      break;
    }
    s = r.state;
    if (trace) trace.push({ phase: s.meta.phase, turn: s.meta.turn, act: act.type });
    if (AUTO_PHASES.includes(s.meta.phase)) queue = [];
  }

  if (iter >= maxIter) {
    throw new Error(`对局未在 ${maxIter} 步内结束（phase=${s.meta.phase} turn=${s.meta.turn}）`);
  }
  return { state: s, iterations: iter };
}
