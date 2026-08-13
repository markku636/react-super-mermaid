// 場景 → quadrantChart 文字。點的座標由節點位置換算回 0..1。

import type { DataLossWarning, SerializeResult } from '../../adapters/types';
import type { EditorScene, SceneNode } from '../../scene/types';
import { sceneToValue } from './model';

const INDENT = '    ';

/** 0..1 值輸出成兩位小數(mermaid 範例的慣例,也避免拖曳產生一長串浮點雜訊)。 */
const fmt = (v: number): string => (Math.round(v * 100) / 100).toString();

function pointLine(n: SceneNode): string {
  const { qx, qy } = sceneToValue(n.x + n.w / 2, n.y + n.h / 2);
  const d = n.data?.kind === 'quadrant' ? n.data : undefined;
  const style: string[] = [];
  if (d?.radius) style.push(`radius: ${d.radius}`);
  if (d?.color) style.push(`color: ${d.color}`);
  if (d?.strokeColor) style.push(`stroke-color: ${d.strokeColor}`);
  if (d?.strokeWidth) style.push(`stroke-width: ${d.strokeWidth}`);
  // 名稱含冒號會和 `名稱: [x, y]` 的分隔衝突 → 加引號(mermaid 接受引號名稱)。
  const label = n.label || n.id;
  const name = /[:[\]]/.test(label) ? `"${label.replace(/"/g, '')}"` : label;
  return `${name}: [${fmt(qx)}, ${fmt(qy)}]${style.length ? ` ${style.join(', ')}` : ''}`;
}

function bySourceIndex(a: SceneNode, b: SceneNode): number {
  return (a.sourceIndex ?? Number.MAX_SAFE_INTEGER) - (b.sourceIndex ?? Number.MAX_SAFE_INTEGER);
}

export function sceneToQuadrant(scene: EditorScene): SerializeResult {
  if (scene.nodes.length === 0 && scene.raw?.fullSource) {
    return { text: scene.raw.fullSource, warnings: [] };
  }
  const warnings: DataLossWarning[] = [];
  const meta = scene.meta.type === 'quadrant' ? scene.meta.quadrant : { quadrants: [] as [] };
  const lines: string[] = [];

  if (scene.frontmatter) lines.push(scene.frontmatter.replace(/\n+$/, ''));
  for (const c of scene.raw?.comments ?? []) {
    if (c.trim().startsWith('%%{')) lines.push(c.trim());
  }
  lines.push('quadrantChart');
  if (meta.title) lines.push(`${INDENT}title ${meta.title}`);
  if (meta.xAxis) {
    lines.push(`${INDENT}x-axis ${meta.xAxis.left}${meta.xAxis.right ? ` --> ${meta.xAxis.right}` : ''}`);
  }
  if (meta.yAxis) {
    lines.push(`${INDENT}y-axis ${meta.yAxis.bottom}${meta.yAxis.top ? ` --> ${meta.yAxis.top}` : ''}`);
  }
  meta.quadrants.forEach((q, i) => {
    if (q) lines.push(`${INDENT}quadrant-${i + 1} ${q}`);
  });
  for (const c of scene.raw?.comments ?? []) {
    const t = c.trim();
    if (t.startsWith('%%') && !t.startsWith('%%{')) lines.push(INDENT + t);
  }
  for (const n of [...scene.nodes].sort(bySourceIndex)) lines.push(INDENT + pointLine(n));
  for (const l of meta.extraLines ?? []) lines.push(INDENT + l);

  return { text: lines.join('\n') + '\n', warnings };
}
