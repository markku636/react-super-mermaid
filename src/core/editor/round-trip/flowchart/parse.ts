// flowchart 文字 → 場景。透過 mermaid 自身的解析後 DB(getDiagramFromText().db)取得
// parser-grade 拓樸(非 regex)。需要 DOM(mermaid 解析會建圖)→ async、browser-scoped。
// 失敗時降級成最小骨架,不拋例外。

import type { ParseResult, ParseWarning } from '../../adapters/types';
import type {
  EditorScene,
  FlowDirection,
  SceneContainer,
  SceneEdge,
  SceneNode,
} from '../../scene/types';
import type { MermaidLike } from '../../../../types';
import { arrowFromFlowEdge, shapeFromFlowType } from './syntax-maps';

/** mermaid 預設匯出實際具備、但 MermaidLike 未列的 parse 入口。 */
interface MermaidApiLike {
  mermaidAPI?: {
    getDiagramFromText?: (text: string) => Promise<{ db?: unknown }> | { db?: unknown };
  };
  getDiagramFromText?: (text: string) => Promise<{ db?: unknown }> | { db?: unknown };
}

interface FlowDbLike {
  getDirection?: () => string;
  getVertices?: () => Map<string, FlowVertexLike> | Record<string, FlowVertexLike>;
  getEdges?: () => FlowEdgeLike[];
  getSubGraphs?: () => FlowSubGraphLike[];
  getTooltip?: (id: string) => string | undefined;
}

interface FlowVertexLike {
  id: string;
  text?: string;
  type?: string;
  labelType?: string;
  styles?: string[];
  classes?: string[];
  dir?: string;
}

interface FlowEdgeLike {
  start: string;
  end: string;
  id?: string;
  isUserDefinedId?: boolean;
  type?: string;
  stroke?: string;
  length?: number;
  text?: string;
  labelType?: string;
}

interface FlowSubGraphLike {
  id: string;
  title?: string;
  nodes: string[];
  dir?: string;
}

const DEFAULT_NODE_W = 120;
const DEFAULT_NODE_H = 56;

function toEntries<T>(coll: Map<string, T> | Record<string, T>): Array<[string, T]> {
  if (coll instanceof Map) return [...coll.entries()];
  return Object.entries(coll);
}

function normalizeDirection(dir: string | undefined): FlowDirection {
  const d = (dir ?? 'TB').toUpperCase();
  if (d === 'TD') return 'TD';
  if (d === 'BT' || d === 'RL' || d === 'LR' || d === 'TB') return d;
  return 'TB';
}

/** 預估節點尺寸(layout 之前的暫定值,讓無排版時也能畫)。 */
function estimateSize(label: string): { w: number; h: number } {
  const longest = label.split(/<br\s*\/?>|\n/).reduce((m, s) => Math.max(m, s.length), 0);
  const w = Math.max(DEFAULT_NODE_W, longest * 9 + 32);
  const lines = label.split(/<br\s*\/?>|\n/).length;
  const h = Math.max(DEFAULT_NODE_H, lines * 22 + 24);
  return { w, h };
}

/** 預掃原始文字,撈出 DB 看不到的內容(註解 / 樣式 / click)以利逐字回吐。 */
function prescan(src: string): {
  frontmatter?: string;
  comments: string[];
  styleLines: string[];
  clickLines: string[];
} {
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
  const clickLines: string[] = [];
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('%%')) comments.push(line);
    else if (/^(classDef|class|style|linkStyle)\b/.test(line)) styleLines.push(line);
    else if (/^(click|href)\b/.test(line)) clickLines.push(line);
  }
  return { frontmatter, comments, styleLines, clickLines };
}

async function getFlowDb(text: string, mermaid: MermaidLike): Promise<FlowDbLike | undefined> {
  const api = mermaid as unknown as MermaidApiLike;
  const fn = api.mermaidAPI?.getDiagramFromText ?? api.getDiagramFromText;
  if (typeof fn !== 'function') return undefined;
  // getDiagramFromText 的型別偵測需要 mermaid 已 initialize(否則拋 "No diagram type detected")。
  // 編輯器在任何 render 之前就 parse,故這裡冪等地初始化一次;不覆寫 host 的主題設定。
  try {
    mermaid.initialize?.({ startOnLoad: false });
  } catch {
    /* 已初始化或不支援,忽略 */
  }
  const diagram = await fn.call(api.mermaidAPI ?? api, text);
  const db = diagram?.db as FlowDbLike | undefined;
  if (!db || typeof db.getVertices !== 'function') return undefined;
  return db;
}

/** 解析失敗時的最小骨架:救出 `A --> B` 這類明顯邊與其節點。 */
function fallbackParse(text: string, prescanRes: ReturnType<typeof prescan>): EditorScene {
  const nodes = new Map<string, SceneNode>();
  const edges: SceneEdge[] = [];
  let i = 0;
  const ensure = (id: string): void => {
    if (!nodes.has(id)) {
      const size = estimateSize(id);
      nodes.set(id, {
        id,
        shape: 'rectangle',
        label: id,
        x: 0,
        y: 0,
        w: size.w,
        h: size.h,
        data: { kind: 'flowchart' },
        sourceIndex: nodes.size,
      });
    }
  };
  const re = /([A-Za-z0-9_]+)\s*-{2,3}>?\s*([A-Za-z0-9_]+)/g;
  let m: RegExpExecArray | null;
  for (const line of text.split('\n')) {
    re.lastIndex = 0;
    while ((m = re.exec(line)) !== null) {
      ensure(m[1]);
      ensure(m[2]);
      edges.push({
        id: `e${i++}`,
        source: m[1],
        target: m[2],
        lineKind: 'solid',
        arrowStart: 'none',
        arrowEnd: 'arrow',
        data: { kind: 'flowchart' },
        sourceIndex: i,
      });
    }
  }
  return {
    version: 1,
    diagramType: 'flowchart',
    meta: { type: 'flowchart', direction: 'TB' },
    nodes: [...nodes.values()],
    edges,
    containers: [],
    frontmatter: prescanRes.frontmatter,
    raw: { ...prescanRes, fullSource: text },
    layoutOwner: 'engine',
  };
}

export async function flowDbToScene(text: string, mermaid: MermaidLike): Promise<ParseResult> {
  const warnings: ParseWarning[] = [];
  const pre = prescan(text);

  let db: FlowDbLike | undefined;
  try {
    db = await getFlowDb(text, mermaid);
  } catch (err) {
    warnings.push({ message: `mermaid 解析失敗,改用最小骨架:${(err as Error).message}` });
  }

  if (!db) {
    if (warnings.length === 0) {
      warnings.push({ message: 'mermaid 解析 API 不可用,改用最小骨架。' });
    }
    return { scene: fallbackParse(text, pre), warnings };
  }

  const direction = normalizeDirection(db.getDirection?.());
  const nodes: SceneNode[] = [];
  let idx = 0;
  for (const [id, v] of toEntries(db.getVertices?.() ?? new Map())) {
    const label = v.text ?? id;
    const size = estimateSize(label);
    const node: SceneNode = {
      id,
      shape: shapeFromFlowType(v.type),
      label,
      labelKind: (v.labelType as SceneNode['labelKind']) ?? 'text',
      x: 0,
      y: 0,
      w: size.w,
      h: size.h,
      data: { kind: 'flowchart' },
      sourceIndex: idx++,
    };
    if (v.classes && v.classes.length > 0) {
      node.style = { classRef: v.classes[0] };
    }
    nodes.push(node);
  }

  const edges: SceneEdge[] = [];
  let eIdx = 0;
  for (const fe of db.getEdges?.() ?? []) {
    const arrow = arrowFromFlowEdge(fe);
    edges.push({
      id: fe.isUserDefinedId && fe.id ? fe.id : `e${eIdx}`,
      source: fe.start,
      target: fe.end,
      label: fe.text && fe.text.length > 0 ? fe.text : undefined,
      labelKind: (fe.labelType as SceneEdge['labelKind']) ?? 'text',
      lineKind: arrow.lineKind,
      arrowStart: arrow.arrowStart,
      arrowEnd: arrow.arrowEnd,
      minLen: arrow.minLen,
      data: { kind: 'flowchart' },
      sourceIndex: eIdx++,
    });
  }

  // subgraph:用 nodes[] 含子 subgraph id 還原巢狀。
  const subgraphs = db.getSubGraphs?.() ?? [];
  const sgIds = new Set(subgraphs.map((s) => s.id));
  const containers: SceneContainer[] = [];
  let cIdx = 0;
  for (const sg of subgraphs) {
    const childNodeIds = sg.nodes.filter((n) => !sgIds.has(n));
    const childContainerIds = sg.nodes.filter((n) => sgIds.has(n));
    containers.push({
      id: sg.id,
      label: sg.title ?? sg.id,
      x: 0,
      y: 0,
      w: 0,
      h: 0,
      childNodeIds,
      childContainerIds,
      direction: sg.dir ? normalizeDirection(sg.dir) : undefined,
      sourceIndex: cIdx++,
    });
  }
  // 設定子容器的 parentId 與節點 parentId。
  for (const c of containers) {
    for (const childCid of c.childContainerIds ?? []) {
      const child = containers.find((x) => x.id === childCid);
      if (child) child.parentId = c.id;
    }
    for (const nid of c.childNodeIds) {
      const node = nodes.find((n) => n.id === nid);
      if (node) node.parentId = c.id;
    }
  }

  const scene: EditorScene = {
    version: 1,
    diagramType: 'flowchart',
    meta: { type: 'flowchart', direction },
    nodes,
    edges,
    containers,
    frontmatter: pre.frontmatter,
    raw: {
      comments: pre.comments,
      styleLines: pre.styleLines,
      clickLines: pre.clickLines,
    },
    // 來自文字 → 尚無座標,標記由引擎排版(layout 之後改 user)。
    layoutOwner: 'engine',
  };
  return { scene, warnings };
}
