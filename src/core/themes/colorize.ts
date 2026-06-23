// Colorful 樣式的後處理上色器:在 mermaid 輸出的 SVG 上重新套用現代調色盤
// (Tailwind 100 底色 / 500 邊框) + 圓角 + 軟陰影 + slate 邊線。
// 純 DOM 操作,需在瀏覽器端執行;每個 pass 在零命中時自動跳過,
// 故 mermaid 的 DOM 結構變動不會讓渲染中斷。

export interface ColorizeOptions {
  dark?: boolean;
}

interface PaletteEntry {
  fill: string;
  stroke: string;
}

const NODE_PALETTE: PaletteEntry[] = [
  { fill: '#DBEAFE', stroke: '#3B82F6' }, // blue
  { fill: '#DCFCE7', stroke: '#22C55E' }, // green
  { fill: '#FFEDD5', stroke: '#F97316' }, // orange
  { fill: '#F3E8FF', stroke: '#A855F7' }, // purple
  { fill: '#FEE2E2', stroke: '#EF4444' }, // red
  { fill: '#CFFAFE', stroke: '#06B6D4' }, // cyan
  { fill: '#FEF9C3', stroke: '#EAB308' }, // yellow
  { fill: '#EDE9FE', stroke: '#8B5CF6' }, // violet
];

// 叢集 / 水道底色。色相對齊 NODE_PALETTE;底色夠濃(16% 而非舊的 7%)、
// 邊框夠飽和,相鄰水道一眼可辨,標題也更清楚。
const CLUSTER_PALETTE: PaletteEntry[] = [
  { fill: 'rgba(59, 130, 246, 0.16)', stroke: '#3B82F6' }, // blue
  { fill: 'rgba(34, 197, 94, 0.16)', stroke: '#22C55E' }, // green
  { fill: 'rgba(249, 115, 22, 0.16)', stroke: '#F97316' }, // orange
  { fill: 'rgba(168, 85, 247, 0.16)', stroke: '#A855F7' }, // purple
  { fill: 'rgba(239, 68, 68, 0.16)', stroke: '#EF4444' }, // red
  { fill: 'rgba(6, 182, 212, 0.16)', stroke: '#06B6D4' }, // cyan
  { fill: 'rgba(234, 179, 8, 0.16)', stroke: '#EAB308' }, // yellow
  { fill: 'rgba(139, 92, 246, 0.16)', stroke: '#8B5CF6' }, // violet
];

// 圓餅 / 圓環專用的鮮明調色盤。mermaid 在 dark base 主題下的預設圓餅色又暗又糊
// (顏色太死),這裡整組換成飽和、相鄰色相差異大的版本,讓圖表「活」起來。
const PIE_PALETTE = [
  '#3B82F6', // blue
  '#22C55E', // green
  '#F59E0B', // amber
  '#A855F7', // purple
  '#EF4444', // red
  '#06B6D4', // cyan
  '#EC4899', // pink
  '#84CC16', // lime
  '#F97316', // orange
  '#14B8A6', // teal
  '#6366F1', // indigo
  '#EAB308', // yellow
];

const NODE_TEXT = '#1F2937';
const SHADOW_FILTER_ID = 'rsm-soft-shadow';
const SVG_NS = 'http://www.w3.org/2000/svg';

function resolveSvg(root: ParentNode): Element | null {
  if (root instanceof Element && root.tagName.toLowerCase() === 'svg') {
    return root;
  }
  return root.querySelector('svg');
}

/** 把顏色字串正規化成 "r,g,b",讓 attribute(hex)與 inline style(瀏覽器會轉成 rgb)互相對得上。 */
function canonColor(input: string): string {
  const s = (input || '').trim();
  const hex = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) {
      h = h
        .split('')
        .map((c) => c + c)
        .join('');
    }
    const n = parseInt(h, 16);
    return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
  }
  const rgb = /rgba?\(([^)]+)\)/i.exec(s);
  if (rgb) {
    const p = rgb[1].split(',').map((x) => Math.round(parseFloat(x)));
    return `${p[0]},${p[1]},${p[2]}`;
  }
  return s.toLowerCase();
}

/** 以 sRGB 相對亮度決定:在這個底色上要用白字還是深字,確保對比清楚。 */
function readableTextOn(color: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(color.trim());
  if (!m) {
    return '#FFFFFF';
  }
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.62 ? '#1F2937' : '#FFFFFF';
}

/** 共用的軟陰影 filter — 讓節點看起來更接近商業工具。 */
function ensureShadowFilter(svg: Element): void {
  if (svg.querySelector(`#${SHADOW_FILTER_ID}`)) {
    return;
  }
  let defs = svg.querySelector(':scope > defs');
  if (!defs) {
    defs = document.createElementNS(SVG_NS, 'defs');
    svg.insertBefore(defs, svg.firstChild);
  }
  const filter = document.createElementNS(SVG_NS, 'filter');
  filter.setAttribute('id', SHADOW_FILTER_ID);
  filter.setAttribute('x', '-25%');
  filter.setAttribute('y', '-25%');
  filter.setAttribute('width', '150%');
  filter.setAttribute('height', '150%');
  const drop = document.createElementNS(SVG_NS, 'feDropShadow');
  drop.setAttribute('dx', '0');
  drop.setAttribute('dy', '1.5');
  drop.setAttribute('stdDeviation', '2');
  drop.setAttribute('flood-color', '#0F172A');
  drop.setAttribute('flood-opacity', '0.22');
  filter.appendChild(drop);
  defs.appendChild(filter);
}

function roundRect(shape: SVGElement, radius: number): void {
  if (shape.tagName.toLowerCase() !== 'rect') {
    return;
  }
  // Stadium 形狀本身已帶大 rx,別把它壓平。
  const rx = Number(shape.getAttribute('rx') ?? '0');
  if (rx < radius + 1) {
    shape.setAttribute('rx', String(radius));
    shape.setAttribute('ry', String(radius));
  }
}

function paintShapes(group: Element, entry: PaletteEntry): void {
  const direct = Array.from(
    group.querySelectorAll<SVGElement>(
      ':scope > rect, :scope > polygon, :scope > circle, :scope > ellipse, :scope > path',
    ),
  );
  if (direct.length > 0) {
    for (const shape of direct) {
      shape.style.fill = entry.fill;
      shape.style.stroke = entry.stroke;
      shape.style.strokeWidth = '1.4px';
      roundRect(shape, 8);
    }
    direct[0].setAttribute('filter', `url(#${SHADOW_FILTER_ID})`);
    return;
  }
  // v11 unified-renderer 節點(如 erDiagram 實體)把形狀包在子群組:
  // g.outer-path 放背景與邊框、g.row-rect-odd/even 放屬性列、g.divider 放分隔線。
  for (const path of Array.from(group.querySelectorAll<SVGElement>(':scope > g.outer-path > *'))) {
    if (path.getAttribute('fill') && path.getAttribute('fill') !== 'none') {
      path.style.fill = entry.fill;
      path.setAttribute('filter', `url(#${SHADOW_FILTER_ID})`);
    }
    if (path.getAttribute('stroke') && path.getAttribute('stroke') !== 'none') {
      path.style.stroke = entry.stroke;
      path.style.strokeWidth = '1.4px';
    }
  }
  for (const row of Array.from(group.querySelectorAll<SVGElement>(':scope > g.row-rect-odd > *'))) {
    row.style.fill = 'rgba(255, 255, 255, 0.55)';
  }
  for (const row of Array.from(group.querySelectorAll<SVGElement>(':scope > g.row-rect-even > *'))) {
    row.style.fill = 'rgba(255, 255, 255, 0.3)';
  }
  for (const divider of Array.from(group.querySelectorAll<SVGElement>(':scope > g.divider > *'))) {
    divider.style.stroke = entry.stroke;
  }
}

function darkenNodeText(group: Element, dark = false): void {
  // 亮色:底色是淺 pastel → 深字才清楚;暗色:底色改半透明深色票 → 亮字才清楚。
  const c = dark ? '#E2E8F0' : NODE_TEXT;
  for (const el of Array.from(group.querySelectorAll<SVGTextElement>('text, tspan'))) {
    el.style.fill = c;
  }
  for (const el of Array.from(group.querySelectorAll<HTMLElement>('.nodeLabel, span, p'))) {
    el.style.color = c;
  }
}

/** slate 色、圓角端點的邊線,比 mermaid 預設更乾淨。 */
function styleEdges(svg: Element, dark: boolean): void {
  const edgeColor = dark ? '#94A3B8' : '#64748B';
  const edgeSelectors = [
    '.edgePaths path',
    'g.edgePath path',
    'path.flowchart-link',
    'path.relationshipLine',
  ].join(', ');
  for (const edge of Array.from(svg.querySelectorAll<SVGElement>(edgeSelectors))) {
    edge.style.stroke = edgeColor;
    edge.style.strokeWidth = '1.7px';
    edge.style.strokeLinecap = 'round';
  }
  for (const marker of Array.from(svg.querySelectorAll<SVGElement>('marker path'))) {
    marker.style.fill = edgeColor;
    marker.style.stroke = edgeColor;
  }
}

function styleEdgeLabels(svg: Element): void {
  for (const label of Array.from(svg.querySelectorAll<HTMLElement>('.edgeLabel span, .edgeLabel p'))) {
    label.style.borderRadius = '6px';
  }
  for (const rect of Array.from(svg.querySelectorAll<SVGElement>('.edgeLabel rect'))) {
    rect.setAttribute('rx', '4');
    rect.setAttribute('ry', '4');
  }
}

/**
 * 訊息文字 / flowchart 邊標籤沿用 mermaid 偏淡的預設色,落在淺色畫布上會糊掉 —
 * 一律改成深色(深色主題改淺色),維持像 Excalidraw 一樣清楚。
 */
function styleLabelText(svg: Element, dark: boolean): void {
  const color = dark ? '#E2E8F0' : NODE_TEXT;
  for (const t of Array.from(
    svg.querySelectorAll<SVGElement>('text.messageText, .edgeLabel text, .edgeLabel tspan'),
  )) {
    t.style.fill = color;
  }
  for (const t of Array.from(svg.querySelectorAll<HTMLElement>('.edgeLabel span, .edgeLabel p'))) {
    t.style.color = color;
  }
}

/** 對舊版 ER markup(mermaid < 11.x)的實體標題列上色。 */
function colorizeLegacyEr(svg: Element): void {
  const erGroups: Element[] = [];
  for (const rect of Array.from(svg.querySelectorAll<SVGElement>('rect.er.entityBox'))) {
    const group = rect.parentElement;
    if (group && !erGroups.includes(group)) {
      erGroups.push(group);
    }
  }
  erGroups.forEach((group, i) => {
    const entry = NODE_PALETTE[i % NODE_PALETTE.length];
    for (const rect of Array.from(group.querySelectorAll<SVGElement>('rect.er.entityBox')).slice(0, 1)) {
      rect.style.fill = entry.fill;
      rect.style.stroke = entry.stroke;
    }
    for (const label of Array.from(group.querySelectorAll<SVGElement>('text.er.entityLabel'))) {
      label.style.fill = NODE_TEXT;
    }
  });
}

/**
 * sequenceDiagram 上色:每條水道(actor 方框 + 生命線 + 啟用條)依名稱輪用調色盤,
 * 讓原本同色的各水道一眼可辨。其餘圖型(flowchart / ER …)無 rect.actor,整段自動略過。
 */
function colorizeSequence(svg: Element, dark: boolean): void {
  const actorRects = Array.from(svg.querySelectorAll<SVGRectElement>('rect.actor'));
  if (actorRects.length === 0) {
    return;
  }

  // 依「DOM 出現順序」(頂端 actor 由左至右)替每個名稱配色;頂 / 底方框與生命線共用同色。
  const colorByName = new Map<string, PaletteEntry>();
  let nextIndex = 0;
  for (const rect of actorRects) {
    const name = rect.getAttribute('name') ?? `#${nextIndex}`;
    let entry = colorByName.get(name);
    if (!entry) {
      entry = NODE_PALETTE[nextIndex % NODE_PALETTE.length];
      colorByName.set(name, entry);
      nextIndex += 1;
    }
    rect.style.fill = entry.fill;
    rect.style.stroke = entry.stroke;
    rect.style.strokeWidth = '1.4px';
    rect.setAttribute('rx', '8');
    rect.setAttribute('ry', '8');
    rect.setAttribute('filter', `url(#${SHADOW_FILTER_ID})`);
    // 標題文字(與 rect 同群組)轉深色,落在淺色 pastel 上才清楚。
    const group = rect.parentElement;
    if (group) {
      for (const text of Array.from(group.querySelectorAll<SVGTextElement>('text, tspan'))) {
        text.style.fill = NODE_TEXT;
      }
    }
  }

  // 生命線:改用所屬水道的描邊色(以 name 對應),縱向流程比單一灰虛線更好追蹤;
  // 同時記下每條生命線的 x 座標 → 水道色,供啟用條對應歸屬。
  const lanesByX: { x: number; entry: PaletteEntry }[] = [];
  for (const line of Array.from(svg.querySelectorAll<SVGElement>('line.actor-line'))) {
    const entry = colorByName.get(line.getAttribute('name') ?? '');
    if (!entry) {
      continue;
    }
    line.style.stroke = entry.stroke;
    line.style.strokeOpacity = '0.45';
    line.style.strokeWidth = '1.3px';
    line.style.strokeDasharray = '4 5';
    const x = Number(line.getAttribute('x1'));
    if (Number.isFinite(x)) {
      lanesByX.push({ x, entry });
    }
  }

  // 啟用條:以中心 x 對應到最近的生命線,套上該水道色,讓「此刻是哪條水道在執行」一眼可辨。
  const activations = Array.from(
    svg.querySelectorAll<SVGRectElement>('rect.activation0, rect.activation1, rect.activation2'),
  );
  for (const bar of activations) {
    const x = Number(bar.getAttribute('x'));
    const w = Number(bar.getAttribute('width'));
    if (!Number.isFinite(x) || !Number.isFinite(w) || lanesByX.length === 0) {
      continue;
    }
    const center = x + w / 2;
    let best = lanesByX[0];
    for (const lane of lanesByX) {
      if (Math.abs(lane.x - center) < Math.abs(best.x - center)) {
        best = lane;
      }
    }
    bar.style.fill = best.entry.fill;
    bar.style.stroke = best.entry.stroke;
    bar.style.strokeWidth = '1px';
    bar.setAttribute('rx', '3');
    bar.setAttribute('ry', '3');
  }

  // note:便利貼風(amber)+ 圓角 + 軟陰影 + 深色字。
  for (const note of Array.from(svg.querySelectorAll<SVGRectElement>('rect.note'))) {
    note.style.fill = '#FEF9C3';
    note.style.stroke = '#EAB308';
    note.style.strokeWidth = '1.2px';
    note.setAttribute('rx', '6');
    note.setAttribute('ry', '6');
    note.setAttribute('filter', `url(#${SHADOW_FILTER_ID})`);
  }
  for (const text of Array.from(svg.querySelectorAll<SVGTextElement>('.noteText, .noteText tspan'))) {
    text.style.fill = NODE_TEXT;
  }

  // 訊息線 / loop·alt·opt 外框:統一成 slate 墨線,與 flowchart edge 風格一致;訊息文字轉深色。
  const ink = dark ? '#94A3B8' : '#64748B';
  for (const line of Array.from(svg.querySelectorAll<SVGElement>('.messageLine0, .messageLine1'))) {
    line.style.stroke = ink;
    line.style.strokeWidth = '1.6px';
    line.style.strokeLinecap = 'round';
  }
  for (const loop of Array.from(svg.querySelectorAll<SVGElement>('.loopLine'))) {
    loop.style.stroke = ink;
    loop.style.strokeOpacity = '0.55';
  }
  for (const text of Array.from(
    svg.querySelectorAll<SVGTextElement>('.messageText, .loopText, .labelText'),
  )) {
    text.style.fill = dark ? '#E2E8F0' : NODE_TEXT;
  }
}

/** Pie / 圓環:換上鮮明調色盤(取代又暗又糊的原生深色),白色分隔線 + 對比文字。 */
function stylePie(svg: Element, dark: boolean): void {
  const slices = Array.from(svg.querySelectorAll<SVGElement>('path.pieCircle'));
  const swatches = Array.from(svg.querySelectorAll<SVGElement>('g.legend rect'));
  if (slices.length === 0 && swatches.length === 0) {
    return;
  }

  // 以「目前填色」為鍵建立 舊色→新鮮明色 對映,讓同一資料項的扇形與圖例色塊拿到同一個新色
  // (mermaid 用 ordinal scale 依 label 上色,同 label 的扇形與圖例底色字串一致)。
  const remap = new Map<string, string>();
  let next = 0;
  const newColorFor = (old: string): string => {
    const key = canonColor(old) || `#slot-${next}`;
    let c = remap.get(key);
    if (!c) {
      c = PIE_PALETTE[next % PIE_PALETTE.length];
      remap.set(key, c);
      next += 1;
    }
    return c;
  };

  const sliceNewColors: string[] = [];
  for (const slice of slices) {
    const old = slice.style.fill || slice.getAttribute('fill') || '';
    const c = newColorFor(old);
    sliceNewColors.push(c);
    slice.style.fill = c;
    slice.style.opacity = '1'; // 原生深色主題的 pieOpacity < 1 會讓扇形發灰 → 拉回不透明。
    slice.style.stroke = dark ? '#0F172A' : '#FFFFFF';
    slice.style.strokeWidth = '2px';
    slice.style.strokeLinejoin = 'round';
  }
  // 圖例色塊:依「索引」對齊對應扇形的新色(扇形與圖例同資料順序)。不可改用舊色比對——
  // mermaid 扇形填 hex/hsl、圖例填 rgb,canonColor 對 hsl↔rgb 正規化不一致 → 第三項起圖例與扇形錯色。
  for (let i = 0; i < swatches.length; i++) {
    const sw = swatches[i];
    const c =
      i < sliceNewColors.length
        ? sliceNewColors[i]
        : newColorFor(sw.style.fill || sw.getAttribute('fill') || '');
    sw.style.fill = c;
    sw.style.stroke = c;
    sw.setAttribute('rx', '3');
    sw.setAttribute('ry', '3');
  }
  // 扇形上的百分比文字:依該扇形新色挑白字 / 深字(mermaid 扇形與 .slice 文字同順序)。
  Array.from(svg.querySelectorAll<SVGElement>('text.slice')).forEach((label, i) => {
    const slice = slices[i];
    const c = slice ? slice.style.fill || PIE_PALETTE[0] : PIE_PALETTE[0];
    label.style.fill = readableTextOn(c);
    label.style.fontWeight = '600';
  });
  for (const title of Array.from(svg.querySelectorAll<SVGElement>('text.pieTitleText'))) {
    title.style.fontWeight = '700';
    title.style.fill = dark ? '#E2E8F0' : '#1F2937';
  }
  for (const t of Array.from(svg.querySelectorAll<SVGElement>('g.legend text'))) {
    t.style.fill = dark ? '#E2E8F0' : '#1F2937';
  }
  for (const oc of Array.from(svg.querySelectorAll<SVGElement>('circle.pieOuterCircle'))) {
    oc.style.stroke = dark ? '#334155' : '#CBD5E1';
  }
}

/** Gantt:依 section 替任務上色,保留 done/active/crit 的語意色不動。 */
function styleGantt(svg: Element, dark: boolean): void {
  const tasks = Array.from(svg.querySelectorAll<SVGElement>('rect.task'));
  if (tasks.length === 0) {
    return;
  }
  // 亮色用實心淺色票(深字);暗色用半透明色票(深底)+ 亮字,維持與其他圖表暗色一致。
  const taskPalette = dark ? CLUSTER_PALETTE : NODE_PALETTE;
  for (const task of tasks) {
    const cls = task.getAttribute('class') ?? '';
    if (/\b(done|active|crit|milestone)\d*\b/.test(cls)) {
      continue;
    }
    const m = cls.match(/task(\d+)/);
    if (!m) {
      continue;
    }
    const entry = taskPalette[Number(m[1]) % taskPalette.length];
    task.style.fill = entry.fill;
    task.style.stroke = entry.stroke;
    task.setAttribute('rx', '4');
    task.setAttribute('ry', '4');
  }
  Array.from(svg.querySelectorAll<SVGElement>('rect.section')).forEach((band) => {
    const m = (band.getAttribute('class') ?? '').match(/section(\d+)/);
    if (m) {
      band.style.fill = CLUSTER_PALETTE[Number(m[1]) % CLUSTER_PALETTE.length].fill;
    }
  });
  for (const t of Array.from(svg.querySelectorAll<SVGElement>('text.taskText'))) {
    // 暗色:所有任務字(條內 + 條外)轉亮;亮色:只把條內字壓深(條外維持 mermaid 預設)。
    if (dark) {
      t.style.fill = '#E2E8F0';
    } else if (!/Outside/.test(t.getAttribute('class') ?? '')) {
      t.style.fill = NODE_TEXT;
    }
  }
  for (const tick of Array.from(svg.querySelectorAll<SVGElement>('g.grid g.tick line'))) {
    tick.style.stroke = dark ? '#334155' : '#E2E8F0';
  }
}

/** Timeline:同一 section 的節點共用一色(以 section-N class 取得)。 */
function styleTimeline(svg: Element, dark: boolean): void {
  // 亮色用實心淺色票(深字);暗色用半透明色票(深底柔和塊)+ 亮字,避免淺塊在暗色刺眼 / 淺字看不見。
  const palette = dark ? CLUSTER_PALETTE : NODE_PALETTE;
  const nodes = Array.from(svg.querySelectorAll<SVGGElement>('g[class*="timeline-node"]'));
  nodes.forEach((node, i) => {
    const m = (node.getAttribute('class') ?? '').match(/section-(-?\d+)/);
    const section = m ? Number(m[1]) : i;
    const entry = section < 0 ? palette[7] : palette[section % palette.length];
    const backgrounds = Array.from(node.querySelectorAll<SVGElement>('.node-bkg'));
    if (backgrounds.length > 0) {
      for (const bkg of backgrounds) {
        bkg.style.fill = entry.fill;
        bkg.style.stroke = entry.stroke;
        bkg.style.strokeWidth = '1.4px';
      }
    } else {
      paintShapes(node, entry);
    }
    darkenNodeText(node, dark);
  });
  if (dark) {
    // 標題 / 期間軸等節點外的文字也轉亮色。
    Array.from(svg.querySelectorAll<SVGElement>('text, tspan')).forEach((t) => {
      if (!t.style.fill || t.style.fill === NODE_TEXT) {
        t.style.fill = '#E2E8F0';
      }
    });
  }
}

/** Mindmap:以 section-N class 為鍵,讓同一分支的兄弟節點共用一色。 */
function styleMindmap(svg: Element, dark: boolean): void {
  const nodes = Array.from(svg.querySelectorAll<SVGGElement>('g.mindmap-node'));
  if (nodes.length === 0) {
    return;
  }
  // 亮色實心淺色票(深字);暗色半透明色票(深底)+ 亮字。
  const palette = dark ? CLUSTER_PALETTE : NODE_PALETTE;
  for (const node of nodes) {
    const m = (node.getAttribute('class') ?? '').match(/section-(-?\d+)/);
    const section = m ? Number(m[1]) : 0;
    const entry =
      section < 0
        ? palette[7] // root → violet
        : palette[section % palette.length];
    for (const shape of Array.from(
      node.querySelectorAll<SVGElement>('path, rect, circle, ellipse'),
    )) {
      if (shape.closest('g.children')) {
        continue; // 只上自己的形狀,不動子孫
      }
      shape.style.fill = entry.fill;
      shape.style.stroke = entry.stroke;
      shape.style.strokeWidth = '1.4px';
    }
    darkenNodeText(node, dark);
  }
  for (const edge of Array.from(svg.querySelectorAll<SVGElement>('path[class*="edge"]'))) {
    const m = (edge.getAttribute('class') ?? '').match(/section-edge-(-?\d+)/);
    if (m) {
      const section = Number(m[1]);
      const entry = section < 0 ? NODE_PALETTE[7] : NODE_PALETTE[section % NODE_PALETTE.length];
      edge.style.stroke = entry.stroke;
      edge.style.strokeWidth = '2px';
      edge.style.opacity = '0.6';
      edge.style.fill = 'none';
    }
  }
}

/** Journey:依任務型別替圓點上色,笑臉維持不動。 */
function styleJourney(svg: Element, dark: boolean): void {
  // 任務方塊:亮色用實心淺色票(深字可讀);暗色改用半透明色票(CLUSTER_PALETTE,在深底是柔和深色塊),
  // 配下方強制亮字,避免「淺底+淺字」在暗色幾乎看不見。
  const taskPalette = dark ? CLUSTER_PALETTE : NODE_PALETTE;
  const tasks = Array.from(
    svg.querySelectorAll<SVGElement>('circle[class*="task-type"], rect[class*="task-type"]'),
  );
  tasks.forEach((shape) => {
    const m = (shape.getAttribute('class') ?? '').match(/task-type-(\d+)/);
    if (m) {
      const entry = taskPalette[Number(m[1]) % taskPalette.length];
      shape.style.fill = entry.fill;
      shape.style.stroke = entry.stroke;
    }
  });
  Array.from(svg.querySelectorAll<SVGElement>('rect[class*="section-type"]')).forEach((rect) => {
    const m = (rect.getAttribute('class') ?? '').match(/section-type-(\d+)/);
    if (m) {
      const entry = CLUSTER_PALETTE[Number(m[1]) % CLUSTER_PALETTE.length];
      rect.style.fill = entry.fill;
      rect.style.stroke = entry.stroke;
    }
  });
  if (dark) {
    Array.from(svg.querySelectorAll<SVGElement>('text')).forEach((t) => {
      t.style.fill = '#E2E8F0';
    });
  }
}

function styleXychart(svg: Element): void {
  // xychart-beta:每個 bar-plot-N 是一個資料系列;mermaid 預設長條填淺紫(#ECECFF)在白底幾乎
  // 看不見 → 給每個系列一個鮮明色(系列內同色=標準長條圖),折線系列上鮮明描邊。
  const barSeries = Array.from(svg.querySelectorAll<SVGElement>('g[class*="bar-plot-"]'));
  barSeries.forEach((g, i) => {
    const c = PIE_PALETTE[i % PIE_PALETTE.length];
    Array.from(g.querySelectorAll<SVGElement>('rect')).forEach((rect) => {
      rect.style.fill = c;
      rect.setAttribute('rx', '2');
      rect.setAttribute('ry', '2');
    });
  });
  Array.from(svg.querySelectorAll<SVGElement>('g[class*="line-plot-"]')).forEach((g, i) => {
    const c = PIE_PALETTE[(barSeries.length + i) % PIE_PALETTE.length];
    Array.from(g.querySelectorAll<SVGElement>('path')).forEach((p) => {
      p.style.stroke = c;
      p.style.strokeWidth = '2.5px';
      p.style.fill = 'none';
    });
  });
}

function styleQuadrant(svg: Element, dark: boolean): void {
  // 4 個象限底色:mermaid 預設給幾乎一樣的淺紫(#ECECFF/#f1f1ff/#f6f6ff/#fbfbff)難以區分 →
  // 換成 4 個柔和但可辨識的分區色(對標付費優先級矩陣)。暗色用半透明深色疊加,亮色用淺色票。
  // 比對那幾個固定底色,改不到就略過。
  const QUAD_TINTS = dark
    ? ['rgba(59,130,246,0.20)', 'rgba(34,197,94,0.20)', 'rgba(234,179,8,0.20)', 'rgba(239,68,68,0.20)']
    : ['#EFF6FF', '#ECFDF5', '#FEFCE8', '#FEF2F2'];
  const palePat = /^#(ececff|f1f1ff|f6f6ff|fbfbff)$/i;
  Array.from(svg.querySelectorAll<SVGElement>('rect'))
    .filter((r) => palePat.test((r.style.fill || r.getAttribute('fill') || '').trim()))
    .slice(0, 4)
    .forEach((r, i) => {
      r.style.fill = QUAD_TINTS[i % QUAD_TINTS.length];
    });
  // 資料點:colorful 主題下點的 fill 被算成 hsl(...NaN%) 而失效(變黑小點)→ 給鮮明色 + 描邊 + 放大。
  Array.from(svg.querySelectorAll<SVGElement>('circle')).forEach((c, i) => {
    c.style.fill = PIE_PALETTE[i % PIE_PALETTE.length];
    c.style.stroke = dark ? '#0F172A' : '#FFFFFF';
    c.style.strokeWidth = '1.5px';
    if (Number(c.getAttribute('r') ?? '0') < 7) {
      c.setAttribute('r', '7');
    }
  });
  // 暗色:象限標題 / 軸標籤 / 點標籤確保亮色,在深底可讀(mermaid 有時留深字)。
  if (dark) {
    Array.from(svg.querySelectorAll<SVGElement>('text')).forEach((t) => {
      t.style.fill = '#E2E8F0';
    });
  }
}

/**
 * 字體清晰度:對「任何主題」渲染出的圖加重文字字重,小字與縮圖也讀得清楚。
 * 只動 font-weight(不改色),故對原生 neutral/forest/dark 主題也安全,不會打架。
 */
export function boostLegibility(root: ParentNode): void {
  const svg = resolveSvg(root);
  if (!svg) {
    return;
  }
  // 節點 / 心智圖 / 時間軸 / actor 標籤:semibold(標題交給各 styler 設更重的 700,
  // 這裡不碰,以免把 colorful 已設好的 700 標題壓回 600)。
  for (const el of Array.from(
    svg.querySelectorAll<SVGElement>(
      'g.node text, g.node tspan, g.mindmap-node text, g[class*="timeline-node"] text, text.actor',
    ),
  )) {
    el.style.fontWeight = '600';
  }
  for (const el of Array.from(svg.querySelectorAll<HTMLElement>('.nodeLabel, g.node span, g.node p'))) {
    el.style.fontWeight = '600';
  }
  // 其餘文字(邊標籤 / 訊息 / 圖例 / 軸…)至少 medium,整體提升可讀性。
  for (const el of Array.from(svg.querySelectorAll<SVGElement>('text'))) {
    if (!el.style.fontWeight) {
      el.style.fontWeight = '500';
    }
  }
}

/** 在已渲染的 mermaid SVG 上套用 Colorful 樣式(就地修改 DOM)。 */
export function colorizeDiagram(root: ParentNode, opts: ColorizeOptions = {}): void {
  const svg = resolveSvg(root);
  if (!svg) {
    return;
  }
  ensureShadowFilter(svg);
  const dark = opts.dark === true;

  // flowchart / state / class / ER 節點(每個節點依序輪用調色盤)
  Array.from(svg.querySelectorAll<SVGGElement>('g.node')).forEach((node, i) => {
    paintShapes(node, NODE_PALETTE[i % NODE_PALETTE.length]);
    darkenNodeText(node);
  });

  // flowchart subgraph(叢集):濃淡分明的底色 + 飽和邊框 + 同色粗體標題,水道一眼可辨。
  Array.from(svg.querySelectorAll<SVGGElement>('g.cluster')).forEach((cluster, i) => {
    const entry = CLUSTER_PALETTE[i % CLUSTER_PALETTE.length];
    for (const rect of Array.from(cluster.querySelectorAll<SVGElement>(':scope > rect'))) {
      rect.style.fill = entry.fill;
      rect.style.stroke = entry.stroke;
      rect.style.strokeWidth = '1.5px';
      roundRect(rect, 10);
    }
    // 標題在 g.cluster-label 內,可能是 HTML label(live)或 <text>(htmlLabels:false 匯出)— 兩種都上色 + 加粗。
    const label = cluster.querySelector(':scope > .cluster-label');
    if (label) {
      for (const el of Array.from(label.querySelectorAll<SVGTextElement>('text, tspan'))) {
        el.style.fill = entry.stroke;
        el.style.fontWeight = '700';
      }
      for (const el of Array.from(label.querySelectorAll<HTMLElement>('.nodeLabel, span, p'))) {
        el.style.color = entry.stroke;
        el.style.fontWeight = '700';
      }
      for (const lr of Array.from(label.querySelectorAll<SVGElement>('rect'))) {
        lr.style.fill = entry.fill;
      }
    }
  });

  colorizeLegacyEr(svg);
  colorizeSequence(svg, dark);
  styleEdges(svg, dark);
  styleEdgeLabels(svg);
  styleLabelText(svg, dark);

  // 依 aria-roledescription 分派各圖型專屬上色;未知型別自動略過,每個 styler 零命中即早退,
  // 故 mermaid 的 DOM 變動永遠不會讓渲染中斷。
  const kind = svg.getAttribute('aria-roledescription') ?? '';
  if (kind === 'pie' || kind === 'pieChart') {
    stylePie(svg, dark);
  } else if (kind === 'gantt') {
    styleGantt(svg, dark);
  } else if (kind === 'timeline') {
    styleTimeline(svg, dark);
  } else if (kind === 'mindmap') {
    styleMindmap(svg, dark);
  } else if (kind === 'journey') {
    styleJourney(svg, dark);
  } else if (kind === 'xychart') {
    styleXychart(svg);
  } else if (kind === 'quadrantChart') {
    styleQuadrant(svg, dark);
  }
}
