// 場景 → stateDiagram-v2 文字。確定性、永遠輸出合法 mermaid。
// 處理:狀態 / 轉移 / [*] 偽狀態 / 複合狀態(巢狀 state X { })/ 方向 / 自訂標籤。

import type { DataLossWarning, SerializeResult } from '../../adapters/types';
import type { EditorScene, SceneEdge, SceneNode } from '../../scene/types';

const INDENT = '    ';

function isPseudo(n: SceneNode | undefined): boolean {
  if (!n) return false;
  if (n.data?.kind === 'state' && (n.data.isStart || n.data.isEnd)) return true;
  return n.shape === 'stateStart' || n.shape === 'stateEnd';
}

/** label 需引號?(含空白以外特殊字元)。 */
function quoteLabel(label: string): string {
  return `"${label.replace(/"/g, '&quot;').replace(/\r?\n/g, '<br/>')}"`;
}

function bySourceIndex<T extends { sourceIndex?: number }>(a: T, b: T): number {
  return (a.sourceIndex ?? Number.MAX_SAFE_INTEGER) - (b.sourceIndex ?? Number.MAX_SAFE_INTEGER);
}

export function sceneToState(scene: EditorScene): SerializeResult {
  // 解析失敗的降級場景(空節點但保有原文)→ 原樣回吐,絕不覆寫成空。
  if (scene.nodes.length === 0 && scene.raw?.fullSource) {
    return { text: scene.raw.fullSource, warnings: [] };
  }
  const warnings: DataLossWarning[] = [];
  const lines: string[] = [];

  if (scene.frontmatter) lines.push(scene.frontmatter.replace(/\n+$/, ''));
  for (const c of scene.raw?.comments ?? []) {
    if (c.trim().startsWith('%%{')) lines.push(c.trim());
  }

  lines.push('stateDiagram-v2');
  const dir = scene.meta.type === 'state' ? scene.meta.direction : undefined;
  if (dir && dir !== 'TB' && dir !== 'TD') lines.push(`${INDENT}direction ${dir}`);

  const nodeById = new Map(scene.nodes.map((n) => [n.id, n] as const));
  const containerById = new Map(scene.containers.map((c) => [c.id, c] as const));
  const parentOf = (id: string): string | null =>
    nodeById.get(id)?.parentId ?? containerById.get(id)?.parentId ?? null;

  // 轉移 token:偽狀態 → [*],其餘 → id。
  const tok = (id: string): string => (isPseudo(nodeById.get(id)) ? '[*]' : id);

  // 每條邊的「作用域」= 來源端點的 parentId(複合狀態內 / 根層)。
  const scopeOfEdge = (e: SceneEdge): string | null => parentOf(e.source) ?? parentOf(e.target);

  // 出現在任一條邊的節點 id(用來判斷孤立狀態需不需要單獨宣告)。
  const inEdge = new Set<string>();
  for (const e of scene.edges) {
    inEdge.add(e.source);
    inEdge.add(e.target);
  }

  const emitScope = (scopeId: string | null, depth: number): void => {
    const pad = INDENT.repeat(depth + 1);

    // 1. 狀態宣告(自訂標籤,或孤立的純狀態)。
    const scopeNodes = scene.nodes
      .filter((n) => (n.parentId ?? null) === scopeId && !isPseudo(n))
      .sort(bySourceIndex);
    for (const n of scopeNodes) {
      const label = n.label ?? '';
      if (label.length > 0 && label !== n.id) {
        lines.push(`${pad}state ${quoteLabel(label)} as ${n.id}`);
      } else if (!inEdge.has(n.id)) {
        lines.push(`${pad}${n.id}`);
      }
    }

    // 2. 此作用域的轉移。
    const scopeEdges = scene.edges.filter((e) => scopeOfEdge(e) === scopeId).sort(bySourceIndex);
    for (const e of scopeEdges) {
      if (!nodeById.has(e.source) && !containerById.has(e.source)) {
        warnings.push({ message: `略過懸空轉移 ${e.id}`, elementId: e.id });
        continue;
      }
      if (!nodeById.has(e.target) && !containerById.has(e.target)) {
        warnings.push({ message: `略過懸空轉移 ${e.id}`, elementId: e.id });
        continue;
      }
      const lbl = e.label && e.label.length > 0 ? `: ${e.label}` : '';
      lines.push(`${pad}${tok(e.source)} --> ${tok(e.target)}${lbl}`);
    }

    // 3. 複合狀態(巢狀)。
    const scopeContainers = scene.containers
      .filter((c) => (c.parentId ?? null) === scopeId)
      .sort(bySourceIndex);
    for (const c of scopeContainers) {
      const decl =
        c.label && c.label !== c.id ? `state ${quoteLabel(c.label)} as ${c.id}` : `state ${c.id}`;
      lines.push(`${pad}${decl} {`);
      if (c.direction && c.direction !== 'TB' && c.direction !== 'TD') {
        lines.push(`${pad}${INDENT}direction ${c.direction}`);
      }
      emitScope(c.id, depth + 1);
      lines.push(`${pad}}`);
    }
  };

  emitScope(null, 0);

  // 4. 未模型化的根層內容(note / classDef / class / style …)逐字回吐。
  for (const s of scene.raw?.styleLines ?? []) lines.push(INDENT + s.trim());

  return { text: lines.join('\n') + '\n', warnings };
}
