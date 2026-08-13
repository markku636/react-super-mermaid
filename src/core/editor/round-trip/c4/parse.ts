// C4 圖(C4Context / C4Container / C4Component / …)文字 → 場景。
//
// mermaid 的 C4 DB 給的是三個扁平集合:getC4ShapeArray()(元素,含 parentBoundary)、
// getBoundaries()(邊界,含 parentBoundary)、getRels()(關係)。巢狀關係全靠 parentBoundary,
// 所以場景直接對映成 nodes + containers(parentId)+ edges。

import type { ParseResult, ParseWarning } from '../../adapters/types';
import type { EditorScene, SceneContainer, SceneEdge, SceneNode } from '../../scene/types';
import type { MermaidLike } from '../../../../types';
import { c4BoxSize } from '../../render/node-metrics';
import { c4Shape } from './shapes';

interface MermaidApiLike {
  mermaidAPI?: { getDiagramFromText?: (t: string) => Promise<{ db?: unknown }> | { db?: unknown } };
  getDiagramFromText?: (t: string) => Promise<{ db?: unknown }> | { db?: unknown };
}

interface TextLike {
  text?: string;
}
interface C4ShapeLike {
  alias?: string;
  label?: TextLike;
  descr?: TextLike;
  techn?: TextLike;
  typeC4Shape?: TextLike;
  parentBoundary?: string;
}
interface C4BoundaryLike {
  alias?: string;
  label?: TextLike;
  type?: TextLike;
  parentBoundary?: string;
}
interface C4RelLike {
  type?: string;
  from?: string;
  to?: string;
  label?: TextLike;
  techn?: TextLike;
  descr?: TextLike;
}
interface C4DbLike {
  getC4ShapeArray?: () => C4ShapeLike[];
  getBoundaries?: () => C4BoundaryLike[];
  getBoundarys?: () => C4BoundaryLike[];
  getRels?: () => C4RelLike[];
  getTitle?: () => string | undefined;
  getC4Type?: () => string | undefined;
}

const txt = (t: TextLike | undefined): string | undefined => {
  const s = t?.text?.trim();
  return s && s.length ? s : undefined;
};

/**
 * 逐字保留 DB 看不到的行:%% 註解,以及 UpdateRelStyle / UpdateElementStyle / UpdateLayoutConfig。
 * 那些樣式指令 mermaid 是「套進去」而不是留著,重建會失真,所以原封不動搬回去。
 */
function prescan(src: string): { comments: string[]; styleLines: string[] } {
  const comments: string[] = [];
  const styleLines: string[] = [];
  for (const raw of src.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('%%')) comments.push(line);
    else if (/^Update(RelStyle|ElementStyle|LayoutConfig)\s*\(/.test(line)) styleLines.push(line);
  }
  return { comments, styleLines };
}

async function getC4Db(text: string, mermaid: MermaidLike): Promise<C4DbLike | undefined> {
  const api = mermaid as unknown as MermaidApiLike;
  const fn = api.mermaidAPI?.getDiagramFromText ?? api.getDiagramFromText;
  if (typeof fn !== 'function') return undefined;
  try {
    mermaid.initialize?.({ startOnLoad: false });
  } catch {
    /* ignore */
  }
  const diagram = await fn.call(api.mermaidAPI ?? api, text);
  const db = diagram?.db as C4DbLike | undefined;
  if (!db || typeof db.getC4ShapeArray !== 'function') return undefined;
  return db;
}

export async function c4DbToScene(text: string, mermaid: MermaidLike): Promise<ParseResult> {
  const warnings: ParseWarning[] = [];
  const pre = prescan(text);
  let db: C4DbLike | undefined;
  try {
    db = await getC4Db(text, mermaid);
  } catch (err) {
    warnings.push({ message: `mermaid 解析失敗:${(err as Error).message}` });
  }
  if (!db) {
    return {
      scene: {
        version: 1,
        diagramType: 'c4',
        meta: { type: 'c4', c4Type: 'C4Context' },
        nodes: [],
        edges: [],
        containers: [],
        raw: { comments: pre.comments, styleLines: pre.styleLines, fullSource: text },
        layoutOwner: 'engine',
      },
      warnings: warnings.length ? warnings : [{ message: 'mermaid 解析 API 不可用。' }],
    };
  }

  // 'global' 是 mermaid 內建的根邊界,不是使用者寫的 → 不建成容器。
  const rawBoundaries = (db.getBoundaries?.() ?? db.getBoundarys?.() ?? []).filter(
    (b) => (b.alias ?? '') !== 'global',
  );
  const boundaryIds = new Set(rawBoundaries.map((b) => b.alias ?? ''));
  const parentOf = (p: string | undefined): string | null =>
    p && p !== 'global' && boundaryIds.has(p) ? p : null;

  const containers: SceneContainer[] = rawBoundaries.map((b, i) => ({
    id: b.alias ?? `b${i}`,
    label: txt(b.label) ?? b.alias ?? '',
    x: 0,
    y: 0,
    w: 0,
    h: 0,
    parentId: parentOf(b.parentBoundary),
    childNodeIds: [],
    c4Type: txt(b.type) ?? 'BOUNDARY',
    sourceIndex: i,
  }));
  const containerById = new Map(containers.map((c) => [c.id, c] as const));

  const nodes: SceneNode[] = [];
  let idx = 0;
  for (const s of db.getC4ShapeArray?.() ?? []) {
    const id = s.alias ?? `c${idx}`;
    const c4Type = txt(s.typeC4Shape) ?? 'system';
    const label = txt(s.label) ?? id;
    const data = { kind: 'c4' as const, c4Type, techn: txt(s.techn), descr: txt(s.descr) };
    const parentId = parentOf(s.parentBoundary);
    if (parentId) containerById.get(parentId)?.childNodeIds.push(id);
    nodes.push({
      id,
      shape: c4Shape(c4Type),
      label,
      x: 0,
      y: 0,
      ...c4BoxSize(label, data),
      parentId,
      data,
      sourceIndex: idx++,
    });
  }

  const ids = new Set(nodes.map((n) => n.id));
  const edges: SceneEdge[] = [];
  let eIdx = 0;
  for (const r of db.getRels?.() ?? []) {
    const from = r.from ?? '';
    const to = r.to ?? '';
    if (!ids.has(from) || !ids.has(to)) {
      warnings.push({ message: `關係端點找不到元素:${from} → ${to}` });
      continue;
    }
    const relType = (r.type ?? 'rel').toLowerCase();
    edges.push({
      id: `e${eIdx}`,
      source: from,
      target: to,
      label: txt(r.label),
      lineKind: 'solid',
      arrowStart: relType === 'birel' ? 'arrow' : 'none',
      arrowEnd: 'arrow',
      data: { kind: 'c4', relType, techn: txt(r.techn), descr: txt(r.descr) },
      sourceIndex: eIdx++,
    });
  }

  const scene: EditorScene = {
    version: 1,
    diagramType: 'c4',
    meta: { type: 'c4', c4Type: db.getC4Type?.() ?? 'C4Context', title: db.getTitle?.() || undefined },
    nodes,
    edges,
    containers,
    raw: { comments: pre.comments, styleLines: pre.styleLines },
    layoutOwner: 'engine',
  };
  return { scene, warnings };
}
