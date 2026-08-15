// 選取 / 控制點 / 框選 / 橡皮筋 / 吸附導引線疊層。畫在 renderer 的 overlayLayer(在 viewport 內)。
// 控制點尺寸除以 zoom → 螢幕上恆定大小。

import type { Rect } from '../scene/geometry';
import { PERIMETER_ANCHORS, sameAnchor } from '../scene/geometry';
import { svgEl, clearChildren } from '../render/dom';
import type { EdgeAnchor, Point } from '../scene/types';
import type { Guide } from './snap';

const ACCENT = '#2563eb';
const SNAP_COLOR = '#e64980';
const HANDLE_PX = 9;

export type ResizeDir = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
export type ConnSide = 'top' | 'right' | 'bottom' | 'left';

// 只用 4 角當縮放控制點;4 邊中點留給「連線控制點」,避免重疊衝突。
const RESIZE_DIRS: Array<{ dir: ResizeDir; fx: number; fy: number }> = [
  { dir: 'nw', fx: 0, fy: 0 },
  { dir: 'ne', fx: 1, fy: 0 },
  { dir: 'se', fx: 1, fy: 1 },
  { dir: 'sw', fx: 0, fy: 1 },
];

// 選取時:4 角已被縮放控制點占用,故連線點只放 4 邊中點(避免重疊衝突)。
// 滑過(未選取)時則用 geometry 的完整 8 點(PERIMETER_ANCHORS),含 4 角。
const CONN_SIDES: Array<{ side: ConnSide; fx: number; fy: number }> = [
  { side: 'top', fx: 0.5, fy: 0 },
  { side: 'right', fx: 1, fy: 0.5 },
  { side: 'bottom', fx: 0.5, fy: 1 },
  { side: 'left', fx: 0, fy: 0.5 },
];

export class Overlay {
  private selLayer: SVGGElement;
  private selEdgeLayer: SVGGElement;
  private hoverLayer: SVGGElement;
  private dropLayer: SVGGElement;
  private anchorLayer: SVGGElement;
  private guideLayer: SVGGElement;
  private transientLayer: SVGGElement;

  constructor(private layer: SVGGElement) {
    this.selEdgeLayer = svgEl('g', { class: 'rsm-ov-sel-edge' });
    this.hoverLayer = svgEl('g', { class: 'rsm-ov-hover' });
    this.dropLayer = svgEl('g', { class: 'rsm-ov-drop' });
    this.anchorLayer = svgEl('g', { class: 'rsm-ov-anchors' });
    this.selLayer = svgEl('g', { class: 'rsm-ov-sel' });
    this.guideLayer = svgEl('g', { class: 'rsm-ov-guides' });
    this.transientLayer = svgEl('g', { class: 'rsm-ov-transient' });
    layer.appendChild(this.guideLayer);
    layer.appendChild(this.dropLayer);
    layer.appendChild(this.selEdgeLayer);
    layer.appendChild(this.hoverLayer);
    layer.appendChild(this.selLayer);
    // anchorLayer 疊在最上層(transient 之下),拉線時的候選點要蓋過 drop 高亮框。
    layer.appendChild(this.anchorLayer);
    layer.appendChild(this.transientLayer);
  }

  /** 連線/重接時:把游標下的目標節點外框高亮(draw.io 式的可放置回饋)。 */
  showDropTarget(r: Rect | null, zoom: number): void {
    clearChildren(this.dropLayer);
    if (!r) return;
    const pad = 3 / zoom;
    const box = svgEl('rect', {
      x: r.x - pad,
      y: r.y - pad,
      width: r.w + pad * 2,
      height: r.h + pad * 2,
      fill: `${ACCENT}1f`,
      stroke: ACCENT,
      'stroke-width': 2 / zoom,
      rx: 4 / zoom,
    });
    box.style.pointerEvents = 'none';
    this.dropLayer.appendChild(box);
  }

  /**
   * 滑過「可以拖、但不是 node」的東西時的外框(目前用於 sequence 的訊息 / 筆記)。
   *
   * 沒有這層回饋,那些箭頭看起來就只是圖上的線 —— 使用者不會想到它抓得起來。
   * 畫在 hoverLayer,選取框在它上層,兩者同時出現也不打架。
   */
  showHoverRect(r: Rect, zoom: number): void {
    clearChildren(this.hoverLayer);
    const pad = 3 / zoom;
    const box = svgEl('rect', {
      x: r.x - pad,
      y: r.y - pad,
      width: r.w + pad * 2,
      height: r.h + pad * 2,
      fill: `${ACCENT}14`,
      stroke: ACCENT,
      'stroke-width': 1 / zoom,
      'stroke-dasharray': `${3 / zoom} ${2 / zoom}`,
      rx: 3 / zoom,
    });
    box.style.pointerEvents = 'none';
    this.hoverLayer.appendChild(box);
  }

  /**
   * 拖曳換序時的落點指示線。
   *
   * 刻意跟吸附導引線(showGuides 的細虛線)長得不一樣:那條是「你對齊到什麼」的參考,
   * 這條是「放手會發生什麼」的承諾 —— 是整個手勢裡最需要被看見的東西。實線、粗一點,
   * 兩端加短豎線把範圍圈出來,才不會在滿是箭頭的序列圖裡被看漏。
   */
  showInsertLine(x1: number, x2: number, y: number, zoom: number): void {
    clearChildren(this.guideLayer);
    const w = 2 / zoom;
    const cap = 5 / zoom;
    const add = (attrs: Record<string, string | number>): void => {
      const el = svgEl('line', { stroke: ACCENT, 'stroke-width': w, 'stroke-linecap': 'round', ...attrs });
      el.style.pointerEvents = 'none';
      this.guideLayer.appendChild(el);
    };
    add({ x1, y1: y, x2, y2: y });
    add({ x1, y1: y - cap, x2: x1, y2: y + cap });
    add({ x1: x2, y1: y - cap, x2, y2: y + cap });
  }

  /**
   * 滑過節點時顯示 8 個固定連線錨點(藍點:4 邊中點 + 4 角)→ 從某點拖出即可從該位置拉線
   * (draw.io 式,免先選取,直覺好發現)。每點帶 fx/fy 供拉線時記成 edge.sourceAnchor。
   */
  showHoverHandles(nodeId: string, r: Rect, zoom: number): void {
    clearChildren(this.hoverLayer);
    const hs = HANDLE_PX / zoom;
    for (const a of PERIMETER_ANCHORS) {
      const dot = svgEl('circle', {
        cx: r.x + r.w * a.fx,
        cy: r.y + r.h * a.fy,
        r: hs * 0.55,
        fill: '#fff',
        stroke: ACCENT,
        'stroke-width': 1.5 / zoom,
        'data-conn-handle': '1',
        'data-conn-node': nodeId,
        'data-conn-fx': String(a.fx),
        'data-conn-fy': String(a.fy),
      });
      dot.style.cursor = 'crosshair';
      this.hoverLayer.appendChild(dot);
    }
  }

  clearHover(): void {
    clearChildren(this.hoverLayer);
  }

  /**
   * 拉線 / 重接時,在目標節點上畫出 8 個候選錨點;`highlight` 為目前吸附中的點(放大實心)。
   * 讓使用者明確看到「會接到哪個位置」(draw.io 式)。r=null → 清除。
   */
  showAnchorPoints(r: Rect | null, zoom: number, highlight: EdgeAnchor | null): void {
    clearChildren(this.anchorLayer);
    if (!r) return;
    const hs = HANDLE_PX / zoom;
    for (const a of PERIMETER_ANCHORS) {
      const hi = highlight ? sameAnchor(a, highlight) : false;
      const dot = svgEl('circle', {
        cx: r.x + r.w * a.fx,
        cy: r.y + r.h * a.fy,
        r: (hi ? 0.95 : 0.5) * hs,
        fill: hi ? ACCENT : '#fff',
        stroke: ACCENT,
        'stroke-width': 1.5 / zoom,
      });
      dot.style.pointerEvents = 'none';
      this.anchorLayer.appendChild(dot);
    }
  }

  clearAnchorPoints(): void {
    clearChildren(this.anchorLayer);
  }

  /** 選取的連線:沿路徑畫半透明粗描邊(accent)當高亮 + 兩端可拖曳端點(重新接線)。 */
  showEdges(paths: Point[][], zoom: number): void {
    clearChildren(this.selEdgeLayer);
    const hs = HANDLE_PX / zoom;
    for (const pts of paths) {
      if (pts.length < 2) continue;
      const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join(' ');
      const hl = svgEl('path', {
        d,
        fill: 'none',
        stroke: ACCENT,
        'stroke-width': 8 / zoom,
        'stroke-opacity': 0.4,
      });
      hl.setAttribute('stroke-linecap', 'round');
      hl.setAttribute('stroke-linejoin', 'round');
      hl.style.pointerEvents = 'none';
      this.selEdgeLayer.appendChild(hl);
      // 兩端端點(可拖曳重新接線的視覺提示)。
      for (const ep of [pts[0], pts[pts.length - 1]]) {
        const dot = svgEl('circle', {
          cx: ep.x,
          cy: ep.y,
          r: hs * 0.62,
          fill: '#fff',
          stroke: ACCENT,
          'stroke-width': 1.5 / zoom,
        });
        dot.style.pointerEvents = 'none';
        this.selEdgeLayer.appendChild(dot);
      }
    }
  }

  /** 畫選取外框 + 控制點。單選時含 8 resize + 4 連線控制點。 */
  showSelection(rects: Array<{ id: string; rect: Rect }>, zoom: number, opts: { handles: boolean }): void {
    clearChildren(this.selLayer);
    const hs = HANDLE_PX / zoom;
    for (const { rect: r } of rects) {
      const outline = svgEl('rect', {
        x: r.x - 2 / zoom,
        y: r.y - 2 / zoom,
        width: r.w + 4 / zoom,
        height: r.h + 4 / zoom,
        fill: 'none',
        stroke: ACCENT,
        'stroke-width': 1.5 / zoom,
        rx: 3 / zoom,
      });
      outline.style.pointerEvents = 'none';
      this.selLayer.appendChild(outline);
    }
    if (!opts.handles || rects.length !== 1) return;
    const r = rects[0].rect;
    const nodeId = rects[0].id;
    // 連線控制點(圓)。4 角被縮放控制點占用 → 選取時只放 4 邊中點;各帶 fx/fy 供設 sourceAnchor。
    for (const c of CONN_SIDES) {
      const cx = r.x + r.w * c.fx;
      const cy = r.y + r.h * c.fy;
      const dot = svgEl('circle', {
        cx,
        cy,
        r: hs * 0.6,
        fill: '#fff',
        stroke: ACCENT,
        'stroke-width': 1.5 / zoom,
        'data-conn-handle': c.side,
        'data-conn-node': nodeId,
        'data-conn-fx': String(c.fx),
        'data-conn-fy': String(c.fy),
      });
      dot.style.cursor = 'crosshair';
      this.selLayer.appendChild(dot);
    }
    // resize 控制點(方)。
    for (const h of RESIZE_DIRS) {
      const cx = r.x + r.w * h.fx;
      const cy = r.y + r.h * h.fy;
      const box = svgEl('rect', {
        x: cx - hs / 2,
        y: cy - hs / 2,
        width: hs,
        height: hs,
        fill: '#fff',
        stroke: ACCENT,
        'stroke-width': 1.5 / zoom,
        'data-resize': h.dir,
        'data-resize-node': nodeId,
      });
      box.style.cursor = `${h.dir}-resize`;
      this.selLayer.appendChild(box);
    }
  }

  clearSelection(): void {
    clearChildren(this.selLayer);
  }

  showGuides(guides: Guide[], zoom: number): void {
    clearChildren(this.guideLayer);
    for (const g of guides) {
      const line = svgEl('line', {
        x1: g.x1,
        y1: g.y1,
        x2: g.x2,
        y2: g.y2,
        stroke: SNAP_COLOR,
        'stroke-width': 1 / zoom,
        'stroke-dasharray': `${4 / zoom} ${3 / zoom}`,
      });
      line.style.pointerEvents = 'none';
      this.guideLayer.appendChild(line);
    }
  }

  clearGuides(): void {
    clearChildren(this.guideLayer);
  }

  showMarquee(a: Point, b: Point, zoom: number): void {
    clearChildren(this.transientLayer);
    const rect = svgEl('rect', {
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      width: Math.abs(a.x - b.x),
      height: Math.abs(a.y - b.y),
      fill: `${ACCENT}1a`,
      stroke: ACCENT,
      'stroke-width': 1 / zoom,
      'stroke-dasharray': `${4 / zoom} ${2 / zoom}`,
    });
    rect.style.pointerEvents = 'none';
    this.transientLayer.appendChild(rect);
  }

  showRubberBand(from: Point, to: Point, zoom: number): void {
    clearChildren(this.transientLayer);
    const line = svgEl('line', {
      x1: from.x,
      y1: from.y,
      x2: to.x,
      y2: to.y,
      stroke: ACCENT,
      'stroke-width': 1.8 / zoom,
      'stroke-dasharray': `${5 / zoom} ${4 / zoom}`,
    });
    line.style.pointerEvents = 'none';
    this.transientLayer.appendChild(line);
    const dot = svgEl('circle', { cx: to.x, cy: to.y, r: 4 / zoom, fill: ACCENT });
    dot.style.pointerEvents = 'none';
    this.transientLayer.appendChild(dot);
  }

  clearTransient(): void {
    clearChildren(this.transientLayer);
  }
}
