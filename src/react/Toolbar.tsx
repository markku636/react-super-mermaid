import type { MermaidTheme } from '../types';

export interface ThemeOption {
  value: MermaidTheme;
  label: string;
}

export const DEFAULT_THEME_OPTIONS: ThemeOption[] = [
  { value: 'colorful', label: 'Colorful' },
  { value: 'sketch', label: 'Excalidraw' },
  { value: 'auto', label: 'Auto' },
  { value: 'default', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'neutral', label: 'Neutral' },
  { value: 'forest', label: 'Forest' },
];

export interface ToolbarProps {
  theme: MermaidTheme;
  themeOptions: ThemeOption[];
  onThemeChange: (theme: MermaidTheme) => void;
  zoomPercent: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onActualSize: () => void;
  onReset: () => void;
  searchEnabled: boolean;
  searchOpen: boolean;
  onToggleSearch: () => void;
  exportEnabled: boolean;
  exporting: boolean;
  onExportSvg: () => void;
  onExportPng: () => void;
}

export function Toolbar(props: ToolbarProps): React.JSX.Element {
  return (
    <div className="rsm-toolbar">
      <label className="rsm-label">
        樣式
        <select
          className="rsm-select"
          value={props.theme}
          onChange={(e) => props.onThemeChange(e.target.value as MermaidTheme)}
        >
          {props.themeOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>

      <div className="rsm-toolbar-spacer" />

      {props.searchEnabled ? (
        <button
          type="button"
          className="rsm-btn"
          aria-pressed={props.searchOpen}
          onClick={props.onToggleSearch}
          title="在圖中搜尋（/ 或 Ctrl+F）"
        >
          🔍 搜尋
        </button>
      ) : null}

      {props.exportEnabled ? (
        <div className="rsm-toolbar-group">
          <button
            type="button"
            className="rsm-btn"
            onClick={props.onExportSvg}
            disabled={props.exporting}
            title="匯出 SVG"
          >
            ⬇ SVG
          </button>
          <button
            type="button"
            className="rsm-btn"
            onClick={props.onExportPng}
            disabled={props.exporting}
            title="匯出 PNG（2x）"
          >
            {props.exporting ? '匯出中…' : '⬇ PNG'}
          </button>
        </div>
      ) : null}

      <div className="rsm-zoom">
        <button type="button" onClick={props.onZoomOut} title="縮小（-）">
          －
        </button>
        <button
          type="button"
          className="rsm-zoom-percent"
          onClick={props.onActualSize}
          title="實際大小（1）"
        >
          {props.zoomPercent}%
        </button>
        <button type="button" onClick={props.onZoomIn} title="放大（+）">
          ＋
        </button>
        <button type="button" onClick={props.onReset} title="符合視窗（0）">
          ⤢
        </button>
      </div>
    </div>
  );
}
