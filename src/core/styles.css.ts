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
}
`;
