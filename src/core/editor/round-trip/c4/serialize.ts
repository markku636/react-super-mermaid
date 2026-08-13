// 場景 → C4 圖文字。確定性、永遠輸出合法 mermaid。

import type { DataLossWarning, SerializeResult } from '../../adapters/types';
import type { EditorScene, SceneContainer, SceneEdge, SceneNode } from '../../scene/types';
import { boundaryKeyword, c4HasTechn, c4Keyword } from './shapes';

const INDENT = '    ';

/** C4 的引數都是帶引號的字串;引號與換行會壞掉語法,先清掉。 */
const q = (s: string | undefined): string => `"${(s ?? '').replace(/["\r\n]+/g, ' ').trim()}"`;

function bySourceIndex<T extends { sourceIndex?: number }>(a: T, b: T): number {
  return (a.sourceIndex ?? Number.MAX_SAFE_INTEGER) - (b.sourceIndex ?? Number.MAX_SAFE_INTEGER);
}

function shapeLine(n: SceneNode): string {
  const d = n.data?.kind === 'c4' ? n.data : undefined;
  const type = d?.c4Type ?? 'system';
  const args = [n.id, q(n.label)];
  // container / component / node 家族的第三個引數是「技術」,其餘型別沒有這一欄。
  if (c4HasTechn(type)) args.push(q(d?.techn));
  args.push(q(d?.descr));
  return `${c4Keyword(type)}(${args.join(', ')})`;
}

function relLine(e: SceneEdge): string {
  const d = e.data?.kind === 'c4' ? e.data : undefined;
  const relType = d?.relType ?? 'rel';
  // rel → Rel、birel → BiRel、rel_u → Rel_U(方向變體只是後綴大寫)。
  const keyword = relType.startsWith('birel')
    ? 'BiRel' + relType.slice(5).toUpperCase()
    : 'Rel' + relType.slice(3).toUpperCase();
  const args = [e.source, e.target, q(e.label)];
  if (d?.techn) args.push(q(d.techn));
  if (d?.descr) args.push(q(d.descr));
  return `${keyword}(${args.join(', ')})`;
}

export function sceneToC4(scene: EditorScene): SerializeResult {
  if (scene.nodes.length === 0 && scene.containers.length === 0 && scene.raw?.fullSource) {
    return { text: scene.raw.fullSource, warnings: [] };
  }
  const warnings: DataLossWarning[] = [];
  const meta = scene.meta.type === 'c4' ? scene.meta : { c4Type: 'C4Context', title: undefined };
  const lines: string[] = [];

  for (const c of scene.raw?.comments ?? []) {
    if (c.trim().startsWith('%%{')) lines.push(c.trim());
  }
  lines.push(meta.c4Type || 'C4Context');
  if (meta.title) lines.push(`${INDENT}title ${meta.title}`);
  for (const c of scene.raw?.comments ?? []) {
    const t = c.trim();
    if (t.startsWith('%%') && !t.startsWith('%%{')) lines.push(INDENT + t);
  }

  const nodesByParent = new Map<string | null, SceneNode[]>();
  for (const n of [...scene.nodes].sort(bySourceIndex)) {
    const p = n.parentId ?? null;
    nodesByParent.set(p, [...(nodesByParent.get(p) ?? []), n]);
  }
  const childBoundaries = (id: string | null): SceneContainer[] =>
    [...scene.containers].sort(bySourceIndex).filter((c) => (c.parentId ?? null) === id);

  const emitScope = (parentId: string | null, depth: number): void => {
    const pad = INDENT.repeat(depth + 1);
    for (const n of nodesByParent.get(parentId) ?? []) lines.push(pad + shapeLine(n));
    for (const b of childBoundaries(parentId)) {
      lines.push(`${pad}${boundaryKeyword(b.c4Type)}(${b.id}, ${q(b.label)}) {`);
      emitScope(b.id, depth + 1);
      lines.push(`${pad}}`);
    }
  };
  emitScope(null, 0);

  const ids = new Set(scene.nodes.map((n) => n.id));
  for (const e of [...scene.edges].sort(bySourceIndex)) {
    if (!ids.has(e.source) || !ids.has(e.target)) {
      warnings.push({ message: `略過懸空關係 ${e.id}`, elementId: e.id });
      continue;
    }
    lines.push(INDENT + relLine(e));
  }

  // UpdateRelStyle / UpdateElementStyle / UpdateLayoutConfig 逐字回吐(見 parse.prescan)。
  for (const s of scene.raw?.styleLines ?? []) lines.push(INDENT + s.trim());

  return { text: lines.join('\n') + '\n', warnings };
}
