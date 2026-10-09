// 数据加载：把 data/*.json 读进来，校验基本结构，注入 config.__events。
// core 层不依赖本文件（core 只接受已装配好的 data 对象）。
//
// 双通道：
//   - 构建产物里数据已内联到 window.__GAME_DATA__，直接读它（file:// 下 fetch 会被 CORS 拦）
//   - 开发态走 fetch

import { validateData } from "./schema.js";

export async function loadData(base = "/data/") {
  let raw;

  const inline = typeof window !== "undefined" ? window.__GAME_DATA__ : null;
  if (inline) {
    raw = inline;
  } else {
    const names = [
      "config", "board", "events",
      "cards.opportunity", "cards.fate", "cards.item",
      "ai_profiles", "ui_text",
    ];
    raw = {};
    await Promise.all(
      names.map(async (n) => {
        const r = await fetch(`${base}${n}.json`);
        if (!r.ok) throw new Error(`无法加载 ${n}.json (${r.status})`);
        raw[n] = await r.json();
      })
    );
  }

  const data = {
    config: raw.config,
    board: raw.board,
    cards: {
      opportunity: raw["cards.opportunity"].cards,
      fate: raw["cards.fate"].cards,
      item: raw["cards.item"].cards,
    },
    events: raw.events.pools,
    aiProfiles: raw.ai_profiles,
    uiText: raw.ui_text,
  };

  // 事件池挂到 config 上，方便 reducer 只拿 data.config 就能取到
  data.config.__events = data.events;

  const errs = validateData(data);
  if (errs.length) {
    console.warn("[数据校验] 发现问题：", errs);
  }
  return data;
}
