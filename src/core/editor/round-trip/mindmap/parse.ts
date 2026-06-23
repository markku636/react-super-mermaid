// mindmap 文字 → 場景。透過 mermaid 解析後 DB 的 getMindmap()(樹狀)取得節點階層。
// 節點以 parentId 表父子;另建 parent→child 邊供畫面顯示連線(序列化時忽略,改用樹還原)。

import type { ParseResult, ParseWarning } from '../../adapters/types';
import type { EditorScene, NodeShape, SceneEdge, SceneNode } from '../../scene/types';
import type { MermaidLike } from '../../../../types';

interface MermaidApiLike {
  mermaidAPI?: { getDiagramFromText?: (t: string) => Promise<{ db?: unknown }> | { db?: unknown } };
  getDiagramFromText?: (t: string) => Promise<{ db?: unknown }> | { db?: unknown };
}
interface MmNode {
  nodeId: string;
  descr?: string;
  type?: number;
  children?: MmNode[];
}
interface MmDbLike {
  getMindmap?: () => MmNode | undefined;
}

/** mindmap type → 場景渲染外形(近似;原始 type 另存 data.shapeType 供序列化無損)。 */
function shapeFromType(t: number | undefined): NodeShape {
  switch (t) {
    case 1:
      return 'rounded';
    case 2:
      return 'rectangle';
    case 3:
      return 'circle';
    case 4:
      return 'ellipse'; // cloud 近似
    case 5:
      return 'circle'; // bang 近似
    case 6:
      return 'hexagon';
    default:
      return 'rounded';
  }
}

function estimateSize(label: string): { w: number; h: number } {
  const longest = label.split(/<br\s*\/?>|\n/).reduce((m, s) => Math.max(m, s.length), 0);
  return { w: Math.max(80, longest * 9 + 28), h: Math.max(44, 44) };
}

async function getMmDb(text: string, mermaid: MermaidLike): Promise<MmDbLike | undefined> {
  const api = mermaid as unknown as MermaidApiLike;
  const fn = api.mermaidAPI?.getDiagramFromText ?? api.getDiagramFromText;
  if (typeof fn !== 'function') return undefined;
  try {
    mermaid.initialize?.({ startOnLoad: false });
  } catch {
    /* ignore */
  }
  const diagram = await fn.call(api.mermaidAPI ?? api, text);
  const db = diagram?.db as MmDbLike | undefined;
  if (!db || typeof db.getMindmap !== 'function') return undefined;
  return db;
}

export async function mindmapToScene(text: string, mermaid: MermaidLike): Promise<ParseResult> {
  const warnings: ParseWarning[] = [];
  let db: MmDbLike | undefined;
  try {
    db = await getMmDb(text, mermaid);
  } catch (err) {
    warnings.push({ message: `mermaid 解析失敗:${(err as Error).message}` });
  }
  const root = db?.getMindmap?.();
  if (!root) {
    return {
      scene: {
        version: 1,
        diagramType: 'mindmap',
        meta: { type: 'mindmap' },
        nodes: [],
        edges: [],
        containers: [],
        raw: { fullSource: text },
        layoutOwner: 'engine',
      },
      warnings: warnings.length ? warnings : [{ message: 'mermaid 解析 API 不可用。' }],
    };
  }

  const nodes: SceneNode[] = [];
  const edges: SceneEdge[] = [];
  let idx = 0;
  const used = new Set<string>();
  const uniqueId = (base: string): string => {
    let id = base || `n${idx}`;
    let k = 1;
    while (used.has(id)) id = `${base}_${k++}`;
    used.add(id);
    return id;
  };
  const walk = (n: MmNode, parentId: string | null): void => {
    const label = n.descr ?? n.nodeId;
    const id = uniqueId(n.nodeId || label);
    const size = estimateSize(label);
    nodes.push({
      id,
      shape: shapeFromType(n.type),
      label,
      x: 0,
      y: 0,
      w: size.w,
      h: size.h,
      parentId,
      data: { kind: 'mindmap', shapeType: n.type ?? 0 },
      sourceIndex: idx++,
    });
    if (parentId) {
      edges.push({
        id: `e${edges.length}`,
        source: parentId,
        target: id,
        lineKind: 'solid',
        arrowStart: 'none',
        arrowEnd: 'none',
        data: { kind: 'flowchart' },
        sourceIndex: edges.length,
      });
    }
    for (const c of n.children ?? []) walk(c, id);
  };
  walk(root, null);

  return {
    scene: {
      version: 1,
      diagramType: 'mindmap',
      meta: { type: 'mindmap' },
      nodes,
      edges,
      containers: [],
      layoutOwner: 'engine',
    },
    warnings,
  };
}
