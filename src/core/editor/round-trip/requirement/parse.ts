// requirementDiagram 文字 → 場景。
//
// mermaid 的 requirement DB 有三個各自獨立的集合:getRequirements() / getElements() 是以「名稱」
// 為鍵的 Map,getRelationships() 是 {type, src, dst} 陣列(端點也是名稱)。所以場景節點 id 直接
// 用名稱(與 ER 同套路),序列化時再正規化回去。

import type { ParseResult, ParseWarning } from '../../adapters/types';
import type {
  EditorScene,
  FlowDirection,
  ReqRelation,
  ReqRisk,
  ReqType,
  ReqVerify,
  SceneEdge,
  SceneNode,
} from '../../scene/types';
import type { MermaidLike } from '../../../../types';
import { requirementBoxSize } from '../../render/node-metrics';

interface MermaidApiLike {
  mermaidAPI?: { getDiagramFromText?: (t: string) => Promise<{ db?: unknown }> | { db?: unknown } };
  getDiagramFromText?: (t: string) => Promise<{ db?: unknown }> | { db?: unknown };
}

interface ReqRecordLike {
  name?: string;
  type?: string;
  requirementId?: string;
  text?: string;
  risk?: string;
  verifyMethod?: string;
}
interface ElRecordLike {
  name?: string;
  type?: string;
  docRef?: string;
}
interface RelRecordLike {
  type?: string;
  src?: string;
  dst?: string;
}
interface ReqDbLike {
  getRequirements?: () => Map<string, ReqRecordLike> | Record<string, ReqRecordLike>;
  getElements?: () => Map<string, ElRecordLike> | Record<string, ElRecordLike>;
  getRelationships?: () => RelRecordLike[];
  getDirection?: () => string | undefined;
}

/** DB 回傳的顯示型別("Functional Requirement")→ mermaid 關鍵字。 */
const TYPE_FROM_DB: Record<string, ReqType> = {
  requirement: 'requirement',
  'functional requirement': 'functionalRequirement',
  'interface requirement': 'interfaceRequirement',
  'performance requirement': 'performanceRequirement',
  'physical requirement': 'physicalRequirement',
  'design constraint': 'designConstraint',
};
const RISKS: ReqRisk[] = ['low', 'medium', 'high'];
const VERIFIES: ReqVerify[] = ['analysis', 'inspection', 'test', 'demonstration'];
const RELATIONS: ReqRelation[] = ['contains', 'copies', 'derives', 'satisfies', 'verifies', 'refines', 'traces'];

const asEntries = <T>(v: Map<string, T> | Record<string, T> | undefined): Array<[string, T]> =>
  v instanceof Map ? [...v.entries()] : Object.entries(v ?? {});

const lower = (s: string | undefined): string => (s ?? '').trim().toLowerCase();

function normalizeDir(dir: string | undefined): FlowDirection | undefined {
  const d = (dir ?? '').toUpperCase();
  return d === 'BT' || d === 'RL' || d === 'LR' || d === 'TB' || d === 'TD' ? (d as FlowDirection) : undefined;
}

/** %% 註解 / style 等未模型化的根層內容逐字保留。 */
function prescan(src: string): { comments: string[]; styleLines: string[] } {
  const comments: string[] = [];
  const styleLines: string[] = [];
  let depth = 0;
  for (const raw of src.split('\n')) {
    const line = raw.trim();
    depth += (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length;
    if (!line) continue;
    if (line.startsWith('%%')) comments.push(line);
    else if (depth <= 0 && /^(classDef|class|style)\b/.test(line)) styleLines.push(line);
  }
  return { comments, styleLines };
}

async function getReqDb(text: string, mermaid: MermaidLike): Promise<ReqDbLike | undefined> {
  const api = mermaid as unknown as MermaidApiLike;
  const fn = api.mermaidAPI?.getDiagramFromText ?? api.getDiagramFromText;
  if (typeof fn !== 'function') return undefined;
  try {
    mermaid.initialize?.({ startOnLoad: false });
  } catch {
    /* ignore */
  }
  const diagram = await fn.call(api.mermaidAPI ?? api, text);
  const db = diagram?.db as ReqDbLike | undefined;
  if (!db || typeof db.getRequirements !== 'function') return undefined;
  return db;
}

export async function requirementDbToScene(text: string, mermaid: MermaidLike): Promise<ParseResult> {
  const warnings: ParseWarning[] = [];
  const pre = prescan(text);
  let db: ReqDbLike | undefined;
  try {
    db = await getReqDb(text, mermaid);
  } catch (err) {
    warnings.push({ message: `mermaid 解析失敗:${(err as Error).message}` });
  }
  if (!db) {
    return {
      scene: {
        version: 1,
        diagramType: 'requirement',
        meta: { type: 'requirement' },
        nodes: [],
        edges: [],
        containers: [],
        raw: { comments: pre.comments, styleLines: pre.styleLines, fullSource: text },
        layoutOwner: 'engine',
      },
      warnings: warnings.length ? warnings : [{ message: 'mermaid 解析 API 不可用。' }],
    };
  }

  const nodes: SceneNode[] = [];
  let idx = 0;
  for (const [name, r] of asEntries(db.getRequirements?.())) {
    const req = {
      element: false as const,
      reqType: TYPE_FROM_DB[lower(r.type)] ?? 'requirement',
      reqId: r.requirementId || undefined,
      text: r.text || undefined,
      risk: RISKS.find((x) => x === lower(r.risk)),
      verifyMethod: VERIFIES.find((x) => x === lower(r.verifyMethod)),
    };
    const label = r.name || name;
    nodes.push({
      id: label,
      shape: 'requirementBox',
      label,
      x: 0,
      y: 0,
      ...requirementBoxSize(label, req),
      data: { kind: 'requirement', req },
      sourceIndex: idx++,
    });
  }
  for (const [name, el] of asEntries(db.getElements?.())) {
    const req = { element: true as const, elementType: el.type || undefined, docRef: el.docRef || undefined };
    const label = el.name || name;
    nodes.push({
      id: label,
      shape: 'elementBox',
      label,
      x: 0,
      y: 0,
      ...requirementBoxSize(label, req),
      data: { kind: 'requirement', req },
      sourceIndex: idx++,
    });
  }

  const ids = new Set(nodes.map((n) => n.id));
  const edges: SceneEdge[] = [];
  let eIdx = 0;
  for (const rel of db.getRelationships?.() ?? []) {
    const src = rel.src ?? '';
    const dst = rel.dst ?? '';
    if (!ids.has(src) || !ids.has(dst)) {
      warnings.push({ message: `關係端點找不到節點:${src} - ${rel.type} -> ${dst}` });
      continue;
    }
    edges.push({
      id: `e${eIdx}`,
      source: src,
      target: dst,
      label: undefined,
      lineKind: 'solid',
      arrowStart: 'none',
      arrowEnd: 'arrow',
      data: { kind: 'requirement', relation: RELATIONS.find((x) => x === lower(rel.type)) ?? 'traces' },
      sourceIndex: eIdx++,
    });
  }

  const scene: EditorScene = {
    version: 1,
    diagramType: 'requirement',
    meta: { type: 'requirement', direction: normalizeDir(db.getDirection?.()) },
    nodes,
    edges,
    containers: [],
    raw: { comments: pre.comments, styleLines: pre.styleLines },
    layoutOwner: 'engine',
  };
  return { scene, warnings };
}
