// 編輯器自有 CSS(注入一次)。畫布、字體變數、cursor。

export const RSM_EDITOR_STYLE_ID = 'rsm-editor-styles';

const CSS = `
.rsm-editor-root{position:relative;width:100%;height:100%;overflow:hidden;
  --rsm-editor-font:'Virgil','KaiTi','Comic Sans MS',cursive;
  --rsm-edge-label-bg:rgba(255,255,255,0.85);
  background:var(--rsm-editor-bg,#fafafa);
  background-image:radial-gradient(var(--rsm-editor-dot,#d7d7de) 1px,transparent 1px);
  background-size:20px 20px;touch-action:none;}
.rsm-editor-root.rsm-dark{--rsm-editor-bg:#1e1e1e;--rsm-editor-dot:#3a3a40;
  --rsm-edge-label-bg:rgba(30,30,30,0.85);}
/* clean 風用一般無襯線字(非手寫 Virgil),標籤更清晰易讀 */
.rsm-editor-root.rsm-clean{--rsm-editor-font:system-ui,-apple-system,"Segoe UI","Microsoft JhengHei","PingFang TC",sans-serif;}
.rsm-editor-svg{display:block;width:100%;height:100%;user-select:none;}
.rsm-editor-svg text,.rsm-editor-svg foreignObject *{user-select:none;}

/* 工具列:常用外形一鍵攤開,不藏在下拉選單裡 */
.rsm-editor-toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:4px;}
.rsm-editor-toolbar .rsm-tb-sep{width:1px;align-self:stretch;margin:2px 4px;
  background:var(--rsm-border,#e5e7eb);}
.rsm-editor-toolbar .rsm-tb-spacer{flex:1 1 auto;}
.rsm-shape-btn{display:inline-flex;align-items:center;gap:4px;}
.rsm-shape-btn .rsm-shape-glyph{font-size:15px;line-height:1;}
/* 下拉選單:選項一律深字淺底(原生 option 在暗色下常白底白字,看不清)。 */
.rsm-editor-toolbar select{color:inherit;}
.rsm-editor-toolbar select option{background:#ffffff;color:#1f2937;}
.rsm-tb-hint{font-size:12px;opacity:0.7;padding:0 8px;align-self:center;white-space:nowrap;}

/* 空白畫布引導提示:置中、不擋互動、淡入(grace 期間靠 JS 不加 show class 而隱藏)。 */
.rsm-empty-hint{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
  pointer-events:none;text-align:center;padding:0 24px;opacity:0;transition:opacity .35s ease;
  font:500 15px/1.7 var(--rsm-editor-font);color:var(--rsm-editor-dot,#9aa0aa);}
.rsm-editor-root.rsm-dark .rsm-empty-hint{color:#6b7280;}
.rsm-empty-hint.rsm-empty-show{opacity:0.9;}

/* 右鍵選單 */
.rsm-ctx{position:absolute;z-index:40;min-width:128px;padding:4px;border-radius:8px;
  background:var(--rsm-ctx-bg,#1f1f23);color:var(--rsm-ctx-fg,#e8e8ea);
  border:1px solid rgba(127,127,127,0.28);box-shadow:0 8px 28px rgba(0,0,0,0.35);
  font:13px/1.4 system-ui,-apple-system,"Microsoft JhengHei",sans-serif;user-select:none;}
.rsm-ctx-item{padding:6px 10px;border-radius:5px;cursor:pointer;white-space:nowrap;}
.rsm-ctx-item:hover{background:var(--rsm-accent,#2563eb);color:#fff;}
.rsm-ctx-sep{height:1px;margin:4px 2px;background:rgba(127,127,127,0.28);}
.rsm-ctx-shapes{display:flex;gap:2px;padding:2px;}
.rsm-ctx-shapes button{flex:1;font-size:15px;padding:4px 0;border:none;border-radius:5px;
  background:transparent;color:inherit;cursor:pointer;}
.rsm-ctx-shapes button:hover{background:var(--rsm-accent,#2563eb);color:#fff;}
`;

export function ensureEditorStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(RSM_EDITOR_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = RSM_EDITOR_STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}
