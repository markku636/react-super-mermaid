// 連線繪製:plain <path> + 正確掛載的箭頭 marker + 粗透明 hit path + label。
// 邊用平滑曲線(非 rough)以確保箭頭端點對齊;節點才是手繪主視覺。

import type { ArrowHead, EditorScene, Point, SceneEdge } from '../scene/types';
import { getNode, resolveEdgeAnchors } from '../scene/scene-ops';
import { svgEl, XHTML_NS } from './dom';
import { INK, INK_DARK } from './palette';

export function markerIdFor(head: ArrowHead, dark: boolean): string | null {
  if (head === 'none' || head === 'open') return null;
  return `rsm-mk-${head}${dark ? '-d' : ''}`;
}

/** 建立箭頭 marker 定義(掛進 defs)。 */
export function buildMarkers(dark: boolean): SVGMarkerElement[] {
  const ink = dark ? INK_DARK : INK;
  // hollow marker 內填底色,避免連線從中穿過(近似畫布底色)。
  const bg = dark ? '#23232e' : '#ffffff';
  // 各 head 的 marker box 尺寸 / 參考點(tip 對齊節點邊界)。
  const specs: Record<string, { vb: string; refX: number; refY: number; w: number; h: number }> = {
    arrow: { vb: '0 0 12 12', refX: 10, refY: 6, w: 9, h: 9 },
    dot: { vb: '0 0 12 12', refX: 6, refY: 6, w: 9, h: 9 },
    cross: { vb: '0 0 12 12', refX: 6, refY: 6, w: 9, h: 9 },
    triangle: { vb: '0 0 16 16', refX: 15, refY: 8, w: 15, h: 15 },
    diamond: { vb: '0 0 20 16', refX: 19, refY: 8, w: 18, h: 14 },
    diamondFilled: { vb: '0 0 20 16', refX: 19, refY: 8, w: 18, h: 14 },
  };
  const heads: ArrowHead[] = ['arrow', 'dot', 'cross', 'triangle', 'diamond', 'diamondFilled'];
  return heads.map((head) => {
    const sp = specs[head];
    const m = svgEl('marker', {
      id: markerIdFor(head, dark) as string,
      viewBox: sp.vb,
      refX: sp.refX,
      refY: sp.refY,
      markerWidth: sp.w,
      markerHeight: sp.h,
      orient: 'auto-start-reverse',
    });
    if (head === 'arrow') {
      m.appendChild(svgEl('path', { d: 'M1,1 L11,6 L1,11 z', fill: ink, stroke: ink }));
    } else if (head === 'dot') {
      m.appendChild(svgEl('circle', { cx: 6, cy: 6, r: 4, fill: ink }));
    } else if (head === 'cross') {
      m.appendChild(svgEl('path', { d: 'M2,2 L10,10 M10,2 L2,10', stroke: ink, 'stroke-width': 1.8, fill: 'none' }));
    } else if (head === 'triangle') {
      // 空心三角(繼承 / 實作):尖端朝節點。
      m.appendChild(svgEl('path', { d: 'M1,1 L15,8 L1,15 z', fill: bg, stroke: ink, 'stroke-width': 1.3, 'stroke-linejoin': 'round' }));
    } else {
      // 菱形(聚合空心 / 組合實心):近端頂點觸及節點。
      const fill = head === 'diamondFilled' ? ink : bg;
      m.appendChild(svgEl('path', { d: 'M19,8 L10,2 L1,8 L10,14 z', fill, stroke: ink, 'stroke-width': 1.3, 'stroke-linejoin': 'round' }));
    }
    return m;
  });
}

/**
 * ER 基數記號(crow's foot):於實體邊界端依基數畫「內層(基數:一=短橫 / 多=鳥足)+
 * 外層(模態:強制=短橫 / 可選=圓圈)」。p=實體邊界點,u=沿線往外的單位向量。
 */
function drawErCardinality(
  g: SVGGElement,
  p: Point,
  u: Point,
  card: 'zeroOrOne' | 'onlyOne' | 'zeroOrMore' | 'oneOrMore',
  ink: string,
  dark: boolean,
): void {
  const bg = dark ? '#23232e' : '#ffffff';
  const vx = -u.y;
  const vy = u.x; // 垂直單位向量
  const at = (d: number): Point => ({ x: p.x + u.x * d, y: p.y + u.y * d });
  const tick = (d: number, h: number): string => {
    const c = at(d);
    return `M${c.x + vx * h},${c.y + vy * h} L${c.x - vx * h},${c.y - vy * h}`;
  };
  const stroke = (d: string): void => {
    g.appendChild(svgEl('path', { d, stroke: ink, 'stroke-width': 1.4, fill: 'none', 'stroke-linecap': 'round' }));
  };
  const isMany = card === 'zeroOrMore' || card === 'oneOrMore';
  const isOptional = card === 'zeroOrOne' || card === 'zeroOrMore';
  // 內層基數
  if (isMany) {
    const tip = at(15);
    const b = at(0);
    const bp = { x: b.x + vx * 7, y: b.y + vy * 7 };
    const bm = { x: b.x - vx * 7, y: b.y - vy * 7 };
    stroke(`M${tip.x},${tip.y} L${bp.x},${bp.y} M${tip.x},${tip.y} L${b.x},${b.y} M${tip.x},${tip.y} L${bm.x},${bm.y}`);
  } else {
    stroke(tick(11, 7));
  }
  // 外層模態
  if (isOptional) {
    const c = at(22);
    g.appendChild(svgEl('circle', { cx: c.x, cy: c.y, r: 5, fill: bg, stroke: ink, 'stroke-width': 1.4 }));
  } else {
    stroke(tick(19, 7));
  }
}

function unit(from: Point, to: Point): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: dx / len, y: dy / len };
}

function pathThrough(points: Point[]): string {
  if (points.length < 2) return '';
  const [first, ...rest] = points;
  let d = `M${first.x},${first.y}`;
  for (const p of rest) d += ` L${p.x},${p.y}`;
  return d;
}

function midpoint(points: Point[]): Point {
  if (points.length === 0) return { x: 0, y: 0 };
  const i = Math.floor((points.length - 1) / 2);
  const a = points[i];
  const b = points[Math.min(i + 1, points.length - 1)];
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/**
 * 平行邊(同一對節點之間多條 / 雙向)彼此外凸避免重疊:回傳一個垂直位移後的中點。
 * 單一邊(絕大多數)回 null → 維持原本兩點直線,零影響。
 */
function parallelMid(scene: EditorScene, edge: SceneEdge, start: Point, end: Point): Point | null {
  const a = edge.source < edge.target ? edge.source : edge.target;
  const b = edge.source < edge.target ? edge.target : edge.source;
  const sibs = scene.edges.filter((e) => {
    const x = e.source < e.target ? e.source : e.target;
    const y = e.source < e.target ? e.target : e.source;
    return x === a && y === b;
  });
  if (sibs.length <= 1) return null;
  const idx = sibs.findIndex((e) => e.id === edge.id);
  const offset = (idx - (sibs.length - 1) / 2) * 22;
  if (offset === 0) return null;
  // 用「規範方向」(小 id → 大 id)算垂直軸,確保同對的各邊往兩側分開。
  const na = getNode(scene, a);
  const nb = getNode(scene, b);
  if (!na || !nb) return null;
  const dx = nb.x + nb.w / 2 - (na.x + na.w / 2);
  const dy = nb.y + nb.h / 2 - (na.y + na.h / 2);
  const len = Math.hypot(dx, dy) || 1;
  const px = -dy / len;
  const py = dx / len;
  return { x: (start.x + end.x) / 2 + px * offset, y: (start.y + end.y) / 2 + py * offset };
}

/** 計算一條邊的折線點(start anchor → waypoints → end anchor)。 */
export function edgePoints(scene: EditorScene, edge: SceneEdge): Point[] | null {
  const anchors = resolveEdgeAnchors(scene, edge);
  if (!anchors) return null;
  if (edge.waypoints && edge.waypoints.length) return [anchors.start, ...edge.waypoints, anchors.end];
  const mid = parallelMid(scene, edge, anchors.start, anchors.end);
  return mid ? [anchors.start, mid, anchors.end] : [anchors.start, anchors.end];
}

/** 建立一條邊的 <g data-edge-id>(可見路徑 + hit path + label)。 */
export function renderEdge(scene: EditorScene, edge: SceneEdge, dark: boolean): SVGGElement {
  const ink = dark ? INK_DARK : INK;
  const g = svgEl('g', { 'data-edge-id': edge.id, class: 'rsm-edge' });
  const pts = edgePoints(scene, edge);
  const d = pts ? pathThrough(pts) : '';

  // 粗透明 hit path(讓細線好點選)。
  const hit = svgEl('path', { d, fill: 'none', stroke: 'transparent', 'stroke-width': 14, 'data-edge-hit': edge.id });
  hit.style.pointerEvents = 'stroke';
  hit.style.cursor = 'pointer';
  g.appendChild(hit);

  // 可見路徑。linkStyle 自訂色/寬(edge.style)優先於主題墨色與 lineKind 寬度。
  const customStroke = edge.style?.stroke;
  const strokeColor = customStroke || ink;
  const vis = svgEl('path', { d, fill: 'none', stroke: strokeColor });
  vis.setAttribute('stroke-linecap', 'round');
  vis.setAttribute('stroke-linejoin', 'round');
  vis.setAttribute('vector-effect', 'non-scaling-stroke');
  vis.style.pointerEvents = 'none';
  const widthByKind = edge.lineKind === 'thick' ? 3.4 : 1.8;
  vis.setAttribute('stroke-width', String(edge.style?.strokeWidth ?? widthByKind));
  if (edge.lineKind === 'dotted') vis.setAttribute('stroke-dasharray', '3 5');
  if (edge.lineKind === 'invisible') vis.setAttribute('stroke-opacity', '0');
  const startMk = markerIdFor(edge.arrowStart, dark);
  // 自訂色的箭頭:就地建一個同色 marker 讓箭頭與線同色(僅常見的實心箭頭)。
  if (customStroke && edge.arrowEnd === 'arrow') {
    const mid = `rsm-mk-arrow-${edge.id}`;
    const mk = svgEl('marker', {
      id: mid,
      viewBox: '0 0 12 12',
      refX: 10,
      refY: 6,
      markerWidth: 9,
      markerHeight: 9,
      orient: 'auto-start-reverse',
    });
    mk.appendChild(svgEl('path', { d: 'M1,1 L11,6 L1,11 z', fill: customStroke, stroke: customStroke }));
    g.appendChild(mk);
    vis.setAttribute('marker-end', `url(#${mid})`);
  } else {
    const endMk = markerIdFor(edge.arrowEnd, dark);
    if (endMk) vis.setAttribute('marker-end', `url(#${endMk})`);
  }
  if (startMk) vis.setAttribute('marker-start', `url(#${startMk})`);
  g.appendChild(vis);

  // ER 基數記號(crow's foot):兩端各依 cardStart / cardEnd 繪製。
  if (edge.data?.kind === 'er' && pts && pts.length >= 2) {
    const s = pts[0];
    const e = pts[pts.length - 1];
    if (edge.data.cardStart) drawErCardinality(g, s, unit(s, pts[1]), edge.data.cardStart, ink, dark);
    if (edge.data.cardEnd) drawErCardinality(g, e, unit(e, pts[pts.length - 2]), edge.data.cardEnd, ink, dark);
  }

  // label。
  if (edge.label && pts) {
    const mid = midpoint(pts);
    const fo = svgEl('foreignObject', { x: mid.x - 60, y: mid.y - 14, width: 120, height: 28, class: 'rsm-edge-label' });
    fo.style.pointerEvents = 'none';
    fo.style.overflow = 'visible';
    // 置中容器透明,膠囊底色由內層 span 包住文字(緊貼字寬,避免相鄰標籤底色連成一條寬帶)。
    const div = document.createElementNS(XHTML_NS, 'div') as unknown as HTMLDivElement;
    div.setAttribute('style', 'display:flex;align-items:center;justify-content:center;height:28px;');
    const span = document.createElementNS(XHTML_NS, 'span') as unknown as HTMLSpanElement;
    span.textContent = edge.label;
    // 膠囊底色隨主題(--rsm-edge-label-bg 淺/深),文字色也須隨主題,否則暗色=深字深底看不見。
    const labelInk = dark ? INK_DARK : INK;
    const labelBg = dark ? 'rgba(30,30,30,0.85)' : '#ffffffe6';
    span.setAttribute(
      'style',
      `font:600 13px/1.2 var(--rsm-editor-font);color:${labelInk};` +
        `background:var(--rsm-edge-label-bg,${labelBg});border-radius:4px;padding:1px 6px;white-space:nowrap;`,
    );
    div.appendChild(span as unknown as Node);
    fo.appendChild(div as unknown as Node);
    g.appendChild(fo);
  }
  return g;
}

/** 只更新既有邊 <g> 的幾何(端點移動時重繞,不重建)。 */
export function updateEdgeGeometry(g: SVGGElement, scene: EditorScene, edge: SceneEdge): void {
  const pts = edgePoints(scene, edge);
  const d = pts ? pathThrough(pts) : '';
  g.querySelectorAll('path').forEach((p) => p.setAttribute('d', d));
  const fo = g.querySelector('foreignObject');
  if (fo && pts) {
    const mid = midpoint(pts);
    fo.setAttribute('x', String(mid.x - 60));
    fo.setAttribute('y', String(mid.y - 14));
  }
}
