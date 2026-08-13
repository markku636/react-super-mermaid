// quadrantChart 的座標系:場景座標 ↔ 0..1 的資料值。
//
// 這張圖之所以特別適合「拖著畫」,是因為點的**位置就是它的值** —— 不像流程圖那樣位置只是排版。
// 所以場景不另存 x/y 值:節點的 x/y 就是唯一真相,序列化時再換算回 [0.xx, 0.yy]。
// 拖曳因此完全不必特別處理(cmdMoveNodes 改的 x/y 直接就是新值)。

import type { Point } from '../../scene/types';

/** 繪圖區(場景座標)。四邊留白給軸標籤,尺寸取 mermaid 預設 chartWidth/Height 的觀感。 */
export const PLOT = { x: 90, y: 70, w: 520, h: 520 } as const;

/** 點的命中方塊邊長(圓點本身只有 12px,太小不好抓)。 */
export const POINT_BOX = 26;

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** 0..1 值 → 場景座標(節點中心)。y 值 1 在上方,與圖表直覺一致。 */
export function valueToScene(qx: number, qy: number): Point {
  return { x: PLOT.x + clamp01(qx) * PLOT.w, y: PLOT.y + (1 - clamp01(qy)) * PLOT.h };
}

/** 場景座標(節點中心)→ 0..1 值,夾在繪圖區內。 */
export function sceneToValue(cx: number, cy: number): { qx: number; qy: number } {
  return {
    qx: clamp01((cx - PLOT.x) / PLOT.w),
    qy: clamp01(1 - (cy - PLOT.y) / PLOT.h),
  };
}

/** 四個象限在場景座標的矩形(索引 0..3 對應 mermaid 的 quadrant-1..4)。 */
export function quadrantRects(): Array<{ x: number; y: number; w: number; h: number }> {
  const hw = PLOT.w / 2;
  const hh = PLOT.h / 2;
  return [
    { x: PLOT.x + hw, y: PLOT.y, w: hw, h: hh }, // quadrant-1 右上
    { x: PLOT.x, y: PLOT.y, w: hw, h: hh }, // quadrant-2 左上
    { x: PLOT.x, y: PLOT.y + hh, w: hw, h: hh }, // quadrant-3 左下
    { x: PLOT.x + hw, y: PLOT.y + hh, w: hw, h: hh }, // quadrant-4 右下
  ];
}
