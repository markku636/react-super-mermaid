// 場景 → gantt 文字。長條的 x 換算回開始日期、寬度換算回工期,y 決定它屬於哪個 section。

import type { DataLossWarning, SerializeResult } from '../../adapters/types';
import type { EditorScene, SceneNode } from '../../scene/types';
import { addDays, formatDay, formatDuration, parseDay, widthToDays, xToDay, yToRow } from './model';

const INDENT = '    ';

function bySourceIndex(a: SceneNode, b: SceneNode): number {
  return (a.sourceIndex ?? Number.MAX_SAFE_INTEGER) - (b.sourceIndex ?? Number.MAX_SAFE_INTEGER);
}

export function sceneToGantt(scene: EditorScene): SerializeResult {
  // 不接管的圖(不支援的 dateFormat / 解不出的日期)原樣回吐。
  if (scene.nodes.length === 0 && scene.raw?.fullSource) {
    return { text: scene.raw.fullSource, warnings: [] };
  }
  const warnings: DataLossWarning[] = [];
  const meta = scene.meta.type === 'gantt' ? scene.meta.gantt : { settings: [] as string[] };
  const epoch = meta.epoch ?? 0;
  const lines: string[] = [];

  for (const c of scene.raw?.comments ?? []) {
    if (c.trim().startsWith('%%{')) lines.push(c.trim());
  }
  lines.push('gantt');
  if (meta.title) lines.push(`${INDENT}title ${meta.title}`);
  if (meta.dateFormat) lines.push(`${INDENT}dateFormat ${meta.dateFormat}`);
  for (const s of meta.settings ?? []) lines.push(INDENT + s);
  for (const c of scene.raw?.comments ?? []) {
    const t = c.trim();
    if (t.startsWith('%%') && !t.startsWith('%%{')) lines.push(INDENT + t);
  }

  // 垂直位置決定 section:與看板同一套「幾何即真相」,把長條拖到別的 section 帶就是換 section。
  const bands = [...scene.containers].sort((a, b) => (a.sourceIndex ?? 0) - (b.sourceIndex ?? 0));
  const rowOfBand = new Map<string, { first: number; last: number }>();
  bands.forEach((b) => {
    rowOfBand.set(b.id, { first: yToRow(b.y + 4), last: yToRow(b.y + b.h) - 1 });
  });
  const sectionFor = (n: SceneNode): string => {
    const r = yToRow(n.y);
    for (const b of bands) {
      const range = rowOfBand.get(b.id);
      if (range && r >= range.first && r <= range.last) return b.id;
    }
    // 拖到所有帶之外 → 歸最近的一帶(不要憑空生出無名 section)。
    return bands.length ? (bands[Math.min(bands.length - 1, Math.max(0, r < 0 ? 0 : bands.length - 1))].id) : '';
  };

  const start = new Map<string, number>();
  for (const n of scene.nodes) start.set(n.id, xToDay({ epoch }, n.x));

  const emitTask = (n: SceneNode): string => {
    const d = n.data?.kind === 'gantt' ? n.data : undefined;
    const s = start.get(n.id) as number;
    const days = widthToDays(n.w);
    const parts: string[] = [...(d?.flags ?? [])];
    if (n.id) parts.push(n.id);

    // 開始:原本寫 `after X` 而且拖完仍然接在 X 後面 → 保留相依關係;否則寫明確日期。
    const afterId = d?.afterId;
    const keepAfter =
      afterId &&
      d?.startRaw?.startsWith('after') &&
      scene.nodes.some((p) => p.id === afterId && Math.abs(p.x + p.w - n.x) < 1);
    parts.push(keepAfter ? (d?.startRaw as string) : formatDay(s));

    // 結束:原本寫工期就還工期(單位照舊)、原本寫日期就還日期。
    const endRaw = d?.endRaw ?? '';
    const endIsDate = parseDay(endRaw) !== null;
    parts.push(endIsDate ? formatDay(addDays(s, days)) : formatDuration(days, endRaw || 'd'));
    // 任務名稱裡有冒號會和 `名稱 :參數` 的分隔衝突。
    return `${(n.label || n.id).replace(/:/g, ' ')} :${parts.join(', ')}`;
  };

  const byBand = new Map<string, SceneNode[]>();
  for (const n of [...scene.nodes].sort(bySourceIndex)) {
    const b = sectionFor(n);
    byBand.set(b, [...(byBand.get(b) ?? []), n]);
  }
  for (const band of bands) {
    const list = (byBand.get(band.id) ?? []).sort((a, b) => a.y - b.y || bySourceIndex(a, b));
    if (band.label) lines.push(`${INDENT}section ${band.label}`);
    for (const n of list) lines.push(`${INDENT}${INDENT}${emitTask(n)}`);
  }
  if (bands.length === 0 && scene.nodes.length > 0) {
    warnings.push({ message: '甘特圖沒有任何 section,任務無處可放。' });
  }

  return { text: lines.join('\n') + '\n', warnings };
}
