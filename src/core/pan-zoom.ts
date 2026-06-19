// svg-pan-zoom 的薄控制器:封裝縮放 / 符合視窗 / 實際大小 / pan-to-element,
// 並維護 baseZoom(fit 後的初始縮放)以換算顯示百分比。

import type { PanZoomInstance, SvgPanZoomFactory } from '../types';

export interface PanZoomView {
  zoom: number;
  pan: { x: number; y: number };
}

export interface PanZoomController {
  zoomIn(): void;
  zoomOut(): void;
  fit(): void; // 符合寬度(viewer 的 'w' 行為)
  reset(): void; // resize + fit + center(viewer 的 '0' 行為)
  actualSize(): void; // 回到 baseZoom(viewer 的 '1' 行為)
  getZoomPercent(): number;
  panToElement(el: Element): void;
  capture(): PanZoomView | null;
  restore(view: PanZoomView): void;
  destroy(): void;
}

export interface AttachPanZoomOptions {
  minZoom?: number;
  maxZoom?: number;
  zoomScaleSensitivity?: number;
  onZoom?: () => void;
}

export function attachPanZoom(
  svg: SVGSVGElement,
  factory: SvgPanZoomFactory,
  opts: AttachPanZoomOptions = {},
): PanZoomController {
  let baseZoom = 1;

  const pz: PanZoomInstance = factory(svg, {
    zoomEnabled: true,
    panEnabled: true,
    controlIconsEnabled: false,
    dblClickZoomEnabled: false,
    fit: true,
    center: true,
    minZoom: opts.minZoom ?? 0.05,
    maxZoom: opts.maxZoom ?? 40,
    zoomScaleSensitivity: opts.zoomScaleSensitivity ?? 0.25,
    onZoom: () => opts.onZoom?.(),
  });
  baseZoom = pz.getZoom() || 1;

  const controller: PanZoomController = {
    zoomIn: () => pz.zoomBy(1.25),
    zoomOut: () => pz.zoomBy(0.8),
    getZoomPercent: () => Math.round((pz.getZoom() / (baseZoom || 1)) * 100),
    actualSize: () => pz.zoom(baseZoom),
    reset: () => {
      pz.resize();
      pz.fit();
      pz.center();
      baseZoom = pz.getZoom() || 1;
      opts.onZoom?.();
    },
    fit: () => {
      const sizes = pz.getSizes();
      const targetReal = (sizes.width - 48) / sizes.viewBox.width;
      pz.zoomBy(targetReal / sizes.realZoom);
      opts.onZoom?.();
    },
    panToElement: (el: Element) => {
      const vp = svg.querySelector<SVGGElement>('.svg-pan-zoom_viewport');
      const g = el as SVGGraphicsElement;
      if (!vp || typeof g.getBBox !== 'function') {
        return;
      }
      const vpCtm = vp.getCTM();
      const elCtm = g.getCTM();
      if (!vpCtm || !elCtm) {
        return;
      }
      let bb: DOMRect;
      try {
        bb = g.getBBox();
      } catch {
        return;
      }
      // 元素本地座標 → viewBox 座標;螢幕 = viewBox * realZoom + pan
      const m = vpCtm.inverse().multiply(elCtm);
      const c = new DOMPoint(bb.x + bb.width / 2, bb.y + bb.height / 2).matrixTransform(m);
      const sizes = pz.getSizes();
      pz.pan({
        x: sizes.width / 2 - c.x * sizes.realZoom,
        y: sizes.height / 2 - c.y * sizes.realZoom,
      });
    },
    capture: () => {
      try {
        return { zoom: pz.getZoom(), pan: pz.getPan() };
      } catch {
        return null;
      }
    },
    restore: (view: PanZoomView) => {
      pz.zoom(view.zoom);
      pz.pan(view.pan);
    },
    destroy: () => {
      try {
        pz.destroy();
      } catch {
        // SVG 可能已被覆寫而移除,忽略 destroy 失敗。
      }
    },
  };

  return controller;
}
