// sankey-beta 的雙向 round-trip(純文字,零 mermaid 依賴)。
//
// 語法就是一份 CSV:每行 `來源,去處,流量`,欄位可加雙引號(內部的引號用 "" 跳脫)。
// 因為只有這三欄,自己解析比繞 mermaid DB 精確得多 —— DB 存的是已經算好的圖形座標。
//
// 場景對映:每個出現過的名稱是一個節點,每一行是一條帶 value 的連線。
// 節點位置由使用者拖曳決定(初次載入用依「層」的自動佈點),序列化不受位置影響。

import type { ParseResult, ParseWarning } from '../../adapters/types';
import type { DataLossWarning, SerializeResult } from '../../adapters/types';
import type { EditorScene, SceneEdge, SceneNode } from '../../scene/types';

const NODE_W = 150;
const NODE_H = 42;
const COL_GAP = 110;
const ROW_GAP = 26;
const ORIGIN = { x: 60, y: 60 };

/** 解析一行 CSV(支援 "…" 引號與 "" 跳脫)。 */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else quoted = false;
      } else cur += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ',') {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

/** 需要引號?(含逗號 / 引號 / 前後空白)。 */
function csvField(value: string): string {
  return /[",]/.test(value) || value !== value.trim() ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * 依連線方向把節點分層(來源在左、去處在右),同層內上下排開。
 * 只在載入時用一次;之後位置由使用者掌管。
 */
function autoPlace(nodes: SceneNode[], edges: SceneEdge[]): SceneNode[] {
  const depth = new Map<string, number>(nodes.map((n) => [n.id, 0]));
  // 反覆鬆弛(圖不大,層數必收斂;有環時由次數上限保護)。
  for (let pass = 0; pass < nodes.length; pass += 1) {
    let changed = false;
    for (const e of edges) {
      const want = (depth.get(e.source) ?? 0) + 1;
      if (want > (depth.get(e.target) ?? 0)) {
        depth.set(e.target, want);
        changed = true;
      }
    }
    if (!changed) break;
  }
  const byDepth = new Map<number, SceneNode[]>();
  for (const n of nodes) {
    const d = depth.get(n.id) ?? 0;
    byDepth.set(d, [...(byDepth.get(d) ?? []), n]);
  }
  const placed: SceneNode[] = [];
  for (const [d, list] of [...byDepth.entries()].sort((a, b) => a[0] - b[0])) {
    list.forEach((n, i) => {
      placed.push({
        ...n,
        x: ORIGIN.x + d * (NODE_W + COL_GAP),
        y: ORIGIN.y + i * (NODE_H + ROW_GAP),
      });
    });
  }
  return placed;
}

export function sankeyToScene(text: string): ParseResult {
  const warnings: ParseWarning[] = [];
  const comments: string[] = [];
  const nodes: SceneNode[] = [];
  const edges: SceneEdge[] = [];
  const byName = new Map<string, SceneNode>();
  let seenHeader = false;
  let eIdx = 0;

  const nodeFor = (name: string): SceneNode => {
    const found = byName.get(name);
    if (found) return found;
    const n: SceneNode = {
      id: name,
      shape: 'sankeyNode',
      label: name,
      x: 0,
      y: 0,
      w: NODE_W,
      h: NODE_H,
      data: { kind: 'sankey' },
      sourceIndex: byName.size,
    };
    byName.set(name, n);
    nodes.push(n);
    return n;
  };

  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('%%')) {
      comments.push(line);
      continue;
    }
    if (!seenHeader && /^sankey(-beta)?$/i.test(line)) {
      seenHeader = true;
      continue;
    }
    const cells = parseCsvLine(line);
    if (cells.length < 3) {
      warnings.push({ message: `略過看不懂的一行:${line}` });
      continue;
    }
    const [src, dst, valueText] = cells;
    const value = Number(valueText);
    if (!src || !dst || !Number.isFinite(value)) {
      warnings.push({ message: `略過看不懂的一行:${line}` });
      continue;
    }
    nodeFor(src);
    nodeFor(dst);
    edges.push({
      id: `e${eIdx}`,
      source: src,
      target: dst,
      lineKind: 'solid',
      arrowStart: 'none',
      // 流量圖不畫箭頭:線寬本身就表達了流量,而箭頭 marker 會隨線寬放大成一塊黑三角。
      arrowEnd: 'none',
      data: { kind: 'sankey', value },
      sourceIndex: eIdx++,
    });
  }

  if (!seenHeader) warnings.push({ message: '找不到 sankey-beta 標頭,已以空圖處理。' });

  const scene: EditorScene = {
    version: 1,
    diagramType: 'sankey',
    meta: { type: 'sankey' },
    nodes: autoPlace(nodes, edges),
    edges,
    containers: [],
    raw: { comments, fullSource: seenHeader ? undefined : text },
    layoutOwner: 'user',
  };
  return { scene, warnings };
}

export function sceneToSankey(scene: EditorScene): SerializeResult {
  if (scene.nodes.length === 0 && scene.raw?.fullSource) {
    return { text: scene.raw.fullSource, warnings: [] };
  }
  const warnings: DataLossWarning[] = [];
  const lines: string[] = [];
  for (const c of scene.raw?.comments ?? []) {
    if (c.trim().startsWith('%%{')) lines.push(c.trim());
  }
  lines.push('sankey-beta');
  lines.push('');
  const label = new Map(scene.nodes.map((n) => [n.id, n.label || n.id] as const));
  const sorted = [...scene.edges].sort(
    (a, b) => (a.sourceIndex ?? Number.MAX_SAFE_INTEGER) - (b.sourceIndex ?? Number.MAX_SAFE_INTEGER),
  );
  for (const e of sorted) {
    const s = label.get(e.source);
    const t = label.get(e.target);
    if (!s || !t) {
      warnings.push({ message: `略過懸空連線 ${e.id}`, elementId: e.id });
      continue;
    }
    const value = e.data?.kind === 'sankey' ? e.data.value : 1;
    lines.push(`${csvField(s)},${csvField(t)},${value}`);
  }
  // 孤立節點在 sankey 沒有語法可表達(每一行都是一條連線)—— 講出來,不要默默吃掉。
  const inEdge = new Set(scene.edges.flatMap((e) => [e.source, e.target]));
  for (const n of scene.nodes) {
    if (!inEdge.has(n.id)) {
      warnings.push({ message: `「${n.label || n.id}」沒有任何連線,sankey 無法表達孤立節點`, elementId: n.id });
    }
  }
  // mermaid 11 的 sankey lexer 只吃 ASCII 名稱 —— 中文加不加引號都是 parse error
  // (`Expecting 'DQUOTE', got 'ESCAPED_TEXT'`),而且沒有別名語法可以擺放顯示文字。
  // 我們照使用者打的原樣輸出(改寫成 n1/n2 只會讓圖變得沒有意義),但要明講它渲染不出來。
  for (const n of scene.nodes) {
    const name = n.label || n.id;
    if (!/^[\x20-\x7E]*$/.test(name)) {
      warnings.push({
        message: `mermaid 的 sankey 目前只接受 ASCII 名稱,「${name}」會讓這張圖渲染失敗`,
        elementId: n.id,
      });
    }
  }
  return { text: lines.join('\n') + '\n', warnings };
}
