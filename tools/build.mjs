// 构建脚本：把多文件 ESM 项目打包成单个 HTML（双击即玩）。
//
// 做法：
//   1. 用 esbuild 把 src/main.js 打成 IIFE（单文件、无模块）
//   2. 内联 CSS
//   3. 把 data/*.json 也内联成 JS 常量（避免 file:// 下的 fetch 限制）
//   4. 输出 dist/大富翁-工位版.html
//
// 为什么必须内联 JSON：file:// 协议下 fetch 本地 JSON 会被 CORS 拦，
// 而「双击就能玩」是硬需求。

import { build } from "esbuild";
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// ── 1. 打包 JS ──
const res = await build({
  entryPoints: [join(ROOT, "src/main.js")],
  bundle: true,
  format: "iife",
  target: ["chrome110", "firefox110", "safari16"],
  write: false,
  minify: true,
  legalComments: "none",
  charset: "utf8",
});
const js = res.outputFiles[0].text;

// ── 2. 读 CSS ──
const css = readFileSync(join(ROOT, "src/ui/theme.css"), "utf8");

// ── 3. 内联数据 ──
const dataDir = join(ROOT, "data");
const jsonFiles = readdirSync(dataDir).filter((f) => f.endsWith(".json"));
const dataObj = {};
for (const f of jsonFiles) {
  const key = f.replace(/\.json$/, "");
  dataObj[key] = JSON.parse(readFileSync(join(dataDir, f), "utf8"));
}
const dataJson = JSON.stringify(dataObj);

// ── 4. 组装 HTML ──
// 注意：</script> 出现在 JSON 字符串里会提前关闭 script 标签，必须转义。
const safeJson = dataJson.replace(/<\/script>/gi, "<\\/script>").replace(/<!--/g, "<\\!--");

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>大富翁 · 工位版</title>
<style>
${css}
</style>
</head>
<body>
<div id="setupRoot"></div>
<div id="app">
  <div class="topbar" id="topbar"></div>
  <div class="main">
    <div class="board-wrap"><canvas id="board" width="600" height="600"></canvas></div>
    <div class="side" id="side"></div>
  </div>
  <div class="actionbar" id="actionbar"></div>
</div>
<div class="overlay" id="modalLayer"></div>
<div class="toasts" id="toastLayer"></div>

<script id="gamedata" type="application/json">${safeJson}</script>
<script>
window.__GAME_DATA__ = (function(){
  var raw = document.getElementById("gamedata").textContent;
  return JSON.parse(raw);
})();
</script>
<script>
${js}
</script>
</body>
</html>`;

mkdirSync(join(ROOT, "dist"), { recursive: true });
const out = join(ROOT, "dist", "monopoly-office.html");
writeFileSync(out, html, "utf8");

const kb = (Buffer.byteLength(html, "utf8") / 1024).toFixed(0);
console.log(`✅ 构建完成：dist/monopoly-office.html  (${kb} KB)`);
console.log(`   内联 ${jsonFiles.length} 个数据文件：${jsonFiles.join(", ")}`);
