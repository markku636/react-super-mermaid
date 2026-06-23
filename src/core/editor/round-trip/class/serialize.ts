// 場景 → classDiagram 文字。確定性、永遠輸出合法 mermaid。

import type { DataLossWarning, SerializeResult } from '../../adapters/types';
import type { ArrowHead, EditorScene, SceneEdge } from '../../scene/types';

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
  return `${e.source} ${left}${line}${right} ${e.target}${label}`;
}

export function sceneToClass(scene: EditorScene): SerializeResult {
  const warnings: DataLossWarning[] = [];
  const lines: string[] = [];

  for (const c of scene.raw?.comments ?? []) {
    if (c.trim().startsWith('%%{')) lines.push(c.trim());
  }
  lines.push('classDiagram');

  // 1. 類別區塊(有成員 / 方法 / stereotype 才開 { };否則孤立類別輸出 `class X`)。
  const inEdge = new Set<string>();
  for (const e of scene.edges) {
    inEdge.add(e.source);
    inEdge.add(e.target);
  }
  for (const n of [...scene.nodes].sort(bySourceIndex)) {
    const data = n.data?.kind === 'class' ? n.data : undefined;
    const members = data?.members ?? [];
    const methods = data?.methods ?? [];
    const stereotype = data?.stereotype;
    const named = n.label && n.label !== n.id ? `${n.id}["${n.label}"]` : n.id;
    if (members.length || methods.length || stereotype) {
      lines.push(`${INDENT}class ${named} {`);
      if (stereotype) lines.push(`${INDENT}${INDENT}<<${stereotype}>>`);
      for (const m of members) lines.push(`${INDENT}${INDENT}${m}`);
      for (const m of methods) lines.push(`${INDENT}${INDENT}${m}`);
      lines.push(`${INDENT}}`);
    } else if (!inEdge.has(n.id)) {
      lines.push(`${INDENT}class ${named}`);
    }
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
