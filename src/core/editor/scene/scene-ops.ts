// 純場景操作:全部回傳「新場景」(immutable),不就地修改。
// 命令層(commands.ts)在此之上包 inverse 與 undo/redo。

import type {
  ArrowHead,
  EdgeAnchor,
  EditorScene,
  LineKind,
  NodeShape,
  Point,
  SceneContainer,
  SceneEdge,
  SceneNode,
} from './types';
import type { Rect } from './geometry';
import { anchorPoint, boundingBox, nodeRect, perimeterAnchor, rectCenter, shapeAnchor } from './geometry';
import { PLOT } from '../round-trip/quadrant/model';
import { XY as XY_PLOT } from '../round-trip/xychart';

let nodeCounter = 0;
let edgeCounter = 0;

/** 產生確定性的新節點 id(n1, n2, …)。不由 label 衍生 → 改名不動 id。 */
export function nextNodeId(scene: EditorScene): string {
  const taken = new Set(scene.nodes.map((n) => n.id));
  do {
    nodeCounter += 1;
  } while (taken.has(`n${nodeCounter}`));
  return `n${nodeCounter}`;
}

export function nextEdgeId(scene: EditorScene): string {
  const taken = new Set(scene.edges.map((e) => e.id));
  do {
    edgeCounter += 1;
  } while (taken.has(`e${edgeCounter}`));
  return `e${edgeCounter}`;
}

/** 測試用:重置流水號(讓 id 可預期)。 */
export function _resetIdCounters(): void {
  nodeCounter = 0;
  edgeCounter = 0;
}

export function getNode(scene: EditorScene, id: string): SceneNode | undefined {
  return scene.nodes.find((n) => n.id === id);
}

// 容器外框內距(對齊 scene-renderer.renderContainers,讓連到容器的邊錨在實際畫出的框上)。
const C_PAD = 18;
const C_LABEL_H = 22;

/** 容器(複合狀態 / subgraph)外框矩形:遞迴涵蓋子節點 + 子容器(巢狀 subgraph)+ 內距。 */
export function containerRect(scene: EditorScene, id: string): Rect | null {
  const c = scene.containers.find((k) => k.id === id);
  if (!c) return null;
  const rects = c.childNodeIds
    .map((cid) => getNode(scene, cid))
    .filter((n): n is SceneNode => Boolean(n))
    .map(nodeRect);
  for (const sub of scene.containers) {
    if (sub.parentId === id) {
      const sr = containerRect(scene, sub.id);
      if (sr) rects.push(sr);
    }
  }
  const bb = boundingBox(rects);
  if (!bb) return null;
  return { x: bb.x - C_PAD, y: bb.y - C_PAD - C_LABEL_H, w: bb.w + C_PAD * 2, h: bb.h + C_PAD * 2 + C_LABEL_H };
}

/**
 * 邊的兩端錨點,支援節點 *與容器*(複合狀態)端點。容器端用矩形周界錨點。
 * 端點若設了固定錨點(edge.sourceAnchor / targetAnchor,draw.io 式)則用該點;
 * 否則維持「動態朝對端」的浮動錨。一端固定、另一端浮動時,浮動端朝固定點(而非對端中心)。
 */
export function resolveEdgeAnchors(
  scene: EditorScene,
  edge: SceneEdge,
): { start: Point; end: Point } | null {
  const sNode = getNode(scene, edge.source);
  const tNode = getNode(scene, edge.target);
  const sRect = sNode ? nodeRect(sNode) : containerRect(scene, edge.source);
  const tRect = tNode ? nodeRect(tNode) : containerRect(scene, edge.target);
  if (!sRect || !tRect) return null;
  const sFixed = edge.sourceAnchor ? anchorPoint(sRect, edge.sourceAnchor) : null;
  const tFixed = edge.targetAnchor ? anchorPoint(tRect, edge.targetAnchor) : null;
  const sRef = sFixed ?? rectCenter(sRect);
  const tRef = tFixed ?? rectCenter(tRect);
  return {
    start: sFixed ?? (sNode ? shapeAnchor(sNode, tRef) : perimeterAnchor(sRect, tRef)),
    end: tFixed ?? (tNode ? shapeAnchor(tNode, sRef) : perimeterAnchor(tRect, sRef)),
  };
}

export function getEdge(scene: EditorScene, id: string): SceneEdge | undefined {
  return scene.edges.find((e) => e.id === id);
}

export function addNode(scene: EditorScene, node: SceneNode): EditorScene {
  return { ...scene, nodes: [...scene.nodes, node] };
}

export function addEdge(scene: EditorScene, edge: SceneEdge): EditorScene {
  return { ...scene, edges: [...scene.edges, edge] };
}

/** 建立一個帶預設尺寸的新節點(尚未加入場景)。 */
export function makeNode(
  id: string,
  at: Point,
  opts: { shape?: NodeShape; label?: string; w?: number; h?: number } = {},
): SceneNode {
  const w = opts.w ?? 120;
  const h = opts.h ?? 56;
  return {
    id,
    shape: opts.shape ?? 'rectangle',
    label: opts.label ?? '',
    x: at.x - w / 2,
    y: at.y - h / 2,
    w,
    h,
    data: { kind: 'flowchart' },
  };
}

export function makeEdge(
  id: string,
  source: string,
  target: string,
  opts: {
    label?: string;
    lineKind?: LineKind;
    arrowStart?: ArrowHead;
    arrowEnd?: ArrowHead;
    sourceAnchor?: EdgeAnchor;
    targetAnchor?: EdgeAnchor;
  } = {},
): SceneEdge {
  return {
    id,
    source,
    target,
    label: opts.label,
    lineKind: opts.lineKind ?? 'solid',
    arrowStart: opts.arrowStart ?? 'none',
    arrowEnd: opts.arrowEnd ?? 'arrow',
    sourceAnchor: opts.sourceAnchor,
    targetAnchor: opts.targetAnchor,
    data: { kind: 'flowchart' },
  };
}

/** 平移一組節點(dx/dy);同時平移其後代容器幾何。 */
export function moveNodes(scene: EditorScene, ids: Set<string>, dx: number, dy: number): EditorScene {
  // 象限圖的位置就是資料值(0..1),拖出繪圖區的部分序列化時會被夾住 ——
  // 與其讓畫面上的點停在框外、存檔後卻跳回邊界,不如在拖曳當下就夾住。
  // xychart 同理,而且它的 x 是分類軸:橫向自由移動沒有意義,所以只放行垂直方向。
  const clamp =
    scene.diagramType === 'quadrant' ? clampToPlot : scene.diagramType === 'xychart' ? clampToXyPlot : null;
  return {
    ...scene,
    nodes: scene.nodes.map((n) => {
      if (!ids.has(n.id)) return n;
      const moved = { ...n, x: n.x + dx, y: n.y + dy };
      return { ...(clamp ? clamp(moved, n.x) : moved), pinned: true };
    }),
  };
}

/** 把節點中心夾在象限圖的繪圖區內。 */
function clampToPlot<T extends { x: number; y: number; w: number; h: number }>(n: T): T {
  const cx = Math.min(PLOT.x + PLOT.w, Math.max(PLOT.x, n.x + n.w / 2));
  const cy = Math.min(PLOT.y + PLOT.h, Math.max(PLOT.y, n.y + n.h / 2));
  return { ...n, x: cx - n.w / 2, y: cy - n.h / 2 };
}

/** xychart:x 鎖回原本的欄位(分類軸),y 夾在繪圖區內。 */
function clampToXyPlot<T extends { x: number; y: number; w: number; h: number }>(n: T, origX: number): T {
  const cy = Math.min(XY_PLOT.y + XY_PLOT.h, Math.max(XY_PLOT.y, n.y + n.h / 2));
  return { ...n, x: origX, y: cy - n.h / 2 };
}

export function resizeNode(scene: EditorScene, id: string, rect: { x: number; y: number; w: number; h: number }): EditorScene {
  return {
    ...scene,
    nodes: scene.nodes.map((n) => (n.id === id ? { ...n, ...rect, pinned: true } : n)),
  };
}

export function setLabel(scene: EditorScene, id: string, label: string): EditorScene {
  const inNodes = scene.nodes.some((n) => n.id === id);
  if (inNodes) {
    return { ...scene, nodes: scene.nodes.map((n) => (n.id === id ? { ...n, label } : n)) };
  }
  return { ...scene, edges: scene.edges.map((e) => (e.id === id ? { ...e, label } : e)) };
}

export function setShape(scene: EditorScene, id: string, shape: NodeShape): EditorScene {
  return { ...scene, nodes: scene.nodes.map((n) => (n.id === id ? { ...n, shape } : n)) };
}

export function reconnectEdge(
  scene: EditorScene,
  edgeId: string,
  endpoint: 'source' | 'target',
  nodeId: string,
  anchor?: EdgeAnchor | null,
): EditorScene {
  // 重接時一併更新該端的固定錨點:吸附到候選點 → 設錨;放在節點本體 → 清成浮動。
  const anchorKey = endpoint === 'source' ? 'sourceAnchor' : 'targetAnchor';
  return {
    ...scene,
    edges: scene.edges.map((e) =>
      e.id === edgeId ? { ...e, [endpoint]: nodeId, [anchorKey]: anchor ?? undefined } : e,
    ),
  };
}

/** 刪除節點 + 連帶刪除入射邊 + 從容器移除。回傳新場景 + 被刪除的邊(供 undo)。 */
export function deleteNodes(
  scene: EditorScene,
  ids: Set<string>,
): { scene: EditorScene; removedEdges: SceneEdge[] } {
  const removedEdges = scene.edges.filter((e) => ids.has(e.source) || ids.has(e.target));
  const next: EditorScene = {
    ...scene,
    nodes: scene.nodes.filter((n) => !ids.has(n.id)),
    edges: scene.edges.filter((e) => !ids.has(e.source) && !ids.has(e.target)),
    containers: scene.containers.map((c) => ({
      ...c,
      childNodeIds: c.childNodeIds.filter((cid) => !ids.has(cid)),
    })),
  };
  return { scene: next, removedEdges };
}

export function deleteEdges(scene: EditorScene, ids: Set<string>): EditorScene {
  return { ...scene, edges: scene.edges.filter((e) => !ids.has(e.id)) };
}

/** 把一組節點包進新的 subgraph 容器。 */
export function groupIntoContainer(
  scene: EditorScene,
  container: SceneContainer,
): EditorScene {
  const childSet = new Set(container.childNodeIds);
  return {
    ...scene,
    containers: [...scene.containers, container],
    nodes: scene.nodes.map((n) => (childSet.has(n.id) ? { ...n, parentId: container.id } : n)),
  };
}
