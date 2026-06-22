// 編輯器自管視口(不用 svg-pan-zoom,避免它攔截拖曳與編輯互動衝突)。
// 在一個 <g class="rsm-viewport"> 上維護 transform = translate(panX,panY) scale(zoom)。
// 提供 screen↔world 換算、zoom-to-cursor、fit/reset。

import type { Point } from '../scene/types';
import type { Rect } from '../scene/geometry';
import { svgEl } from '../render/dom';

export interface ViewportOptions {
  minZoom?: number;
  maxZoom?: number;
  onChange?: () => void;
}

export class Viewport {
  readonly group: SVGGElement;
  private panX = 0;
  private panY = 0;
  private zoom = 1;
  private minZoom: number;
  private maxZoom: number;
  private onChange?: () => void;

  constructor(private svg: SVGSVGElement, opts: ViewportOptions = {}) {
    this.minZoom = opts.minZoom ?? 0.1;
    this.maxZoom = opts.maxZoom ?? 8;
    this.onChange = opts.onChange;
    this.group = svgEl('g', { class: 'rsm-viewport' });
    // 建構期間只設 transform,不觸發 onChange:呼叫端的 onChange 閉包可能尚未能引用
    // 本實例(const viewport = new Viewport({ onChange: () => viewport... }))→ 避免 TDZ。
    this.setTransform();
  }

  private setTransform(): void {
    this.group.setAttribute('transform', `translate(${this.panX},${this.panY}) scale(${this.zoom})`);
  }

  private apply(): void {
    this.setTransform();
    this.onChange?.();
  }

  getZoom(): number {
    return this.zoom;
  }

  /** 容器(svg)左上角為原點的螢幕座標。 */
  private clientToContainer(clientX: number, clientY: number): Point {
    const rect = this.svg.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  screenToWorld(clientX: number, clientY: number): Point {
    const c = this.clientToContainer(clientX, clientY);
    return { x: (c.x - this.panX) / this.zoom, y: (c.y - this.panY) / this.zoom };
  }

  worldToScreen(p: Point): Point {
    return { x: p.x * this.zoom + this.panX, y: p.y * this.zoom + this.panY };
  }

  panBy(dxScreen: number, dyScreen: number): void {
    this.panX += dxScreen;
    this.panY += dyScreen;
    this.apply();
  }

  /** 以游標為錨點縮放(factor>1 放大);錨點世界座標維持在原螢幕位置。 */
  zoomAtClient(factor: number, clientX: number, clientY: number): void {
    const next = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom * factor));
    if (next === this.zoom) return;
    const c = this.clientToContainer(clientX, clientY);
    // 維持錨點:world = (c - pan)/zoom 不變 → pan' = c - world*next
    const worldX = (c.x - this.panX) / this.zoom;
    const worldY = (c.y - this.panY) / this.zoom;
    this.zoom = next;
    this.panX = c.x - worldX * this.zoom;
    this.panY = c.y - worldY * this.zoom;
    this.apply();
  }

  zoomBy(factor: number): void {
    const rect = this.svg.getBoundingClientRect();
    this.zoomAtClient(factor, rect.left + rect.width / 2, rect.top + rect.height / 2);
  }

  setZoom(z: number): void {
    this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, z));
    this.apply();
  }

  /** 把內容外框置中且符合容器(留白 margin)。 */
  fit(content: Rect | null, margin = 48): void {
    const rect = this.svg.getBoundingClientRect();
    const vw = rect.width || 800;
    const vh = rect.height || 600;
    if (!content || content.w === 0 || content.h === 0) {
      this.zoom = 1;
      this.panX = vw / 2;
      this.panY = vh / 2;
      this.apply();
      return;
    }
    const z = Math.min((vw - margin * 2) / content.w, (vh - margin * 2) / content.h);
    this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, z));
    const cx = content.x + content.w / 2;
    const cy = content.y + content.h / 2;
    this.panX = vw / 2 - cx * this.zoom;
    this.panY = vh / 2 - cy * this.zoom;
    this.apply();
  }

  getZoomPercent(base = 1): number {
    return Math.round((this.zoom / base) * 100);
  }
}
