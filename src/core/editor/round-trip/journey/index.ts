// user journey 的雙向 round-trip(純文字)。
//
// 語法:
//   journey
//       title 我的一天
//       section 上班
//         泡茶: 5: 我
//         上樓: 3: 我, 貓
//
// 版面沿用看板那套直向泳道:section 是欄,任務是卡片 —— 把任務拖到別的 section 就是改它的階段,
// 上下拖曳就是改順序。心情分數(1..5)顯示在卡片上,由右鍵切換。

import type { ParseResult, ParseWarning } from '../../adapters/types';
import type { DataLossWarning, SerializeResult } from '../../adapters/types';
import type { EditorScene, SceneContainer, SceneNode } from '../../scene/types';
import { CARD, bucketByLane, laneCardX, layoutLanes, sortedLanes } from '../../layout/lanes';

const INDENT = '    ';

/** 任務行:`名稱: 分數: 角色1, 角色2`(分數與角色都可省略)。 */
const TASK_RE = /^(.+?)\s*:\s*(\d+)?\s*(?::\s*(.*))?$/;

export function journeyToScene(text: string): ParseResult {
  const warnings: ParseWarning[] = [];
  const comments: string[] = [];
  const containers: SceneContainer[] = [];
  const nodes: SceneNode[] = [];
  let title: string | undefined;
  let seenHeader = false;
  let laneIdx = 0;
  let taskIdx = 0;

  const laneFor = (name: string): SceneContainer => {
    const c: SceneContainer = {
      id: `s${laneIdx}`,
      label: name,
      x: 0,
      y: 0,
      w: 0,
      h: 0,
      parentId: null,
      childNodeIds: [],
      sourceIndex: laneIdx++,
    };
    containers.push(c);
    return c;
  };

  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('%%')) {
      comments.push(line);
      continue;
    }
    if (!seenHeader && /^journey$/i.test(line)) {
      seenHeader = true;
      continue;
    }
    const t = /^title\s+(.*)$/i.exec(line);
    if (t) {
      title = t[1].trim();
      continue;
    }
    const s = /^section\s+(.*)$/i.exec(line);
    if (s) {
      laneFor(s[1].trim());
      continue;
    }
    const m = TASK_RE.exec(line);
    if (!m) {
      warnings.push({ message: `略過看不懂的一行:${line}` });
      continue;
    }
    // 任務出現在任何 section 之前 → 補一個無名 section(mermaid 也接受)。
    if (containers.length === 0) laneFor('');
    const score = m[2] ? Math.max(1, Math.min(5, Number(m[2]))) : 3;
    const actors = (m[3] ?? '')
      .split(',')
      .map((a) => a.trim())
      .filter(Boolean);
    nodes.push({
      id: `t${taskIdx}`,
      shape: 'journeyTask',
      label: m[1].trim(),
      x: laneCardX(containers.length - 1),
      y: taskIdx,
      w: CARD.w,
      h: CARD.minH + (actors.length ? 16 : 0),
      parentId: containers[containers.length - 1].id,
      data: { kind: 'journey', score, actors },
      sourceIndex: taskIdx++,
    });
  }

  if (!seenHeader) warnings.push({ message: '找不到 journey 標頭,已以空圖處理。' });

  const scene = layoutLanes({
    version: 1,
    diagramType: 'journey',
    meta: { type: 'journey', title },
    nodes,
    edges: [],
    containers,
    raw: { comments, fullSource: seenHeader ? undefined : text },
    layoutOwner: 'user',
  });
  return { scene, warnings };
}

export function sceneToJourney(scene: EditorScene): SerializeResult {
  if (scene.containers.length === 0 && scene.raw?.fullSource) {
    return { text: scene.raw.fullSource, warnings: [] };
  }
  const warnings: DataLossWarning[] = [];
  const meta = scene.meta.type === 'journey' ? scene.meta : { title: undefined };
  const lines: string[] = [];
  for (const c of scene.raw?.comments ?? []) {
    if (c.trim().startsWith('%%{')) lines.push(c.trim());
  }
  lines.push('journey');
  if (meta.title) lines.push(`${INDENT}title ${meta.title}`);
  for (const c of scene.raw?.comments ?? []) {
    const t = c.trim();
    if (t.startsWith('%%') && !t.startsWith('%%{')) lines.push(INDENT + t);
  }

  const lanes = sortedLanes(scene);
  const buckets = bucketByLane(scene, lanes);
  lanes.forEach((lane, i) => {
    lines.push(`${INDENT}section ${lane.label}`);
    for (const task of buckets[i]) {
      const d = task.data?.kind === 'journey' ? task.data : undefined;
      // 名稱裡的冒號會和 `名稱: 分數: 角色` 的分隔衝突。
      const name = (task.label || task.id).replace(/:/g, ' ');
      const actors = d?.actors?.length ? `: ${d.actors.join(', ')}` : '';
      lines.push(`${INDENT}${INDENT}${name}: ${d?.score ?? 3}${actors}`);
    }
  });
  if (lanes.length === 0 && scene.nodes.length > 0) {
    warnings.push({ message: '旅程圖沒有任何 section,任務無處可放。' });
  }
  return { text: lines.join('\n') + '\n', warnings };
}
