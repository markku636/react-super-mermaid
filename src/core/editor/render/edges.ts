// 連線繪製:plain <path> + 正確掛載的箭頭 marker + 粗透明 hit path + label。
// 邊用平滑曲線(非 rough)以確保箭頭端點對齊;節點才是手繪主視覺。

import { edgeAnchors } from '../scene/geometry';
import type { ArrowHead, EditorScene, Point, SceneEdge } from '../scene/types';
import { getNode } from '../scene/scene-ops';
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

/** 計算一條邊的折線點(start anchor → waypoints → end anchor)。 */
export function edgePoints(scene: EditorScene, edge: SceneEdge): Point[] | null {
  const anchors = edgeAnchors(edge, getNode(scene, edge.source), getNode(scene, edge.target));
  if (!anchors) return null;
  return [anchors.start, ...(edge.waypoints ?? []), anchors.end];
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

  // 可見路徑。
  const vis = svgEl('path', { d, fill: 'none', stroke: ink });
  vis.setAttribute('stroke-linecap', 'round');
  vis.setAttribute('stroke-linejoin', 'round');
  vis.setAttribute('vector-effect', 'non-scaling-stroke');
  vis.style.pointerEvents = 'none';
  const widthByKind = edge.lineKind === 'thick' ? 3.4 : 1.8;
  vis.setAttribute('stroke-width', String(widthByKind));
  if (edge.lineKind === 'dotted') vis.setAttribute('stroke-dasharray', '3 5');
  if (edge.lineKind === 'invisible') vis.setAttribute('stroke-opacity', '0');
  const endMk = markerIdFor(edge.arrowEnd, dark);
  const startMk = markerIdFor(edge.arrowStart, dark);
  if (endMk) vis.setAttribute('marker-end', `url(#${endMk})`);
  if (startMk) vis.setAttribute('marker-start', `url(#${startMk})`);
  g.appendChild(vis);

  // label。
  if (edge.label && pts) {
    const mid = midpoint(pts);
    const fo = svgEl('foreignObject', { x: mid.x - 60, y: mid.y - 14, width: 120, height: 28, class: 'rsm-edge-label' });
    fo.style.pointerEvents = 'none';
    fo.style.overflow = 'visible';
    // 置中容器透明,白底膠囊由內層 span 包住文字(緊貼字寬,避免相鄰標籤白底連成一條寬帶)。
    const div = document.createElementNS(XHTML_NS, 'div') as unknown as HTMLDivElement;
    div.setAttribute('style', 'display:flex;align-items:center;justify-content:center;height:28px;');
    const span = document.createElementNS(XHTML_NS, 'span') as unknown as HTMLSpanElement;
    span.textContent = edge.label;
    // 標籤底色一律淺(白底膠囊),故文字一律用深墨色(對齊 Edit Diagram,且修暗色模式下淺字白底看不清)。
    span.setAttribute(
      'style',
      `font:600 13px/1.2 var(--rsm-editor-font);color:${INK};` +
        'background:var(--rsm-edge-label-bg,#ffffffe6);border-radius:4px;padding:1px 6px;white-space:nowrap;',
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
