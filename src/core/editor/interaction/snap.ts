// 吸附:格線 + 物件對齊(Excalidraw 式),回傳調整後位移與導引線。

import type { Rect } from '../scene/geometry';
import { boundingBox } from '../scene/geometry';

export const GRID = 8;

export interface Guide {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface SnapResult {
  dx: number;
  dy: number;
  guides: Guide[];
}

export function snapValueToGrid(v: number): number {
  return Math.round(v / GRID) * GRID;
}

/**
 * 給定移動中節點集合的原始矩形 + 靜止節點矩形,算出對齊吸附後的位移。
 * tol 為世界座標容差(由螢幕容差 ÷ zoom 換算)。
 */
export function computeSnap(
  movingRects: Rect[],
  staticRects: Rect[],
  dx: number,
  dy: number,
  tol: number,
): SnapResult {
  const bb = boundingBox(movingRects);
  if (!bb) return { dx, dy, guides: [] };
  const moved: Rect = { x: bb.x + dx, y: bb.y + dy, w: bb.w, h: bb.h };

  const guides: Guide[] = [];
  let adjX = dx;
  let adjY = dy;

  // 候選對齊位置(移動框的 left/centerX/right、top/centerY/bottom)。
  const movX = [moved.x, moved.x + moved.w / 2, moved.x + moved.w];
  const movY = [moved.y, moved.y + moved.h / 2, moved.y + moved.h];

  let bestX: { delta: number; line: number } | null = null;
  let bestY: { delta: number; line: number } | null = null;

  for (const s of staticRects) {
    const sX = [s.x, s.x + s.w / 2, s.x + s.w];
    const sY = [s.y, s.y + s.h / 2, s.y + s.h];
    for (const mx of movX) {
      for (const sx of sX) {
        const d = sx - mx;
        if (Math.abs(d) <= tol && (!bestX || Math.abs(d) < Math.abs(bestX.delta))) {
          bestX = { delta: d, line: sx };
        }
      }
    }
    for (const my of movY) {
      for (const sy of sY) {
        const d = sy - my;
        if (Math.abs(d) <= tol && (!bestY || Math.abs(d) < Math.abs(bestY.delta))) {
          bestY = { delta: d, line: sy };
        }
      }
    }
  }

  if (bestX) {
    adjX += bestX.delta;
    guides.push({ x1: bestX.line, y1: moved.y - 400, x2: bestX.line, y2: moved.y + moved.h + 400 });
  } else {
    adjX = snapValueToGrid(bb.x + dx) - bb.x;
  }
  if (bestY) {
    adjY += bestY.delta;
    guides.push({ x1: moved.x - 400, y1: bestY.line, x2: moved.x + moved.w + 400, y2: bestY.line });
  } else {
    adjY = snapValueToGrid(bb.y + dy) - bb.y;
  }

  return { dx: adjX, dy: adjY, guides };
}
