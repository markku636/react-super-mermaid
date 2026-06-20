// 套件內建樣式(無 Tailwind),由 ensure-styles 一次性注入 <head>。
// 全部 scope 在 .rsm-root 之下,避免污染 host 頁面;顏色用 CSS 變數,host 可覆寫。

export const RSM_STYLE_ID = 'react-super-mermaid-styles';

export const RSM_CSS = `
.rsm-root {
  --rsm-border: #e5e7eb;
  --rsm-fg: #374151;
  --rsm-muted: #6b7280;
  --rsm-accent: #2563eb;
  --rsm-hover: #f3f4f6;
  --rsm-surface: #ffffff;
  /* --rsm-paper = 畫布底色,對齊 VS Code 擴充套件的 editor-background(亮)。 */
  --rsm-paper: #ffffff;
  --rsm-canvas-bg: transparent;
  /* 點陣格線:對齊 VS Code 的 color-mix(foreground 9%) 公式。 */
  --rsm-grid-dot: color-mix(in srgb, var(--rsm-fg) 9%, transparent);
  /* 網格線:比網點再淡一點,避免線條搶過圖表。 */
  --rsm-grid-line: color-mix(in srgb, var(--rsm-fg) 7%, transparent);
  --rsm-radius: 8px;
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  box-sizing: border-box;
  border: 1px solid var(--rsm-border);
  border-radius: var(--rsm-radius);
  background: var(--rsm-surface);
  color: var(--rsm-fg);
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  overflow: hidden;
}
.rsm-root *, .rsm-root *::before, .rsm-root *::after { box-sizing: border-box; }

.rsm-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--rsm-border);
}
.rsm-toolbar-spacer { margin-left: auto; }
.rsm-toolbar-group { display: inline-flex; align-items: center; gap: 6px; }

.rsm-label { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--rsm-muted); }

.rsm-select {
  border: 1px solid var(--rsm-border);
  background: var(--rsm-surface);
  color: var(--rsm-fg);
  border-radius: 6px;
  padding: 4px 8px;
  font-size: 13px;
  cursor: pointer;
}
.rsm-select:focus { outline: none; border-color: var(--rsm-accent); }

.rsm-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: 1px solid var(--rsm-border);
  background: var(--rsm-surface);
  color: var(--rsm-fg);
  border-radius: 6px;
  padding: 4px 10px;
  font-size: 13px;
  line-height: 1.4;
  cursor: pointer;
  transition: background 0.12s ease, border-color 0.12s ease, color 0.12s ease;
}
.rsm-btn:hover { background: var(--rsm-hover); }
.rsm-btn[aria-pressed="true"] {
  border-color: var(--rsm-accent);
  color: var(--rsm-accent);
  background: color-mix(in srgb, var(--rsm-accent) 10%, transparent);
}
.rsm-btn:disabled { opacity: 0.6; cursor: default; }

/* 工具列控制項高度一致(樣式下拉 / 一般鈕 / 縮放群 / 背景鈕),避免高低不齊。 */
.rsm-toolbar .rsm-btn,
.rsm-toolbar .rsm-select,
.rsm-toolbar .rsm-zoom { min-height: 30px; }
.rsm-toolbar .rsm-btn,
.rsm-toolbar .rsm-select { align-items: center; }
.rsm-toolbar .rsm-zoom > button { display: inline-flex; align-items: center; justify-content: center; }

.rsm-zoom {
  display: inline-flex;
  align-items: stretch;
  border: 1px solid var(--rsm-border);
  border-radius: 6px;
  overflow: hidden;
}
.rsm-zoom > button {
  border: 0;
  background: var(--rsm-surface);
  color: var(--rsm-fg);
  padding: 4px 10px;
  font-size: 13px;
  cursor: pointer;
}
.rsm-zoom > button:hover { background: var(--rsm-hover); }
.rsm-zoom > button + button { border-left: 1px solid var(--rsm-border); }
.rsm-zoom-percent { min-width: 52px; text-align: center; font-variant-numeric: tabular-nums; font-size: 12px; }

.rsm-searchbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--rsm-border);
  background: var(--rsm-hover);
}
.rsm-input {
  flex: 0 1 320px;
  border: 1px solid var(--rsm-border);
  background: var(--rsm-surface);
  color: var(--rsm-fg);
  border-radius: 6px;
  padding: 5px 10px;
  font-size: 13px;
}
.rsm-input:focus { outline: none; border-color: var(--rsm-accent); }
.rsm-count { min-width: 48px; font-size: 12px; color: var(--rsm-muted); font-variant-numeric: tabular-nums; }
.rsm-searchbar-spacer { margin-left: auto; }

.rsm-canvas {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
  /* 底色由 --rsm-canvas-bg 控制(預設透明,跟隨頁面);圖樣疊在其上(background-image)。 */
  background-color: var(--rsm-canvas-bg, transparent);
}
.rsm-stage { width: 100%; height: 100%; }
.rsm-root svg { cursor: grab; user-select: none; }
.rsm-root svg.rsm-grabbing { cursor: grabbing; }

.rsm-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 16px;
  text-align: center;
  font-size: 13px;
  color: var(--rsm-muted);
  pointer-events: none;
}
.rsm-overlay.rsm-error { color: #dc2626; }

/* 搜尋:命中以外的節點變暗,當前命中加暖色光暈。 */
.rsm-root .rsm-dim { opacity: 0.22; transition: opacity 0.15s ease; }
.rsm-root .rsm-hit { filter: drop-shadow(0 0 5px #f59e0b) drop-shadow(0 0 1.5px #f59e0b); }

.rsm-root.rsm-dark {
  /* 暗色面板對齊 VS Code Dark+ / Dark Modern 的中性灰(非藍調)。 */
  --rsm-border: #3c3c3c;
  --rsm-fg: #cccccc;
  --rsm-muted: #9d9d9d;
  --rsm-accent: #3794ff;
  --rsm-hover: #2a2d2e;
  --rsm-surface: #252526;
  /* 畫布底色 = VS Code editor-background(暗);grid-dot 由 --rsm-fg 9% 自動推導。 */
  --rsm-paper: #1e1e1e;
}

/* ── 背景 ── 底色 + 疊加圖樣,兩者獨立。
 * 底色:--rsm-canvas-bg(由色票 / 自訂色 inline 覆寫;未設 = 透明跟隨頁面)。
 * 圖樣:.rsm-pattern-dots(網點) / .rsm-pattern-grid(網格線),疊在底色之上。 */
.rsm-root.rsm-pattern-dots .rsm-canvas {
  background-image: radial-gradient(var(--rsm-grid-dot) 1px, transparent 1px);
  background-size: 18px 18px;
  background-position: -9px -9px;
}
.rsm-root.rsm-pattern-grid .rsm-canvas {
  background-image:
    linear-gradient(to right, var(--rsm-grid-line) 1px, transparent 1px),
    linear-gradient(to bottom, var(--rsm-grid-line) 1px, transparent 1px);
  background-size: 22px 22px;
  background-position: -1px -1px;
}

/* ── 背景選擇器(toolbar 內的色井按鈕 + 彈出面板)── */
.rsm-bg { position: relative; display: inline-flex; }

/* 觸發鈕左側的「色井」:反映目前底色;透明 / 預設時畫一道斜線表示「不覆寫」。 */
.rsm-bg-well {
  width: 16px;
  height: 16px;
  border-radius: 4px;
  border: 1px solid color-mix(in srgb, var(--rsm-fg) 28%, transparent);
  background-color: var(--rsm-well-color, transparent);
}
.rsm-bg-well[data-empty="true"] {
  background-color: var(--rsm-surface);
  background-image: linear-gradient(
    to top right,
    transparent calc(50% - 1px),
    #ef4444 calc(50% - 1px),
    #ef4444 calc(50% + 1px),
    transparent calc(50% + 1px)
  );
}

/* 彈出面板:卡片式、輕陰影、淡入。 */
.rsm-bg-pop {
  position: absolute;
  top: calc(100% + 8px);
  left: 0;
  z-index: 50;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
  min-width: 260px;
  border: 1px solid var(--rsm-border);
  border-radius: 12px;
  background: var(--rsm-surface);
  color: var(--rsm-fg);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.16), 0 2px 6px rgba(0, 0, 0, 0.08);
  animation: rsm-pop-in 0.13s ease-out;
}
@keyframes rsm-pop-in {
  from { opacity: 0; transform: translateY(-5px); }
  to { opacity: 1; transform: none; }
}
.rsm-bg-section { display: flex; flex-direction: column; gap: 8px; }
.rsm-bg-section-label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.03em;
  color: var(--rsm-muted);
}
.rsm-bg-swatches { display: flex; flex-wrap: wrap; gap: 8px; }

/* 色票:圓角小方塊;選中加同色外環。 */
.rsm-swatch {
  position: relative;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 1px solid color-mix(in srgb, var(--rsm-fg) 16%, transparent);
  border-radius: 7px;
  cursor: pointer;
  transition: transform 0.1s ease, box-shadow 0.1s ease;
}
.rsm-swatch:hover { transform: scale(1.12); }
.rsm-swatch:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--rsm-accent); }
.rsm-swatch.rsm-selected { outline: 2px solid var(--rsm-accent); outline-offset: 2px; }
.rsm-swatch[data-empty="true"] {
  background-color: var(--rsm-surface);
  background-image: linear-gradient(
    to top right,
    transparent calc(50% - 1px),
    #ef4444 calc(50% - 1px),
    #ef4444 calc(50% + 1px),
    transparent calc(50% + 1px)
  );
}

/* 自訂色票:覆一個隱形的原生 color input,未選時顯示 🎨。 */
.rsm-swatch-custom {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background:
    conic-gradient(from 180deg, #f87171, #fbbf24, #34d399, #60a5fa, #a78bfa, #f87171);
}
.rsm-swatch-custom.rsm-has-color { background: none; }
.rsm-swatch-custom input[type="color"] {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  padding: 0;
  border: 0;
  opacity: 0;
  cursor: pointer;
}
.rsm-swatch-custom-icon {
  font-size: 12px;
  line-height: 1;
  pointer-events: none;
  filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.35));
}

/* 圖樣切換:分段式按鈕(無 / 網點 / 網格)。 */
.rsm-seg {
  display: inline-flex;
  align-self: flex-start;
  border: 1px solid var(--rsm-border);
  border-radius: 8px;
  overflow: hidden;
}
.rsm-seg > button {
  flex: 1 1 0;
  min-width: 58px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  border: 0;
  background: var(--rsm-surface);
  color: var(--rsm-fg);
  padding: 6px 11px;
  font-size: 12px;
  line-height: 1.3;
  cursor: pointer;
  transition: background 0.1s ease, color 0.1s ease;
}
.rsm-seg > button + button { border-left: 1px solid var(--rsm-border); }
.rsm-seg > button:hover { background: var(--rsm-hover); }
.rsm-seg > button[aria-pressed="true"] {
  background: color-mix(in srgb, var(--rsm-accent) 14%, transparent);
  color: var(--rsm-accent);
  font-weight: 600;
}
.rsm-seg-glyph { font-size: 13px; line-height: 1; }

/* ── 全螢幕跳窗 ── position:fixed 覆蓋整個視窗,RWD 友善。 */
.rsm-root.rsm-fullscreen {
  position: fixed;
  inset: 0;
  width: 100vw;
  width: 100dvw;
  height: 100vh;
  height: 100dvh;
  max-width: 100vw;
  max-height: 100dvh;
  margin: 0;
  z-index: 2147483000;
  border: 0;
  border-radius: 0;
  animation: rsm-fs-in 0.16s ease-out;
}
@keyframes rsm-fs-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

/* 全螢幕右上角的離開鈕(toolbar 隱藏時也能關閉)。 */
.rsm-fs-close {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 5;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  padding: 0;
  font-size: 16px;
  line-height: 1;
  border: 1px solid var(--rsm-border);
  border-radius: 8px;
  background: var(--rsm-surface);
  color: var(--rsm-fg);
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.18);
  transition: background 0.12s ease, color 0.12s ease;
}
.rsm-fs-close:hover { background: var(--rsm-hover); }

/* ── RWD ── 小螢幕收緊 toolbar、縮短搜尋框,避免換行擠壓畫布。 */
@media (max-width: 640px) {
  .rsm-toolbar { gap: 6px; padding: 6px 8px; }
  .rsm-btn { padding: 4px 8px; font-size: 12px; }
  .rsm-label { font-size: 11px; }
  .rsm-select { padding: 3px 6px; font-size: 12px; }
  .rsm-zoom > button { padding: 4px 8px; font-size: 12px; }
  .rsm-input { flex-basis: 150px; }
}

/* ── 標籤字重(量測階段就生效)──
 * boostLegibility 在「渲染後」才把標籤字重加到 600/700,但 mermaid 是在「渲染中」
 * 量測文字寬度來決定 foreignObject / 節點外框的大小。若只在事後加粗,粗體字會比已量好的
 * 框更寬 → foreignObject 把尾字裁掉(心智圖節點「react-super-mermaid」尾巴的 d 不見就是這個)。
 * 解法:把同樣的字重用 CSS 提前宣告,且「不」scope 在 .rsm-root 之下,而是 scope 在 mermaid
 * 的渲染 id(svg[id^="rsm-"])——因為量測時那顆暫時的 svg 還在 <body> 下、尚未掛進 .rsm-root。
 * 這樣 mermaid 量到的就是粗體寬度,框會剛好容納,事後 boostLegibility 設同值不再撐破。
 * 只 scope 我們自己渲染出的 svg,故不會污染 host 頁面其它 mermaid。 */
svg[id^="rsm-"] g.node text,
svg[id^="rsm-"] g.node tspan,
svg[id^="rsm-"] g.node .nodeLabel,
svg[id^="rsm-"] g.mindmap-node text,
svg[id^="rsm-"] g.mindmap-node .nodeLabel,
svg[id^="rsm-"] g[class*="timeline-node"] text,
svg[id^="rsm-"] text.actor { font-weight: 600 !important; }
svg[id^="rsm-"] .cluster-label text,
svg[id^="rsm-"] .cluster-label .nodeLabel,
svg[id^="rsm-"] text.pieTitleText { font-weight: 700 !important; }
`;
