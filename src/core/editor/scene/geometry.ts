// 純幾何工具(零 DOM):bbox、命中測試、節點周界錨點。場景座標系。

import type { Point, SceneEdge, SceneNode } from './types';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function nodeRect(n: SceneNode): Rect {
  return { x: n.x, y: n.y, w: n.w, h: n.h };
}

export function rectCenter(r: Rect): Point {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

export function pointInRect(p: Point, r: Rect, pad = 0): boolean {
  return p.x >= r.x - pad && p.x <= r.x + r.w + pad && p.y >= r.y - pad && p.y <= r.y + r.h + pad;
}

/** 兩矩形是否相交(AABB),供框選用。 */
export function rectsIntersect(a: Rect, b: Rect): boolean {
  return !(a.x + a.w < b.x || b.x + b.w < a.x || a.y + a.h < b.y || b.y + b.h < a.y);
}

/** 矩形完全被另一矩形包住。 */
export function rectContains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h
  );
}

/** 包住一組矩形的最小外框。 */
export function boundingBox(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rects) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.w);
    maxY = Math.max(maxY, r.y + r.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * 從矩形中心朝 `toward` 方向射線,求與矩形邊界的交點(節點周界錨點)。
 * 用於連線端點貼齊節點外框,而非穿到中心。
 */
export function perimeterAnchor(r: Rect, toward: Point): Point {
  const c = rectCenter(r);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  if (dx === 0 && dy === 0) return c;
  const halfW = r.w / 2;
  const halfH = r.h / 2;
  // 以中心為原點,找與四邊相交時最小的縮放比例 t。
  const scaleX = dx === 0 ? Infinity : halfW / Math.abs(dx);
  const scaleY = dy === 0 ? Infinity : halfH / Math.abs(dy);
  const t = Math.min(scaleX, scaleY);
  return { x: c.x + dx * t, y: c.y + dy * t };
}

/**
 * 形狀感知的周界錨點:diamond / circle / ellipse 用真實外形求交點(避免用 bbox 造成
 * 線與圖形之間留空隙);其餘外形用矩形 bbox 近似(足夠貼合)。
 */
export function shapeAnchor(node: SceneNode, toward: Point): Point {
  const r = nodeRect(node);
  const c = rectCenter(r);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  if (dx === 0 && dy === 0) return c;
  const a = r.w / 2;
  const b = r.h / 2;
  if (node.shape === 'diamond') {
    // |x|/a + |y|/b = 1 沿射線解 t。
    const t = 1 / (Math.abs(dx) / a + Math.abs(dy) / b);
    return { x: c.x + dx * t, y: c.y + dy * t };
  }
  if (node.shape === 'circle' || node.shape === 'doubleCircle' || node.shape === 'ellipse') {
    const t = 1 / Math.hypot(dx / a, dy / b);
    return { x: c.x + dx * t, y: c.y + dy * t };
  }
  return perimeterAnchor(r, toward);
}

/** 一條邊的兩端錨點(以對方中心為朝向),供繪製與 hit-test。 */
export function edgeAnchors(
  edge: SceneEdge,
  source: SceneNode | undefined,
  target: SceneNode | undefined,
): { start: Point; end: Point } | null {
  if (!source || !target) return null;
  const sc = rectCenter(nodeRect(source));
  const tc = rectCenter(nodeRect(target));
  return {
    start: shapeAnchor(source, tc),
    end: shapeAnchor(target, sc),
  };
}

/** 點到線段距離(供邊的 hit-test;搭配粗 hit path 也可純算)。 */
export function pointToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return distance(p, a);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return distance(p, { x: a.x + t * dx, y: a.y + t * dy });
}

/** 沿折線(多段)的最短點距。 */
export function pointToPolyline(p: Point, pts: Point[]): number {
  if (pts.length === 0) return Infinity;
  if (pts.length === 1) return distance(p, pts[0]);
  let min = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    min = Math.min(min, pointToSegment(p, pts[i], pts[i + 1]));
  }
  return min;
}
