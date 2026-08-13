// quadrantChart 文字 → 場景。
//
// 這裡刻意**不走 mermaid DB**:quadrant 的 db.getQuadrantData() 只吐已經算成像素的繪圖指令
// (點的 x/y 是畫布座標、顏色是 hsl 字串),原始的 0..1 值與標籤根本拿不回來。語法本身是逐行的,
// 自己解析反而精確可逆。

import type { ParseResult, ParseWarning } from '../../adapters/types';
import type { EditorScene, QuadrantMeta, SceneNode } from '../../scene/types';
import { POINT_BOX, valueToScene } from './model';

const FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/;

/** `名稱: [0.3, 0.6]` 或帶樣式的 `名稱: [0.3, 0.6] radius: 10, color: #f00` */
const POINT_RE = /^(.+?)\s*:\s*\[\s*([0-9.]+)\s*,\s*([0-9.]+)\s*\](.*)$/;

function parseStyle(tail: string): { radius?: number; color?: string; strokeColor?: string; strokeWidth?: string } {
  const out: { radius?: number; color?: string; strokeColor?: string; strokeWidth?: string } = {};
  for (const part of tail.split(',')) {
    const m = /^\s*([A-Za-z-]+)\s*:\s*(.+?)\s*$/.exec(part);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2];
    if (key === 'radius') out.radius = Number(value) || undefined;
    else if (key === 'color') out.color = value;
    else if (key === 'stroke-color') out.strokeColor = value;
    else if (key === 'stroke-width') out.strokeWidth = value;
  }
  return out;
}

/** 軸定義:`x-axis 低成本 --> 高成本`(右端可省略)。 */
function parseAxis(rest: string): { a: string; b?: string } {
  const i = rest.indexOf('-->');
  if (i === -1) return { a: rest.trim() };
  return { a: rest.slice(0, i).trim(), b: rest.slice(i + 3).trim() || undefined };
}

export function quadrantToScene(text: string): ParseResult {
  const warnings: ParseWarning[] = [];
  let body = text;
  let frontmatter: string | undefined;
  const fm = FRONTMATTER_RE.exec(body);
  if (fm) {
    frontmatter = fm[0].replace(/\r?\n$/, '');
    body = body.slice(fm[0].length);
  }

  const meta: QuadrantMeta = { quadrants: [] };
  const comments: string[] = [];
  const extraLines: string[] = [];
  const nodes: SceneNode[] = [];
  let seenHeader = false;
  let idx = 0;

  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('%%')) {
      comments.push(line);
      continue;
    }
    if (!seenHeader && /^quadrantChart\b/i.test(line)) {
      seenHeader = true;
      continue;
    }
    const kw = /^([A-Za-z][A-Za-z0-9-]*)\s+(.*)$/.exec(line);
    const head = kw ? kw[1].toLowerCase() : '';
    if (head === 'title') {
      meta.title = kw![2].trim();
      continue;
    }
    if (head === 'x-axis') {
      const { a, b } = parseAxis(kw![2]);
      meta.xAxis = { left: a, right: b };
      continue;
    }
    if (head === 'y-axis') {
      const { a, b } = parseAxis(kw![2]);
      meta.yAxis = { bottom: a, top: b };
      continue;
    }
    const q = /^quadrant-([1-4])\s+(.*)$/i.exec(line);
    if (q) {
      meta.quadrants[Number(q[1]) - 1] = q[2].trim();
      continue;
    }
    const p = POINT_RE.exec(line);
    if (p) {
      const label = p[1].trim().replace(/^["']|["']$/g, '');
      const at = valueToScene(Number(p[2]), Number(p[3]));
      const style = parseStyle(p[4] ?? '');
      nodes.push({
        id: label || `p${idx + 1}`,
        shape: 'point',
        label,
        x: at.x - POINT_BOX / 2,
        y: at.y - POINT_BOX / 2,
        w: POINT_BOX,
        h: POINT_BOX,
        data: { kind: 'quadrant', ...style },
        sourceIndex: idx++,
        pinned: true,
      });
      continue;
    }
    // 未模型化的行(classDef / 點的 class 指派等)逐字保留。
    extraLines.push(line);
  }

  if (!seenHeader) warnings.push({ message: '找不到 quadrantChart 標頭,已以空圖處理。' });
  if (extraLines.length) meta.extraLines = extraLines;

  const scene: EditorScene = {
    version: 1,
    diagramType: 'quadrant',
    meta: { type: 'quadrant', quadrant: meta },
    nodes,
    edges: [],
    containers: [],
    frontmatter,
    raw: { comments, fullSource: seenHeader ? undefined : text },
    // 點的位置就是資料,永遠由使用者掌管,不需要(也不可以)交給排版引擎重排。
    layoutOwner: 'user',
  };
  return { scene, warnings };
}
