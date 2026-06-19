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

const CLUSTER_PALETTE: PaletteEntry[] = [
  { fill: 'rgba(59, 130, 246, 0.07)', stroke: '#93C5FD' },
  { fill: 'rgba(34, 197, 94, 0.07)', stroke: '#86EFAC' },
  { fill: 'rgba(249, 115, 22, 0.07)', stroke: '#FDBA74' },
  { fill: 'rgba(168, 85, 247, 0.07)', stroke: '#D8B4FE' },
  { fill: 'rgba(6, 182, 212, 0.07)', stroke: '#67E8F9' },
  { fill: 'rgba(239, 68, 68, 0.07)', stroke: '#FCA5A5' },
];

const NODE_TEXT = '#1F2937';
const SHADOW_FILTER_ID = 'rsm-soft-shadow';
const SVG_NS = 'http://www.w3.org/2000/svg';

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

function darkenNodeText(group: Element): void {
  // 底色為淺色 pastel,節點文字在深淺色主題下都必須是深色才看得清楚。
  for (const el of Array.from(group.querySelectorAll<SVGTextElement>('text, tspan'))) {
    el.style.fill = NODE_TEXT;
  }
  for (const el of Array.from(group.querySelectorAll<HTMLElement>('.nodeLabel, span, p'))) {
    el.style.color = NODE_TEXT;
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

/** 在已渲染的 mermaid SVG 上套用 Colorful 樣式(就地修改 DOM)。 */
export function colorizeDiagram(root: ParentNode, opts: ColorizeOptions = {}): void {
  const svg =
    root instanceof Element && root.tagName.toLowerCase() === 'svg' ? root : root.querySelector('svg');
  if (!svg) {
    return;
  }
  ensureShadowFilter(svg);

  // flowchart / state / class / ER 節點(每個節點依序輪用調色盤)
  Array.from(svg.querySelectorAll<SVGGElement>('g.node')).forEach((node, i) => {
    paintShapes(node, NODE_PALETTE[i % NODE_PALETTE.length]);
    darkenNodeText(node);
  });

  // flowchart subgraph(叢集)
  Array.from(svg.querySelectorAll<SVGGElement>('g.cluster')).forEach((cluster, i) => {
    const entry = CLUSTER_PALETTE[i % CLUSTER_PALETTE.length];
    for (const rect of Array.from(cluster.querySelectorAll<SVGElement>(':scope > rect'))) {
      rect.style.fill = entry.fill;
      rect.style.stroke = entry.stroke;
      rect.style.strokeWidth = '1.2px';
      roundRect(rect, 10);
    }
  });

  colorizeLegacyEr(svg);
  colorizeSequence(svg, opts.dark === true);
  styleEdges(svg, opts.dark === true);
  styleEdgeLabels(svg);
}
