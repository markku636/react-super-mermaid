// react-super-mermaid 公開出口。
// 主要 API 是 React 元件;同時附帶輸出框架無關的 core 函式供進階 / 非 React 使用。

// ── React 元件 ──
export { MermaidViewer } from './react/MermaidViewer';
export type { MermaidViewerProps, MermaidViewerHandle } from './react/MermaidViewer';
export { MermaidDiagram } from './react/MermaidDiagram';
export { Toolbar, DEFAULT_THEME_OPTIONS } from './react/Toolbar';
export type { ToolbarProps, ThemeOption } from './react/Toolbar';
export { useMermaidViewer } from './react/useMermaidViewer';
export type {
  UseMermaidViewerOptions,
  UseMermaidViewerResult,
  RenderStatus,
} from './react/useMermaidViewer';

// ── core(框架無關) ──
export { renderDiagram } from './core/render-pipeline';
export { loadMermaid } from './core/load-mermaid';
export { loadSvgPanZoom } from './core/load-svg-pan-zoom';
export { ensureStyles } from './core/ensure-styles';
export { resolveTheme } from './core/resolve-theme';
export { colorizeDiagram, type ColorizeOptions } from './core/themes/colorize';
export {
  sketchifyDiagram,
  ensureSketchFont,
  SKETCH_FONT,
  DEFAULT_VIRGIL_FONT_URL,
  type SketchOptions,
} from './core/themes/sketch';
export {
  serializeLiveSvg,
  prepareSvgString,
  prepareSvgElement,
  rasterizeToBlob,
  svgBlob,
  downloadBlob,
  type PreparedSvg,
} from './core/export';

// ── 型別 ──
export type {
  MermaidTheme,
  MermaidBaseTheme,
  MermaidSource,
  MermaidLike,
  LoadMermaidOptions,
  SvgPanZoomSource,
  PanZoomInstance,
  RenderDiagramOptions,
  RenderResult,
  ExportRasterOptions,
  RasterType,
  SearchState,
} from './types';
