import type { MermaidTheme, RsmBackground } from '../types';

export interface ThemeOption {
  value: MermaidTheme;
  label: string;
}

/** 背景模式 → 按鈕上顯示的圖示與文字。 */
export const BACKGROUND_LABELS: Record<RsmBackground, { icon: string; label: string }> = {
  transparent: { icon: '▦', label: '透明' },
  solid: { icon: '◻', label: '純色' },
  grid: { icon: '⊞', label: '格線' },
};

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
  backgroundEnabled: boolean;
  background: RsmBackground;
  onCycleBackground: () => void;
  /** 純色模式色票目前的值(hex)。 */
  solidColor: string;
  /** 使用者在色票選了新顏色。 */
  onSolidColorChange: (color: string) => void;
  fullscreenEnabled: boolean;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
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

      {props.backgroundEnabled ? (
        <button
          type="button"
          className="rsm-btn"
          onClick={props.onCycleBackground}
          title="切換畫布背景（透明 / 純色 / 格線，B）"
        >
          {BACKGROUND_LABELS[props.background].icon} 背景：{BACKGROUND_LABELS[props.background].label}
        </button>
      ) : null}

      {props.backgroundEnabled && props.background === 'solid' ? (
        <input
          type="color"
          className="rsm-color"
          value={props.solidColor}
          onChange={(e) => props.onSolidColorChange(e.target.value)}
          title="選擇純色背景顏色"
          aria-label="純色背景顏色"
        />
      ) : null}

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

      {props.fullscreenEnabled ? (
        <button
          type="button"
          className="rsm-btn rsm-btn-fullscreen"
          aria-pressed={props.fullscreen ? 'true' : 'false'}
          onClick={props.onToggleFullscreen}
          title={props.fullscreen ? '離開全螢幕（Esc）' : '全螢幕檢視（F）'}
        >
          {props.fullscreen ? '✕ 離開全螢幕' : '⛶ 全螢幕'}
        </button>
      ) : null}
    </div>
  );
}
