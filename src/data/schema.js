// 数据校验：id 唯一性、effect op 白名单、weight 合法、格子路径连续、牌数符合配置。
// 返回错误字符串数组（空数组 = 全部通过）。

import { OPS } from "../core/effects.js";

export function validateData(data) {
  const errs = [];
  const { config, board, cards, events } = data;

  // 棋盘
  if (!board.tiles || !board.tiles.length) {
    errs.push("board.tiles 为空");
    return errs;
  }
  const size = board.tiles.length;
  if (size < 40 || size > 50) {
    errs.push(`格子数 ${size} 超出 40~50 的设计区间`);
  }
  const ids = new Set();
  for (const t of board.tiles) {
    if (ids.has(t.id)) errs.push(`格子 id 重复：${t.id}`);
    ids.add(t.id);
    if (!t.type) errs.push(`格子 ${t.id} 缺少 type`);
    if (t.type === "property" || t.type === "company") {
      if (!(t.payload && t.payload.price > 0)) errs.push(`地皮 ${t.id} 缺少 price`);
      if (!(t.payload && t.payload.rent > 0)) errs.push(`地皮 ${t.id} 缺少 rent`);
    }
    if (t.type === "vehicle") {
      if (!(t.payload && Array.isArray(t.payload.options) && t.payload.options.length)) {
        errs.push(`买车格 ${t.id} 缺少 options`);
      }
    }
  }
  // 路径必须 0..size-1 连续，否则环形移动会跳格
  const sorted = board.tiles.map((t) => t.id).sort((a, b) => a - b);
  for (let i = 0; i < size; i++) {
    if (sorted[i] !== i) { errs.push("格子 id 必须是 0..n-1 的连续整数（环形移动依赖）"); break; }
  }

  // 卡牌
  for (const deck of ["opportunity", "fate", "item"]) {
    const list = cards[deck] || [];
    if (!list.length) { errs.push(`牌堆 ${deck} 为空`); continue; }
    const seen = new Set();
    for (const c of list) {
      if (seen.has(c.id)) errs.push(`卡牌 id 重复：${c.id}`);
      seen.add(c.id);
      if (!(c.weight > 0)) errs.push(`卡牌 ${c.id} weight 非法`);
      if (!c.name) errs.push(`卡牌 ${c.id} 缺少 name`);
      if (!Array.isArray(c.text) || !c.text.length) errs.push(`卡牌 ${c.id} 缺少 text`);
      for (const e of c.effects || []) {
        if (!OPS.has(e.op)) errs.push(`卡牌 ${c.id} 使用了未知 op：${e.op}`);
      }
      for (const g of c.grants || []) {
        if (!GRANT_OPS.has(g.op)) errs.push(`卡牌 ${c.id} 使用了未知 grant：${g.op}`);
      }
      if (c.deck !== deck) errs.push(`卡牌 ${c.id} 的 deck 字段(${c.deck}) 与所在牌堆(${deck}) 不符`);
    }
  }

  // 事件
  for (const [pool, list] of Object.entries(events || {})) {
    for (const e of list) {
      if (!e.id) errs.push(`事件池 ${pool} 中有事件缺少 id`);
      if (!(e.weight > 0)) errs.push(`事件 ${e.id} weight 非法`);
      for (const eff of e.effects || []) {
        if (!OPS.has(eff.op)) errs.push(`事件 ${e.id} 使用了未知 op：${eff.op}`);
      }
    }
  }

  // 职级
  const ranks = config.ranks || [];
  if (!ranks.length) errs.push("ranks 为空");
  let prev = -1;
  for (const r of ranks) {
    if (r.minNetWorth <= prev) errs.push(`职级 ${r.name} 的 minNetWorth 必须递增`);
    prev = r.minNetWorth;
  }
  if (ranks[0] && ranks[0].coefficient !== 0.6) errs.push("实习生系数应为 0.6");

  return errs;
}

export const GRANT_OPS = new Set([
  "reroll", "drawCard", "skipMove", "exemptLiving", "halveLiving",
  "peekRichest", "stat", "cash", "moveBonus", "skipNext", "shield",
  "passiveIncome",
]);

// 起手道具必须存在于 item 牌堆
export function validateStartingDeck(config, cards) {
  const errs = [];
  const ids = new Set((cards.item || []).map((c) => c.id));
  for (const id of config.startingDeck?.item || []) {
    if (!ids.has(id)) errs.push(`startingDeck 里的道具 ${id} 不存在于 item 牌堆`);
  }
  return errs;
}
