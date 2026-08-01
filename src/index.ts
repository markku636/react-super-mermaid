// react-super-mermaid 公開出口。
// 主要 API 是 React 元件;同時附帶輸出框架無關的 core 函式供進階 / 非 React 使用。

// ── React 元件 ──
export { MermaidViewer } from './react/MermaidViewer';
export type { MermaidViewerProps, MermaidViewerHandle } from './react/MermaidViewer';
export { MermaidDiagram } from './react/MermaidDiagram';
export { Toolbar, DEFAULT_THEME_OPTIONS, BACKGROUND_PRESETS, PATTERN_OPTIONS } from './react/Toolbar';
export type { ToolbarProps, ThemeOption } from './react/Toolbar';
export { CheckCard, CheckList, CheckPopover } from './react/CheckPanel';
export type {
  CheckCardProps,
  CheckListProps,
  CheckPopoverProps,
  CheckResolveElkLink,
} from './react/CheckPanel';
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

// ── 懸停提示(tips)的框架無關工具 ──
export { parseTips, stripTipDirectives, mergeTips, normalizeTips } from './core/tips/parse';
export { attachHoverTips } from './core/tips/hover';
export type {
  AttachHoverTipsOptions,
  GetNodeTip,
  HoverTipContext,
  HoverTipsController,
} from './core/tips/hover';

// ── 檢查提示(checks)的框架無關工具 ──
export { parseChecks, stripCheckDirectives, mergeChecks } from './core/checks/parse';
export { annotateChecks } from './core/checks/annotate';
export type {
  AnnotateOptions,
  ChecksController,
  ResolvedCheckGroup,
} from './core/checks/annotate';
export { buildKibanaDiscoverUrl, elkLinkFromConfig } from './core/checks/kibana';
export type { KibanaDiscoverUrlInput } from './core/checks/kibana';
export { authorIdFromDomId, findDiagramNode, nodeLabelText } from './core/node-index';
export type { FindNodeOptions } from './core/node-index';

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
  DiagramCheck,
  DiagramTip,
  CheckSeverity,
  CheckSnippet,
  CheckLink,
  CheckElkQuery,
  ElkLinkConfig,
} from './types';
