// 場景 → kanban 文字。卡片歸屬哪一欄、在欄內排第幾,都由它的位置決定。

import type { DataLossWarning, SerializeResult } from '../../adapters/types';
import type { EditorScene, SceneNode } from '../../scene/types';
import { laneIndexAt } from './model';

const INDENT = '  ';

/** 欄與卡片都可寫成 `id[顯示文字]`;id 與文字相同時省略成純文字。 */
function nameFor(id: string, label: string): string {
  const text = label || id;
  // mermaid 的 kanban 用 [] 界定顯示文字,所以文字裡不能有中括號。
  const safe = text.replace(/[[\]]/g, '');
  return id === safe ? safe : `${id}[${safe}]`;
}

function cardLine(n: SceneNode): string {
  const d = n.data?.kind === 'kanban' ? n.data : undefined;
  const meta: string[] = [];
  if (d?.assigned) meta.push(`assigned: '${d.assigned}'`);
  if (d?.ticket) meta.push(`ticket: ${d.ticket}`);
  if (d?.priority) meta.push(`priority: '${d.priority}'`);
  return `${nameFor(n.id, n.label)}${meta.length ? `@{ ${meta.join(', ')} }` : ''}`;
}

export function sceneToKanban(scene: EditorScene): SerializeResult {
  if (scene.containers.length === 0 && scene.raw?.fullSource) {
    return { text: scene.raw.fullSource, warnings: [] };
  }
  const warnings: DataLossWarning[] = [];
  const lines: string[] = [];
  if (scene.frontmatter) lines.push(scene.frontmatter.replace(/\n+$/, ''));
  for (const c of scene.raw?.comments ?? []) {
    if (c.trim().startsWith('%%{')) lines.push(c.trim());
  }
  lines.push('kanban');
  for (const c of scene.raw?.comments ?? []) {
    const t = c.trim();
    if (t.startsWith('%%') && !t.startsWith('%%{')) lines.push(INDENT + t);
  }

  const lanes = [...scene.containers].sort((a, b) => (a.sourceIndex ?? 0) - (b.sourceIndex ?? 0));
  // 幾何是唯一真相:欄由卡片中心落點決定,欄內順序由 y 決定(拖曳因此不需要任何額外同步)。
  const buckets: SceneNode[][] = lanes.map(() => []);
  for (const n of scene.nodes) buckets[laneIndexAt(n.x + n.w / 2, lanes.length)].push(n);
  for (const b of buckets) b.sort((a, c) => a.y - c.y);

  lanes.forEach((lane, i) => {
    lines.push(INDENT + nameFor(lane.id, lane.label));
    for (const card of buckets[i]) lines.push(INDENT + INDENT + cardLine(card));
  });

  if (lanes.length === 0 && scene.nodes.length > 0) {
    warnings.push({ message: '看板沒有任何欄位,卡片無處可放。' });
  }
  return { text: lines.join('\n') + '\n', warnings };
}
