// 場景 → classDiagram 文字。確定性、永遠輸出合法 mermaid。

import type { DataLossWarning, SerializeResult } from '../../adapters/types';
import type { ArrowHead, EditorScene, SceneEdge, SceneNode } from '../../scene/types';

const INDENT = '    ';

const LEFT_MARKER: Partial<Record<ArrowHead, string>> = {
  triangle: '<|',
  diamondFilled: '*',
  diamond: 'o',
  open: '<',
  arrow: '<',
  none: '',
};
const RIGHT_MARKER: Partial<Record<ArrowHead, string>> = {
  triangle: '|>',
  diamondFilled: '*',
  diamond: 'o',
  open: '>',
  arrow: '>',
  none: '',
};

function bySourceIndex<T extends { sourceIndex?: number }>(a: T, b: T): number {
  return (a.sourceIndex ?? Number.MAX_SAFE_INTEGER) - (b.sourceIndex ?? Number.MAX_SAFE_INTEGER);
}

function relationLine(e: SceneEdge): string {
  const left = LEFT_MARKER[e.arrowStart] ?? '';
  const right = RIGHT_MARKER[e.arrowEnd] ?? '';
  const line = e.lineKind === 'dotted' ? '..' : '--';
  const label = e.label && e.label.length > 0 ? ` : ${e.label}` : '';
  // 基數標籤:`Source "1" --> "*" Target`(來源側緊接 source、目標側緊接 target 前)。
  const cd = e.data?.kind === 'class' ? e.data : undefined;
  const c1 = cd?.cardinalitySource ? ` "${cd.cardinalitySource}"` : '';
  const c2 = cd?.cardinalityTarget ? ` "${cd.cardinalityTarget}"` : '';
  return `${e.source}${c1} ${left}${line}${right}${c2} ${e.target}${label}`;
}

export function sceneToClass(scene: EditorScene): SerializeResult {
  // 解析失敗的降級場景(空節點但保有原文)→ 原樣回吐,絕不覆寫成空。
  if (scene.nodes.length === 0 && scene.raw?.fullSource) {
    return { text: scene.raw.fullSource, warnings: [] };
  }
  const warnings: DataLossWarning[] = [];
  const lines: string[] = [];

  for (const c of scene.raw?.comments ?? []) {
    if (c.trim().startsWith('%%{')) lines.push(c.trim());
  }
  lines.push('classDiagram');
  const dir = scene.meta.type === 'class' ? scene.meta.direction : undefined;
  if (dir && dir !== 'TB' && dir !== 'TD') lines.push(`${INDENT}direction ${dir}`);

  // 1. 類別區塊(有成員 / 方法 / stereotype 才開 { };否則孤立類別輸出 `class X`)。
  const inEdge = new Set<string>();
  for (const e of scene.edges) {
    inEdge.add(e.source);
    inEdge.add(e.target);
  }
  const emitClass = (n: SceneNode, pad: string): void => {
    const data = n.data?.kind === 'class' ? n.data : undefined;
    const members = data?.members ?? [];
    const methods = data?.methods ?? [];
    const stereotype = data?.stereotype;
    // 泛型類別 → `Id~T~`;自訂標籤 → `Id["label"]`;否則裸 id。
    const named = data?.generic
      ? `${n.id}~${data.generic}~`
      : n.label && n.label !== n.id
        ? `${n.id}["${n.label}"]`
        : n.id;
    if (members.length || methods.length || stereotype) {
      lines.push(`${pad}class ${named} {`);
      if (stereotype) lines.push(`${pad}${INDENT}<<${stereotype}>>`);
      for (const m of members) lines.push(`${pad}${INDENT}${m}`);
      for (const m of methods) lines.push(`${pad}${INDENT}${m}`);
      lines.push(`${pad}}`);
    } else {
      lines.push(`${pad}class ${named}`);
    }
  };
  const byId = new Map(scene.nodes.map((n) => [n.id, n] as const));
  const inNamespace = new Set<string>();
  // namespace 區塊:成員一律宣告於其內。
  for (const c of [...scene.containers].sort(bySourceIndex)) {
    lines.push(`${INDENT}namespace ${c.label || c.id} {`);
    for (const cid of c.childNodeIds) {
      const n = byId.get(cid);
      if (n) {
        inNamespace.add(cid);
        emitClass(n, INDENT + INDENT);
      }
    }
    lines.push(`${INDENT}}`);
  }
  // 頂層類別(不在 namespace);無內容且已被關係宣告者略過。
  for (const n of [...scene.nodes].sort(bySourceIndex)) {
    if (inNamespace.has(n.id)) continue;
    const data = n.data?.kind === 'class' ? n.data : undefined;
    const hasBody = (data?.members?.length || data?.methods?.length || data?.stereotype) as unknown as boolean;
    if (hasBody || !inEdge.has(n.id)) emitClass(n, INDENT);
  }

  // 2. 關係(穩定排序)。
  const ids = new Set(scene.nodes.map((n) => n.id));
  for (const e of [...scene.edges].sort(bySourceIndex)) {
    if (!ids.has(e.source) || !ids.has(e.target)) {
      warnings.push({ message: `略過懸空關係 ${e.id}`, elementId: e.id });
      continue;
    }
    lines.push(INDENT + relationLine(e));
  }

  return { text: lines.join('\n') + '\n', warnings };
}
