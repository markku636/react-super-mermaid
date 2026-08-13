// xychart-beta 的雙向 round-trip + 版面。
//
// 每個資料點是一個節點,**垂直位置就是它的值**:往上拖就是把數字調大。水平位置鎖在該類別的
// 欄位中心(x 是分類軸,橫向自由移動沒有意義,只會讓人以為改到了別的東西)。
//
// 自己逐行解析:mermaid 的 xychart DB 只吐已經算成像素的繪圖指令,原始數值拿不回來。

import type { ParseResult, ParseWarning } from '../../adapters/types';
import type { DataLossWarning, SerializeResult } from '../../adapters/types';
import type { EditorScene, SceneNode, XyChartMeta } from '../../scene/types';

export const XY = { x: 90, y: 70, w: 620, h: 420 } as const;
export const POINT_BOX = 26;

/** 第 i 個類別的欄位中心 x(共 n 個類別)。 */
export function bandX(i: number, n: number): number {
  const band = XY.w / Math.max(1, n);
  return XY.x + band * (i + 0.5);
}

/** x → 類別索引(拖到欄與欄之間時取最近的一欄)。 */
export function xToBand(x: number, n: number): number {
  const band = XY.w / Math.max(1, n);
  return Math.max(0, Math.min(n - 1, Math.floor((x - XY.x) / band)));
}

export function valueToY(v: number, min: number, max: number): number {
  const span = max - min || 1;
  return XY.y + XY.h * (1 - (v - min) / span);
}

export function yToValue(y: number, min: number, max: number): number {
  const span = max - min || 1;
  const v = min + (1 - (y - XY.y) / XY.h) * span;
  // 兩位小數就夠了:再多只是把拖曳的浮點雜訊寫進使用者的檔案。
  return Math.round(Math.min(max, Math.max(min, v)) * 100) / 100;
}

/** `[a, b, c]` → 字串陣列(去引號)。 */
function parseList(text: string): string[] {
  const inner = /^\[(.*)\]$/.exec(text.trim());
  if (!inner) return [];
  return inner[1]
    .split(',')
    .map((s) => s.trim().replace(/^["']|["']$/g, ''))
    .filter((s) => s.length > 0);
}

const strip = (s: string): string => s.trim().replace(/^["']|["']$/g, '');

export function xychartToScene(text: string): ParseResult {
  const warnings: ParseWarning[] = [];
  const comments: string[] = [];
  const meta: XyChartMeta = { categories: [], series: [], yMin: 0, yMax: 100 };
  let seenHeader = false;
  let horizontal = false;

  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('%%')) {
      comments.push(line);
      continue;
    }
    if (!seenHeader) {
      const h = /^xychart(-beta)?\b(.*)$/i.exec(line);
      if (h) {
        seenHeader = true;
        if (/horizontal/i.test(h[2])) horizontal = true;
        continue;
      }
    }
    const t = /^title\s+(.*)$/i.exec(line);
    if (t) {
      meta.title = strip(t[1]);
      continue;
    }
    const xa = /^x-axis\s+(.*)$/i.exec(line);
    if (xa) {
      const rest = xa[1].trim();
      if (rest.startsWith('[')) meta.categories = parseList(rest);
      else {
        // `x-axis "標題" [a, b]` 或數值區間 —— 標題以外的部分才是類別。
        const br = rest.indexOf('[');
        if (br >= 0) {
          meta.xTitle = strip(rest.slice(0, br));
          meta.categories = parseList(rest.slice(br));
        } else {
          meta.xTitle = strip(rest);
        }
      }
      continue;
    }
    const ya = /^y-axis\s+(.*)$/i.exec(line);
    if (ya) {
      const rest = ya[1].trim();
      const range = /(-?[0-9.]+)\s*-->\s*(-?[0-9.]+)\s*$/.exec(rest);
      if (range) {
        meta.yMin = Number(range[1]);
        meta.yMax = Number(range[2]);
        const head = rest.slice(0, range.index).trim();
        if (head) meta.yTitle = strip(head);
      } else {
        meta.yTitle = strip(rest);
      }
      continue;
    }
    const s = /^(bar|line)\s+(.*)$/i.exec(line);
    if (s) {
      const kind = s[1].toLowerCase() as 'bar' | 'line';
      const rest = s[2].trim();
      const br = rest.indexOf('[');
      const name = br > 0 ? strip(rest.slice(0, br)) : undefined;
      const values = parseList(br >= 0 ? rest.slice(br) : rest).map((v) => Number(v));
      meta.series.push({ kind, name, values: values.map((v) => (Number.isFinite(v) ? v : 0)) });
      continue;
    }
    warnings.push({ message: `略過看不懂的一行:${line}` });
  }

  if (!seenHeader) warnings.push({ message: '找不到 xychart-beta 標頭,已以空圖處理。' });
  if (horizontal) {
    warnings.push({ message: 'horizontal 版面尚未支援拖曳編輯,已改為唯讀。' });
    return {
      scene: {
        version: 1,
        diagramType: 'xychart',
        meta: { type: 'xychart', xy: meta },
        nodes: [],
        edges: [],
        containers: [],
        raw: { comments, fullSource: text },
        layoutOwner: 'user',
      },
      warnings,
    };
  }

  // 類別數以最長的一組資料為準(x-axis 沒寫類別時就用序號)。
  const n = Math.max(meta.categories.length, ...meta.series.map((s) => s.values.length), 1);
  if (meta.categories.length === 0) meta.categories = Array.from({ length: n }, (_, i) => String(i + 1));

  const nodes: SceneNode[] = [];
  meta.series.forEach((series, si) => {
    series.values.forEach((v, i) => {
      const cx = bandX(i, n);
      const cy = valueToY(v, meta.yMin, meta.yMax);
      nodes.push({
        id: `s${si}p${i}`,
        shape: 'xyPoint',
        label: '',
        x: cx - POINT_BOX / 2,
        y: cy - POINT_BOX / 2,
        w: POINT_BOX,
        h: POINT_BOX,
        data: { kind: 'xy', series: si, index: i },
        sourceIndex: si * 1000 + i,
        pinned: true,
      });
    });
  });

  const scene: EditorScene = {
    version: 1,
    diagramType: 'xychart',
    meta: { type: 'xychart', xy: meta },
    nodes,
    edges: [],
    containers: [],
    raw: { comments, fullSource: seenHeader ? undefined : text },
    layoutOwner: 'user',
  };
  return { scene, warnings };
}

const fmt = (v: number): string => String(Math.round(v * 100) / 100);
const quote = (s: string): string => (/^[A-Za-z0-9_.-]+$/.test(s) ? s : `"${s.replace(/"/g, '')}"`);

export function sceneToXychart(scene: EditorScene): SerializeResult {
  if (scene.nodes.length === 0 && scene.raw?.fullSource) {
    return { text: scene.raw.fullSource, warnings: [] };
  }
  const warnings: DataLossWarning[] = [];
  const meta = scene.meta.type === 'xychart' ? scene.meta.xy : undefined;
  if (!meta) return { text: scene.raw?.fullSource ?? 'xychart-beta\n', warnings };
  const lines: string[] = [];
  for (const c of scene.raw?.comments ?? []) {
    if (c.trim().startsWith('%%{')) lines.push(c.trim());
  }
  lines.push('xychart-beta');
  if (meta.title) lines.push(`    title ${quote(meta.title)}`);
  lines.push(
    `    x-axis ${meta.xTitle ? `${quote(meta.xTitle)} ` : ''}[${meta.categories.map(quote).join(', ')}]`,
  );
  lines.push(`    y-axis ${meta.yTitle ? `${quote(meta.yTitle)} ` : ''}${fmt(meta.yMin)} --> ${fmt(meta.yMax)}`);
  for (const c of scene.raw?.comments ?? []) {
    const t = c.trim();
    if (t.startsWith('%%') && !t.startsWith('%%{')) lines.push(`    ${t}`);
  }

  // 值由節點的 y 決定(垂直拖曳就是在改數字)。
  const n = Math.max(1, meta.categories.length);
  meta.series.forEach((series, si) => {
    const values = series.values.map((v, i) => {
      const node = scene.nodes.find((x) => x.data?.kind === 'xy' && x.data.series === si && x.data.index === i);
      return node ? yToValue(node.y + node.h / 2, meta.yMin, meta.yMax) : v;
    });
    void n;
    lines.push(`    ${series.kind} ${series.name ? `${quote(series.name)} ` : ''}[${values.map(fmt).join(', ')}]`);
  });

  return { text: lines.join('\n') + '\n', warnings };
}

/** 「整理」= 把每個點放回它所屬類別的欄位中心(垂直位置 = 值,不動)。 */
export function layoutXychart(scene: EditorScene): EditorScene {
  const meta = scene.meta.type === 'xychart' ? scene.meta.xy : undefined;
  if (!meta) return scene;
  const n = Math.max(1, meta.categories.length);
  return {
    ...scene,
    nodes: scene.nodes.map((node) => {
      if (node.data?.kind !== 'xy') return node;
      const cx = bandX(node.data.index, n);
      return { ...node, x: cx - node.w / 2 };
    }),
  };
}
