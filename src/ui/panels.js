// 面板渲染：顶栏、右侧玩家卡、底部操作区、中央弹窗、Toast。
// 全部走「增量改 textContent / class」，不做 innerHTML 全量替换（防闪烁）。

import { AVATARS, ICONS, RANK_NAMES, RANK_COLOR, CHARACTERS, AI_AVATARS } from "./icons.js";
import { drawCharacterOnCanvas } from "./character.js";
import { fmt, fmtSigned } from "./fmt.js";

const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ─────────── 顶栏 ───────────
export function renderTop(el, state, data) {
  const m = state.meta;
  const cur = state.players[m.currentSeat];
  const phaseName = {
    TURN_START: "回合开始", ROLL: "掷骰子", MOVING: "移动中",
    TILE_EVENT: "格子事件", POST_ACTION: "交易与道具", TURN_END: "回合结束",
    MONTH_SETTLE: "月度结算", BANKRUPT_CHECK: "破产清算", GAME_OVER: "游戏结束",
  }[m.phase] || m.phase;

  // 局域网模式：额外显示回合包导出/导入（伪联机通道）
  const lan = m.mode === "lan";

  el.innerHTML = `
    <div class="brand">大富翁 · 工位版<small>${esc(data.board.name)}</small></div>
    <div class="turn">第 ${m.turn} / ${m.maxRounds} 回合 · 第 ${m.month} 个月 · ${phaseName}</div>
    <div class="spacer"></div>
    <div class="mini-list" id="miniList"></div>
    ${lan ? `
      <button class="btn sm" id="btnImport" title="导入上一位发来的回合包">📥 导入</button>
      <button class="btn sm" id="btnExport" title="导出回合包发给下一位">📤 导出</button>
    ` : ""}
    <button class="icon-btn" id="btnSound" title="音效开关">🔊</button>
    <button class="icon-btn" id="btnBgm" title="背景音乐">🎵</button>
    <button class="icon-btn" id="btnSettings" title="设置">⚙️</button>
    <button class="icon-btn" id="btnHelp" title="玩法">?</button>
  `;
  const list = el.querySelector("#miniList");
  for (const p of state.players) {
    const d = document.createElement("div");
    d.className = "mini" + (p.id === cur?.id ? " active" : "") + (p.alive ? "" : " dead");
    d.innerHTML = `<span class="dot" style="background:${p.color}"></span>${esc(p.name)} <span style="color:var(--text-3)">${fmt(p.netWorth)}</span>`;
    list.appendChild(d);
  }
}

// ─────────── 右侧玩家卡 ───────────
export function renderPanels(el, state, data, onSelect) {
  const cur = state.players[state.meta.currentSeat];
  const html = [];
  html.push(`<div class="side-sec"><div class="sec-title">玩家 ${state.players.length} 名 · 第 ${state.meta.month} 个月</div>`);

  const RANK_LV = { intern: 1, specialist: 2, supervisor: 3, manager: 4, director: 5 };
  // 给 emoji "加表情气泡 + 职级徽章" ——
  // 当前玩家头上挂一个气泡显示状态（默认表情对应现金 / 大笑对应刚买地 / 加班对应 timeout 时），
  // 头像右下角叠一个盾形职级徽章（专员 Lv1~总监 Lv5）。
  // 这样 4 张玩家卡就从"信息卡片"升级为"角色小立绘"——也是后续可以替换成真立绘的容器。
  function portrait(p, isCur, data) {
    const mood = pickMood(p, isCur, data);
    const lv = (data.config?.ranks?.find((r) => r.id === p.rankId)?.level)
            || RANK_LV[p.rankId]
            || 1;
    // avatar 字段存人物 id（CHARACTERS）；旧存档的 emoji id 兜底显示
    const isChar = !!CHARACTERS[p.avatar];
    return `
      <div class="portrait" style="--skin:${p.color};--rank:${RANK_COLOR[p.rankId] || "#a8a4b4"}">
        <div class="portrait-body">
          ${isChar
            ? `<canvas class="portrait-cv" width="46" height="46" data-char="${p.avatar}"></canvas>`
            : `<span class="portrait-emoji">${AVATARS[p.avatar] || p.avatar || "👤"}</span>`}
          ${isCur ? `<span class="portrait-mood" title="${mood.label}">${mood.emoji}</span>` : ""}
        </div>
        <span class="portrait-lv" title="${p.rankId}">Lv${lv}</span>
      </div>
    `;
  }

  function pickMood(p, isCur, data) {
    if (!isCur) return { emoji: "", label: "" };
    if (p.cash < 0) return { emoji: "😵", label: "破产边缘" };
    if (p.loan.principal > 30000) return { emoji: "😰", label: "负债累累" };
    if (p.turnsSinceLastPurchase != null && p.turnsSinceLastPurchase > 6) return { emoji: "😴", label: "久未出手" };
    if (data && data.ui_text?.phrases?.mood_default) return data.ui_text.phrases.mood_default;
    return { emoji: "😊", label: "状态良好" };
  }

  for (const p of state.players) {
    const rank = RANK_NAMES[p.rankId];
    const isCur = p.id === cur?.id;
    const warn = p.cash < 0;
    // 职级等级：玩家卡星标和头像徽章共用（portrait 内部也算过一份，这里提升到外层作用域）
    const lv = (data.config?.ranks?.find((r) => r.id === p.rankId)?.level)
      || RANK_LV[p.rankId] || 1;
    const debt = p.loan.principal + p.vehicles.reduce((s, v) => s + (v.financed || 0), 0)
      + p.properties.reduce((s, x) => s + (x.financed || 0), 0);

    const cards = [];
    for (const deck of ["opportunity", "fate", "item"]) {
      for (const cid of p.cards[deck] || []) {
        const def = catalogOf(data, deck, cid);
        cards.push(`<span class="chip card" title="${esc(def?.detail || "")}" data-card="${deck}:${cid}">${esc(def?.name || cid)}</span>`);
      }
    }

    html.push(`
      <div class="pcard ${isCur ? "active" : ""} ${p.alive ? "" : "dead"}" data-pid="${p.id}" style="--pc:${p.color}">
        <div class="pcard-head">
          ${portrait(p, isCur, data)}
          <div class="pcard-id">
            <div class="pcard-name">${esc(p.name)}${p.isAI ? " 🤖" : ""}</div>
            <div class="pcard-rank" style="color:${RANK_COLOR[p.rankId] || "#a8a4b4"}">${rank}
              <span class="rank-stars">${"★".repeat(lv)}</span> · 月薪 ${fmt(monthlyOf(state, p, data))}</div>
          </div>
          <div class="pcard-nw">${fmt(p.netWorth)}<small>净资产</small></div>
        </div>
        <div class="pcard-row"><span>现金</span><b class="${p.cash < 0 ? "neg" : ""}">${fmt(p.cash)}${warn ? " ⚠️" : ""}</b></div>
        <div class="pcard-row"><span>存款</span><b>${fmt(p.deposit)}</b></div>
        ${debt > 0 ? `<div class="pcard-row"><span>负债</span><b class="neg">-${fmt(debt)}</b></div>` : ""}
        ${p.properties.length || p.vehicles.length ? `
        <div class="pcard-assets">
          ${p.properties.map((x) => `<span class="chip">${esc(x.name)}</span>`).join("")}
          ${p.vehicles.map((v) => `<span class="chip">${esc(v.name)}</span>`).join("")}
        </div>` : ""}
        ${cards.length ? `<div class="pcard-assets">${cards.join("")}</div>` : ""}
      </div>
    `);
  }
  html.push("</div>");

  // 行动日志
  const logs = state.log.slice(-9).reverse();
  html.push(`<div class="side-sec"><div class="sec-title">最近动态</div>
    ${logs.map((l) => `<div class="log-item"><span style="color:var(--text-3)">${l.round ? "R" + l.round + " " : ""}</span>${esc(l.text)}</div>`).join("")}
  </div>`);

  el.innerHTML = html.join("");
  // 头像 canvas：innerHTML 之后统一画 Q 版人物
  el.querySelectorAll("canvas.portrait-cv").forEach((cv) => {
    drawCharacterOnCanvas(cv, cv.dataset.char, CHARACTERS);
  });
  el.querySelectorAll(".pcard").forEach((c) => {
    c.onclick = () => onSelect(c.dataset.pid);
  });
  el.querySelectorAll("[data-card]").forEach((c) => {
    c.onclick = (e) => { e.stopPropagation(); showCardTip(c, data); };
  });
}

function showCardTip(el, data) {
  const [deck, id] = el.dataset.card.split(":");
  const def = catalogOf(data, deck, id);
  if (!def) return;
  el.title = `${def.name}\n${(def.text || []).join("\n")}\n\n${def.detail || ""}`;
}

function catalogOf(data, deck, id) {
  return (data.cards[deck] || []).find((c) => c.id === id) || null;
}

function monthlyOf(state, p, data) {
  const rank = data.config.ranks.find((r) => r.id === p.rankId) || data.config.ranks[0];
  return rank.coefficient * data.config.economy.baseSalary * p.salaryCoefficient * (1 - data.config.economy.salaryTaxRate);
}

// ─────────── 底部操作区 ───────────
export function renderActions(el, game, state, data) {
  const cur = state.players[state.meta.currentSeat];
  const mine = cur && !cur.isAI;
  const m = state.meta;

  // 强制刷新当前阶段的按钮集
  el.innerHTML = "";
  if (!cur) return;

  const add = (label, cls, fn, disabled) => {
    const b = document.createElement("button");
    b.className = "btn " + (cls || "");
    b.textContent = label;
    b.disabled = !!disabled;
    b.onclick = () => { game.audio.click(); fn(); };
    el.appendChild(b);
    return b;
  };

  if (!mine) {
    const d = document.createElement("span");
    // AI 等待指示器：人物头像 + 三点跳动，让"在算"和"卡了"两件事视觉上可区分
    d.className = "ai-wait";
    d.innerHTML = cur.alive
      ? `<canvas class="ai-wait-cv" width="34" height="34" data-char="${CHARACTERS[cur.avatar] ? cur.avatar : "coder"}"></canvas>
         <span class="ai-wait-name">${esc(cur.name)} 正在思考</span>
         <span class="ai-dots"><i></i><i></i><i></i></span>`
      : `<span class="ai-wait-name">${esc(cur.name)} 已出局</span>`;
    el.appendChild(d);
    el.querySelectorAll("canvas.ai-wait-cv").forEach((cv) => {
      drawCharacterOnCanvas(cv, cv.dataset.char, CHARACTERS);
    });
    return;
  }

  const hint = document.createElement("span");
  hint.className = "hint";

  switch (m.phase) {
    case "ROLL":
    case "TURN_START":
      add("🎲 掷骰子", "primary", () => game.dispatch({ type: "ROLL_DICE", playerId: cur.id }));
      hint.textContent = "掷骰子开始这一回合";
      break;

    case "POST_ACTION":
    case "TILE_EVENT": {
      // 手里有道具就给按钮（呼吸灯提示"该用道具了"）
      const items = cur.cards.item || [];
      if (items.length) add(`使用道具 (${items.length})`, "gold pulse", () => showItemPicker(game, cur, data));
      if (cur.cards.opportunity?.length) add(`打机会卡 (${cur.cards.opportunity.length})`, "purple", () => showCardPicker(game, cur, "opportunity", data));
      // 存/取款只在 POST_ACTION 开放：阶段白名单（actions.js）在 TILE_EVENT 不允许
      // DEPOSIT/WITHDRAW，旧版两阶段共用这组按钮，点了只会收到"当前阶段不允许"的 toast。
      if (m.phase === "POST_ACTION") {
        add("存款", "blue", () => showAmount(game, cur, "deposit", data));
        if (cur.deposit > 0) add("取款", "green", () => showAmount(game, cur, "withdraw", data));
        add("结束回合", "primary", () => game.dispatch({ type: "END_TURN", playerId: cur.id }));
        hint.textContent = "处理完就结束回合";
      } else {
        hint.textContent = "先处理格子事件";
      }
      break;
    }

    default:
      hint.textContent = "";
  }

  el.appendChild(hint);
}

function showItemPicker(game, cur, data) {
  const cards = cur.cards.item;
  // ★ 每个选项必须带 data-act —— Modal 的事件委托只认 [data-act] 和 [data-foot]。
  //   原实现只写 data-id，onClickFn 永远不触发 → 弹窗关不掉 → 玩家被困（= 反馈的"卡死"）。
  //   同时必须给页脚一个「取消」，否则误点后没有退路。
  const body = `<div class="opt-list">${cards.map((id) => {
    const def = catalogOf(data, "item", id);
    return `<button class="opt" data-act="use:${esc(id)}" data-id="${esc(id)}">
      <div class="opt-head"><span class="opt-name">${esc(def?.name || id)}</span></div>
      <div class="opt-meta">${esc(def?.detail || "")}</div>
    </button>`;
  }).join("")}</div>`;
  game.modal.open("用哪个道具？", body, "🎁", [{ label: "取消", value: "__cancel__" }]);
  game.modal.onClick((act, el) => {
    // 页脚「取消」
    if (act === "__foot__") { game.modal.close(); return; }
    if (typeof act === "string" && act.startsWith("use:")) {
      const cardId = act.slice(4);
      game.modal.close();
      // dispatch 内部已自动调 step()，这里不要重复调（会双推进导致跳过阶段）
      game.dispatch({ type: "USE_ITEM", cardId, playerId: cur.id });
    }
  });
}

function showCardPicker(game, cur, deck, data) {
  const cards = cur.cards[deck];
  // 同 showItemPicker：选项必须带 data-act，否则委托不触发、弹窗关不掉。
  const body = `<div class="opt-list">${cards.map((id) => {
    const def = catalogOf(data, deck, id);
    return `<button class="opt" data-act="play:${esc(id)}" data-id="${esc(id)}">
      <div class="opt-head"><span class="opt-name">${esc(def?.name || id)}</span></div>
      <div class="opt-meta">${esc(def?.detail || "")}</div>
    </button>`;
  }).join("")}</div>`;
  game.modal.open("打出手里的牌", body, "🎴", [{ label: "取消", value: "__cancel__" }]);
  game.modal.onClick((act) => {
    if (act === "__foot__") { game.modal.close(); return; }
    if (typeof act === "string" && act.startsWith("play:")) {
      game.modal.close();
      game.dispatch({ type: "PLAY_CARD", cardId: act.slice(5), playerId: cur.id });
    }
  });
}

function showAmount(game, cur, kind, data) {
  const isDep = kind === "deposit";
  const max = isDep ? cur.cash : cur.deposit;
  const rate = data.config.economy.depositInterestRate;
  // 同上：data-act + 取消按钮 + 不重复 step()
  const body = `
    <div class="opt-list">
      <button class="opt" data-act="amt:${Math.round(max * 0.3)}">
        <div class="opt-head"><span class="opt-name">30%</span><span class="opt-price">${fmt(max * 0.3)}</span></div></button>
      <button class="opt" data-act="amt:${Math.round(max * 0.5)}">
        <div class="opt-head"><span class="opt-name">50%</span><span class="opt-price">${fmt(max * 0.5)}</span></div></button>
      <button class="opt" data-act="amt:${Math.round(max)}">
        <div class="opt-head"><span class="opt-name">全部</span><span class="opt-price">${fmt(max)}</span></div></button>
    </div>
    <div class="modal-detail">当前现金 ${fmt(cur.cash)} 元 · 存款 ${fmt(cur.deposit)} 元，月利息约 ${fmt(cur.deposit * rate)} 元。
      ${isDep ? "存钱吃息。" : "取出来周转。"}</div>`;
  game.modal.open(isDep ? "存多少？" : "取多少？", body, "🏦", [{ label: "取消", value: "__cancel__" }]);
  game.modal.onClick((act) => {
    if (act === "__foot__") { game.modal.close(); return; }
    if (typeof act === "string" && act.startsWith("amt:")) {
      game.modal.close();
      const amt = Math.max(0, Math.min(max, +act.slice(4)));
      if (amt > 0) game.dispatch({ type: isDep ? "DEPOSIT" : "WITHDRAW", amount: amt, playerId: cur.id });
    }
  });
}

// ─────────── 中央弹窗 ───────────
export class Modal {
  constructor(el) {
    this.el = el;
    // 只用 [data-act] 一个通道，页脚按钮用 data-foot。
    // 第 4 步实测两者都用 data-act 时会互相串：选项按钮 data-act="skip"
    // 会触发事件弹窗的 onClick("skip")，而那个回调只认 "buy"，
    // 结果「继续」按钮点了没反应、弹窗关不掉、回合卡在 TILE_EVENT。
    this.el.addEventListener("click", (e) => {
      const opt = e.target.closest("[data-act]");
      if (opt && this.onClickFn) { this.onClickFn(opt.dataset.act, opt); return; }
      const foot = e.target.closest("[data-foot]");
      if (foot && this.onClickFn) {
        this.onClickFn("__foot__", foot);
        // ★ 兜底：只有点右上角 ×（__x__）才强制关。
        //   普通页脚按钮（继续/知道了）回调里可能还要 dispatch，不能这里抢着关。
        //   但 × 是「我明确要退出」，回调万一没处理就必须兜住，
        //   否则玩家点 × 没反应 = 被困在弹窗里（这正是反馈的「不能取消」）。
        if (foot.dataset.foot === "__x__" && this.el.classList.contains("show")) this.close();
        return;
      }
    });
  }
  open(title, bodyHtml, emoji = "💬", buttons = []) {
    const btns = buttons
      .map((b) => `<button class="btn ${b.cls || ""}" data-foot="${b.value || b.label}">${esc(b.label)}</button>`)
      .join("");
    this.el.innerHTML = `
      <div class="modal">
        <div class="modal-head">
          <button class="modal-x" data-foot="__x__" title="关闭">×</button>
          <div class="modal-emoji">${emoji}</div>
          <div class="modal-title">${esc(title)}</div>
        </div>
        <div class="modal-body">${bodyHtml}</div>
        ${btns ? `<div class="modal-foot">${btns}</div>` : ""}
      </div>`;
    this.el.classList.add("show");
  }
  onClick(fn) { this.onClickFn = fn; }
  close() {
    this.el.classList.remove("show");
    this.el.innerHTML = "";
    this.onClickFn = null;
  }
}

// ─────────── Toast ───────────
export class Toast {
  constructor(el) { this.el = el; }
  show(text, kind = "") {
    const d = document.createElement("div");
    d.className = "toast " + kind;
    d.textContent = text;
    this.el.appendChild(d);
    setTimeout(() => d.remove(), 2400);
  }
}

// ─────────── 道具栏（独立的 6 卡槽抽屉） ───────────
// 固定在棋盘左下角：从当前玩家 cards.item/opportunity/fate 取图标（用 emoji + 卡名首字），
// 只展示当前玩家拥有的；非当前玩家拥有的卡槽灰显。
// 点击空卡槽：提示"无道具"；点击非空卡槽：弹该项的 detail（复用 Modal）。
//
// 道具/卡牌图标：统一走 icons.js 的 ICONS 映射（旧版 def.icon 是 key 不是 emoji，
// 未映射时会直接把 "car" 这种字符串当图标显示）
function cardEmoji(def) {
  if (!def) return "❔";
  return ICONS[def.icon] || ICONS[def.id] || "📦";
}

export function renderInventory(boardEl, state, data, onUseCard) {
  const cur = state.players[state.meta.currentSeat];
  if (!cur) return;
  // 合成 6 个槽位：item / opportunity / fate
  const slots = [];
  const push = (deck, cid) => {
    const def = catalogOf(data, deck, cid);
    slots.push({ deck, id: cid, def });
  };
  (cur.cards.item || []).forEach((id) => push("item", id));
  (cur.cards.opportunity || []).forEach((id) => push("opportunity", id));
  (cur.cards.fate || []).forEach((id) => push("fate", id));
  // 填满到 6 槽
  while (slots.length < 6) slots.push(null);

  const html = `
    <div class="inv-wrap">
      <div class="inv-title"><span>🎒 道具栏</span><small>${slots.filter(Boolean).length}/6</small></div>
      <div class="inv-slots">
        ${slots.map((s, i) => s
          ? `<button class="inv-slot filled ${s.deck}" data-idx="${i}" data-card="${s.deck}:${s.id}" title="${esc(s.def?.name||'')}">
               <span class="inv-glyph">${cardEmoji(s.def)}</span>
               <span class="inv-name">${esc((s.def?.name || '').slice(0, 4))}</span>
             </button>`
          : `<div class="inv-slot empty" title="空槽"><span class="inv-glyph">＋</span></div>`
        ).join("")}
      </div>
    </div>
  `;

  // 容器就绪后渲染（手里有道具时加呼吸灯，提醒"该用道具了"）
  let container = document.getElementById("inventory");
  if (!container) {
    container = document.createElement("div");
    container.id = "inventory";
    container.className = "inv-fixed";
    boardEl.parentElement?.appendChild(container);
  }
  container.className = "inv-fixed" + (slots.some(Boolean) ? " has-items" : "");
  container.innerHTML = html;
  container.querySelectorAll(".inv-slot.filled").forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      onUseCard?.(btn.dataset.card);
    };
  });
}
