// 带种子的 PRNG（mulberry32）。所有随机都必须走这里，保证回放一致。
// state 只有一个 uint32，序列化成本极低。

export function createRng(seed) {
  return seed >>> 0;
}

// 返回 [0,1) 的浮点数与新的 rng，顺序统一为 [value, nextRng]
export function nextFloat(rng) {
  rng = (rng + 0x6d2b79f5) >>> 0;
  let t = rng;
  t = Math.imul(t ^ (t >>> 15), 1 | t);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  const v = (t ^ (t >>> 14)) >>> 0;
  return [v / 4294967296, rng];
}

// 推进一次并返回新 rng
export function advance(rng) {
  return nextFloat(rng)[0];
}

// 返回 [1..sides] 的整数
export function nextInt(rng, sides) {
  const [f, r] = nextFloat(rng);
  return [Math.floor(f * sides) + 1, r];
}

// 按 weight 字段加权抽取。items 需带 weight 数字字段。
// 返回 [item, newRng]，全空返回 [null, rng]
export function weightedPick(rng, items, weightKey = "weight") {
  let total = 0;
  for (const it of items) total += (it[weightKey] > 0 ? it[weightKey] : 0);
  if (total <= 0) return [null, rng];
  const [f, r] = nextFloat(rng);
  let acc = f * total;
  for (const it of items) {
    acc -= (it[weightKey] > 0 ? it[weightKey] : 0);
    if (acc <= 0) return [it, r];
  }
  return [items[items.length - 1], r];
}

// 原地洗牌（Fisher-Yates），返回新 rng
export function shuffle(rng, arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const [f, r] = nextFloat(rng);
    rng = r;
    const j = Math.floor(f * (i + 1));
    const t = a[i];
    a[i] = a[j];
    a[j] = t;
  }
  return { rng, arr: a };
}

// 从 seed 字符串生成 uint32（用于房间号 → 种子）
export function seedFromString(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}
