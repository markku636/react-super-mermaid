// react-super-mermaid 公開出口。
// 主要 API 是 React 元件;同時附帶輸出框架無關的 core 函式供進階 / 非 React 使用。

// ── React 元件 ──
export { MermaidViewer } from './react/MermaidViewer';
export type { MermaidViewerProps, MermaidViewerHandle } from './react/MermaidViewer';
export { MermaidDiagram } from './react/MermaidDiagram';
export { Toolbar, DEFAULT_THEME_OPTIONS, BACKGROUND_PRESETS, PATTERN_OPTIONS } from './react/Toolbar';
export type { ToolbarProps, ThemeOption } from './react/Toolbar';
export { useMermaidViewer } from './react/useMermaidViewer';
export type {
  UseMermaidViewerOptions,
  UseMermaidViewerResult,
  RenderStatus,
} from './react/useMermaidViewer';

// ── 繪製編輯器(Excalidraw 式,雙向 round-trip)──
export { MermaidEditor } from './react/MermaidEditor';
export type { MermaidEditorProps, MermaidEditorHandle } from './react/MermaidEditor';
export { EditorToolbar } from './react/EditorToolbar';
export type { EditorToolbarProps } from './react/EditorToolbar';
export { useDiagramEditor } from './react/useDiagramEditor';
export type { UseDiagramEditorOptions, UseDiagramEditorResult } from './react/useDiagramEditor';
// 框架無關的繪製引擎也從主入口轉出(進階 / 非 React 用法可改 import 'react-super-mermaid/editor')。
export {
  createDiagramEditor,
  registerFlowchartAdapter,
  detectDiagramType,
  emptyScene,
  sceneToFlowchart,
} from './core/editor';
export type {
  DiagramEditorHandle,
  DiagramEditorOptions,
  EditorScene,
  SceneNode,
  SceneEdge,
  DiagramType,
  NodeShape,
  Tool,
} from './core/editor';

// ── core(框架無關) ──
export { renderDiagram } from './core/render-pipeline';
export { loadMermaid } from './core/load-mermaid';
export { loadSvgPanZoom } from './core/load-svg-pan-zoom';
export { ensureStyles } from './core/ensure-styles';
export { resolveTheme } from './core/resolve-theme';
export { colorizeDiagram, boostLegibility, type ColorizeOptions } from './core/themes/colorize';
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
  RsmPattern,
  RsmBackgroundPreset,
} from './types';
