// 套件共用型別(框架無關)。React 專屬的 props/handle 型別定義在 react/ 內。

/** 本套件實際用到的 mermaid API 子集 — 避免直接相依 mermaid 匯出的型別。 */
export interface MermaidRenderResult {
  svg: string;
  bindFunctions?: (element: Element) => void;
}

export interface MermaidLike {
  initialize: (config: unknown) => void;
  render: (id: string, text: string, container?: Element) => Promise<MermaidRenderResult>;
  parse?: (text: string) => Promise<unknown> | unknown;
}

/** 如何取得外部 mermaid:注入實例 > peer 動態 import('mermaid') > CDN。 */
export interface MermaidSource {
  /** (a) host 已 import 的 mermaid 實例,最高優先,不再動態載入。 */
  instance?: MermaidLike;
  /** (c) mermaid ESM build 的 CDN 網址,如 .../mermaid@11/dist/mermaid.esm.min.mjs。 */
  cdnUrl?: string;
}

export interface LoadMermaidOptions {
  source?: MermaidSource;
  /** 強制重新解析(清掉模組級快取)。 */
  fresh?: boolean;
}

/** svg-pan-zoom 工廠函式(預設匯出),只列出本套件用到的形狀。 */
export type SvgPanZoomFactory = (svg: SVGElement, options?: Record<string, unknown>) => PanZoomInstance;

export interface SvgPanZoomSource {
  instance?: SvgPanZoomFactory;
  cdnUrl?: string;
}

/** svg-pan-zoom 實例 — 只列出本套件用到的方法。 */
export interface PanZoomInstance {
  destroy: () => void;
  zoomBy: (factor: number) => void;
  zoom: (scale: number) => void;
  getZoom: () => number;
  resize: () => void;
  fit: () => void;
  center: () => void;
  pan: (point: { x: number; y: number }) => void;
  getPan: () => { x: number; y: number };
  getSizes: () => {
    width: number;
    height: number;
    realZoom: number;
    viewBox: { x: number; y: number; width: number; height: number };
  };
}

export type MermaidTheme =
  | 'colorful'
  | 'sketch'
  | 'auto'
  | 'default'
  | 'dark'
  | 'neutral'
  | 'forest';

export type MermaidBaseTheme = 'default' | 'dark' | 'neutral' | 'forest';

export interface RenderDiagramOptions {
  /** mermaid 原始碼字串。 */
  code: string;
  /** 渲染目標;字串視為 CSS selector。省略則只回傳 detached SVG。 */
  container?: HTMLElement | string;
  theme?: MermaidTheme;
  dark?: boolean;
  /** sketch 抖動亂數種子,預設 42。 */
  seed?: number;
  /** sketch 手寫字體來源覆寫。 */
  fontUrl?: string;
  /** 透傳給 mermaid.initialize 的設定(深合併)。 */
  mermaidConfig?: Record<string, unknown>;
  /** 如何取得 mermaid。 */
  mermaid?: MermaidSource;
  /** 是否注入套件內建 CSS,預設 true。 */
  injectStyles?: boolean;
}

export interface RenderResult {
  /** 已注入 container(若有提供)的 SVG 元素。 */
  svg: SVGSVGElement;
  /** 序列化後的 SVG 字串。 */
  svgString: string;
  /** 本次 render 使用的唯一 id。 */
  id: string;
}

export type RasterType = 'png' | 'jpeg' | 'webp';

export interface ExportRasterOptions {
  /** 解析度倍率,預設 2。 */
  scale?: 1 | 2 | 4;
  /** 透明背景(JPEG 不支援,會自動填白)。 */
  transparent?: boolean;
  /** 明確指定背景色,覆寫 transparent。 */
  background?: string;
  type?: RasterType;
  /** jpeg / webp 的品質 0..1,預設 0.92。 */
  quality?: number;
}

export interface SearchState {
  current: number;
  total: number;
}
