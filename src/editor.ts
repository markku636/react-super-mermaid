// react-super-mermaid/editor 子路徑出口:100% React-free 的繪製 / round-trip 引擎。
// 供 VS Code webview 等非 React host 直接 import,esbuild 不會把 React 拉進來。

export * from './core/editor';

// 附帶 re-export 幾個 React-free 的 core 工具(host 串接 mermaid / 匯出時常用)。
export { renderDiagram } from './core/render-pipeline';
export { loadMermaid } from './core/load-mermaid';
export { colorizeDiagram, boostLegibility } from './core/themes/colorize';
export {
  serializeLiveSvg,
  prepareSvgElement,
  prepareSvgString,
  rasterizeToBlob,
  svgBlob,
  downloadBlob,
} from './core/export';

export type {
  MermaidTheme,
  MermaidSource,
  MermaidLike,
  RenderDiagramOptions,
  RenderResult,
  ExportRasterOptions,
  RasterType,
} from './types';
