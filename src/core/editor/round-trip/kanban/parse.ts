// kanban 文字 → 場景。欄(section)成為容器,卡片成為節點。

import type { ParseResult, ParseWarning } from '../../adapters/types';
import type { EditorScene, SceneContainer, SceneNode } from '../../scene/types';
import type { MermaidLike } from '../../../../types';
import { CARD, laneCardX, layoutKanban } from './model';

interface MermaidApiLike {
  mermaidAPI?: { getDiagramFromText?: (t: string) => Promise<{ db?: unknown }> | { db?: unknown } };
  getDiagramFromText?: (t: string) => Promise<{ db?: unknown }> | { db?: unknown };
}

interface KanbanNodeLike {
  id?: string;
  parentId?: string;
  label?: string;
  isGroup?: boolean;
  assigned?: string;
  ticket?: string;
  priority?: string;
}
interface KanbanDbLike {
  getData?: () => { nodes?: KanbanNodeLike[] };
}

const FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/;

/** 卡片高度:標籤長就多幾行,再加上有 metadata 時的那一列。 */
function cardHeight(label: string, hasMeta: boolean): number {
  const rows = Math.max(1, Math.ceil(label.length / 18));
  return Math.max(CARD.minH, 18 + rows * 18 + (hasMeta ? 18 : 0));
}

async function getKanbanDb(text: string, mermaid: MermaidLike): Promise<KanbanDbLike | undefined> {
  const api = mermaid as unknown as MermaidApiLike;
  const fn = api.mermaidAPI?.getDiagramFromText ?? api.getDiagramFromText;
  if (typeof fn !== 'function') return undefined;
  try {
    mermaid.initialize?.({ startOnLoad: false });
  } catch {
    /* ignore */
  }
  const diagram = await fn.call(api.mermaidAPI ?? api, text);
  const db = diagram?.db as KanbanDbLike | undefined;
  if (!db || typeof db.getData !== 'function') return undefined;
  return db;
}

export async function kanbanDbToScene(text: string, mermaid: MermaidLike): Promise<ParseResult> {
  const warnings: ParseWarning[] = [];
  const fm = FRONTMATTER_RE.exec(text);
  const frontmatter = fm ? fm[0].replace(/\r?\n$/, '') : undefined;
  const comments = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('%%'));

  let db: KanbanDbLike | undefined;
  try {
    db = await getKanbanDb(text, mermaid);
  } catch (err) {
    warnings.push({ message: `mermaid 解析失敗:${(err as Error).message}` });
  }
  if (!db) {
    return {
      scene: {
        version: 1,
        diagramType: 'kanban',
        meta: { type: 'kanban' },
        nodes: [],
        edges: [],
        containers: [],
        frontmatter,
        raw: { comments, fullSource: text },
        layoutOwner: 'user',
      },
      warnings: warnings.length ? warnings : [{ message: 'mermaid 解析 API 不可用。' }],
    };
  }

  const data = db.getData?.() ?? {};
  const containers: SceneContainer[] = [];
  const nodes: SceneNode[] = [];
  let sIdx = 0;
  let nIdx = 0;
  // getData().nodes 是「欄、欄內的卡、下一欄…」的扁平串;isGroup 區分兩者,parentId 給歸屬。
  for (const n of data.nodes ?? []) {
    const id = n.id ?? `k${sIdx + nIdx}`;
    if (n.isGroup) {
      containers.push({
        id,
        label: n.label ?? id,
        x: 0,
        y: 0,
        w: 0,
        h: 0,
        parentId: null,
        childNodeIds: [],
        sourceIndex: sIdx++,
      });
      continue;
    }
    const meta = { assigned: n.assigned, ticket: n.ticket, priority: n.priority };
    const hasMeta = Boolean(meta.assigned || meta.ticket || meta.priority);
    const label = n.label ?? id;
    nodes.push({
      id,
      shape: 'kanbanCard',
      label,
      x: 0,
      y: 0,
      w: CARD.w,
      h: cardHeight(label, hasMeta),
      parentId: n.parentId ?? null,
      data: { kind: 'kanban', ...meta },
      sourceIndex: nIdx++,
    });
  }

  // 初始位置:先照 parentId 把卡片放進它原本的欄(x 用該欄的卡片位置,版面才判得回同一欄),
  // y 只需保持原順序,實際座標交給 layoutKanban 算。
  const laneOrder = new Map(containers.map((c, i) => [c.id, i] as const));
  const seeded = nodes.map((n, i) => ({
    ...n,
    x: laneCardX(laneOrder.get(n.parentId ?? '') ?? 0),
    y: i,
  }));

  const scene: EditorScene = layoutKanban({
    version: 1,
    diagramType: 'kanban',
    meta: { type: 'kanban' },
    nodes: seeded,
    edges: [],
    containers,
    frontmatter,
    raw: { comments },
    layoutOwner: 'user',
  });
  return { scene, warnings };
}
