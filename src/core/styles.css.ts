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
  --rsm-canvas-bg: transparent;
  --rsm-grid-dot: rgba(0, 0, 0, 0.08);
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
  background: var(--rsm-canvas-bg);
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
  --rsm-border: #374151;
  --rsm-fg: #e5e7eb;
  --rsm-muted: #9ca3af;
  --rsm-accent: #60a5fa;
  --rsm-hover: #1f2937;
  --rsm-surface: #111827;
  --rsm-grid-dot: rgba(255, 255, 255, 0.10);
}

/* ── 背景模式 ── 透明(預設,跟隨頁面) / 純色(surface) / 點陣格線。 */
.rsm-root.rsm-bg-solid .rsm-canvas { background: var(--rsm-surface); }
.rsm-root.rsm-bg-grid .rsm-canvas {
  background-color: var(--rsm-surface);
  background-image: radial-gradient(var(--rsm-grid-dot) 1px, transparent 1px);
  background-size: 18px 18px;
  background-position: -9px -9px;
}

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
