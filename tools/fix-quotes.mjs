// 修复 JSON 里中文文案中的直引号（ASCII " 会破坏 JSON 语法）。
// 逐字符扫描跟踪字符串状态；字符串内部遇到的 " 若后面不是 JSON 合法延续符，
// 则判定为内容引号，成对替换为中文引号「」。
//
// 用法：node tools/fix-quotes.mjs data/xxx.json [更多文件...]

import { readFileSync, writeFileSync } from "node:fs";

const files = process.argv.slice(2);
if (!files.length) {
  console.error("用法：node tools/fix-quotes.mjs <file.json> [more...]");
  process.exit(1);
}

function fix(src) {
  let out = "";
  let inStr = false;
  let escaped = false;
  let fixed = 0;
  let openQuote = true; // 下一个内容引号用「 还是 」

  for (let i = 0; i < src.length; i++) {
    const c = src[i];

    if (!inStr) {
      out += c;
      if (c === '"') { inStr = true; openQuote = true; }
      continue;
    }

    if (escaped) { out += c; escaped = false; continue; }
    if (c === "\\") { out += c; escaped = true; continue; }

    if (c === '"') {
      let j = i + 1;
      while (j < src.length && /\s/.test(src[j])) j++;
      const next = src[j];
      const isTerminator =
        next === undefined || next === "," || next === "]" || next === "}" || next === ":";
      if (isTerminator) {
        out += c;
        inStr = false;
      } else {
        out += openQuote ? "「" : "」";
        openQuote = !openQuote;
        fixed++;
      }
      continue;
    }
    out += c;
  }
  return { out, fixed };
}

let bad = 0;
for (const f of files) {
  const src = readFileSync(f, "utf8");
  try {
    JSON.parse(src);
    console.log(`- ${f} 已合法，跳过`);
    continue;
  } catch { /* 需要修 */ }

  const { out, fixed } = fix(src);
  try {
    JSON.parse(out);
    writeFileSync(f, out, "utf8");
    console.log(`✅ ${f} 修复 ${fixed} 处内容引号`);
  } catch (e) {
    console.error(`❌ ${f} 修复后仍不合法：${e.message}`);
    bad++;
  }
}
process.exit(bad ? 1 : 0);
