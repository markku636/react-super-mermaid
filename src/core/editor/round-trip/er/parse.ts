// erDiagram 文字 → 場景。透過 mermaid 解析後 DB 的 getData() 取得實體(含屬性)與關係(含基數)。
// 節點 id 用「實體名稱」(getData 內部 id 形如 entity-NAME-n,排版回抓也是用名稱)。

import type { ParseResult, ParseWarning } from '../../adapters/types';
import type { EditorScene, ErAttribute, ErCardinality, SceneEdge, SceneNode } from '../../scene/types';
import type { MermaidLike } from '../../../../types';
import { erEntitySize } from '../../render/node-metrics';

interface MermaidApiLike {
  mermaidAPI?: { getDiagramFromText?: (t: string) => Promise<{ db?: unknown }> | { db?: unknown } };
  getDiagramFromText?: (t: string) => Promise<{ db?: unknown }> | { db?: unknown };
}
interface ErNodeLike {
  id: string;
  label?: string;
  shape?: string;
  attributes?: Array<{ type?: string; name?: string; keys?: string[]; comment?: string }>;
}
interface ErEdgeLike {
  id?: string;
  start: string;
  end: string;
  label?: string;
  arrowTypeStart?: string;
  arrowTypeEnd?: string;
  pattern?: string;
}
interface ErDbLike {
  getData?: () => { nodes: ErNodeLike[]; edges: ErEdgeLike[] };
  getDirection?: () => string;
}

function normalizeDir(dir: string | undefined): 'TB' | 'TD' | 'BT' | 'LR' | 'RL' {
  const d = (dir ?? 'TB').toUpperCase();
  if (d === 'TD' || d === 'BT' || d === 'RL' || d === 'LR' || d === 'TB') return d as 'TB';
  return 'TB';
}

function cardFromArrow(t: string | undefined): ErCardinality {
  switch (t) {
    case 'zero_or_one':
      return 'zeroOrOne';
    case 'zero_or_more':
      return 'zeroOrMore';
    case 'one_or_more':
      return 'oneOrMore';
    case 'only_one':
    default:
      return 'onlyOne';
  }
}

function prescan(src: string): { comments: string[] } {
  const comments: string[] = [];
  for (const raw of src.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('%%')) comments.push(line);
  }
  return { comments };
}

async function getErDb(text: string, mermaid: MermaidLike): Promise<ErDbLike | undefined> {
  const api = mermaid as unknown as MermaidApiLike;
  const fn = api.mermaidAPI?.getDiagramFromText ?? api.getDiagramFromText;
  if (typeof fn !== 'function') return undefined;
  try {
    mermaid.initialize?.({ startOnLoad: false });
  } catch {
    /* ignore */
  }
  const diagram = await fn.call(api.mermaidAPI ?? api, text);
  const db = diagram?.db as ErDbLike | undefined;
  if (!db || typeof db.getData !== 'function') return undefined;
  return db;
}

export async function erDbToScene(text: string, mermaid: MermaidLike): Promise<ParseResult> {
  const warnings: ParseWarning[] = [];
  const pre = prescan(text);
  let db: ErDbLike | undefined;
  try {
    db = await getErDb(text, mermaid);
  } catch (err) {
    warnings.push({ message: `mermaid 解析失敗:${(err as Error).message}` });
  }
  if (!db) {
    return {
      scene: {
        version: 1,
        diagramType: 'er',
        meta: { type: 'er' },
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
  const direction = normalizeDir(db.getDirection?.());
  const idToName = new Map<string, string>();
  for (const dn of data.nodes) idToName.set(dn.id, dn.label ?? dn.id);

  const nodes: SceneNode[] = [];
  let nIdx = 0;
  for (const dn of data.nodes) {
    const name = dn.label ?? dn.id;
    const attributes: ErAttribute[] = (dn.attributes ?? []).map((a) => ({
      name: a.name ?? '',
      type: a.type,
      keys: a.keys && a.keys.length ? a.keys : undefined,
      comment: a.comment && a.comment.length ? a.comment : undefined,
    }));
    const size = erEntitySize(name, attributes);
    nodes.push({
      id: name,
      shape: 'entity',
      label: name,
      x: 0,
      y: 0,
      w: size.w,
      h: size.h,
      data: { kind: 'er', attributes },
      sourceIndex: nIdx++,
    });
  }

  const edges: SceneEdge[] = [];
  let eIdx = 0;
  for (const de of data.edges) {
    const src = idToName.get(de.start) ?? de.start;
    const tgt = idToName.get(de.end) ?? de.end;
    const identifying = de.pattern !== 'dashed';
    edges.push({
      id: de.id ?? `e${eIdx}`,
      source: src,
      target: tgt,
      label: de.label && de.label.length > 0 ? de.label : undefined,
      lineKind: identifying ? 'solid' : 'dotted',
      arrowStart: 'none',
      arrowEnd: 'none',
      data: {
        kind: 'er',
        identifying,
        cardStart: cardFromArrow(de.arrowTypeStart),
        cardEnd: cardFromArrow(de.arrowTypeEnd),
      },
      sourceIndex: eIdx++,
    });
  }

  return {
    scene: {
      version: 1,
      diagramType: 'er',
      meta: { type: 'er', direction },
      nodes,
      edges,
      containers: [],
      raw: { comments: pre.comments },
      layoutOwner: 'engine',
    },
    warnings,
  };
}
