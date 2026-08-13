// block-beta 的雙向 round-trip + 版面。
//
// 積木圖是「按欄位流動」的網格:區塊依序填格,`columns N` 決定一列幾格。所以**位置就是順序** ——
// 把區塊拖到別的格子就是在重排,這正是這種圖唯一要做的編輯。
//
// 只吃可以完整還原的子集;遇到 `block:… end` 巢狀、帶文字的箭頭、style 行等,整份原文回吐
// 並降為唯讀。積木圖的語法變化很多,半懂不懂地改寫比不能編輯糟糕得多。

import type { ParseResult, ParseWarning } from '../../adapters/types';
import type { DataLossWarning, SerializeResult } from '../../adapters/types';
import type { EditorScene, NodeShape, SceneEdge, SceneNode } from '../../scene/types';
import { SHAPE_TO_BRACKETS } from '../flowchart/syntax-maps';

export const CELL = { w: 150, h: 78, gapX: 16, gapY: 16, x0: 60, y0: 60 } as const;

/** 括號 → 外形(SHAPE_TO_BRACKETS 的反查;長括號優先,`[[` 不可以被 `[` 先吃掉)。 */
const BRACKET_ENTRIES = Object.entries(SHAPE_TO_BRACKETS).sort(
  (a, b) => b[1].left.length - a[1].left.length,
);

/**
 * 積木 id 允許的字元。**不是** `[A-Za-z0-9_-]`:mermaid 的 id 可以是中文,把中文擋掉等於
 * 讓所有中文積木圖都退成唯讀。這裡只排除會與語法本身衝突的字元。
 */
const ID_RE = /^[^\s[\](){}<>:"']+$/;

/** `id["文字"]:2` → { id, shape, label, span }。看不懂回 null。 */
function parseBlockToken(token: string): { id: string; shape: NodeShape; label: string; span: number } | null {
  // 先切出結尾的 `:N` 欄寬(但別把 `["a:b"]` 裡的冒號切掉)。
  let span = 1;
  let body = token;
  const spanMatch = /^(.*?[\]})>])\s*:\s*(\d+)$/.exec(token) ?? /^([^\s:]+)\s*:\s*(\d+)$/.exec(token);
  if (spanMatch) {
    body = spanMatch[1];
    span = Math.max(1, Number(spanMatch[2]));
  }
  if (ID_RE.test(body)) return { id: body, shape: 'rectangle', label: body, span };
  for (const [shape, br] of BRACKET_ENTRIES) {
    const i = body.indexOf(br.left);
    if (i <= 0 || !body.endsWith(br.right)) continue;
    const id = body.slice(0, i);
    if (!ID_RE.test(id)) continue;
    const label = body.slice(i + br.left.length, body.length - br.right.length).replace(/^["']|["']$/g, '');
    return { id, shape: shape as NodeShape, label, span };
  }
  return null;
}

const EDGE_RE = /^([^\s[\](){}<>:"']+)\s*(-->|---|<-->)\s*([^\s[\](){}<>:"']+)$/;
/** 需要整份放棄的語法(巢狀積木 / 樣式 / 帶標籤箭頭)。 */
const BAIL_RE = /^(block\s*:|end\b|style\b|classDef\b|class\b)|--\s*"/;

function passthrough(text: string, comments: string[], warnings: ParseWarning[]): ParseResult {
  return {
    scene: {
      version: 1,
      diagramType: 'block',
      meta: { type: 'block', columns: 1 },
      nodes: [],
      edges: [],
      containers: [],
      raw: { comments, fullSource: text },
      layoutOwner: 'user',
    },
    warnings,
  };
}

export function blockToScene(text: string): ParseResult {
  const warnings: ParseWarning[] = [];
  const comments: string[] = [];
  const nodes: SceneNode[] = [];
  const edges: SceneEdge[] = [];
  let columns = 1;
  let seenHeader = false;
  let cell = 0;
  let eIdx = 0;

  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('%%')) {
      comments.push(line);
      continue;
    }
    if (!seenHeader && /^block(-beta)?$/i.test(line)) {
      seenHeader = true;
      continue;
    }
    if (BAIL_RE.test(line)) {
      warnings.push({ message: `包含尚未支援的語法(${line}),已改為唯讀以免改壞原檔。` });
      return passthrough(text, comments, warnings);
    }
    const col = /^columns\s+(\d+)$/i.exec(line);
    if (col) {
      columns = Math.max(1, Number(col[1]));
      continue;
    }
    const e = EDGE_RE.exec(line);
    if (e) {
      edges.push({
        id: `e${eIdx}`,
        source: e[1],
        target: e[3],
        lineKind: 'solid',
        arrowStart: e[2] === '<-->' ? 'arrow' : 'none',
        arrowEnd: e[2] === '---' ? 'none' : 'arrow',
        data: { kind: 'flowchart' },
        sourceIndex: eIdx++,
      });
      continue;
    }
    // 其餘皆視為「一列積木」:以空白切,每個 token 一格。
    for (const token of line.split(/\s+/)) {
      const space = /^space(?::(\d+))?$/i.exec(token);
      if (space) {
        cell += Math.max(1, Number(space[1] ?? 1));
        continue;
      }
      const b = parseBlockToken(token);
      if (!b) {
        warnings.push({ message: `看不懂的積木「${token}」,已改為唯讀以免改壞原檔。` });
        return passthrough(text, comments, warnings);
      }
      const cx = cell % columns;
      const cy = Math.floor(cell / columns);
      nodes.push({
        id: b.id,
        shape: b.shape,
        label: b.label,
        x: CELL.x0 + cx * (CELL.w + CELL.gapX),
        y: CELL.y0 + cy * (CELL.h + CELL.gapY),
        w: CELL.w * b.span + CELL.gapX * (b.span - 1),
        h: CELL.h,
        data: { kind: 'block', span: b.span },
        sourceIndex: nodes.length,
        pinned: true,
      });
      cell += b.span;
    }
  }

  if (!seenHeader) {
    warnings.push({ message: '找不到 block-beta 標頭,已以空圖處理。' });
    return passthrough(text, comments, warnings);
  }

  const scene: EditorScene = {
    version: 1,
    diagramType: 'block',
    meta: { type: 'block', columns },
    nodes,
    edges,
    containers: [],
    raw: { comments },
    layoutOwner: 'user',
  };
  return { scene, warnings };
}

/** 節點中心 → 格座標(拖到哪一格就算哪一格)。 */
function cellOf(n: SceneNode): { col: number; row: number } {
  return {
    col: Math.max(0, Math.round((n.x - CELL.x0) / (CELL.w + CELL.gapX))),
    row: Math.max(0, Math.round((n.y - CELL.y0) / (CELL.h + CELL.gapY))),
  };
}

export function sceneToBlock(scene: EditorScene): SerializeResult {
  if (scene.nodes.length === 0 && scene.raw?.fullSource) {
    return { text: scene.raw.fullSource, warnings: [] };
  }
  const warnings: DataLossWarning[] = [];
  const columns = scene.meta.type === 'block' ? scene.meta.columns : 1;
  const lines: string[] = [];
  for (const c of scene.raw?.comments ?? []) {
    if (c.trim().startsWith('%%{')) lines.push(c.trim());
  }
  lines.push('block-beta');
  for (const c of scene.raw?.comments ?? []) {
    const t = c.trim();
    if (t.startsWith('%%') && !t.startsWith('%%{')) lines.push(`  ${t}`);
  }
  lines.push(`  columns ${columns}`);

  // 位置就是順序:先依列、再依欄排序,列與列之間換行輸出。
  const placed = scene.nodes
    .map((n) => ({ n, c: cellOf(n) }))
    .sort((a, b) => a.c.row - b.c.row || a.c.col - b.c.col);
  let curRow = -1;
  let row: string[] = [];
  const flush = (): void => {
    if (row.length) lines.push(`  ${row.join(' ')}`);
    row = [];
  };
  for (const { n, c } of placed) {
    if (c.row !== curRow) {
      flush();
      curRow = c.row;
    }
    const d = n.data?.kind === 'block' ? n.data : undefined;
    const br = SHAPE_TO_BRACKETS[n.shape] ?? SHAPE_TO_BRACKETS.rectangle;
    const label = (n.label || n.id).replace(/["]/g, '');
    const spanPart = d && d.span > 1 ? `:${d.span}` : '';
    // 標籤與 id 相同且是單純識別字時可以只寫 id(維持作者原本的簡潔寫法)。
    const body = label === n.id && ID_RE.test(label) ? n.id : `${n.id}${br.left}"${label}"${br.right}`;
    row.push(`${body}${spanPart}`);
  }
  flush();

  const ids = new Set(scene.nodes.map((n) => n.id));
  for (const e of [...scene.edges].sort(
    (a, b) => (a.sourceIndex ?? 0) - (b.sourceIndex ?? 0),
  )) {
    if (!ids.has(e.source) || !ids.has(e.target)) {
      warnings.push({ message: `略過懸空連線 ${e.id}`, elementId: e.id });
      continue;
    }
    const arrow = e.arrowStart !== 'none' ? '<-->' : e.arrowEnd !== 'none' ? '-->' : '---';
    lines.push(`  ${e.source} ${arrow} ${e.target}`);
  }
  return { text: lines.join('\n') + '\n', warnings };
}

/** 「整理」= 依目前的格座標重新對齊到網格。 */
export function layoutBlock(scene: EditorScene): EditorScene {
  const columns = scene.meta.type === 'block' ? scene.meta.columns : 1;
  const placed = scene.nodes
    .map((n) => ({ n, c: cellOf(n) }))
    .sort((a, b) => a.c.row - b.c.row || a.c.col - b.c.col);
  let cell = 0;
  const nodes = placed.map(({ n }) => {
    const span = n.data?.kind === 'block' ? n.data.span : 1;
    // 這一列放不下就換到下一列開頭(與 mermaid 的填格規則一致)。
    if ((cell % columns) + span > columns) cell += columns - (cell % columns);
    const col = cell % columns;
    const rowIdx = Math.floor(cell / columns);
    cell += span;
    return {
      ...n,
      x: CELL.x0 + col * (CELL.w + CELL.gapX),
      y: CELL.y0 + rowIdx * (CELL.h + CELL.gapY),
    };
  });
  return { ...scene, nodes, layoutOwner: 'user' };
}
