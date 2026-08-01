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
  /** 以指定點為錨點縮放(乘以 factor);手勢捏合縮放用,讓兩指中點維持在原位。 */
  zoomAtPointBy: (factor: number, point: { x: number; y: number }) => void;
  getZoom: () => number;
  resize: () => void;
  fit: () => void;
  center: () => void;
  pan: (point: { x: number; y: number }) => void;
  /** 相對平移(螢幕像素位移);手勢拖曳用。 */
  panBy: (point: { x: number; y: number }) => void;
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

/**
 * 畫布背景模式(舊版,已棄用)。新版把背景拆成兩個獨立維度:
 * 底色(`solidColor`) + 疊加圖樣(`RsmPattern`)。保留型別僅為相容舊匯入。
 * @deprecated 改用 `RsmPattern` + `solidColor`。
 */
export type RsmBackground = 'transparent' | 'solid' | 'grid';

/** 畫布疊加圖樣:無 / 網點 / 網格線。可與任一底色(透明或純色)自由組合。 */
export type RsmPattern = 'none' | 'dots' | 'grid';

/** 一個底色預設色票;`value` 為 null 代表「預設 / 透明」(跟隨頁面底色)。 */
export interface RsmBackgroundPreset {
  /** 色票 hex(如 `#FFFFFF`);null = 透明 / 跟隨頁面。 */
  value: string | null;
  /** 顯示名稱(tooltip / aria-label)。 */
  label: string;
}

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

// ── 檢查提示(checks)──
// 把「這一步異常時怎麼查」掛回圖上的節點。來源有二:mermaid 原始碼裡的 `%% @check` 指令,
// 以及 host 傳入的 `checks` prop(同 target 由 prop 覆寫)。

/** 檢查點的嚴重度 — 決定角標與卡片的配色。 */
export type CheckSeverity = 'info' | 'warn' | 'error';

/** 一段可複製的檢查片段(SQL / KQL / 指令…)。`lang` 同時作為顯示標籤。 */
export interface CheckSnippet {
  /** 語言 / 類型,例 `sql`、`kql`、`sh`。來自指令的鍵名。 */
  lang?: string;
  /** 覆寫顯示標籤;省略時顯示 `lang`。 */
  label?: string;
  code: string;
}

/** 外部參考連結(Runbook / Jira / Confluence…)。 */
export interface CheckLink {
  label: string;
  url: string;
}

/** ELK 查詢條件;`kql` 由套件內建 builder 消費,`dsl` 僅交給 host callback。 */
export interface CheckElkQuery {
  kql?: string;
  /** 完整 ES DSL — 內建 builder 不處理(含 `-` 的欄位需 custom filter pill),僅供 callback 使用。 */
  dsl?: Record<string, unknown>;
  /** 覆寫 index / data view(交給 callback 判斷用)。 */
  index?: string;
  /** 覆寫按鈕文字。 */
  label?: string;
}

/** 掛在某個圖形節點上的一則檢查提示。 */
export interface DiagramCheck {
  /** 對應的節點:預設比對作者 id,`match: 'label'` 時比對節點標籤文字。 */
  target: string;
  match?: 'id' | 'label';
  /** 省略時渲染期以節點自身的標籤文字遞補。 */
  title?: string;
  severity?: CheckSeverity;
  desc?: string;
  /** 逐步檢查步驟(有序)。 */
  steps?: string[];
  snippets?: CheckSnippet[];
  links?: CheckLink[];
  elk?: CheckElkQuery;
}

// ── 懸停提示(tips)──
// 滑鼠懸停在節點上時顯示的說明文字。來源有二:mermaid 原始碼裡的 `%% @tip` 指令,
// 以及 host 傳入的 `tips` prop(同 target 由 prop 覆寫)。

/** 掛在某個圖形節點上的一則懸停提示。 */
export interface DiagramTip {
  /** 對應的節點:預設比對作者 id,`match: 'label'` 時比對節點標籤文字。 */
  target: string;
  match?: 'id' | 'label';
  /** 懸停時顯示的文字(可多行,`\n` 分行)。 */
  text: string;
}

/** 內建 Kibana Discover 連結設定;host 已知 data view UUID 時可免後端直接產連結。 */
export interface ElkLinkConfig {
  /** Kibana 站台網址,例 `https://kibana.example.com`。 */
  kibanaHost: string;
  /** data view(index pattern)的 UUID。 */
  dataViewId: string;
  /** 時間範圍,支援絕對 ISO 或相對值(`now-24h`)。預設 `now-24h` → `now`。 */
  timeFrom?: string;
  timeTo?: string;
  /** Discover 預設顯示欄位。 */
  columns?: string[];
}
