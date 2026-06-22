// 用 rough.js generator 把節點外形畫成 Drawable(本地座標 0..w, 0..h)。
// scene-renderer 再呼叫 gen.toPaths() 轉成 <path>。沒有原生方法的外形用 path 字串。

import type { NodeShape } from '../scene/types';

// rough generator 的最小型別介面(避免硬綁 roughjs 型別匯出路徑)。
export interface RoughOptionsLike {
  seed?: number;
  roughness?: number;
  bowing?: number;
  stroke?: string;
  strokeWidth?: number;
  fill?: string;
  fillStyle?: string;
  fillWeight?: number;
  hachureGap?: number;
  strokeLineDash?: number[];
}

export interface RoughGeneratorLike {
  rectangle(x: number, y: number, w: number, h: number, options?: RoughOptionsLike): unknown;
  ellipse(x: number, y: number, w: number, h: number, options?: RoughOptionsLike): unknown;
  circle(x: number, y: number, diameter: number, options?: RoughOptionsLike): unknown;
  polygon(points: Array<[number, number]>, options?: RoughOptionsLike): unknown;
  linearPath(points: Array<[number, number]>, options?: RoughOptionsLike): unknown;
  line(x1: number, y1: number, x2: number, y2: number, options?: RoughOptionsLike): unknown;
  path(d: string, options?: RoughOptionsLike): unknown;
  curve(points: Array<[number, number]>, options?: RoughOptionsLike): unknown;
  toPaths(drawable: unknown): RoughPathInfo[];
}

export interface RoughPathInfo {
  d: string;
  stroke: string;
  strokeWidth: number;
  fill?: string;
  fillStyle?: string;
}

function roundedRectPath(w: number, h: number, r: number): string {
  const rr = Math.min(r, w / 2, h / 2);
  return (
    `M${rr},0 L${w - rr},0 Q${w},0 ${w},${rr} ` +
    `L${w},${h - rr} Q${w},${h} ${w - rr},${h} ` +
    `L${rr},${h} Q0,${h} 0,${h - rr} ` +
    `L0,${rr} Q0,0 ${rr},0 Z`
  );
}

function stadiumPath(w: number, h: number): string {
  const r = h / 2;
  return `M${r},0 L${w - r},0 A${r},${r} 0 0 1 ${w - r},${h} L${r},${h} A${r},${r} 0 0 1 ${r},0 Z`;
}

/**
 * 給定外形與尺寸,回傳一組 rough Drawable(本地座標 0..w / 0..h)。
 * 多數外形回傳單一 Drawable;cylinder / subroutine / doubleCircle 回傳多個。
 */
export function buildNodeDrawables(
  gen: RoughGeneratorLike,
  shape: NodeShape,
  w: number,
  h: number,
  options: RoughOptionsLike,
): unknown[] {
  switch (shape) {
    case 'rounded':
      return [gen.path(roundedRectPath(w, h, 14), options)];
    case 'stadium':
      return [gen.path(stadiumPath(w, h), options)];
    case 'circle':
      return [gen.circle(w / 2, h / 2, Math.min(w, h), options)];
    case 'doubleCircle': {
      const d = Math.min(w, h);
      return [gen.circle(w / 2, h / 2, d, options), gen.circle(w / 2, h / 2, d - 10, { ...options, fill: undefined })];
    }
    case 'ellipse':
      return [gen.ellipse(w / 2, h / 2, w, h, options)];
    case 'diamond':
      return [gen.polygon([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]], options)];
    case 'hexagon': {
      const o = Math.min(w * 0.2, 22);
      return [gen.polygon([[o, 0], [w - o, 0], [w, h / 2], [w - o, h], [o, h], [0, h / 2]], options)];
    }
    case 'parallelogram': {
      const o = Math.min(w * 0.18, 22);
      return [gen.polygon([[o, 0], [w, 0], [w - o, h], [0, h]], options)];
    }
    case 'parallelogramAlt': {
      const o = Math.min(w * 0.18, 22);
      return [gen.polygon([[0, 0], [w - o, 0], [w, h], [o, h]], options)];
    }
    case 'trapezoid': {
      const o = Math.min(w * 0.18, 22);
      return [gen.polygon([[o, 0], [w - o, 0], [w, h], [0, h]], options)];
    }
    case 'trapezoidAlt': {
      const o = Math.min(w * 0.18, 22);
      return [gen.polygon([[0, 0], [w, 0], [w - o, h], [o, h]], options)];
    }
    case 'subroutine': {
      const inset = 8;
      return [
        gen.rectangle(0, 0, w, h, options),
        gen.line(inset, 0, inset, h, { ...options, fill: undefined }),
        gen.line(w - inset, 0, w - inset, h, { ...options, fill: undefined }),
      ];
    }
    case 'cylinder': {
      const ry = Math.min(h * 0.15, 12);
      const top = `M0,${ry} A${w / 2},${ry} 0 0 1 ${w},${ry} A${w / 2},${ry} 0 0 1 0,${ry} Z`;
      const body = `M0,${ry} L0,${h - ry} A${w / 2},${ry} 0 0 0 ${w},${h - ry} L${w},${ry}`;
      return [gen.path(body, options), gen.path(top, { ...options, fill: undefined })];
    }
    case 'odd': {
      const o = Math.min(w * 0.15, 18);
      return [gen.polygon([[0, 0], [w, 0], [w, h], [0, h], [o, h / 2]], options)];
    }
    case 'rectangle':
    default:
      return [gen.rectangle(0, 0, w, h, options)];
  }
}
