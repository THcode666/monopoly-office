// 主控制器：装配 core + ui + 音频，处理回合流程与动画时序。
//
// 架构铁律（来自第 1 步设计）：动画不阻塞 reducer。
// 逻辑推进后立即渲染 diff，动画只是消费方。
// 联机模式下 host 不等动画，同步推进。

import { loadData } from "./data/loader.js";
import { reduce } from "./core/reducer.js";
import { make, PHASE, A } from "./core/actions.js";
import { decideActions } from "./core/ai.js";
import { netWorth } from "./core/economy.js";
import { BoardRenderer } from "./ui/board.js";
import { Audio } from "./ui/audio.js";
import { showSetup } from "./ui/setup.js";
import { ICONS, RANK_NAMES, CHARACTERS, AI_AVATARS } from "./ui/icons.js";
import { drawCharacterOnCanvas } from "./ui/character.js";
import { fmt } from "./ui/fmt.js";
import { Modal, Toast, renderPanels, renderTop, renderActions, renderInventory } from "./ui/panels.js";
import { showPassExport, showPassImport } from "./ui/passpackage.js";
import * as serializeMod from "./core/serialize.js";
import { loadSettings, applySettings, openSettingsModal } from "./ui/settings.js";

const root = document.getElementById("app");

class Game {
  constructor(data) {
    this.data = data;
    this.audio = new Audio();
    this.modal = new Modal(document.getElementById("modalLayer"));
    this.toast = new Toast(document.getElementById("toastLayer"));
    this.board = new BoardRenderer(document.getElementById("board"), data.board);
    this.state = null;
    this.cfg = null;
    this.busy = false;
    this.soundOn = true;
    this.bgmOn = true;
    this.settings = loadSettings();
    // AI 回合看门狗阈值：单个 AI 座位一个回合最多卡 20 秒，超时强制推进
    this.watchdogMs = 20000;
  }

  start(cfg) {
    this.cfg = cfg;
    const players = [];
    const useAI = cfg.mode === "solo";

    if (useAI) {
      players.push({
        id: "p0", name: cfg.names[0], avatar: cfg.avatars[0],
        color: cfg.colors[0], isAI: false,
      });
      const n = cfg.aiCount ?? 3;
      for (let i = 0; i < n; i++) {
        const prof = cfg.aiProfiles[i % cfg.aiProfiles.length] || "greedy";
        players.push({
          id: "a" + i, name: this.data.aiProfiles.profiles.find((x) => x.id === prof)?.name || "AI",
          avatar: AI_AVATARS[prof], color: this.data.board.colorTokens[(i + 1) % 6],
          isAI: true, aiProfile: prof,
        });
      }
    } else {
      // 热座 / 局域网：都是纯本地玩家
      const n = cfg.humanCount || (cfg.mode === "hotseat" ? 2 : 4);
      const used = new Set();
      for (let i = 0; i < n; i++) {
        let name = (cfg.names[i] || "").trim();
        let color = cfg.colors[i];
        if (!name) name = "玩家" + (i + 1);
        // 局域网下可能有重名/重色（每台机器各自填了自己的设置），做个最小去重
        if (used.has(name)) name += "-" + (i + 1);
        if (used.has(color)) color = this.data.board.colorTokens.find((c) => !used.has(c));
        used.add(name); used.add(color);
        players.push({
          id: "p" + i, name, avatar: cfg.avatars[i] || "panda",
          color, isAI: false,
        });
      }
      this.roomId = cfg.roomId || null;
    }

    const maxRounds = cfg.winCondition === "bankruptcy" ? 999 : this.data.config.game.maxRounds;
    const r = reduce(null, {
      type: A.NEW_GAME, players, seed: (Date.now() % 2147483647),
      mode: cfg.mode, winCondition: cfg.winCondition, maxRounds,
    }, this.data);
    this.state = r.state;

    this.board.setBoard(this.data.board);
    this.board.resize();
    this.board.draw(this.state, this.state.players);
    this.render();
    this.bindTopButtons();
    this.armWatchdog();
    this.step();
  }

  get cur() { return this.state.players[this.state.meta.currentSeat]; }
  get isMyTurn() { return this.cur && !this.cur.isAI && !this.state.netPlayerIds?.has(this.cur.id); }

  // 队列归属的座位号。切换到别的座位时必须清 queue，
  // 否则上一家的动作会被下一家执行（实测导致 reducer 静默 reject → 界面卡死）。
  guardQueue() {
    const seat = this.state?.meta?.currentSeat ?? -1;
    if (this.queueSeat !== seat) { this.queue = null; this.queueSeat = seat; }
  }

  // 派发 action + 播放动画
  dispatch(action) {
    const r = reduce(this.state, action, this.data);
    if (r.reject) {
      this.toast.show(r.reject, "warn");
      // 被 reducer 拒绝说明 action 与当前 phase/state 不匹配（多半是残留队列）。
      // 直接丢掉队列并重新推进，避免玩家对着不动的界面干等。
      if (this.queue) { this.queue = null; this.step(); }
      return false;
    }
    this.state = r.state;
    this.applyDiff(r.diff);
    this.render();
    // dispatch 后必须自动推进：showModal / showSettle 都在 step() 里。
    // 第 4 步实测漏掉这行 → 掷骰后 phase 正确变成 TILE_EVENT、
    // pending.modal 也设好了，但弹窗永远不显示（overlay 一直是 false），
    // 玩家卡在"格子事件"无法继续。
    // GAME_OVER 也必须走 step()：结算排名画面只在 step() 里触发，
    // 旧版在这里跳过它 → 终局时棋盘直接冻住，结算画面从来没弹出来过。
    this.step();
    return true;
  }

  // 按 diff 播放音效与动画
  applyDiff(diff) {
    for (const d of diff) {
      switch (d.t) {
        case "dice":
          this.audio.dice(d.value);
          // 3D 骰子动画。旧版只播音效，board 里的 showDice/drawDice 从未被调用（死代码）。
          this.board.showDice(d.value);
          break;
        case "move":
          if (d.from !== undefined && d.steps > 0) {
            this.board.moveToken(d.id, d.from, d.to, d.steps);
            this.board.setHighlight(d.to);
          }
          break;
        case "cash": {
          const p = this.state.players.find((x) => x.id === d.id);
          if (p && d.from != null && d.to != null && Math.abs(d.to - d.from) > 300) {
            if (d.to > d.from) this.audio.cash();
            this.floatText(p, (d.to > d.from ? "+" : "") + fmt(d.to - d.from),
              d.to > d.from ? "pos" : "neg");
          }
          break;
        }
        case "rank":
          if (RANK_NAMES[d.to] === "专员" || d.to === "manager" || d.to === "director") this.audio.up();
          else this.audio.down();
          break;
        case "bankrupt":
          this.audio.bankrupt();
          break;
        case "warn":
          this.audio.sigh();
          break;
        case "buyProperty":
        case "buyVehicle":
          this.audio.cash();
          break;
        case "card": {
          // 抽到/获得卡牌的即时反馈（简历、简历镀金的抽卡现在真正生效了）
          const p2 = this.state.players.find((x) => x.id === d.id);
          const def = (this.data.cards[d.deck] || []).find((c) => c.id === d.cardId);
          if (p2 && def) {
            this.toast.show(`${p2.name} ${d.draw ? "抽到" : "获得"}【${def.name}】`, "ok");
            this.audio.popup();
          }
          break;
        }
        case "shield":
          this.toast.show("☂️ 折叠伞挡下了一次损失", "good");
          this.audio.popup();
          break;
        case "useCard": {
          // 打出任何卡都给一个全屏卡牌特效 —— 道具/卡牌的"存在感"来自这种高光时刻
          const owner = this.state.players.find((x) => x.id === d.id);
          const allDefs = [
            ...(this.data.cards.item || []),
            ...(this.data.cards.opportunity || []),
            ...(this.data.cards.fate || []),
          ];
          const def = allDefs.find((c) => c.id === d.cardId);
          if (owner && def) this.showCardSplash(def, owner);
          break;
        }
      }
    }
  }

  // 卡牌使用全屏特效：大图标 + 卡名砸进屏幕中央，1.4s 后自己消失。
  // 不阻塞任何逻辑（纯展示层），AI 用卡时同样触发 —— 道具存在感的核心来源。
  showCardSplash(def, owner) {
    let layer = document.getElementById("splashLayer");
    if (!layer) {
      layer = document.createElement("div");
      layer.id = "splashLayer";
      layer.className = "splash-layer";
      document.body.appendChild(layer);
    }
    layer.innerHTML = `<div class="item-splash">
      <div class="splash-emoji">${ICONS[def.icon] || "🎁"}</div>
      <div class="splash-name">${esc(owner.name)} 使用了「${esc(def.name)}」</div>
      <div class="splash-detail">${esc(def.detail || "")}</div>
    </div>`;
    this.audio.popup();
    clearTimeout(this._splashTimer);
    this._splashTimer = setTimeout(() => { layer.innerHTML = ""; }, 1400);
  }

  floatText(player, text, cls) {    const t = this.board.tokens().find((x) => x.id === player.id);
    if (!t) return;
    const el = document.createElement("div");
    el.className = "float-text " + cls;
    el.textContent = text;
    el.style.left = t.cx * (this.board.size / this.board.canvas.clientWidth) + "px";
    el.style.top = (t.cy * (this.board.size / this.board.canvas.clientHeight) - 20) + "px";
    el.style.color = cls === "pos" ? "var(--success)" : "var(--danger)";
    document.querySelector(".board-wrap").appendChild(el);
    setTimeout(() => el.remove(), 1000);
  }

  // ── 回合看门狗：AI 单回合最多卡 watchdogMs（默认 20s），超时强制推进 ──
  // 卡死可能来自任何一环（弹窗 autoResolve 循环、残留队列、渲染抛异常断掉
  // step() 调用链……），与其逐个堵，不如兜底：超时就按当前阶段合法地推一把。
  // 只对 AI 回合计时；人类回合想多久都行，不干预。
  armWatchdog() {
    if (this.watchdogTimer) clearInterval(this.watchdogTimer);
    this.watchKey = null;
    this.watchStart = 0;
    this.watchFires = 0;
    this.watchdogTimer = setInterval(() => this.checkWatchdog(), 1000);
  }

  checkWatchdog() {
    const s = this.state;
    if (!s || s.meta.phase === PHASE.GAME_OVER) return;
    const cur = this.cur;
    if (!cur) return;
    // 人类回合：不计时（热座里有人去拿水喝也不该被跳过）
    if (!cur.isAI) { this.watchKey = null; this.watchFires = 0; return; }
    // 页面切到后台时定时器会被浏览器节流，动画/回调同样变慢，
    // 这段时间不计入超时，避免回来时被误判强推
    if (document.hidden) { this.watchStart = Date.now(); return; }

    const key = `${s.meta.currentSeat}:${s.meta.turn}`;
    if (this.watchKey !== key) {
      // 新的 AI 回合：开始计时
      this.watchKey = key;
      this.watchStart = Date.now();
      this.watchFires = 0;
      return;
    }

    const elapsed = Date.now() - this.watchStart;
    if (elapsed < this.watchdogMs) return;

    // 超时：强制推进。清掉一切"进行中"的软状态，按阶段发合法 action。
    this.watchFires++;
    this.watchStart = Date.now();
    this.queue = null;
    this.aiRunning = false;
    this.autoKey = null;
    this.autoTries = 0;
    this.reportShown = false;
    console.warn(`[watchdog] AI 回合卡住 ${Math.round(elapsed / 1000)}s`
      + `（seat=${s.meta.currentSeat} phase=${s.meta.phase}），第 ${this.watchFires} 次强制推进`);

    const pid = cur.id;
    const phase = s.meta.phase;
    if (s.pending.modal) {
      // 弹窗没人点 → 直接替它关掉
      this.toast.show("AI 反应超时，已自动推进", "warn");
      this.dispatch({ type: A.DISMISS_MODAL, playerId: pid });
      return;
    }
    if (phase === PHASE.ROLL || phase === PHASE.TURN_START) {
      this.toast.show("AI 反应超时，已自动推进", "warn");
      this.dispatch({ type: A.ROLL_DICE, playerId: pid });
      return;
    }
    if (phase === PHASE.TILE_EVENT || phase === PHASE.MOVING) {
      this.dispatch({ type: A.DISMISS_MODAL, playerId: pid });
      return;
    }
    if (phase === PHASE.POST_ACTION) {
      this.dispatch({ type: A.END_TURN, playerId: pid });
      return;
    }
    // 自动阶段（TURN_END / MONTH_SETTLE / BANKRUPT_CHECK）本该在一次
    // dispatch 内消化完，停在这里说明调用链真的断了 —— 重新驱动。
    this.step();
  }

  // 回合驱动：等动画播完后继续
  step() {
    if (this.state.meta.phase === PHASE.GAME_OVER) { this.showGameOver(); return; }
    const cur = this.cur;
    if (!cur) return;
    this.guardQueue();

    // ── 人类玩家：先处理需要确认的弹窗 ──
    if (!cur.isAI) {
      if (this.state.pending.modal) {
        // 骰子还在摇就先别弹窗 —— 等落定再出，掷骰的演出才完整（否则弹窗遮罩
        // 立刻把棋盘压暗，1 秒的掷骰动画全被盖住）
        if (this.board.dice) { setTimeout(() => this.step(), 100); return; }
        this.showModal(this.state.pending.modal); return;
      }
      if (this.state.report && !this.reportShown) {
        this.reportShown = true;
        this.showSettle(this.state.report);
        return;
      }
      if (this.queue && this.queue.length) { this.runQueue(); return; }
      this.renderActions();
      // 热座模式：轮到别人时提示交接设备
      if (!this.handoffShown) { this.handoffShown = true; this.handoffPrompt(cur); }
      return;
    }
    this.handoffShown = false;

    // ── AI：优先消费上一步 decideActions 规划出的剩余动作 ──
    // 实测 bug：原实现只在人类分支调 runQueue()，AI 分支直接把 queue 覆盖掉，
    // 结果 ① 每个 action 都重跑一次 decideActions（慢）② 残留 queue 漏到人类回合，
    // 人类替 AI 执行 USE_ITEM（playerId 对不上 → reducer 静默 return false → 卡死）。
    if (this.queue && this.queue.length) { this.runQueue(); return; }

    // ★ 真正的卡死点：AI 分支完全没处理 pending.modal。
    // 走到「买地 / 事件」时 reducer 会设 pending.modal 等人点，
    // AI 没人点 → 弹窗悬在屏幕上、phase 不推进 → 整局死锁。
    // 实测：人类 6 回合实测 6.7s/回合，其中大部分就是 AI 卡在弹窗上等超时。
    if (this.state.pending.modal) { this.autoResolveModal(); return; }

    // 月度结算弹窗同理：AI 回合结束后必出，AI 不需要看。
    if (this.state.report && !this.reportShown) {
      this.reportShown = true;
      if (cur.isAI) { this.dismissReport(); } else { this.showSettle(this.state.report); return; }
    }

    if (this.aiRunning) return;
    this.aiRunning = true;
    setTimeout(() => {
      this.aiRunning = false;
      if (!this.state || this.state.meta.phase === PHASE.GAME_OVER) return;
      const me = this.cur;
      if (!me || !me.isAI) return;

      // ★★★ 最关键的循环驱动 ★★★
      // decideActions() 只在 TILE_EVENT/MOVING/POST_ACTION 里给"买/存/打"，
      // 它**从不返回 ROLL_DICE** —— 掷骰一直是由人类点按钮触发的。
      // AI 分支以前直接跑 decideActions，ROLL 阶段拿到空数组 → 只 render() →
      // 没有任何 dispatch → step() 再也不会被调 → AI 永久停在 ROLL（实测 seat 卡在 1）。
      // 所以 AI 必须自己补上掷骰这一步，循环才闭合。
      const phase = this.state.meta.phase;
      if (phase === PHASE.ROLL || phase === PHASE.TURN_START) {
        this.dispatch({ type: A.ROLL_DICE, playerId: me.id });
        return;
      }

      const acts = decideActions(this.state, me.id, this.data) || [];
      if (acts.length) {
        this.queue = acts.slice(1).map((a) => ({ ...a, playerId: me.id }));
        this.dispatch({ ...acts[0], playerId: me.id });
      } else {
        // 没动作 → 直接结束回合，否则又是一个死胡同
        this.dispatch({ type: A.END_TURN, playerId: me.id });
      }
    }, this.board.anim.size ? 90 : 16);
  }

  // AI 自动处理弹窗 —— 不弹 UI，直接走 decideActions 的判断 dispatch。
  //
  // 为什么必须有：reducer 把「买地 / 抽卡 / 事件」都建模成 pending.modal，
  // 等人点按钮才继续。人类走 showModal 正常，但 AI 没人点 →
  // pending.modal 永远不清 → phase 卡在 TILE_EVENT → 整局死锁。
  //
  // 决策口径跟 AI 原本的策略一致（decideActions 会算 buy / skip），
  // 这里不重复造轮子，只在弹窗出现时补一次判断。
  autoResolveModal() {
    const m = this.state.pending.modal;
    const me = this.cur;
    if (!m || !me) return;

    // 安全阀：同一个 modal（按 seq 认）反复 dispatch 超过 6 次就强制 dismiss，
    // 避免「AI 想买但钱不够」这类反复 reject 把流程卡在死循环里。
    const key = `${this.state.meta.seq}:${m.kind}:${m.title}`;
    if (this.autoKey === key) {
      this.autoTries = (this.autoTries || 0) + 1;
    } else {
      this.autoKey = key;
      this.autoTries = 1;
    }
    if (this.autoTries > 6) {
      this.autoKey = null; this.autoTries = 0;
      this.dispatch({ type: A.DISMISS_MODAL });
      return;
    }

    // 只有「买地 / 买车」需要 AI 表态，其余（事件 / 抽卡 / 收租 / 报错）一律 dismiss
    const isPurchase = m.kind === "buy" || m.kind === "vehicle";
    if (!isPurchase) {
      this.dispatch({ type: A.DISMISS_MODAL });
      return;
    }

    // 问 AI 一次：这张地买不买
    const acts = decideActions(this.state, me.id, this.data) || [];
    // 字段必须对齐：BUY_VEHICLE 带的是 optionId（旧版比较 vehicleId —— 两边都是
    // undefined 时恒真，AI 会被误判成"想买"，好在 decideActions 只在真想买时才返回该动作）
    const wantsBuy = acts.some((a) =>
      (a.type === A.BUY_PROPERTY && a.tileId === m.tileId) ||
      (a.type === A.BUY_VEHICLE && a.tileId === m.tileId));
    if (!wantsBuy) {
      this.dispatch({ type: A.DISMISS_MODAL });
      return;
    }

    const act = acts.find((a) =>
      (a.type === A.BUY_PROPERTY && a.tileId === m.tileId) ||
      (a.type === A.BUY_VEHICLE && a.tileId === m.tileId));
    this.dispatch({ ...act, playerId: me.id, targetId: me.id });
  }

  // AI 回合的月度结算：直接清掉，不弹结算面板
  dismissReport() {
    this.reportShown = false;
    if (this.modal.el.classList.contains("show")) this.modal.close();
    this.step();
  }

  runQueue() {
    const a = this.queue.shift();
    if (!a) { this.step(); return; }
    // dispatch 内部会调 step()，这里不重复调。
    // AI 的连续动作之间插一个短延迟（16ms），让浏览器有机会重绘 + 让音效不糊成一片。
    if (this.cur?.isAI) {
      // ★ 不设 aiRunning —— 之前这里也设 true，导致与 step() 里的定时器互相抢：
      //   step() 的回调把 aiRunning 置 false 后立刻 dispatch → step() 又进这里置 true，
      //   而上一个回调还没跑完 → aiRunning 永久停在 true → AI 从此彻底死锁。
      //   现在只靠「queue 是否为空」决定要不要再等，完全不碰 aiRunning。
      setTimeout(() => this.dispatch(a), 16);
      return;
    }
    this.dispatch(a);
  }

  // ── 中央弹窗 ──
  showModal(m) {
    const I = ICONS;
    const ico = m.icon && I[m.icon] ? I[m.icon] : "💬";
    let body = "";

    if (m.kind === "buy") {
      const tile = this.state.board.tiles.find((t) => t.id === m.tileId);
      body = `<div class="quote">${esc((m.text || "").replace(/\n/g, "<br>"))}</div>`;
      body += `<div class="opt-list">
        <button class="opt" data-act="buy">
          <div class="opt-head"><span class="opt-name">买下 ${esc(m.title)}</span>
          <span class="opt-price">${fmt(m.price)}</span></div>
          <div class="opt-meta">首付 ${fmt(Math.round(m.price * (1 - this.data.config.economy.mortgageRatio)))} ·
            月供 ${fmt(this.monthlyOf(m.price))} · 月租 ${fmt(tile.payload.rent || 0)}（每月约 ${(tile.payload.rent || 0) * 1.05 | 0} 到手）</div>
        </button>
        <button class="opt" data-act="skip">
          <div class="opt-head"><span class="opt-name">再想想</span></div>
          <div class="opt-meta">保持现金也是一种策略</div>
        </button>
      </div>`;
      this.modal.open(m.title || "要不要买？", body, ico, []);
      this.modal.onClick((act, el) => {
        if (act === "buy") this.dispatch(make.buyProperty(m.tileId));
        else this.dispatch(make.dismissModal());
        this.afterModal();
      });
      return;
    }

    if (m.kind === "vehicle") {
      const tile = this.state.board.tiles.find((t) => t.id === m.tileId);
      const opts = tile.payload.options || [];
      const vTerm = this.data.config.economy.vehicleMonths || 24;
      body = `<div class="quote">${esc((m.text || "").replace(/\n/g, "<br>"))}</div>`;
      body += `<div class="opt-list">`;
      for (const o of opts) {
        const down = Math.round(o.price * (1 - this.data.config.economy.mortgageRatio));
        body += `<button class="opt" data-act="veh" data-id="${o.id}">
          <div class="opt-head"><span class="opt-name">${esc(o.name)}</span>
          <span class="opt-price">${fmt(o.price)}</span></div>
          <div class="opt-meta">首付 ${fmt(down)} · 月供 ${fmt(this.monthlyOf(o.price, vTerm))} ·
            月省生活 ${fmt(o.livingDiscount)} · 面子 +${o.face} 心情 +${o.mood}
            ${o.tag ? "· " + esc(o.tag) : ""}</div>
        </button>`;
      }
      // 必须给"不买"的退路：买车弹窗没有取消键时，点 × 只会关掉 UI，
      // pending.modal 还挂着，弹窗立刻重开 —— 玩家被永久困在 4S 店。
      body += `<button class="opt" data-act="skip">
          <div class="opt-head"><span class="opt-name">先不买</span></div>
          <div class="opt-meta">地铁也挺香的</div>
        </button></div>`;
      body += `<div class="modal-detail">车不只是代步：每月省下的生活开销会直接计入月结。月供按车贷 ${vTerm} 期计算。</div>`;
      this.modal.open("看车", body, "🚗", []);
      this.modal.onClick((act, el) => {
        if (act === "veh") this.dispatch(make.buyVehicle(m.tileId, el.dataset.id));
        else if (act === "skip") this.dispatch(make.dismissModal());
        this.afterModal();
      });
      return;
    }

    if (m.kind === "error") {
      this.modal.open(m.title, `<div class="quote">${esc(m.text)}</div>`, "⚠️", [
        { label: "知道了", value: "know", cls: "primary" },
      ]);
      this.modal.onClick((act) => {
        if (act === 'know' || act === '__foot__') {
          this.dispatch(make.dismissModal());
          this.afterModal();
        }
      });
      this.audio.sigh();
      return;
    }

    // 茶水间情报：展示首富资产明细
    if (m.kind === "peek") {
      const t = m.target;
      body = `<div class="quote">${esc(m.text)}</div>
        <div class="settle-table">
          <div class="st-row"><span class="k">净资产</span><span class="v">${fmt(t.netWorth)}</span></div>
          <div class="st-row"><span class="k">现金</span><span class="v">${fmt(t.cash)}</span></div>
          <div class="st-row"><span class="k">存款</span><span class="v">${fmt(t.deposit)}</span></div>
          <div class="st-row"><span class="k">房产</span><span class="v">${t.properties.length ? esc(t.properties.join("、")) : "无"}</span></div>
          <div class="st-row"><span class="k">车辆</span><span class="v">${t.vehicles.length ? esc(t.vehicles.join("、")) : "无"}</span></div>
        </div>
        <div class="modal-detail">知己知彼 —— 该找谁谈判，心里有数了。</div>`;
      this.modal.open(m.title, body, ico || "👁️", [
        { label: "知道了", value: "know", cls: "primary" },
      ]);
      this.modal.onClick((act) => {
        if (act === "know" || act === "__foot__") {
          this.dispatch(make.dismissModal());
          this.afterModal();
        }
      });
      return;
    }

    // 事件 / 卡牌
    const lines = Array.isArray(m.text) ? m.text : [m.text];
    body = `<div class="quote">${lines.map((l) => `<div>${esc(l)}</div>`).join("")}</div>`;
    if (m.detail) body += `<div class="modal-detail">${esc(m.detail)}</div>`;
    if (m.amount != null) body += `<div class="modal-detail">实付 ${fmt(m.amount)} 元${m.ownerName ? "（对方：" + esc(m.ownerName) + "）" : ""}</div>`;
    this.modal.open(m.title || m.cardName || "发生了什么", body, ico, [
      { label: "继续", value: "next", cls: "primary" },
    ]);
    this.modal.onClick((act, el) => {
      if (act === "next" || act === "__foot__") {
        this.dispatch(make.dismissModal());
        this.afterModal();
      }
    });
  }

  // 月供估算。term 必须按资产类型传：房贷 36 期、车贷 24 期，
  // 旧版看车弹窗也用 36 期，展示的月供比实际扣款低一大截。
  monthlyOf(price, term) {
    const e = this.data.config.economy;
    const loan = Math.round(price * e.mortgageRatio);
    const r = e.loanInterestRate;
    const n = term || e.mortgageMonths || 36;
    return Math.round((loan * r) / (1 - Math.pow(1 + r, -n)));
  }

  afterModal() {
    this.modal.close();   // 第 4 步：关掉遮罩层，否则 overlay 一直挡住画面
    if (this.state.meta.phase === PHASE.GAME_OVER) { this.showGameOver(); return; }
    this.step();
  }

  showSettle(report) {
    const rows = report.reports.map((r) => {
      const net = r.net;
      return `<div class="st-row"><span class="k">${esc(r.player)}</span>
        <span class="v ${net >= 0 ? "pos" : "neg"}">${net >= 0 ? "+" : ""}${fmt(net)}</span></div>`;
    });
    const detail = report.reports[0];
    const body = `
      <div class="settle-table">
        <div class="st-row"><span class="k">应发工资</span><span class="v pos">${fmt(detail.salary)}</span></div>
        <div class="st-row"><span class="k">收租收入</span><span class="v pos">${fmt(detail.rentIncome)}</span></div>
        <div class="st-row"><span class="k">生活开销</span><span class="v neg">-${fmt(detail.living)}</span></div>
        <div class="st-row"><span class="k">月供支出</span><span class="v ${detail.debt ? "neg" : ""}">-${fmt(detail.debt)}</span></div>
        <div class="st-row"><span class="k">贷款利息</span><span class="v ${detail.interestPaid ? "neg" : ""}">-${fmt(detail.interestPaid)}</span></div>
        <div class="st-row"><span class="k">存款利息</span><span class="v pos">+${fmt(detail.interestEarned)}</span></div>
      </div>
      <div style="margin-top:14px;font-size:12px;color:var(--text-2)">各玩家本月净收支</div>
      <div class="settle-table">${rows.join("")}</div>`;
    this.modal.open(`月度结算 · 第 ${report.month} 个月`, body, "💵", [
      { label: "继续", value: "next", cls: "primary" },
    ]);
    this.modal.onClick((act) => {
      if (act !== "next" && act !== "__foot__") return;
      this.modal.close();
      this.reportShown = false;
      this.state.report = null;
      this.step();
    });
  }

  showGameOver() {
    const s = this.state;
    const sorted = s.players.slice().sort((a, b) => {
      if (a.alive !== b.alive) return a.alive ? -1 : 1;
      return netWorth(s, b.id) - netWorth(s, a.id);
    });
    const win = sorted[0];
    const MEDALS = ["🥇", "🥈", "🥉"];

    // 前三名领奖台（2-1-3 排布，冠军台最高 + 金框）
    const podiumHeights = ["92px", "120px", "68px"];
    const podiumOrder = [sorted[1], sorted[0], sorted[2]].filter(Boolean);
    const podium = `<div class="podium">${podiumOrder.map((p) => {
      const i = sorted.indexOf(p);
      return `<div class="podium-col ${i === 0 ? "champ" : ""}">
        <canvas class="podium-cv" width="56" height="56" data-char="${CHARACTERS[p.avatar] ? p.avatar : "coder"}"></canvas>
        <div class="podium-name">${esc(p.name)}${p.isAI ? " 🤖" : ""}</div>
        <div class="podium-worth">${fmt(netWorth(s, p.id))}</div>
        <div class="podium-block" style="height:${podiumHeights[i] || "56px"}">
          <span>${MEDALS[i] || (i + 1)}</span>
        </div>
      </div>`;
    }).join("")}</div>`;

    // 第 4 名之后的完整排名列表
    const list = sorted.slice(3).map((p, i) => `
      <div class="rank-item">
        <div class="rank-no">${i + 4}</div>
        <div style="flex:1">
          <div style="font-size:13px;font-weight:500">${esc(p.name)}${p.isAI ? " 🤖" : ""} ${!p.alive ? "（已出局）" : ""}</div>
          <div style="font-size:11px;color:var(--text-2)">${RANK_NAMES[p.rankId]} ·
            房产 ${p.properties.length} · 车 ${p.vehicles.length}</div>
        </div>
        <div style="font-family:var(--mono);font-size:13px">${fmt(netWorth(s, p.id))}</div>
      </div>`).join("");

    const reason = s.meta.winCondition === "bankruptcy"
      ? "活到最后的人赢。"
      : `${this.data.config.game.maxRounds} 回合结束，资产最高者胜出。`;
    this.modal.open(`${win.name} 通关`,
      `<div class="sub" style="color:var(--text-2);margin-bottom:14px;text-align:center">${reason}</div>
       ${podium}
       ${list ? `<div class="rank-list" style="margin-top:14px">${list}</div>` : ""}`,
      "🏆", [
        { label: "🔄 再来一局", value: "restart", cls: "primary" },
        { label: "🚪 退出游戏", value: "exit", cls: "ghost" },
      ]);
    this.modal.onClick((act, src) => {
      // 页脚按钮统一收到 "__foot__"，具体按钮看 dataset.foot（与设置页同模式）
      const v = act === "__foot__" ? src?.dataset?.foot : act;
      if (v === "restart") {
        this.modal.close();
        // 直接用同一套配置开新局（换随机种子），不用回设置页重选一遍
        this.reportShown = false;
        this.handoffShown = false;
        this.start(this.cfg);
      } else if (v === "exit") {
        this.exitGame();
      }
    });
    // 领奖台人物
    document.querySelectorAll("#modalLayer canvas.podium-cv").forEach((cv) => {
      drawCharacterOnCanvas(cv, cv.dataset.char, CHARACTERS);
    });
    this.audio.up();
  }

  // 退出游戏：先尝试 window.close()（Electron 里可以直接关窗），
  // 被浏览器拦下就展示告别页，让玩家知道"可以关标签页了"
  exitGame() {
    this.audio.stopBgm();
    try { window.close(); } catch { /* 忽略 */ }
    setTimeout(() => {
      document.body.innerHTML = `
        <div class="farewell">
          <div class="farewell-emoji">🏢</div>
          <h1>感谢游玩《大富翁 · 工位版》</h1>
          <p>现在可以安全地关闭这个页面了。</p>
          <button class="btn primary" onclick="location.reload()">重新打开游戏</button>
        </div>`;
    }, 250);
  }

  // ── 渲染 ──
  render() {
    renderTop(document.getElementById("topbar"), this.state, this.data);
    renderPanels(document.getElementById("side"), this.state, this.data, (pid) => {
      this.board.setHighlight(this.state.players.find((p) => p.id === pid)?.pos);
      this.audio.click();
    });
    this.board.draw(this.state, this.state.players);
    renderInventory(document.getElementById("board"), this.state, this.data, (key) => {
      // 道具栏点击：道具直接使用，机会/命运卡弹详情（它们只能由 reducer 在事件里触发）
      const [deck, id] = key.split(":");
      const cur = this.state.players[this.state.meta.currentSeat];
      if (!cur || cur.isAI) { this.toast.show("现在不是你的回合", "warn"); return; }
      if (!cur.cards[deck]?.includes(id)) { this.toast.show("这张卡不在你手上", "warn"); return; }

      if (deck === "item") {
        // reducer 读 action.cardId（不是 itemId）—— 之前传错字段导致 idx<0 直接 reject，
        // 玩家看到"点了没反应"，实际是被静默 return false。
        const r = this.dispatch({ type: "USE_ITEM", cardId: id });
        if (r) this.toast.show("已使用道具", "ok");
        else this.toast.show("这个道具现在用不了", "warn");
        return;
      }

      // 机会 / 命运卡：只允许在对应时机打，这里给详情 + 提示
      const def = (this.data.cards[deck] || []).find((c) => c.id === id);
      if (!def) return;
      const timing = deck === "opportunity" ? "机会卡（抽到时打）" : "命运卡（命中格子时打）";
      this.modal.open(`📜 ${def.name}`,
        `<div class="quote">${esc((def.text || []).join("\n"))}</div>
         <p style="color:var(--text-3);margin-top:10px">${esc(def.detail || "")}</p>
         <p style="color:var(--gold);margin-top:10px;font-size:12px">${timing}——在对应提示出现时点「打机会卡」即可</p>`,
        "📜", [{ label: "知道了", value: "close" }]);
      this.modal.onClick((v) => { if (v === "__foot__" || v === "close") this.modal.close(); });
    });
    this.renderActions();
  }

  // 顶栏按钮。用事件委托挂在稳定容器上 ——
  // renderTop() 每次都会重建 topbar 的 innerHTML，
  // 直接给按钮绑 click 会在第二次 render 后失效。
  // （也不能放在 index.html 的内联 script 里：单文件构建不保留它。）
  bindTopButtons() {
    const bar = document.getElementById("topbar");
    if (bar.__bound) return;
    bar.__bound = true;
    bar.addEventListener("click", (e) => {
      const id = e.target.id;
      if (id === "btnSound") {
        e.target.textContent = this.audio.toggle() ? "🔊" : "🔇";
      } else if (id === "btnBgm") {
        e.target.textContent = this.audio.toggleBgm() ? "🎵" : "🔕";
      } else if (id === "btnHelp") {
        this.showHelp();
      } else if (id === "btnExport") {
        showPassExport(this);
      } else if (id === "btnImport") {
        showPassImport(this, this.data);
      } else if (id === "btnSettings") {
        openSettingsModal(this, (s) => {
          // 设置实时变化：audio 状态已由 openSettingsModal 应用
          // 专注模式默认需要"下次启动"生效（game 已开始就不强制切）
          this.toast.show("设置已保存", "info", 1500);
        });
      }
    });
  }

  showHelp() {
    const e = this.data.config.economy;
    const months = (this.data.config.game.maxRounds / this.data.config.game.roundsPerMonth).toFixed(0);
    this.modal.open("怎么玩", `
      <div style="line-height:1.95;font-size:13px">
        <b>回合流程</b>：掷骰子 → 移动 → 落位事件 → 交易/用道具 → 结束回合<br>
        每 <b>${this.data.config.game.roundsPerMonth} 回合 = 1 个月</b>，
        月末结算：工资 + 收租 − 生活开销 − 月供 − 利息 + 存款利息<br><br>

        <b>资产口径</b>：净资产 = 现金 + 存款 + 房产 + 车辆 − <b>负债</b><br>
        资产最高者获胜。现金为负会先进入 <b>${e ? this.data.config.game.bankruptcy.graceRounds : 1} 个回合宽限期</b>，
        仍不足则按 车 → 房 → 存款 顺序变卖，变卖后还不回来就出局。<br><br>

        <b>房产怎么赚</b>：首付 ${((1 - e.mortgageRatio) * 100).toFixed(0)}%，贷款 ${e.mortgageMonths} 期。<br>
        月收入 = 月租 × <b>本月被踩次数</b>；持有满 3 个月解锁升值溢价（第 6 个月满额，
        ${months} 个月约涨 ${Math.round((Math.pow(1 + e.propertyAppreciation, 6) * (1 + e.propertyAppreciation * 6) - 1) * 100)}%）。<br>
        <b>地块位置决定收入</b> —— 起点周边和转角人流量更高。<br><br>

        <b>车怎么赚</b>：首付同比例、贷款 ${e.vehicleMonths} 期。价值在
        <b>每月省生活开销 + 加面子/心情</b>，不是租金。<br><br>

        <b>杠杆上限</b>：负债 / 总资产 超过上限就贷不出款了。<br>
        <b>存款</b>月息 ${(e.depositInterestRate * 100).toFixed(2)}%，<b>贷款</b>月息 ${(e.loanInterestRate * 100).toFixed(2)}%。
      </div>`, "❓", [{ label: "知道了", value: "know", cls: "primary" }]);
    this.modal.onClick((act) => {
      if (act === "know" || act === "__foot__") this.modal.close();
    });
  }

  renderActions() {
    const el = document.getElementById("actionbar");
    renderActions(el, this, this.state, this.data);
  }

  // 热座 / 局域网：轮到别人时，全屏提示把设备传过去。
  // 这是热座模式的核心交互 —— 不提示的话玩家会盯着屏幕干等。
  handoffPrompt(cur) {
    if (this.state.meta.mode === "solo" || !cur || cur.isAI) return;
    if (this.state.meta.mode !== "hotseat" && this.state.meta.mode !== "lan") return;
    this.modal.open("请把设备交给下一位", `
      <div class="quote" style="text-align:center;padding:18px 12px">
        <div style="font-size:15px">轮到 <b>${esc(cur.name)}</b> 了</div>
        <div style="margin-top:6px;font-size:12px;color:var(--text-3)">
          ${cur.name} 看完屏幕后点「开始」</div>
      </div>`, "🙋", [{ label: "开始", value: "go", cls: "primary" }]);
    this.modal.onClick((act) => {
      if (act === "go" || act === "__foot__") { this.modal.close(); this.renderActions(); }
    });
  }
}

// ── 启动 ──
async function boot() {
  let data;
  try {
    // 必须用绝对路径：main.js 在 src/ 下，相对路径会解析成 /src/data/*.json（404）
    data = await loadData("/data/");
  } catch (e) {
    document.getElementById("setupRoot").innerHTML =
      `<div style="padding:40px;font-family:system-ui">
        <h2>数据加载失败</h2><p>${esc(e.message)}</p>
        <p>请确认 data/ 目录存在，或用本地服务器打开（python -m http.server）。</p></div>`;
    return;
  }

  const game = new Game(data);
  window.__game = game;         // 便于调试与端到端测试
  window.__reduce = reduce;          // 直接是函数
  window.__serialize = serializeMod;   // ESM 命名空间

  // v2 §4.4 专注模式：F11 / Esc 切换 body.focus-mode
  ensureFocusExitButton();
  window.addEventListener("keydown", (e) => {
    if (e.key === "F11") {
      e.preventDefault();
      toggleFocusMode();
    } else if (e.key === "Escape" && document.body.classList.contains("focus-mode")) {
      toggleFocusMode();
    }
  });

  showSetup(document.getElementById("setupRoot"), data, (cfg) => {
    document.getElementById("setupRoot").innerHTML = "";
    root.classList.add("ready");
    game.start(cfg);
    game.audio.resume();
    if (game.bgmOn) game.audio.startBgm();
  });
}

function toggleFocusMode() {
  document.body.classList.toggle("focus-mode");
  window.__game?.audio?.blip?.("soft");
}

function ensureFocusExitButton() {
  if (document.querySelector(".focus-exit")) return;
  const btn = document.createElement("button");
  btn.className = "focus-exit";
  btn.textContent = "退出专注 (F11)";
  btn.onclick = () => toggleFocusMode();
  document.body.appendChild(btn);
}

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

boot();
