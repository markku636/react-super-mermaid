// 觸控手勢:雙指捏合縮放(pinch zoom)+ 雙指 / 單指拖曳平移。
// svg-pan-zoom 內建的 touch 事件只取 touches[0] 做單指平移、不支援捏合,
// 所以這裡用它的 customEventsHandler 介面:haltEventListeners 把內建 touch 監聽拔掉,
// 改由本 handler 接管全部觸控,直接呼叫 instance.zoomAtPointBy / panBy。零新相依。
//
// 單指平移是否生效交給 CSS touch-action 決定(見 styles.css.ts):
//   行內(touch-action: pan-y)→ 單指縱向給瀏覽器捲動頁面(touchmove 不可取消,本 handler 跳過);
//   全螢幕(touch-action: none)→ 單指可取消 → 接管成平移。
// 雙指手勢兩種情境都接管(pan-y 不含 pinch-zoom,故雙指 touchmove 可取消)。

import type { PanZoomInstance } from '../types';

interface CustomEventsHandlerInit {
  svgElement: SVGElement;
  instance: PanZoomInstance;
  eventsListenerElement?: EventTarget | null;
}

/** svg-pan-zoom customEventsHandler 介面(只列本套件用到的形狀)。 */
export interface SvgPanZoomCustomEventsHandler {
  haltEventListeners: string[];
  init: (opts: CustomEventsHandlerInit) => void;
  destroy: (opts: CustomEventsHandlerInit) => void;
}

const HALT = ['touchstart', 'touchend', 'touchmove', 'touchleave', 'touchcancel'];

export function createTouchGestureHandler(): SvgPanZoomCustomEventsHandler {
  let cleanup: (() => void) | null = null;

  return {
    haltEventListeners: HALT,
    init(opts: CustomEventsHandlerInit): void {
      const { svgElement, instance } = opts;
      const target: EventTarget = opts.eventsListenerElement ?? svgElement;

      let pinchDist = 0; // 上一幀兩指距離(0 = 非捏合中)
      let lastCenter: { x: number; y: number } | null = null; // 上一幀手勢中點(svg 內座標)
      let lastSingle: { x: number; y: number } | null = null; // 上一幀單指座標(svg 內座標)

      // client 座標 → svg 內座標(zoomAtPointBy 的錨點需用 svg 內相對座標)。
      const local = (clientX: number, clientY: number): { x: number; y: number } => {
        const rect = svgElement.getBoundingClientRect();
        return { x: clientX - rect.left, y: clientY - rect.top };
      };
      const midpoint = (a: Touch, b: Touch): { x: number; y: number } =>
        local((a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2);
      const distance = (a: Touch, b: Touch): number =>
        Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);

      const onStart = (e: TouchEvent): void => {
        if (e.touches.length === 2) {
          pinchDist = distance(e.touches[0], e.touches[1]);
          lastCenter = midpoint(e.touches[0], e.touches[1]);
          lastSingle = null;
          e.preventDefault();
        } else if (e.touches.length === 1) {
          lastSingle = local(e.touches[0].clientX, e.touches[0].clientY);
          pinchDist = 0;
          lastCenter = null;
        }
      };

      const onMove = (e: TouchEvent): void => {
        if (e.touches.length === 2) {
          // 雙指:捏合縮放 + 兩指中點拖曳平移。
          const dist = distance(e.touches[0], e.touches[1]);
          const center = midpoint(e.touches[0], e.touches[1]);
          if (pinchDist > 0 && dist > 0) {
            instance.zoomAtPointBy(dist / pinchDist, center);
          }
          if (lastCenter) {
            instance.panBy({ x: center.x - lastCenter.x, y: center.y - lastCenter.y });
          }
          pinchDist = dist;
          lastCenter = center;
          e.preventDefault();
        } else if (e.touches.length === 1 && lastSingle) {
          // 單指平移:只有事件可取消時才接管(行內縱向捲動 = 不可取消 → 讓頁面捲動)。
          if (!e.cancelable) {
            return;
          }
          const p = local(e.touches[0].clientX, e.touches[0].clientY);
          instance.panBy({ x: p.x - lastSingle.x, y: p.y - lastSingle.y });
          lastSingle = p;
          e.preventDefault();
        }
      };

      const onEnd = (e: TouchEvent): void => {
        if (e.touches.length < 2) {
          pinchDist = 0;
          lastCenter = null;
        }
        if (e.touches.length === 1) {
          // 從雙指放開到剩一指:重抓基準點,避免平移跳一下。
          lastSingle = local(e.touches[0].clientX, e.touches[0].clientY);
        } else if (e.touches.length === 0) {
          lastSingle = null;
        }
      };

      target.addEventListener('touchstart', onStart as EventListener, { passive: false });
      target.addEventListener('touchmove', onMove as EventListener, { passive: false });
      target.addEventListener('touchend', onEnd as EventListener);
      target.addEventListener('touchcancel', onEnd as EventListener);

      cleanup = (): void => {
        target.removeEventListener('touchstart', onStart as EventListener);
        target.removeEventListener('touchmove', onMove as EventListener);
        target.removeEventListener('touchend', onEnd as EventListener);
        target.removeEventListener('touchcancel', onEnd as EventListener);
      };
    },
    destroy(): void {
      cleanup?.();
      cleanup = null;
    },
  };
}
