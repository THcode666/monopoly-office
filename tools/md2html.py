"""把 docs/05-UI概念设计.md 转成排版好的 HTML。"""
import sys
from pathlib import Path
import markdown
from markdown.extensions.toc import TocExtension

ROOT = Path(r"C:/Users/藤浩office/WorkBuddy/2026-10-08-08-37-10/monopoly-office")
md_path = ROOT / "docs/05-UI概念设计.md"
html_path = ROOT / "docs/05-UI概念设计.html"

md_text = md_path.read_text(encoding="utf-8")

CSS = """
:root {
  --bg: #1a1d24;
  --bg-card: #242832;
  --bg-soft: #2d313c;
  --fg: #e8e6df;
  --fg-mute: #9a9bab;
  --fg-dim: #6c6f7d;
  --accent: #f5c842;
  --accent-2: #e8804f;
  --blue: #4f80d8;
  --purple: #9268d4;
  --brown: #a07050;
  --green: #5cb868;
  --gold: #e8c66c;
  --border: #3a3654;
  --code-bg: #15171c;
}
* { box-sizing: border-box; }
html, body {
  margin: 0; padding: 0;
  background: var(--bg);
  color: var(--fg);
  font-family: 'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', -apple-system, sans-serif;
  font-size: 16px;
  line-height: 1.7;
}
.wrap {
  max-width: 980px;
  margin: 0 auto;
  padding: 48px 32px 96px;
}
/* Cover */
.cover {
  background: linear-gradient(135deg, #2a2520 0%, #1a1d24 50%, #1f2530 100%);
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 48px 40px;
  margin-bottom: 48px;
  position: relative;
  overflow: hidden;
}
.cover::before {
  content: '';
  position: absolute; top: 0; left: 0; right: 0; height: 4px;
  background: linear-gradient(90deg, var(--accent) 0%, var(--accent-2) 50%, var(--purple) 100%);
}
.cover h1:first-child { display: none; }
.cover-meta {
  display: flex; gap: 24px; flex-wrap: wrap;
  font-size: 14px; color: var(--fg-mute);
  margin-top: 16px;
}
.cover-meta span::before { content: '· '; color: var(--accent); }

/* Typography */
h1 { font-size: 36px; line-height: 1.2; margin: 0 0 24px; color: var(--fg); }
h2 {
  font-size: 26px; line-height: 1.3; margin: 56px 0 20px;
  padding-bottom: 12px; border-bottom: 2px solid var(--border);
  color: var(--fg);
}
h2::before {
  content: '§'; color: var(--accent); margin-right: 12px;
  font-family: 'DIN', monospace; font-weight: 700;
}
h3 {
  font-size: 20px; line-height: 1.4; margin: 32px 0 12px;
  color: var(--accent);
}
h3::before {
  content: '▸'; color: var(--accent-2); margin-right: 8px;
}
h4 { font-size: 17px; margin: 24px 0 8px; color: var(--fg); }
p { margin: 12px 0; color: var(--fg); }
strong { color: var(--accent); }
em { color: var(--fg-mute); font-style: normal; border-bottom: 1px dashed var(--fg-dim); }
hr {
  border: 0; height: 1px; background: var(--border);
  margin: 48px 0;
}

/* Lists */
ul, ol { padding-left: 24px; margin: 12px 0; }
li { margin: 6px 0; }
li::marker { color: var(--accent-2); }

/* Code */
code {
  background: var(--code-bg);
  color: #ffb86c;
  padding: 2px 6px; border-radius: 4px;
  font-family: 'JetBrains Mono', 'Consolas', monospace;
  font-size: 14px;
}
pre {
  background: var(--code-bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 20px; margin: 20px 0;
  overflow-x: auto;
  font-size: 13px; line-height: 1.5;
}
pre code { background: transparent; padding: 0; color: var(--fg); }

/* Tables */
table {
  width: 100%; border-collapse: collapse;
  margin: 20px 0;
  background: var(--bg-card);
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid var(--border);
}
th, td {
  text-align: left; padding: 12px 16px;
  border-bottom: 1px solid var(--border);
  font-size: 14px;
}
th {
  background: var(--bg-soft);
  color: var(--accent);
  font-weight: 600;
  font-size: 13px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
tr:last-child td { border-bottom: 0; }
tr:hover td { background: rgba(245, 200, 66, 0.05); }

/* Blockquote */
blockquote {
  margin: 20px 0; padding: 16px 24px;
  background: var(--bg-card);
  border-left: 4px solid var(--accent);
  border-radius: 0 8px 8px 0;
  color: var(--fg-mute);
}

/* ASCII art boxes (start with ┌──┐ or ╔══╗) */
pre:has(code) {
  /* keep default */
}

/* Section anchors */
h2, h3, h4 {
  scroll-margin-top: 24px;
}

/* TOC */
.toc {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 24px 32px;
  margin: 24px 0 48px;
}
.toc h2 { margin-top: 0; font-size: 18px; border: 0; padding: 0; }
.toc h2::before { display: none; }
.toc ul { list-style: none; padding-left: 0; }
.toc li { margin: 6px 0; }
.toc a { color: var(--fg-mute); text-decoration: none; }
.toc a:hover { color: var(--accent); }

/* Color swatches in tables */
td:has(strong:only-child) { font-weight: 600; }
"""

md = markdown.Markdown(
    extensions=[
        "fenced_code",
        "tables",
        "nl2br",
        "sane_lists",
        TocExtension(toc_depth="2-3", anchorlink=False),
    ]
)
body_html = md.convert(md_text)
toc_html = md.toc

html = f"""<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>大富翁·工位版 · UI 概念设计文档</title>
  <style>{CSS}</style>
</head>
<body>
  <div class="wrap">
    <div class="cover">
      <h1>🏢 「大富翁·工位版」UI 概念设计文档</h1>
      <p>版本：v1.0 · 交付给 UI / 视觉设计师的方案稿<br>
      视觉风格参考：网易《大富翁 11》（Q 版 2.5D 卡通、3D 半俯视棋盘、彩色分地段格子、中央装饰场景）<br>
      本文档目标：把"工位版"主题与参考图的高完成度视觉范式对齐，输出一份<strong>可直接照图施工</strong>的 UI 概念稿。</p>
      <div class="cover-meta">
        <span>产品：大富翁·工位版</span>
        <span>平台：Windows / Web</span>
        <span>主题：写字楼办公室生态</span>
        <span>受众：2–6 人联机</span>
        <span>2026-10-08</span>
      </div>
    </div>
    <nav class="toc">
      <h2>📑 目录</h2>
      {toc_html}
    </nav>
    <main>
      {body_html}
    </main>
    <hr>
    <p style="text-align:center;color:var(--fg-dim);font-size:13px;">
      本文档由 Chip 自动生成 · 项目路径 <code>monopoly-office/docs/05-UI概念设计.md</code>
    </p>
  </div>
</body>
</html>
"""

html_path.write_text(html, encoding="utf-8")
print(f"OK: {html_path}")
print(f"Size: {html_path.stat().st_size} bytes")
print(f"MD size: {md_path.stat().st_size} bytes")
