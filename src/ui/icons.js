// 视觉规格：配色、格子材质、装饰、棋子形象。
// 参照经典大富翁（棋盘宝盒 / 欢乐大富翁）的做法：
//   ① 分区跳跃配色 —— 相邻格子不同色，避免整盘一片糊
//   ② 格子有立体厚度 —— 顶面 + 侧面 + 高光，不是纯色平面
//   ③ 装饰画成实际场景 —— 工位是隔断、茶水间是咖啡机，不是 emoji
//   ④ 棋子有形象 —— 带高光和投影的小圆角方块，不是裸圆点

// ─────────── 格子配色 ───────────
// v2 升级（2026-10-08）：14 种 tile type 全部映射到 v2 6 区段色板（来自 docs/05-UI概念设计.md §2.1）
// 6 区段：研发蓝 / 会议紫 / 咖啡棕 / 公共绿 / 高管金 / 机动橙 + state-warn 红
// 同区段内通过 hi / deep 区分（如 company=蓝 base，property=蓝 deep；eat=棕 base，cut=棕 deep）
// bg/fg/edge/hi：底色 / 文字 / 侧面暗部 / 顶部高光
export const TILE = {
  start:      { bg: "#5cb868", fg: "#ffffff", edge: "#3f8048", hi: "#8fd896", tone: "起点" },
  company:    { bg: "#4f80d8", fg: "#ffffff", edge: "#345d9b", hi: "#8fb0e8", tone: "地产" },
  property:   { bg: "#345d9b", fg: "#ffffff", edge: "#1f3d6b", hi: "#6f90c8", tone: "房产" },
  rent:       { bg: "#3f8048", fg: "#ffffff", edge: "#2a5a32", hi: "#6fb078", tone: "租房" },
  eat:        { bg: "#a07050", fg: "#ffffff", edge: "#75513a", hi: "#c89e80", tone: "吃饭" },
  clothes:    { bg: "#e8804f", fg: "#ffffff", edge: "#a55a35", hi: "#f0a888", tone: "购物" },
  vehicle:    { bg: "#a55a35", fg: "#ffffff", edge: "#7a4023", hi: "#d28868", tone: "买车" },
  promotion:  { bg: "#e8c66c", fg: "#3d2f00", edge: "#a98a4a", hi: "#f0dca0", tone: "升职" },
  demotion:   { bg: "#e85a5a", fg: "#ffffff", edge: "#a83a3a", hi: "#f08882", tone: "降职" },
  raise:      { bg: "#f0dca0", fg: "#3d2f00", edge: "#a98a4a", hi: "#fff0c8", tone: "加薪" },
  cut:        { bg: "#75513a", fg: "#ffffff", edge: "#523823", hi: "#a07050", tone: "降薪" },
  chance:     { bg: "#9268d4", fg: "#ffffff", edge: "#674695", hi: "#bca0e8", tone: "机会" },
  fate:       { bg: "#674695", fg: "#ffffff", edge: "#43305f", hi: "#9678c0", tone: "命运" },
  vacation:   { bg: "#8fd896", fg: "#3d2f00", edge: "#5cb868", hi: "#b8e8be", tone: "公休" },
};

// 格子顶部的类型徽标配色（画一条小色带 + 文字）
export const TILE_BADGE = {
  start: "#8fd896", company: "#8fb0e8", property: "#6f90c8",
  rent: "#6fb078", eat: "#c89e80", clothes: "#f0a888",
  vehicle: "#d28868", promotion: "#f0dca0", demotion: "#f08882",
  raise: "#fff0c8", cut: "#a07050", chance: "#bca0e8",
  fate: "#9678c0", vacation: "#b8e8be",
};

// ─────────── 内部装饰：画成实际场景 ───────────
// kind 与 board.json 的 decor.kind 对应。每项给 draw 函数需要的参数。
export const DECOR_SPEC = {
  // 工位区：四联隔断工位
  cubicle: { kind: "cubicle", tint: "#8fb8e8", dark: "#5a87bd" },
  // 茶水间：咖啡机 + 杯架
  teaRoom: { kind: "teaRoom", tint: "#f0c98a", dark: "#b8934f" },
  // 会议室：大圆桌 + 四把椅子
  meetingRoom: { kind: "meeting", tint: "#a9c9e8", dark: "#6b8cae" },
  // 老板办公室：大班台 + 老板椅
  bossOffice: { kind: "boss", tint: "#e8a898", dark: "#a86a58" },
  printer: { kind: "printer", tint: "#c2ccd6", dark: "#8592a0" },
  plant: { kind: "plant", tint: "#8fc99a", dark: "#579a63" },
  whiteboard: { kind: "board", tint: "#dfe5ea", dark: "#9aa5b0" },
  pantry: { kind: "pantry", tint: "#e8c4a0", dark: "#a67f5c" },
  window: { kind: "window", tint: "#a8d4ea", dark: "#6b9fbb" },
  sofa: { kind: "sofa", tint: "#cfc0e0", dark: "#8f7fa6" },
  watercooler: { kind: "water", tint: "#a8d8e0", dark: "#6b9aa8" },
  gym: { kind: "gym", tint: "#8fc99a", dark: "#579a63" },
  serverRoom: { kind: "server", tint: "#9fb4c8", dark: "#5a7186" },
  reception: { kind: "reception", tint: "#f0dca0", dark: "#b8934f" },
};

// ─────────── 棋子 ───────────
// 6 个颜色对应 colorTokens（全部走 v2 区段色，仅红色保留为对手色语义）
export const TOKEN_SKIN = {
  "#e85a5a": { hi: "#f08585", lo: "#a33f3f", glyph: "●" }, // 1 红（state-warn，对手色）
  "#4f80d8": { hi: "#7ea8e8", lo: "#345d9b", glyph: "●" }, // 2 蓝（研发蓝 hi）
  "#5cb868": { hi: "#8fd896", lo: "#3f8048", glyph: "●" }, // 3 绿（公共绿 hi）
  "#e8c66c": { hi: "#f0dca0", lo: "#a98b3f", glyph: "●" }, // 4 金（高管金 hi）
  "#9268d4": { hi: "#b69fe0", lo: "#674695", glyph: "●" }, // 5 紫（会议紫 hi）
  "#e8804f": { hi: "#f4a47c", lo: "#a55a35", glyph: "●" }, // 6 橙（机动橙 hi）
};

// ─────────── 头像 ───────────
export const AVATARS = {
  panda: "🐼", shark: "🦈", turtle: "🐢", cat: "🐱",
  dog: "🐶", fox: "🦊", bear: "🐻", rabbit: "🐰",
  chicken: "🐔", frog: "🐸", owl: "🦉", mouse: "🐭",
};

export const AI_AVATARS = {
  greedy: "boss",    // 贪婪型 → 金表老板
  steady: "coder",   // 稳健型 → 眼镜小哥
  spender: "sis",    // 消费型 → 高马尾小柒
};

// ─────────── Q 版卡通人物（人类打工人，不用动物）───────────
// hair:  short 短发 / long 长发 / buns 双丸子 / ponytail 侧马尾 / bald 秃头造型
// 具体画法见 character.js
export const CHARACTERS = {
  coder:  { name: "眼镜小哥",   hair: "short",    hairColor: "#2b2b33", skin: "#f2cfad", shirt: "#4f80d8", glasses: true },
  lady:   { name: "红裙丽人",   hair: "long",     hairColor: "#5f4230", skin: "#f6d7ba", shirt: "#d4537e" },
  intern: { name: "丸子头妹妹", hair: "buns",     hairColor: "#23202a", skin: "#f8dcc0", shirt: "#e8c66c" },
  uncle:  { name: "绿衫大叔",   hair: "short",    hairColor: "#3d3d43", skin: "#eac49b", shirt: "#1d9e75", beard: true },
  boss:   { name: "金表老板",   hair: "bald",     hairColor: "#7d7d86", skin: "#eec9a4", shirt: "#3a3947", tie: "#f5c842" },
  sis:    { name: "高马尾小柒", hair: "ponytail", hairColor: "#8a4a2a", skin: "#f7d8bd", shirt: "#e8804f" },
};
export const CHARACTER_ORDER = ["coder", "lady", "intern", "uncle", "boss", "sis"];

export const RANK_NAMES = {
  intern: "实习生", specialist: "专员", supervisor: "主管",
  manager: "经理", director: "总监",
};

// 职级配色（玩家卡徽章）——全部走 v2 区段色，浅→深 表层级递进
export const RANK_COLOR = {
  intern: "#6e6a7c",        // 实习生（text-3 灰，最浅）
  specialist: "#4f80d8",    // 专员（研发蓝）
  supervisor: "#5cb868",    // 主管（公共绿）
  manager: "#e8c66c",       // 经理（高管金）
  director: "#9268d4",      // 总监（会议紫，最显赫）
};

// 事件弹窗图标
export const ICONS = {
  start: "🏁", company: "🏢", property: "🏠", rent: "🔑",
  eat: "🍜", clothes: "👕", vehicle: "🚗", promotion: "📈",
  demotion: "📉", raise: "💰", cut: "✂", chance: "✨",
  fate: "🎲", vacation: "🌴",
  event: "💬", card: "🎴", buy: "🤝", skip: "🐟", error: "⚠️",
  house: "🏠", car: "🚗", bento: "🍱", meal: "🍽", noodle: "🍜",
  delivery: "🛵", buffet: "🍲", shirt: "👕", suit: "🧥", shoes: "👞",
  repair: "🔧", leave: "🌴", meeting: "👥", coffee: "☕", night: "🌙",
  star: "⭐", cert: "📜", money: "💴", coin: "🪙", down: "📉", up: "📈",
  help: "🤝", phone: "📞", mail: "✉️", mic: "🎤", doc: "📄",
  chart: "📈", laptop: "💻", drink: "🥤", box: "📦", blame: "👉",
  screen: "🖥", health: "🏥", search: "🔍", whisper: "🗣", server: "🖧",
  anger: "😠", chair: "🪑", pie: "🥧", fail: "❌", bank: "🏦",
  plant: "🌿", ticket: "🎫", eye: "👁", fish: "🐟", umbrella: "☂️",
  gift: "🎁", car: "🚗", money: "💴",
};
