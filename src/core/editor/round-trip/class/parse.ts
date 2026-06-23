// classDiagram 文字 → 場景。透過 mermaid 解析後 DB 的 getData() 取得類別(成員/方法)與關係。

import type { ParseResult, ParseWarning } from '../../adapters/types';
import type { ArrowHead, EditorScene, FlowDirection, SceneContainer, SceneEdge, SceneNode } from '../../scene/types';
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
  parentId?: string;
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
interface ClassRelationLike {
  id1: string;
  id2: string;
  title?: string;
  relationTitle1?: string;
  relationTitle2?: string;
}
interface ClassDbLike {
  getData?: () => { nodes: ClassNodeLike[]; edges: ClassEdgeLike[] };
  getRelations?: () => ClassRelationLike[];
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

function prescan(src: string): { comments: string[]; generics: Map<string, string> } {
  const comments: string[] = [];
  // 類別自身的泛型參數(class Foo~T~)被 mermaid getData 丟棄 → 從原文撈回。
  const generics = new Map<string, string>();
  const reGeneric = /\bclass\s+(\w+)~([^~]+)~/g;
  let m: RegExpExecArray | null;
  while ((m = reGeneric.exec(src)) !== null) generics.set(m[1], m[2]);
  for (const raw of src.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('%%')) comments.push(line);
  }
  return { comments, generics };
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
  const containers: SceneContainer[] = [];
  let nIdx = 0;
  let cIdx = 0;
  for (const dn of data.nodes) {
    if (dn.isGroup) {
      // namespace → 容器(保留分組,序列化回 `namespace X { }`)。
      containers.push({
        id: dn.id,
        label: dn.label ?? dn.id,
        x: 0,
        y: 0,
        w: 0,
        h: 0,
        parentId: dn.parentId ?? null,
        childNodeIds: [],
        sourceIndex: cIdx++,
      });
      continue;
    }
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
      parentId: dn.parentId ?? null,
      data: { kind: 'class', members, methods, stereotype, generic: pre.generics.get(dn.id) },
      sourceIndex: nIdx++,
    });
  }
  // 指派 namespace 子成員。
  const cById = new Map(containers.map((c) => [c.id, c] as const));
  for (const n of nodes) if (n.parentId && cById.has(n.parentId)) cById.get(n.parentId)!.childNodeIds.push(n.id);

  // 基數標籤(getData edges 不含,要從 getRelations 補:relationTitle1/2)。依 id1|id2|title 配對。
  const relCard = new Map<string, { c1?: string; c2?: string }>();
  for (const r of db.getRelations?.() ?? []) {
    const key = `${r.id1}|${r.id2}|${r.title ?? ''}`;
    if (!relCard.has(key)) relCard.set(key, { c1: r.relationTitle1, c2: r.relationTitle2 });
  }
  const edges: SceneEdge[] = [];
  let eIdx = 0;
  for (const de of data.edges) {
    const card = relCard.get(`${de.start}|${de.end}|${de.label ?? ''}`);
    const cardinalitySource = card?.c1 && card.c1 !== 'none' ? card.c1 : undefined;
    const cardinalityTarget = card?.c2 && card.c2 !== 'none' ? card.c2 : undefined;
    edges.push({
      id: de.id ?? `e${eIdx}`,
      source: de.start,
      target: de.end,
      label: de.label && de.label.length > 0 ? de.label : undefined,
      lineKind: de.pattern === 'dashed' ? 'dotted' : 'solid',
      arrowStart: arrowFromClass(de.arrowTypeStart),
      arrowEnd: arrowFromClass(de.arrowTypeEnd),
      data: { kind: 'class', relation: 'association', cardinalitySource, cardinalityTarget },
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
      containers,
      raw: { comments: pre.comments },
      layoutOwner: 'engine',
    },
    warnings,
  };
}
