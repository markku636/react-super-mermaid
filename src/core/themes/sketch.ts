// 手繪風(Sketch)後處理器。
// Mermaid 原生 look:'handDrawn'(rough.js)只作用於走 unified renderer 的圖
// (flowchart / state / class / ER / venn …);sequenceDiagram 使用獨立 renderer,
// 設了 handDrawn 也毫無效果。本模組針對「已渲染完成的 sequence SVG」就地補上手繪質感:
//   1) feTurbulence + feDisplacementMap 位移濾鏡 — 讓直線 / 方框抖動成手繪線條;
//      因為位移的是 render 後的圖元而非字體,故對 CJK 文字同樣有效。
//   2) 手寫風字體(Latin / 數字直接生效,CJK 自動 fallback 系統字)。
//   3) pastel actor 標題 + slate ink 訊息線 + 便利貼 note,讓畫面更精緻。
// 純 DOM 操作,僅瀏覽器端可用;非 sequence 圖直接略過並回傳 false,
// 不影響 flowchart / ER 既有的原生 handDrawn 結果。

export interface SketchOptions {
  dark?: boolean;
  /** 位移濾鏡亂數種子,固定值可確保每次 render 的抖動一致(與 handDrawnSeed 對齊)。 */
  seed?: number;
}

interface PaletteEntry {
  fill: string;
  stroke: string;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const SKETCH_FILTER_ID = 'rsm-sketch-wobble';
const FONT_FACE_ID = 'rsm-sketch-fontface';
const DEFAULT_SEED = 42;

// Excalidraw 招牌手寫字體 Virgil;CJK 用 Windows 內建 KaiTi(標楷體)
// 補手寫筆刷感,最後回退 Comic Sans MS / cursive。
export const SKETCH_FONT = "'Virgil', 'KaiTi', 'Comic Sans MS', cursive";

// 預設從本套件發佈在 jsDelivr 的 dist 取 Virgil;host 可用 ensureSketchFont(fontUrl) 覆寫
// 成自家 /public 路徑或其他 CDN。載入失敗會靜默退回 fallback 字鏈,不阻斷渲染。
export const DEFAULT_VIRGIL_FONT_URL =
  'https://cdn.jsdelivr.net/npm/react-super-mermaid/dist/Virgil.woff2';

// actor 標題用的調色盤 — Excalidraw Open Color 元素底色 + 對應描邊。
const ACTOR_PALETTE: PaletteEntry[] = [
  { fill: '#a5d8ff', stroke: '#1971c2' }, // blue
  { fill: '#b2f2bb', stroke: '#2f9e44' }, // green
  { fill: '#ffd8a8', stroke: '#e8590c' }, // orange
  { fill: '#d0bfff', stroke: '#6741d9' }, // violet
  { fill: '#99e9f2', stroke: '#0c8599' }, // cyan
  { fill: '#ffc9c9', stroke: '#e03131' }, // red
  { fill: '#ffec99', stroke: '#f08c00' }, // yellow
  { fill: '#eebefa', stroke: '#9c36b5' }, // grape
];

const NOTE_FILL = '#ffec99';
const NOTE_STROKE = '#f08c00';
// Excalidraw 預設黑墨;落在彩色 / 便利貼底色上的文字一律用它,深淺色主題下都看得清楚。
const INK_DARK = '#1e1e1e';

/** 是否為 sequenceDiagram 的 SVG(只有它需要本模組補手繪)。 */
function isSequenceSvg(svg: Element): boolean {
  return (
    svg.getAttribute('aria-roledescription') === 'sequence' ||
    svg.querySelector('.actor, .messageLine0, .actor-line') !== null
  );
}

/** 建立(或重用)位移濾鏡:fractalNoise 噪聲驅動 feDisplacementMap,使線條呈手繪抖動。 */
function ensureWobbleFilter(svg: Element, seed: number): void {
  if (svg.querySelector(`#${SKETCH_FILTER_ID}`)) {
    return;
  }
  let defs = svg.querySelector(':scope > defs');
  if (!defs) {
    defs = document.createElementNS(SVG_NS, 'defs');
    svg.insertBefore(defs, svg.firstChild);
  }
  const filter = document.createElementNS(SVG_NS, 'filter');
  filter.setAttribute('id', SKETCH_FILTER_ID);
  // 濾鏡區域略為外擴,避免抖動位移把邊緣圖元裁掉。
  filter.setAttribute('x', '-3%');
  filter.setAttribute('y', '-3%');
  filter.setAttribute('width', '106%');
  filter.setAttribute('height', '106%');
  const turbulence = document.createElementNS(SVG_NS, 'feTurbulence');
  turbulence.setAttribute('type', 'fractalNoise');
  turbulence.setAttribute('baseFrequency', '0.012');
  turbulence.setAttribute('numOctaves', '2');
  turbulence.setAttribute('seed', String(seed));
  turbulence.setAttribute('result', 'noise');
  const displace = document.createElementNS(SVG_NS, 'feDisplacementMap');
  displace.setAttribute('in', 'SourceGraphic');
  displace.setAttribute('in2', 'noise');
  // 位移幅度:夠明顯能讀出手繪感,又不至於讓文字糊掉。
  displace.setAttribute('scale', '2.2');
  displace.setAttribute('xChannelSelector', 'R');
  displace.setAttribute('yChannelSelector', 'G');
  filter.appendChild(turbulence);
  filter.appendChild(displace);
  defs.appendChild(filter);
}

/** 把 svg 內所有圖元(defs / style 除外)包進一個套了位移濾鏡的群組。 */
function wrapWithWobble(svg: SVGSVGElement): void {
  if (svg.querySelector(':scope > g.rsm-sketch-layer')) {
    return;
  }
  const layer = document.createElementNS(SVG_NS, 'g');
  layer.setAttribute('class', 'rsm-sketch-layer');
  layer.style.filter = `url(#${SKETCH_FILTER_ID})`;
  const movable = Array.from(svg.childNodes).filter((node): node is Element => {
    if (node.nodeType !== Node.ELEMENT_NODE) {
      return false;
    }
    const tag = (node as Element).tagName.toLowerCase();
    return tag !== 'defs' && tag !== 'style';
  });
  // 依原順序搬入,維持 z-order(背景 → 線 → 框 → 文字)。
  for (const node of movable) {
    layer.appendChild(node);
  }
  svg.appendChild(layer);
}

/** 套用手寫風字體到所有文字節點(<text> 與 htmlLabels 的 span/p 都涵蓋)。 */
function applyHandwritingFont(svg: Element): void {
  for (const text of Array.from(svg.querySelectorAll<SVGTextElement>('text, tspan'))) {
    text.style.fontFamily = SKETCH_FONT;
  }
  for (const html of Array.from(
    svg.querySelectorAll<HTMLElement>('.messageText, .noteText, .loopText, .labelText, span, p'),
  )) {
    html.style.fontFamily = SKETCH_FONT;
  }
}

/** 依 actor 名稱分組上色:同一 actor 的頂 / 底方框共用同一個 pastel 色,label 文字轉深色。 */
function colorizeActors(svg: Element): void {
  const rects = Array.from(svg.querySelectorAll<SVGRectElement>('rect.actor'));
  if (rects.length === 0) {
    return;
  }
  const colorByName = new Map<string, PaletteEntry>();
  let nextIndex = 0;
  for (const rect of rects) {
    const name = rect.getAttribute('name') ?? `#${nextIndex}`;
    let entry = colorByName.get(name);
    if (!entry) {
      entry = ACTOR_PALETTE[nextIndex % ACTOR_PALETTE.length];
      colorByName.set(name, entry);
      nextIndex += 1;
    }
    rect.style.fill = entry.fill;
    rect.style.stroke = entry.stroke;
    rect.style.strokeWidth = '2px';
    rect.setAttribute('rx', '8');
    rect.setAttribute('ry', '8');
    // label 文字與 rect 同在一個 <g> 內 → 把該群組的文字轉黑墨(彩色底色需深字)。
    const group = rect.parentElement;
    if (group) {
      for (const text of Array.from(group.querySelectorAll<SVGTextElement>('text, tspan'))) {
        text.style.fill = INK_DARK;
      }
    }
  }
}

/** 便利貼風 note:Excalidraw 黃底 + 橘框 + 黑墨字。 */
function colorizeNotes(svg: Element): void {
  for (const note of Array.from(svg.querySelectorAll<SVGRectElement>('rect.note'))) {
    note.style.fill = NOTE_FILL;
    note.style.stroke = NOTE_STROKE;
    note.style.strokeWidth = '1.8px';
    note.setAttribute('rx', '6');
    note.setAttribute('ry', '6');
  }
  for (const text of Array.from(svg.querySelectorAll<SVGTextElement>('.noteText, .noteText tspan'))) {
    text.style.fill = INK_DARK;
  }
}

/** 訊息線 / 生命線 / 迴圈框:統一成 Excalidraw 黑墨線條,端點圓潤。 */
function styleLines(svg: Element, ink: string): void {
  for (const line of Array.from(svg.querySelectorAll<SVGElement>('.messageLine0, .messageLine1'))) {
    line.style.stroke = ink;
    line.style.strokeWidth = '1.8px';
    line.style.strokeLinecap = 'round';
    line.style.strokeLinejoin = 'round';
  }
  for (const marker of Array.from(
    svg.querySelectorAll<SVGElement>('marker path, .arrowhead, path.arrowMarkerPath'),
  )) {
    marker.style.fill = ink;
    marker.style.stroke = ink;
  }
  // 生命線:更淡的虛線,退到背景。
  for (const life of Array.from(svg.querySelectorAll<SVGElement>('.actor-line'))) {
    life.style.stroke = ink;
    life.style.strokeOpacity = '0.3';
    life.style.strokeDasharray = '2 5';
  }
  // alt / opt / loop 外框 + 標籤(便利貼黃標籤,呼應 Excalidraw)
  for (const loop of Array.from(svg.querySelectorAll<SVGElement>('.loopLine'))) {
    loop.style.stroke = ink;
    loop.style.strokeOpacity = '0.5';
  }
  for (const box of Array.from(svg.querySelectorAll<SVGElement>('polygon.labelBox'))) {
    box.style.fill = NOTE_FILL;
    box.style.stroke = ink;
    box.style.strokeOpacity = '0.6';
  }
  for (const text of Array.from(
    svg.querySelectorAll<SVGTextElement>('.messageText, .loopText, .labelText'),
  )) {
    text.style.fill = ink;
  }
}

/**
 * 對已渲染的 mermaid SVG 套用手繪風(就地修改 DOM)。
 * 僅處理 sequenceDiagram;其他圖型回傳 false 由呼叫端維持原生 handDrawn 結果。
 */
export function sketchifyDiagram(root: ParentNode, opts: SketchOptions = {}): boolean {
  const svg = root instanceof SVGSVGElement ? root : root.querySelector<SVGSVGElement>('svg');
  if (!svg || !isSequenceSvg(svg)) {
    return false;
  }
  // Excalidraw 黑墨;深色主題下退成淺墨,維持線條可讀。
  const ink = opts.dark === true ? '#e9ecef' : INK_DARK;

  // 先上色(此時圖元仍是 svg 的直接子節點,選擇器最單純),再包進抖動群組。
  colorizeActors(svg);
  colorizeNotes(svg);
  styleLines(svg, ink);
  applyHandwritingFont(svg);

  ensureWobbleFilter(svg, opts.seed ?? DEFAULT_SEED);
  wrapWithWobble(svg);
  return true;
}

// 字體載入依 URL 快取,避免重複注入 / 重複等待;不同 URL 各自獨立。
const fontPromises = new Map<string, Promise<void>>();

/**
 * 注入 Virgil 的 @font-face 並等待載入完成。
 * 必須在 mermaid.render 之前 await — 否則 mermaid 會用 fallback 字體量測文字寬度,
 * 導致換成 Virgil 後文字溢出方框。載入失敗時靜默退回 fallback 字體,不阻斷渲染。
 *
 * @param fontUrl Virgil woff2 的來源網址;省略則用 DEFAULT_VIRGIL_FONT_URL(jsDelivr)。
 */
export function ensureSketchFont(fontUrl: string = DEFAULT_VIRGIL_FONT_URL): Promise<void> {
  if (typeof document === 'undefined') {
    return Promise.resolve();
  }
  const cached = fontPromises.get(fontUrl);
  if (cached) {
    return cached;
  }
  const promise = (async () => {
    const styleId = `${FONT_FACE_ID}-${hashUrl(fontUrl)}`;
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent =
        `@font-face{font-family:'Virgil';` +
        `src:url("${fontUrl}") format('woff2');font-display:swap;}`;
      document.head.appendChild(style);
    }
    try {
      await document.fonts.load("16px 'Virgil'");
    } catch {
      // 字體載入失敗 → 沿用 fallback(KaiTi / Comic Sans),不中斷流程。
    }
  })();
  fontPromises.set(fontUrl, promise);
  return promise;
}

/** 把 URL 壓成短雜湊,當 <style> 的 id 後綴(允許多來源並存)。 */
function hashUrl(url: string): string {
  let hash = 0;
  for (let i = 0; i < url.length; i += 1) {
    hash = (hash * 31 + url.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}
