// 通用工具：深拷贝、数值钳制、状态哈希。零依赖。
//
// 深拷贝用手写递归而非 structuredClone：实测 state 是「大量小对象 + 数组」结构，
// structuredClone 每次都要走结构化序列化协议，比手写递归慢 5 倍以上
// （300 局模拟从 4 秒变 30+ 秒）。手写版对纯 JSON 数据足够。

export function clone(o) {
  if (o === null || typeof o !== "object") return o;
  if (Array.isArray(o)) {
    const n = o.length;
    const a = new Array(n);
    for (let i = 0; i < n; i++) {
      const v = o[i];
      a[i] = v !== null && typeof v === "object" ? clone(v) : v;
    }
    return a;
  }
  const r = {};
  for (const k in o) {
    const v = o[k];
    r[k] = v !== null && typeof v === "object" ? clone(v) : v;
  }
  return r;
}

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function round2(v) {
  return Math.round(v * 100) / 100;
}

// FNV-1a 32bit。用于伪联机与断线重连的一致性校验。
// 必须对 key 排序，否则对象字面量顺序不同会导致哈希不同。
export function hashState(state) {
  const s = stableStringify(state);
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return "fnv1a-" + h.toString(16).padStart(8, "0");
}

export function stableStringify(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]";
  const keys = Object.keys(v).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(v[k])).join(",") + "}";
}

export function formatMoney(v) {
  const n = Math.round(v);
  return n.toLocaleString("zh-CN");
}

export function titleCaseRank(r) {
  return r;
}
