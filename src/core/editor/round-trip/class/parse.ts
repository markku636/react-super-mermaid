// classDiagram 文字 → 場景。透過 mermaid 解析後 DB 的 getData() 取得類別(成員/方法)與關係。

import type { ParseResult, ParseWarning } from '../../adapters/types';
import type { ArrowHead, EditorScene, FlowDirection, SceneEdge, SceneNode } from '../../scene/types';
import type { MermaidLike } from '../../../../types';

interface MermaidApiLike {
  mermaidAPI?: { getDiagramFromText?: (t: string) => Promise<{ db?: unknown }> | { db?: unknown } };
  getDiagramFromText?: (t: string) => Promise<{ db?: unknown }> | { db?: unknown };
}
interface ClassMemberLike {
  memberType?: string;
  visibility?: string;
  id?: string;
  text?: string;
  parameters?: string;
  returnType?: string;
}
interface ClassNodeLike {
  id: string;
  label?: string;
  shape?: string;
  isGroup?: boolean;
  members?: ClassMemberLike[];
  methods?: ClassMemberLike[];
  annotations?: string[];
}
interface ClassEdgeLike {
  id?: string;
  start: string;
  end: string;
  label?: string;
  arrowTypeStart?: string;
  arrowTypeEnd?: string;
  pattern?: string;
}
interface ClassDbLike {
  getData?: () => { nodes: ClassNodeLike[]; edges: ClassEdgeLike[] };
  getDirection?: () => string;
}

function normalizeDirection(dir: string | undefined): FlowDirection {
  const d = (dir ?? 'TB').toUpperCase();
  if (d === 'TD') return 'TD';
  if (d === 'BT' || d === 'RL' || d === 'LR' || d === 'TB') return d as FlowDirection;
  return 'TB';
}

/** class 關係箭頭名 → 場景 ArrowHead(供渲染;序列化另有反查)。 */
function arrowFromClass(t: string | undefined): ArrowHead {
  switch (t) {
    case 'extension':
      return 'triangle';
    case 'composition':
      return 'diamondFilled';
    case 'aggregation':
      return 'diamond';
    case 'dependency':
      return 'open';
    default:
      return 'none';
  }
}

/** 重建成員字串:`+String name`。 */
function memberText(m: ClassMemberLike): string {
  const vis = m.visibility ?? '';
  return `${vis}${m.id ?? ''}`.trim();
}
/** 重建方法字串:`+makeSound() void`。 */
function methodText(m: ClassMemberLike): string {
  const vis = m.visibility ?? '';
  const ret = m.returnType ? ` ${m.returnType}` : '';
  return `${vis}${m.id ?? ''}(${m.parameters ?? ''})${ret}`.trim();
}

function classSize(label: string, rows: string[]): { w: number; h: number } {
  const longest = Math.max(label.length, ...rows.map((r) => r.length), 8);
  const w = Math.max(120, longest * 7.5 + 24);
  const h = 30 + Math.max(1, rows.length) * 19 + 12;
  return { w, h };
}

function prescan(src: string): { comments: string[] } {
  const comments: string[] = [];
  for (const raw of src.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('%%')) comments.push(line);
  }
  return { comments };
}

async function getClassDb(text: string, mermaid: MermaidLike): Promise<ClassDbLike | undefined> {
  const api = mermaid as unknown as MermaidApiLike;
  const fn = api.mermaidAPI?.getDiagramFromText ?? api.getDiagramFromText;
  if (typeof fn !== 'function') return undefined;
  try {
    mermaid.initialize?.({ startOnLoad: false });
  } catch {
    /* ignore */
  }
  const diagram = await fn.call(api.mermaidAPI ?? api, text);
  const db = diagram?.db as ClassDbLike | undefined;
  if (!db || typeof db.getData !== 'function') return undefined;
  return db;
}

export async function classDbToScene(text: string, mermaid: MermaidLike): Promise<ParseResult> {
  const warnings: ParseWarning[] = [];
  const pre = prescan(text);
  let db: ClassDbLike | undefined;
  try {
    db = await getClassDb(text, mermaid);
  } catch (err) {
    warnings.push({ message: `mermaid 解析失敗:${(err as Error).message}` });
  }
  if (!db) {
    return {
      scene: {
        version: 1,
        diagramType: 'class',
        meta: { type: 'class' },
        nodes: [],
        edges: [],
        containers: [],
        raw: { comments: pre.comments, fullSource: text },
        layoutOwner: 'engine',
      },
      warnings: warnings.length ? warnings : [{ message: 'mermaid 解析 API 不可用。' }],
    };
  }

  const data = db.getData?.() ?? { nodes: [], edges: [] };
  const direction = normalizeDirection(db.getDirection?.());

  const nodes: SceneNode[] = [];
  let nIdx = 0;
  for (const dn of data.nodes) {
    if (dn.isGroup) continue; // namespace 群組(後續處理);v1 略過容器
    const members = (dn.members ?? []).map(memberText).filter(Boolean);
    const methods = (dn.methods ?? []).map(methodText).filter(Boolean);
    const stereotype = dn.annotations && dn.annotations.length ? dn.annotations[0] : undefined;
    const size = classSize(dn.label ?? dn.id, [...members, ...methods]);
    nodes.push({
      id: dn.id,
      shape: 'classBox',
      label: dn.label ?? dn.id,
      x: 0,
      y: 0,
      w: size.w,
      h: size.h,
      data: { kind: 'class', members, methods, stereotype },
      sourceIndex: nIdx++,
    });
  }

  const edges: SceneEdge[] = [];
  let eIdx = 0;
  for (const de of data.edges) {
    edges.push({
      id: de.id ?? `e${eIdx}`,
      source: de.start,
      target: de.end,
      label: de.label && de.label.length > 0 ? de.label : undefined,
      lineKind: de.pattern === 'dashed' ? 'dotted' : 'solid',
      arrowStart: arrowFromClass(de.arrowTypeStart),
      arrowEnd: arrowFromClass(de.arrowTypeEnd),
      data: { kind: 'class', relation: 'association' },
      sourceIndex: eIdx++,
    });
  }

  return {
    scene: {
      version: 1,
      diagramType: 'class',
      meta: { type: 'class', direction },
      nodes,
      edges,
      containers: [],
      raw: { comments: pre.comments },
      layoutOwner: 'engine',
    },
    warnings,
  };
}
