// 性格画像：拆解各性格的资产构成与胜率，定位平衡问题。
// 复用 tools/load.mjs 的共享驱动，与真实游戏同一条路径。
// 用法：node tools/profile.mjs [局数]

import { loadHarness, PROFILES, mkProfiles } from "./load.mjs";

const h = await loadHarness();
const { data, reduce, netWorth, monthlyRentIncome } = h;

const N = parseInt(process.argv[2] || "300", 10);

const agg = {};
for (const pr of PROFILES) {
  agg[pr] = {
    win: 0, nw: [], cash: [], deposit: [], props: [], rent: [],
    loan: [], assets: [], vehicles: 0, loanUse: 0, bankrupt: 0, rank: {},
  };
}

let errs = 0;
const t0 = Date.now();
for (let i = 0; i < N; i++) {
  const seed = 300000 + i * 7919;
  const players = mkProfiles(3, data.board);
  const r0 = reduce(null, h.newGame(seed, players), data);
  let st;
  try {
    st = h.playOut(r0.state).state;
  } catch (e) {
    errs++;
    if (errs <= 3) console.log(`  x seed ${seed}: ${e.message.slice(0, 130)}`);
    continue;
  }
  for (const p of st.players) {
    const a = agg[p.aiProfile];
    if (!a) continue;
    if (st.winner === p.id) a.win++;
    if (!p.alive) a.bankrupt++;
    a.nw.push(netWorth(st, p.id));
    a.cash.push(p.cash);
    a.deposit.push(p.deposit);
    a.props.push(p.properties.length);
    a.rent.push(monthlyRentIncome(st, p.id));
    a.loan.push(p.loan.principal);
    a.assets.push(p.properties.map((x) => x.name).join("+") || "-");
    a.vehicles += p.vehicles.length;
    if (p.loan.principal > 0) a.loanUse++;
    a.rank[p.rankId] = (a.rank[p.rankId] || 0) + 1;
  }
}
const total = Date.now() - t0;

const avg = (x) => (x.length ? x.reduce((s, v) => s + v, 0) / x.length : 0);
const fm = (n) => (Math.abs(n) >= 10000 ? (n / 10000).toFixed(1) + "万" : Math.round(n).toString());

console.log(`\n${N} 局 · 3 性格混战 · 耗时 ${total}ms${errs ? ` · ${errs} 局异常` : ""}\n`);
console.log("性格".padEnd(9), "胜率".padStart(7), "净资产".padStart(8), "现金".padStart(8),
  "存款".padStart(8), "房产".padStart(6), "月租".padStart(7), "贷款".padStart(8), "买车".padStart(6), "破产".padStart(6));
console.log("-".repeat(84));
for (const pr of PROFILES) {
  const a = agg[pr];
  console.log(
    pr.padEnd(9),
    ((a.win / N) * 100).toFixed(1).padStart(6) + "%",
    fm(avg(a.nw)).padStart(8),
    fm(avg(a.cash)).padStart(8),
    fm(avg(a.deposit)).padStart(8),
    avg(a.props).toFixed(2).padStart(6),
    fm(avg(a.rent)).padStart(7),
    fm(avg(a.loan)).padStart(8),
    (a.vehicles / N).toFixed(2).padStart(6),
    ((a.bankrupt / N) * 100).toFixed(1).padStart(5) + "%"
  );
}

console.log("\n-- 买入的资产（按次数）--");
for (const pr of PROFILES) {
  const cnt = {};
  for (const list of agg[pr].assets) {
    if (list === "-") continue;
    for (const name of list.split("+")) cnt[name] = (cnt[name] || 0) + 1;
  }
  const s = Object.entries(cnt).sort((a, b) => b[1] - a[1]);
  console.log(`  ${pr.padEnd(9)} ${s.length ? s.map(([k, v]) => `${k} x${v}`).join("  ") : "（未买房）"}`);
}

console.log("\n-- 资产产出率 vs 存款利率 --");
const depRoi = data.config.economy.depositInterestRate * 12;
for (const pr of PROFILES) {
  const a = agg[pr];
  const nwAvg = avg(a.nw);
  const roi = nwAvg > 0 ? (avg(a.rent) * 12) / nwAvg : 0;
  console.log(`  ${pr.padEnd(9)} ${(roi * 100).toFixed(2)}%  vs 存款 ${(depRoi * 100).toFixed(2)}%  -> ${roi > depRoi ? "优于存款 [OK]" : "不如存款 [X]"}`);
}

console.log("\n-- 职级分布 --");
const rankNames = { intern: "实习生", specialist: "专员", supervisor: "主管", manager: "经理", director: "总监" };
for (const pr of PROFILES) {
  const parts = Object.entries(agg[pr].rank).sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${rankNames[k] || k} ${(v / N * 100).toFixed(0)}%`);
  console.log(`  ${pr.padEnd(9)} ${parts.join("  ")}`);
}

const wins = PROFILES.map((p) => (agg[p].win / N) * 100);
const spread = Math.max(...wins) - Math.min(...wins);
console.log("\n-- 平衡判定 --");
console.log(`  胜率极差 ${spread.toFixed(1)} 个百分点 ${spread < 25 ? "[OK] 平衡可接受" : spread < 45 ? "[!] 略失衡" : "[X] 严重失衡"}`);
