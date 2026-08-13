// pie 的雙向 round-trip + 版面。
//
// 語法極簡:`pie [showData]` / `title X` / `"標籤" : 數值`。自己逐行解析(比繞 DB 精確,
// DB 只給一個 label→value 的物件,順序與 showData 之外的東西都拿不回來)。
//
// 編輯模型:每個扇形是一個節點,節點放在該扇形的「質心」上。
// - 繞著圓拖曳 = 改變扇形順序(圓餅圖真正會做的排列操作)
// - 雙擊 = 編輯「標籤: 數值」
// 值不做拖曳改動:圓餅的角度是相對值,拖一個扇形要同時改動別人的份額才對得起來,
// 那會讓使用者以為自己只動了一個數字。

import type { ParseResult, ParseWarning } from '../../adapters/types';
import type { DataLossWarning, SerializeResult } from '../../adapters/types';
import type { EditorScene, SceneNode } from '../../scene/types';

export const PIE = { cx: 300, cy: 300, r: 200 } as const;
/** 扇形節點(質心把手)的方塊邊長。 */
export const SLICE_BOX = 76;

const TAU = Math.PI * 2;

/** 依序算出每個扇形的起訖角(從 12 點鐘方向順時針,與 mermaid 一致)。 */
export function sliceAngles(values: number[]): Array<{ from: number; to: number }> {
  const total = values.reduce((s, v) => s + Math.max(0, v), 0) || 1;
  let acc = -Math.PI / 2;
  return values.map((v) => {
    const from = acc;
    acc += (Math.max(0, v) / total) * TAU;
    return { from, to: acc };
  });
}

/** 扇形質心(放標籤 / 把手的位置)。 */
export function sliceCentroid(a: { from: number; to: number }): { x: number; y: number } {
  const mid = (a.from + a.to) / 2;
  const rr = PIE.r * 0.62;
  return { x: PIE.cx + Math.cos(mid) * rr, y: PIE.cy + Math.sin(mid) * rr };
}

/** 節點中心 → 以 12 點鐘為 0、順時針增加的角度(0..2π),用來排序扇形。 */
export function angleOf(cx: number, cy: number): number {
  const a = Math.atan2(cy - PIE.cy, cx - PIE.cx) + Math.PI / 2;
  return ((a % TAU) + TAU) % TAU;
}

/** 依目前節點位置的角度重排,再把節點擺回各自扇形的質心。 */
export function layoutPie(scene: EditorScene): EditorScene {
  const ordered = [...scene.nodes].sort(
    (a, b) => angleOf(a.x + a.w / 2, a.y + a.h / 2) - angleOf(b.x + b.w / 2, b.y + b.h / 2),
  );
  const angles = sliceAngles(ordered.map((n) => (n.data?.kind === 'pie' ? n.data.value : 0)));
  const placed = ordered.map((n, i) => {
    const c = sliceCentroid(angles[i]);
    return { ...n, x: c.x - n.w / 2, y: c.y - n.h / 2, sourceIndex: i, pinned: true };
  });
  return { ...scene, nodes: placed, layoutOwner: 'user' };
}

const LINE_RE = /^\s*("?)(.*?)\1\s*:\s*([0-9.]+)\s*$/;

export function pieToScene(text: string): ParseResult {
  const warnings: ParseWarning[] = [];
  const comments: string[] = [];
  const nodes: SceneNode[] = [];
  let title: string | undefined;
  let showData = false;
  let seenHeader = false;
  let idx = 0;

  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('%%')) {
      comments.push(line);
      continue;
    }
    if (!seenHeader) {
      const h = /^pie\b(.*)$/i.exec(line);
      if (h) {
        seenHeader = true;
        const rest = h[1].trim();
        if (/^showData\b/i.test(rest)) {
          showData = true;
          const t = rest.replace(/^showData\s*/i, '').replace(/^title\s+/i, '').trim();
          if (t) title = t;
        } else if (/^title\s+/i.test(rest)) {
          title = rest.replace(/^title\s+/i, '').trim();
        }
        continue;
      }
    }
    const t = /^title\s+(.*)$/i.exec(line);
    if (t) {
      title = t[1].trim();
      continue;
    }
    const m = LINE_RE.exec(line);
    if (!m) {
      warnings.push({ message: `略過看不懂的一行:${line}` });
      continue;
    }
    const value = Number(m[3]);
    nodes.push({
      id: `s${idx}`,
      shape: 'pieSlice',
      label: m[2],
      x: 0,
      y: 0,
      w: SLICE_BOX,
      h: SLICE_BOX,
      data: { kind: 'pie', value: Number.isFinite(value) ? value : 0 },
      sourceIndex: idx++,
    });
  }

  if (!seenHeader) warnings.push({ message: '找不到 pie 標頭,已以空圖處理。' });

  // 初始位置:先照原始順序放到各扇形質心(layoutPie 會依角度排序,順序因此得以保持)。
  const angles = sliceAngles(nodes.map((n) => (n.data?.kind === 'pie' ? n.data.value : 0)));
  const placed = nodes.map((n, i) => {
    const c = sliceCentroid(angles[i]);
    return { ...n, x: c.x - n.w / 2, y: c.y - n.h / 2 };
  });

  const scene: EditorScene = {
    version: 1,
    diagramType: 'pie',
    meta: { type: 'pie', title, showData },
    nodes: placed,
    edges: [],
    containers: [],
    raw: { comments, fullSource: seenHeader ? undefined : text },
    layoutOwner: 'user',
  };
  return { scene, warnings };
}

export function sceneToPie(scene: EditorScene): SerializeResult {
  if (scene.nodes.length === 0 && scene.raw?.fullSource) {
    return { text: scene.raw.fullSource, warnings: [] };
  }
  const warnings: DataLossWarning[] = [];
  const meta = scene.meta.type === 'pie' ? scene.meta : { title: undefined, showData: false };
  const lines: string[] = [];
  for (const c of scene.raw?.comments ?? []) {
    if (c.trim().startsWith('%%{')) lines.push(c.trim());
  }
  lines.push(`pie${meta.showData ? ' showData' : ''}${meta.title ? ` title ${meta.title}` : ''}`);
  for (const c of scene.raw?.comments ?? []) {
    const t = c.trim();
    if (t.startsWith('%%') && !t.startsWith('%%{')) lines.push(`    ${t}`);
  }
  // 順序由角度決定(繞著圓拖曳就是在排順序)。
  const ordered = [...scene.nodes].sort(
    (a, b) => angleOf(a.x + a.w / 2, a.y + a.h / 2) - angleOf(b.x + b.w / 2, b.y + b.h / 2),
  );
  for (const n of ordered) {
    const v = n.data?.kind === 'pie' ? n.data.value : 0;
    // 標籤一律加引號:mermaid 的 pie 標籤本來就是字串,含空白 / 冒號時不加會解錯。
    lines.push(`    "${(n.label || n.id).replace(/"/g, '')}" : ${v}`);
  }
  return { text: lines.join('\n') + '\n', warnings };
}
