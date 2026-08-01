import { useEffect, useRef, useState } from 'react';
import type { MermaidTheme, RsmBackgroundPreset, RsmPattern } from '../types';

export interface ThemeOption {
  value: MermaidTheme;
  label: string;
}

/**
 * 底色預設色票。第一個 value=null 代表「預設 / 透明」(跟隨頁面底色);
 * 其餘對齊 VS Code 擴充套件的色票,色相柔和、適合做圖表底色。
 * 不符合時可用面板裡的「自訂」色票自選任意顏色。
 */
export const BACKGROUND_PRESETS: RsmBackgroundPreset[] = [
  { value: null, label: '預設 / 透明' },
  { value: '#FFFFFF', label: '白' },
  { value: '#F3F4F6', label: '淺灰' },
  { value: '#EFF6FF', label: '淺藍' },
  { value: '#FEFCE8', label: '淺黃' },
  { value: '#FDF2F8', label: '淺玫瑰' },
];

/** 疊加圖樣選項(分段切換鈕):無 / 網點 / 網格線。 */
export const PATTERN_OPTIONS: { value: RsmPattern; glyph: string; label: string }[] = [
  { value: 'none', glyph: '▢', label: '無' },
  { value: 'dots', glyph: '⠿', label: '網點' },
  { value: 'grid', glyph: '⊞', label: '網格' },
];

export const DEFAULT_THEME_OPTIONS: ThemeOption[] = [
  { value: 'colorful', label: 'Colorful' },
  { value: 'sketch', label: 'Excalidraw' },
  { value: 'auto', label: 'Auto' },
  { value: 'default', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'neutral', label: 'Neutral' },
  { value: 'forest', label: 'Forest' },
];

/** 是否為合法的 #rrggbb;原生 color input 只接受這種格式。 */
const HEX6 = /^#[0-9a-fA-F]{6}$/;

/** 把 surface 跟某個預設值做比對(大小寫不敏感)。 */
function isSameColor(a: string | null, b: string | null): boolean {
  if (a === null || b === null) {
    return a === b;
  }
  return a.toLowerCase() === b.toLowerCase();
}

interface BackgroundPickerProps {
  /** 目前底色;null = 透明 / 跟隨頁面。 */
  surface: string | null;
  /** 使用者選了新底色(色票或自訂);null = 透明。 */
  onSurfaceChange: (color: string | null) => void;
  /** 目前疊加圖樣。 */
  pattern: RsmPattern;
  /** 使用者切換了圖樣。 */
  onPatternChange: (pattern: RsmPattern) => void;
}

/**
 * 背景選擇器:一顆色井觸發鈕,點開後是「底色色票 + 自訂色」與「圖樣切換」兩段。
 * 點面板外或按 Esc 收合;底色與圖樣可自由組合(例如:淺藍底 + 網格)。
 */
function BackgroundPicker(props: BackgroundPickerProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const onDocPointer = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // 目前底色是否落在某個預設上;若否(且非透明)則「自訂」色票為選中狀態。
  const isPreset = BACKGROUND_PRESETS.some((p) => isSameColor(p.value, props.surface));
  const customActive = props.surface !== null && !isPreset;
  // color input 必須是合法 #rrggbb;以目前底色為起點,否則給一個中性深藍。
  const customInputValue =
    props.surface && HEX6.test(props.surface) ? props.surface : '#1e293b';

  return (
    <div className="rsm-bg" ref={rootRef}>
      <button
        type="button"
        className="rsm-btn rsm-bg-trigger"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((o) => !o)}
        title="畫布背景（底色 + 網點 / 網格，B）"
      >
        <span
          className="rsm-bg-well"
          data-empty={props.surface === null ? 'true' : undefined}
          style={
            props.surface ? ({ ['--rsm-well-color' as string]: props.surface }) : undefined
          }
        />
        背景
      </button>

      {open ? (
        <div className="rsm-bg-pop" role="dialog" aria-label="畫布背景設定">
          <div className="rsm-bg-section">
            <div className="rsm-bg-section-label">底色</div>
            <div className="rsm-bg-swatches">
              {BACKGROUND_PRESETS.map((preset) => {
                const selected = isSameColor(preset.value, props.surface);
                return (
                  <button
                    key={preset.label}
                    type="button"
                    className={`rsm-swatch${selected ? ' rsm-selected' : ''}`}
                    data-empty={preset.value === null ? 'true' : undefined}
                    style={preset.value ? { backgroundColor: preset.value } : undefined}
                    title={preset.label}
                    aria-label={`底色：${preset.label}`}
                    aria-pressed={selected}
                    onClick={() => props.onSurfaceChange(preset.value)}
                  />
                );
              })}

              {/* 自訂色:覆一個隱形 color input,挑不到合適預設時用。 */}
              <span
                className={`rsm-swatch rsm-swatch-custom${customActive ? ' rsm-has-color rsm-selected' : ''}`}
                style={customActive ? { backgroundColor: props.surface as string } : undefined}
                title="自訂顏色"
              >
                {!customActive ? <span className="rsm-swatch-custom-icon">🎨</span> : null}
                <input
                  type="color"
                  value={customInputValue}
                  aria-label="自訂底色"
                  onChange={(e) => props.onSurfaceChange(e.target.value)}
                />
              </span>
            </div>
          </div>

          <div className="rsm-bg-section">
            <div className="rsm-bg-section-label">圖樣</div>
            <div className="rsm-seg" role="group" aria-label="背景圖樣">
              {PATTERN_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  aria-pressed={props.pattern === opt.value}
                  title={opt.label}
                  onClick={() => props.onPatternChange(opt.value)}
                >
                  <span className="rsm-seg-glyph" aria-hidden="true">
                    {opt.glyph}
                  </span>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

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
  /** 是否顯示背景選擇器。 */
  backgroundEnabled: boolean;
  /** 目前底色(hex);null = 透明 / 跟隨頁面。 */
  surface: string | null;
  /** 使用者選了新底色。 */
  onSurfaceChange: (color: string | null) => void;
  /** 目前疊加圖樣。 */
  pattern: RsmPattern;
  /** 使用者切換了圖樣。 */
  onPatternChange: (pattern: RsmPattern) => void;
  fullscreenEnabled: boolean;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
  /** 圖上的檢查提示數量;0 時整組檢查 UI 不顯示。 */
  checkCount: number;
  /** 角標目前是否顯示。 */
  checksVisible: boolean;
  onToggleChecks: () => void;
  /** 側邊檢查清單是否展開。 */
  checklistOpen: boolean;
  onToggleChecklist: () => void;
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
        <BackgroundPicker
          surface={props.surface}
          onSurfaceChange={props.onSurfaceChange}
          pattern={props.pattern}
          onPatternChange={props.onPatternChange}
        />
      ) : null}

      {props.checkCount > 0 ? (
        <div className="rsm-toolbar-group">
          <button
            type="button"
            className="rsm-btn"
            aria-pressed={props.checksVisible}
            onClick={props.onToggleChecks}
            title="顯示 / 隱藏節點上的檢查提示（H）"
          >
            🔍 檢查 {props.checkCount}
          </button>
          <button
            type="button"
            className="rsm-btn"
            aria-pressed={props.checklistOpen}
            onClick={props.onToggleChecklist}
            title="展開檢查清單（C）"
          >
            ☰ 清單
          </button>
        </div>
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
