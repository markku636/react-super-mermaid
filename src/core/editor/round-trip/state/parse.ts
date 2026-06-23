// stateDiagram(-v2) 文字 → 場景。透過 mermaid 解析後 DB 的 getData()(layout-ready 統一格式)
// 取得節點(含 shape / isGroup / parentId)與連線。需要 DOM → async、browser-scoped。
// 失敗時降級成最小骨架,不拋例外。

import type { ParseResult, ParseWarning } from '../../adapters/types';
import type {
  EditorScene,
  FlowDirection,
  NodeShape,
  SceneContainer,
  SceneEdge,
  SceneNode,
} from '../../scene/types';
import type { MermaidLike } from '../../../../types';

interface MermaidApiLike {
  mermaidAPI?: { getDiagramFromText?: (t: string) => Promise<{ db?: unknown }> | { db?: unknown } };
  getDiagramFromText?: (t: string) => Promise<{ db?: unknown }> | { db?: unknown };
}

interface StateNodeLike {
  id: string;
  label?: string;
  shape?: string;
  isGroup?: boolean;
  parentId?: string;
}
interface StateEdgeLike {
  id?: string;
  start: string;
  end: string;
  label?: string;
}
interface StateDbLike {
  getData?: () => { nodes: StateNodeLike[]; edges: StateEdgeLike[] };
  getDirection?: () => string;
}

function normalizeDirection(dir: string | undefined): FlowDirection {
  const d = (dir ?? 'TB').toUpperCase();
  if (d === 'TD') return 'TD';
  if (d === 'BT' || d === 'RL' || d === 'LR' || d === 'TB') return d as FlowDirection;
  return 'TB';
}

/** getData() 的 shape 字串 → 場景 NodeShape。 */
function shapeFromState(shape: string | undefined): { shape: NodeShape; isStart?: boolean; isEnd?: boolean } {
  switch (shape) {
    case 'stateStart':
      return { shape: 'stateStart', isStart: true };
    case 'stateEnd':
      return { shape: 'stateEnd', isEnd: true };
    case 'choice':
      return { shape: 'choice' };
    case 'forkJoin':
    case 'fork':
      return { shape: 'fork' };
    default:
      return { shape: 'state' };
  }
}

function estimateSize(label: string, isPseudo: boolean): { w: number; h: number } {
  if (isPseudo) return { w: 22, h: 22 };
  const longest = label.split(/<br\s*\/?>|\n/).reduce((m, s) => Math.max(m, s.length), 0);
  const w = Math.max(90, longest * 9 + 32);
  const h = Math.max(46, label.split(/<br\s*\/?>|\n/).length * 22 + 20);
  return { w, h };
}

/** 預掃:抓 DB 看不到 / 尚未模型化的根層內容(註解 / note / <<fork>> / style)以逐字回吐。
 *  以大括號深度追蹤,只擷取「根層(深度 0)且非 transition / 非 state-block / 非 direction」的行。 */
function prescan(src: string): { frontmatter?: string; comments: string[]; styleLines: string[] } {
  let body = src;
  let frontmatter: string | undefined;
  if (body.startsWith('---')) {
    const end = body.indexOf('\n---', 3);
    if (end !== -1) {
      const after = body.indexOf('\n', end + 1);
      frontmatter = body.slice(0, after === -1 ? body.length : after);
      body = after === -1 ? '' : body.slice(after + 1);
    }
  }
  const comments: string[] = [];
  const styleLines: string[] = [];
  let depth = 0;
  let first = true;
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    const opens = (line.match(/\{/g) ?? []).length;
    const closes = (line.match(/\}/g) ?? []).length;
    if (!line) {
      depth += opens - closes;
      continue;
    }
    if (first) {
      // 跳過圖種標頭(stateDiagram / stateDiagram-v2)。
      first = false;
      if (/^stateDiagram/i.test(line)) {
        depth += opens - closes;
        continue;
      }
    }
    if (depth === 0) {
      if (line.startsWith('%%')) comments.push(line);
      else if (/^state\b/i.test(line) && line.includes('<<')) {
        // `state X <<fork>>` / `<<choice>>` / `<<join>>` 宣告 → 逐字保留(節點本身由 DB 建模)。
        styleLines.push(line);
      } else if (
        !line.includes('-->') &&
        !/^state\b/i.test(line) &&
        !/^direction\b/i.test(line) &&
        line !== '}' &&
        !/^\[\*\]/.test(line)
      ) {
        // note / classDef / class / style / 其他未模型化 → 逐字保留。
        styleLines.push(line);
      }
    }
    depth += opens - closes;
  }
  return { frontmatter, comments, styleLines };
}

async function getStateDb(text: string, mermaid: MermaidLike): Promise<StateDbLike | undefined> {
  const api = mermaid as unknown as MermaidApiLike;
  const fn = api.mermaidAPI?.getDiagramFromText ?? api.getDiagramFromText;
  if (typeof fn !== 'function') return undefined;
  try {
    mermaid.initialize?.({ startOnLoad: false });
  } catch {
    /* 已初始化或不支援 */
  }
  const diagram = await fn.call(api.mermaidAPI ?? api, text);
  const db = diagram?.db as StateDbLike | undefined;
  if (!db || typeof db.getData !== 'function') return undefined;
  return db;
}

export async function stateDbToScene(text: string, mermaid: MermaidLike): Promise<ParseResult> {
  const warnings: ParseWarning[] = [];
  const pre = prescan(text);

  let db: StateDbLike | undefined;
  try {
    db = await getStateDb(text, mermaid);
  } catch (err) {
    warnings.push({ message: `mermaid 解析失敗:${(err as Error).message}` });
  }
  if (!db) {
    return {
      scene: {
        version: 1,
        diagramType: 'state',
        meta: { type: 'state' },
        nodes: [],
        edges: [],
        containers: [],
        frontmatter: pre.frontmatter,
        raw: { ...pre, fullSource: text },
        layoutOwner: 'engine',
      },
      warnings: warnings.length ? warnings : [{ message: 'mermaid 解析 API 不可用。' }],
    };
  }

  const data = db.getData?.() ?? { nodes: [], edges: [] };
  const direction = normalizeDirection(db.getDirection?.());

  // note 會在 getData 產生污染:note 節點(shape 'note')+ noteGroup 包裝容器(包住真實狀態)
  // + 一條連到 note 的邊。全部排除,改由 prescan 把 `note ...` 原文逐字回吐;真實狀態從
  // noteGroup 內「拉回」其真正的父層。
  const noteNodeIds = new Set(data.nodes.filter((n) => n.shape === 'note').map((n) => n.id));
  const noteGroupIds = new Set(data.nodes.filter((n) => n.shape === 'noteGroup').map((n) => n.id));
  const groupParent = new Map<string, string | null>();
  for (const n of data.nodes) {
    if (n.shape === 'noteGroup') groupParent.set(n.id, n.parentId ?? null);
  }
  const resolveParent = (pid: string | undefined): string | null => {
    let p: string | null = pid ?? null;
    while (p && noteGroupIds.has(p)) p = groupParent.get(p) ?? null;
    return p;
  };

  const nodes: SceneNode[] = [];
  const containers: SceneContainer[] = [];
  let nIdx = 0;
  let cIdx = 0;
  for (const dn of data.nodes) {
    if (dn.shape === 'note' || dn.shape === 'noteGroup') continue; // note 污染 → 排除
    if (dn.isGroup) {
      containers.push({
        id: dn.id,
        label: dn.label ?? dn.id,
        x: 0,
        y: 0,
        w: 0,
        h: 0,
        parentId: resolveParent(dn.parentId),
        childNodeIds: [],
        childContainerIds: [],
        sourceIndex: cIdx++,
      });
      continue;
    }
    const sh = shapeFromState(dn.shape);
    const isPseudo = Boolean(sh.isStart || sh.isEnd);
    const label = isPseudo ? '' : dn.label ?? dn.id;
    const size = estimateSize(label, isPseudo);
    nodes.push({
      id: dn.id,
      shape: sh.shape,
      label,
      x: 0,
      y: 0,
      w: size.w,
      h: size.h,
      parentId: resolveParent(dn.parentId),
      data: { kind: 'state', isStart: sh.isStart, isEnd: sh.isEnd },
      sourceIndex: nIdx++,
    });
  }

  // 容器子成員指派。
  const cById = new Map(containers.map((c) => [c.id, c] as const));
  for (const n of nodes) {
    if (n.parentId && cById.has(n.parentId)) cById.get(n.parentId)!.childNodeIds.push(n.id);
  }
  for (const c of containers) {
    if (c.parentId && cById.has(c.parentId)) cById.get(c.parentId)!.childContainerIds!.push(c.id);
  }

  const edges: SceneEdge[] = [];
  let eIdx = 0;
  for (const de of data.edges) {
    if (noteNodeIds.has(de.start) || noteNodeIds.has(de.end)) continue; // 連到 note 的邊 → 排除
    edges.push({
      id: de.id ?? `e${eIdx}`,
      source: de.start,
      target: de.end,
      label: de.label && de.label.length > 0 ? de.label : undefined,
      lineKind: 'solid',
      arrowStart: 'none',
      arrowEnd: 'arrow',
      data: { kind: 'state' },
      sourceIndex: eIdx++,
    });
  }

  return {
    scene: {
      version: 1,
      diagramType: 'state',
      meta: { type: 'state', direction },
      nodes,
      edges,
      containers,
      frontmatter: pre.frontmatter,
      raw: { comments: pre.comments, styleLines: pre.styleLines },
      layoutOwner: 'engine',
    },
    warnings,
  };
}
