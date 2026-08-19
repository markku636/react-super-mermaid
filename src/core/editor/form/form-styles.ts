// Form 編輯器(timeline 等資料圖表)的 CSS,注入一次。深淺色皆涵蓋。

export const RSM_FORM_STYLE_ID = 'rsm-form-styles';

const CSS = `
.rsm-form-root{position:absolute;inset:0;display:flex;min-height:0;overflow:hidden;
  font:14px/1.5 system-ui,-apple-system,"Segoe UI","Microsoft JhengHei","PingFang TC",sans-serif;
  --rsm-form-bg:#f8fafc;--rsm-form-card:#ffffff;--rsm-form-border:#e2e8f0;--rsm-form-fg:#1f2937;
  --rsm-form-muted:#64748b;--rsm-form-accent:#3b82f6;--rsm-form-danger:#ef4444;
  background:var(--rsm-form-bg);color:var(--rsm-form-fg);}
.rsm-editor-root.rsm-dark .rsm-form-root{--rsm-form-bg:#0d1117;--rsm-form-card:#161b22;
  --rsm-form-border:#30363d;--rsm-form-fg:#e2e8f0;--rsm-form-muted:#8b949e;--rsm-form-accent:#58a6ff;}

.rsm-form-pane{flex:1 1 52%;min-width:0;overflow:auto;padding:16px;}
.rsm-form-preview{flex:1 1 48%;min-width:0;overflow:auto;display:flex;align-items:center;justify-content:center;
  padding:16px;border-left:1px solid var(--rsm-form-border);background:var(--rsm-form-bg);}
.rsm-form-preview svg{max-width:100%;height:auto;}
.rsm-form-preview-err{color:var(--rsm-form-danger);font:13px/1.5 ui-monospace,monospace;white-space:pre-wrap;padding:12px;}

.rsm-form-title-row{display:flex;align-items:center;gap:8px;margin-bottom:14px;}
.rsm-form-title-row label{font-weight:600;color:var(--rsm-form-muted);white-space:nowrap;}

.rsm-form-input{flex:1;min-width:0;padding:6px 9px;border:1px solid var(--rsm-form-border);border-radius:7px;
  background:var(--rsm-form-card);color:var(--rsm-form-fg);font:inherit;outline:none;}
.rsm-form-input:focus{border-color:var(--rsm-form-accent);box-shadow:0 0 0 2px color-mix(in srgb,var(--rsm-form-accent) 30%,transparent);}

.rsm-form-section{background:var(--rsm-form-card);border:1px solid var(--rsm-form-border);border-radius:11px;
  padding:11px;margin-bottom:12px;box-shadow:0 1px 2px rgba(0,0,0,0.04);}
.rsm-form-section-head{display:flex;align-items:center;gap:6px;margin-bottom:8px;}
.rsm-form-section-head .rsm-form-input{font-weight:600;}
.rsm-form-section-tag{font-size:12px;font-weight:700;color:var(--rsm-form-muted);white-space:nowrap;}

.rsm-form-period{border-left:3px solid var(--rsm-form-accent);margin:8px 0 8px 4px;padding:0 0 0 10px;}
.rsm-form-period-head{display:flex;align-items:center;gap:6px;margin-bottom:5px;}
.rsm-form-period-head .rsm-form-input{font-weight:500;}
.rsm-form-events{display:flex;flex-direction:column;gap:5px;padding-left:8px;}
.rsm-form-event{display:flex;align-items:center;gap:6px;}
.rsm-form-event::before{content:"•";color:var(--rsm-form-muted);flex:0 0 auto;}

.rsm-form-iconbtn{flex:0 0 auto;width:26px;height:26px;display:inline-flex;align-items:center;justify-content:center;
  border:1px solid var(--rsm-form-border);border-radius:6px;background:var(--rsm-form-card);color:var(--rsm-form-muted);
  cursor:pointer;font-size:13px;line-height:1;padding:0;}
.rsm-form-iconbtn:hover{color:var(--rsm-form-fg);border-color:var(--rsm-form-accent);}
.rsm-form-iconbtn.rsm-form-del:hover{color:#fff;background:var(--rsm-form-danger);border-color:var(--rsm-form-danger);}
.rsm-form-iconbtn:disabled{opacity:0.35;cursor:default;}

.rsm-form-addbtn{display:inline-flex;align-items:center;gap:5px;padding:5px 11px;border:1px dashed var(--rsm-form-border);
  border-radius:7px;background:transparent;color:var(--rsm-form-accent);cursor:pointer;font:inherit;font-size:13px;margin-top:4px;}
.rsm-form-addbtn:hover{border-color:var(--rsm-form-accent);background:color-mix(in srgb,var(--rsm-form-accent) 8%,transparent);}
.rsm-form-add-event{font-size:12px;padding:3px 9px;}
.rsm-form-add-section{font-weight:600;}

/* ── ORID:四段各有語意主色(--rsm-orid-accent 由 orid-editor 逐卡設定) ── */
.rsm-orid-stage{border-left:4px solid var(--rsm-orid-accent,var(--rsm-form-accent));}
.rsm-orid-stage .rsm-orid-tag{color:var(--rsm-orid-accent,var(--rsm-form-accent));font-size:13px;}
.rsm-orid-stage .rsm-form-input:focus{border-color:var(--rsm-orid-accent,var(--rsm-form-accent));
  box-shadow:0 0 0 2px color-mix(in srgb,var(--rsm-orid-accent,var(--rsm-form-accent)) 30%,transparent);}
.rsm-orid-stage .rsm-form-addbtn{color:var(--rsm-orid-accent,var(--rsm-form-accent));}
.rsm-orid-hint{font-size:12px;color:var(--rsm-form-muted);margin:-2px 0 8px;line-height:1.45;}
.rsm-orid-missing{display:flex;flex-wrap:wrap;align-items:center;gap:7px;margin-top:6px;}
.rsm-orid-missing .rsm-form-section-tag{margin-right:2px;}
.rsm-orid-add-stage{margin-top:0;font-size:13px;}
`;

export function ensureFormStyles(): void {
  if (typeof document === 'undefined') return;
  let style = document.getElementById(RSM_FORM_STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = RSM_FORM_STYLE_ID;
    document.head.appendChild(style);
  }
  if (style.textContent !== CSS) style.textContent = CSS;
}
