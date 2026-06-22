// 純場景操作:全部回傳「新場景」(immutable),不就地修改。
// 命令層(commands.ts)在此之上包 inverse 與 undo/redo。

import type {
  EditorScene,
  LineKind,
  NodeShape,
  Point,
  SceneContainer,
  SceneEdge,
  SceneNode,
} from './types';

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
  opts: { label?: string; lineKind?: LineKind } = {},
): SceneEdge {
  return {
    id,
    source,
    target,
    label: opts.label,
    lineKind: opts.lineKind ?? 'solid',
    arrowStart: 'none',
    arrowEnd: 'arrow',
    data: { kind: 'flowchart' },
  };
}

/** 平移一組節點(dx/dy);同時平移其後代容器幾何。 */
export function moveNodes(scene: EditorScene, ids: Set<string>, dx: number, dy: number): EditorScene {
  return {
    ...scene,
    nodes: scene.nodes.map((n) =>
      ids.has(n.id) ? { ...n, x: n.x + dx, y: n.y + dy, pinned: true } : n,
    ),
  };
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
): EditorScene {
  return {
    ...scene,
    edges: scene.edges.map((e) => (e.id === edgeId ? { ...e, [endpoint]: nodeId } : e)),
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
