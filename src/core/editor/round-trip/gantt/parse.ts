// gantt 文字 → 場景。
//
// 走 mermaid 的 DB:它已經把每個任務的 section / id / 旗標 / 前置任務解好了,連 `raw` 都留著
// (原本寫的是 `after a1` 還是 `2026-01-01`、是 `7d` 還是結束日期)。自己重解那串逗號分隔的
// 參數很容易解錯 —— mermaid 的規則會依 token 數量改變意義。
//
// 只要遇到不支援的東西(非 YYYY-MM-DD 的 dateFormat、解不出的日期),就整份原文回吐:
// 半懂不懂地改寫使用者的甘特圖,比不能編輯糟糕得多。

import type { ParseResult, ParseWarning } from '../../adapters/types';
import type { EditorScene, SceneContainer, SceneNode } from '../../scene/types';
import type { MermaidLike } from '../../../../types';
import {
  BAR_H,
  DAY_W,
  ORIGIN,
  ROW_H,
  SUPPORTED_DATE_FORMAT,
  dayToX,
  daysToWidth,
  parseDay,
  rowY,
} from './model';

interface MermaidApiLike {
  mermaidAPI?: { getDiagramFromText?: (t: string) => Promise<{ db?: unknown }> | { db?: unknown } };
  getDiagramFromText?: (t: string) => Promise<{ db?: unknown }> | { db?: unknown };
}

interface GanttTaskLike {
  section?: string;
  task?: string;
  id?: string;
  order?: number;
  prevTaskId?: string;
  done?: boolean;
  active?: boolean;
  crit?: boolean;
  milestone?: boolean;
  startTime?: Date | string;
  endTime?: Date | string;
  raw?: { startTime?: { startData?: string }; endTime?: { data?: string } };
}
interface GanttDbLike {
  getTasks?: () => GanttTaskLike[];
  getSections?: () => string[];
  getDateFormat?: () => string;
  getAxisFormat?: () => string;
  getDiagramTitle?: () => string;
}

/** DB 沒建模的設定行(excludes / todayMarker / tickInterval / weekday …)逐字保留。 */
const PASSTHROUGH_RE = /^(excludes|includes|todayMarker|tickInterval|weekday|axisFormat|displayMode|topAxis)\b/i;

function prescan(src: string): { comments: string[]; settings: string[] } {
  const comments: string[] = [];
  const settings: string[] = [];
  for (const raw of src.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('%%')) comments.push(line);
    else if (PASSTHROUGH_RE.test(line)) settings.push(line);
  }
  return { comments, settings };
}

async function getGanttDb(text: string, mermaid: MermaidLike): Promise<GanttDbLike | undefined> {
  const api = mermaid as unknown as MermaidApiLike;
  const fn = api.mermaidAPI?.getDiagramFromText ?? api.getDiagramFromText;
  if (typeof fn !== 'function') return undefined;
  try {
    mermaid.initialize?.({ startOnLoad: false });
  } catch {
    /* ignore */
  }
  const diagram = await fn.call(api.mermaidAPI ?? api, text);
  const db = diagram?.db as GanttDbLike | undefined;
  if (!db || typeof db.getTasks !== 'function') return undefined;
  return db;
}

const asMs = (v: Date | string | undefined): number | null => {
  if (!v) return null;
  const t = v instanceof Date ? v.getTime() : Date.parse(v);
  return Number.isFinite(t) ? t : null;
};

/** 原樣回吐用的降級場景(不接管、也絕不覆寫)。 */
function passthrough(text: string, comments: string[], warnings: ParseWarning[]): ParseResult {
  return {
    scene: {
      version: 1,
      diagramType: 'gantt',
      meta: { type: 'gantt', gantt: { settings: [] } },
      nodes: [],
      edges: [],
      containers: [],
      raw: { comments, fullSource: text },
      layoutOwner: 'user',
    },
    warnings,
  };
}

export async function ganttDbToScene(text: string, mermaid: MermaidLike): Promise<ParseResult> {
  const warnings: ParseWarning[] = [];
  const pre = prescan(text);
  let db: GanttDbLike | undefined;
  try {
    db = await getGanttDb(text, mermaid);
  } catch (err) {
    warnings.push({ message: `mermaid 解析失敗:${(err as Error).message}` });
  }
  if (!db) {
    warnings.push({ message: 'mermaid 解析 API 不可用。' });
    return passthrough(text, pre.comments, warnings);
  }

  const dateFormat = (db.getDateFormat?.() ?? '').trim() || SUPPORTED_DATE_FORMAT;
  if (dateFormat !== SUPPORTED_DATE_FORMAT) {
    warnings.push({
      message: `目前只支援 dateFormat ${SUPPORTED_DATE_FORMAT}(這張圖是 ${dateFormat}),已改為唯讀。`,
    });
    return passthrough(text, pre.comments, warnings);
  }

  const tasks = [...(db.getTasks?.() ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  if (tasks.length === 0) return passthrough(text, pre.comments, warnings);

  // 每個任務的實際起訖(mermaid 已把 `after` 解好),用來定位長條。
  const spans = tasks.map((t) => ({ start: asMs(t.startTime), end: asMs(t.endTime) }));
  if (spans.some((s) => s.start === null || s.end === null)) {
    warnings.push({ message: '有任務的日期解不出來,已改為唯讀以免改壞原檔。' });
    return passthrough(text, pre.comments, warnings);
  }
  const epoch = Math.min(...spans.map((s) => s.start as number));

  const sections: string[] = [];
  for (const t of tasks) {
    const s = t.section ?? '';
    if (!sections.includes(s)) sections.push(s);
  }

  const nodes: SceneNode[] = [];
  const containers: SceneContainer[] = [];
  // 每個任務一列;section 依序占用連續的列(垂直位置因此同時決定了「屬於哪個 section」)。
  let row = 0;
  sections.forEach((sec, si) => {
    const first = row;
    tasks.forEach((t, i) => {
      if ((t.section ?? '') !== sec) return;
      const start = spans[i].start as number;
      const end = spans[i].end as number;
      const days = Math.max(0, (end - start) / 86400000);
      const x = dayToX({ epoch }, start);
      nodes.push({
        id: t.id ?? `t${i}`,
        shape: 'ganttBar',
        label: (t.task ?? '').trim(),
        x,
        y: rowY(row) + (ROW_H - BAR_H) / 2,
        w: daysToWidth(days || (t.milestone ? 0 : 1)),
        h: BAR_H,
        parentId: `sec${si}`,
        data: {
          kind: 'gantt',
          flags: [t.done && 'done', t.active && 'active', t.crit && 'crit', t.milestone && 'milestone'].filter(
            Boolean,
          ) as string[],
          startRaw: t.raw?.startTime?.startData ?? '',
          endRaw: t.raw?.endTime?.data ?? '',
          afterId: t.prevTaskId,
        },
        sourceIndex: t.order ?? i,
        pinned: true,
      });
      row += 1;
    });
    containers.push({
      id: `sec${si}`,
      label: sec,
      x: ORIGIN.x - 60,
      y: rowY(first) - 4,
      w: 60 + Math.max(1, row - first) * 0 + DAY_W * 30,
      h: Math.max(1, row - first) * ROW_H,
      parentId: null,
      childNodeIds: [],
      sourceIndex: si,
    });
  });

  const scene: EditorScene = {
    version: 1,
    diagramType: 'gantt',
    meta: {
      type: 'gantt',
      gantt: {
        title: db.getDiagramTitle?.() || undefined,
        dateFormat,
        epoch,
        settings: pre.settings,
      },
    },
    nodes,
    edges: [],
    containers,
    raw: { comments: pre.comments },
    layoutOwner: 'user',
  };
  return { scene, warnings };
}
