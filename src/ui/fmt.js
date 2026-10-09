// 数字格式化

export function fmt(n) {
  const v = Math.round(n || 0);
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 100000000) return sign + (abs / 100000000).toFixed(2) + "亿";
  if (abs >= 10000) return sign + (abs / 10000).toFixed(abs >= 100000 ? 0 : 1) + "万";
  return sign + abs.toLocaleString("zh-CN");
}

export function fmtSigned(n) {
  const v = Math.round(n || 0);
  return (v >= 0 ? "+" : "") + fmt(v);
}
