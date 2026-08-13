// 「依圖種建立元素」的單一真相。
//
// 為什麼需要它:拖拉繪製有六條入口(工具列外形鈕、node-create 工具、雙擊空白、Tab 快速接續、
// 右鍵「在此新增」、拉線到空白處一步建點),先前每條都直接叫 makeNode(),而 makeNode 寫死
// `data:{kind:'flowchart'}` + rectangle。結果在 class / er / mindmap / state 上拖出來的節點
// 帶著 flowchart 的資料形狀,渲染不出隔間、序列化也退化(class 少了 {} 區塊、er 沒有屬性表、
// mindmap 變成第二個 root 直接讓 mermaid 報錯)。這裡集中處理,六條入口共用。

import type {
  ArrowHead,
  DiagramType,
  EdgeAnchor,
  EditorScene,
  LineKind,
  NodeData,
  NodeShape,
  Point,
  SceneEdge,
  SceneNode,
} from './types';
import { c4BoxSize, classBoxSize, erEntitySize, requirementBoxSize } from '../render/node-metrics';
import { POINT_BOX } from '../round-trip/quadrant/model';
import { C4_SHAPE_DEFAULT_TYPE } from '../round-trip/c4/shapes';
import { CARD as KANBAN_CARD } from '../round-trip/kanban/model';

/**
 * 新拖出來的需求 / 元素預填的內容。
 * mermaid 的 requirementDiagram 對這兩者的必填欄位很嚴格(需求少了 id 或 text 就整份語法錯誤),
 * 所以「空白節點」不能真的空白 —— 一律先給合法的預設值,使用者再改。
 */
const NEW_REQUIREMENT = {
  element: false as const,
  reqType: 'requirement' as const,
  reqId: '1',
  text: '待填寫需求描述',
  risk: 'medium' as const,
  verifyMethod: 'test' as const,
};
const NEW_ELEMENT = { element: true as const, elementType: 'simulation' };

/** 各圖種新節點的預設外形(adapter capabilities.defaults.nodeShape 的 core 版對照)。 */
export function defaultShapeFor(type: DiagramType): NodeShape {
  switch (type) {
    case 'state':
      return 'state';
    case 'class':
      return 'classBox';
    case 'er':
      return 'entity';
    case 'mindmap':
      return 'rounded';
    case 'requirement':
      return 'requirementBox';
    case 'quadrant':
      return 'point';
    case 'c4':
      return 'c4Box';
    case 'kanban':
      return 'kanbanCard';
    case 'sankey':
      return 'sankeyNode';
    case 'journey':
      return 'journeyTask';
    case 'gantt':
      return 'ganttBar';
    case 'pie':
      return 'pieSlice';
    case 'xychart':
      return 'xyPoint';
    case 'architecture':
      return 'archNode';
    case 'block':
      return 'rectangle';
    case 'sequence':
      return 'participant';
    default:
      return 'rectangle';
  }
}

/** 外形決定初始尺寸:偽狀態是小圓點、fork 是細長條、class/er 要放得下標題列。 */
export function defaultSizeFor(type: DiagramType, shape: NodeShape): { w: number; h: number } {
  switch (shape) {
    case 'stateStart':
      return { w: 22, h: 22 };
    case 'stateEnd':
      return { w: 26, h: 26 };
    case 'choice':
      return { w: 44, h: 44 };
    case 'fork':
      return { w: 120, h: 12 };
    case 'circle':
    case 'doubleCircle':
      return { w: 76, h: 76 };
    // 隔間框:交給內容尺寸模型,新建的空框才不會比它畫出來的東西大一圈。
    case 'classBox':
      return classBoxSize('', {});
    case 'entity':
      return erEntitySize('', []);
    case 'requirementBox':
      return requirementBoxSize('', NEW_REQUIREMENT);
    case 'elementBox':
      return requirementBoxSize('', NEW_ELEMENT);
    case 'point':
      return { w: POINT_BOX, h: POINT_BOX };
    case 'c4Person':
    case 'c4Box':
    case 'c4Db':
    case 'c4Queue':
      return c4BoxSize('', { c4Type: C4_SHAPE_DEFAULT_TYPE[shape] ?? 'system' });
    case 'kanbanCard':
    case 'journeyTask':
      return { w: KANBAN_CARD.w, h: KANBAN_CARD.minH };
    default:
      return type === 'mindmap' ? { w: 110, h: 46 } : { w: 120, h: 56 };
  }
}

/** 圖種 → 節點的判別式資料(渲染器與序列化都靠它分辨隔間 / 括號 / 偽狀態)。 */
function defaultDataFor(type: DiagramType, shape: NodeShape): NodeData {
  switch (type) {
    case 'state':
      return { kind: 'state', isStart: shape === 'stateStart', isEnd: shape === 'stateEnd' };
    case 'class':
      return { kind: 'class', members: [], methods: [] };
    case 'er':
      return { kind: 'er', attributes: [] };
    case 'mindmap':
      return { kind: 'mindmap', shapeType: mindmapShapeType(shape) };
    case 'requirement':
      return { kind: 'requirement', req: shape === 'elementBox' ? { ...NEW_ELEMENT } : { ...NEW_REQUIREMENT } };
    case 'quadrant':
      return { kind: 'quadrant' };
    case 'c4':
      return { kind: 'c4', c4Type: C4_SHAPE_DEFAULT_TYPE[shape] ?? 'system' };
    case 'kanban':
      return { kind: 'kanban' };
    case 'sankey':
      return { kind: 'sankey' };
    case 'journey':
      return { kind: 'journey', score: 3, actors: [] };
    case 'gantt':
      return { kind: 'gantt', flags: [], startRaw: '', endRaw: '1d' };
    case 'pie':
      return { kind: 'pie', value: 1 };
    case 'xychart':
      return { kind: 'xy', series: 0, index: 0 };
    case 'architecture':
      return { kind: 'architecture' };
    case 'block':
      return { kind: 'block', span: 1 };
    case 'sequence':
      return { kind: 'sequence', actor: shape === 'actor' };
    default:
      return { kind: 'flowchart' };
  }
}

/** mindmap 外形 → mermaid 括號代碼(對齊 round-trip/mindmap/serialize.wrap)。 */
export function mindmapShapeType(shape: NodeShape): number {
  switch (shape) {
    case 'rounded':
      return 1;
    case 'rectangle':
      return 2;
    case 'circle':
      return 3;
    case 'ellipse':
      return 5;
    case 'hexagon':
      return 6;
    default:
      return 0;
  }
}

/**
 * mindmap 的新節點該掛在誰底下。
 *
 * mermaid mindmap 只允許**一個**根:兩個 parentId=null 的節點會直接讓渲染報錯。所以新節點
 * 一律掛在「目前選取的節點」之下,沒有選取就掛在既有根節點之下;場景全空時才讓它自己當根。
 */
export function mindmapParent(scene: EditorScene, preferId?: string): string | undefined {
  if (scene.nodes.length === 0) return undefined;
  if (preferId && scene.nodes.some((n) => n.id === preferId)) return preferId;
  const root = scene.nodes.find((n) => !n.parentId);
  return root?.id ?? scene.nodes[0].id;
}

export interface MakeNodeOptions {
  shape?: NodeShape;
  label?: string;
  w?: number;
  h?: number;
  /** 建立時直接指定父節點(mindmap 掛樹 / subgraph 內建點)。 */
  parentId?: string | null;
  /** 建點時「目前選取」的節點,mindmap 用來決定掛在誰底下。 */
  preferParentId?: string;
}

/**
 * 依場景圖種建立一個新節點(外形 / 資料 / 尺寸 / 父節點都對)。
 * at = 節點中心的世界座標(與舊 makeNode 一致)。
 */
export function makeNodeFor(
  scene: EditorScene,
  id: string,
  at: Point,
  opts: MakeNodeOptions = {},
): SceneNode {
  const type = scene.diagramType;
  const shape = opts.shape ?? defaultShapeFor(type);
  const size = defaultSizeFor(type, shape);
  const w = opts.w ?? size.w;
  const h = opts.h ?? size.h;
  const parentId =
    opts.parentId !== undefined
      ? opts.parentId
      : type === 'mindmap'
        ? mindmapParent(scene, opts.preferParentId)
        : undefined;
  return {
    id,
    shape,
    label: opts.label ?? '',
    x: at.x - w / 2,
    y: at.y - h / 2,
    w,
    h,
    parentId,
    data: defaultDataFor(type, shape),
    // 拖出來的節點就是使用者定位的 → 標記 pinned,「整理排版」才不會把它彈回引擎座標。
    pinned: true,
  };
}

export interface MakeEdgeOptions {
  label?: string;
  lineKind?: LineKind;
  arrowStart?: ArrowHead;
  arrowEnd?: ArrowHead;
  sourceAnchor?: EdgeAnchor;
  targetAnchor?: EdgeAnchor;
}

/** 圖種 → 連線的判別式資料(關係種類 / 基數等,序列化靠它決定符號)。 */
function defaultEdgeDataFor(type: DiagramType): SceneEdge['data'] {
  switch (type) {
    case 'state':
      return { kind: 'state' };
    case 'class':
      return { kind: 'class', relation: 'association' };
    case 'er':
      return { kind: 'er', identifying: true, cardStart: 'onlyOne', cardEnd: 'zeroOrMore' };
    case 'requirement':
      return { kind: 'requirement', relation: 'satisfies' };
    case 'c4':
      return { kind: 'c4', relType: 'rel' };
    case 'architecture':
      return { kind: 'architecture', fromSide: 'R', toSide: 'L' };
    default:
      return { kind: 'flowchart' };
  }
}

/** 依場景圖種建立一條新連線(帶對的 data,序列化才畫得出三角 / 鳥足等關係符號)。 */
export function makeEdgeFor(
  scene: EditorScene,
  id: string,
  source: string,
  target: string,
  opts: MakeEdgeOptions = {},
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
    data: defaultEdgeDataFor(scene.diagramType),
  };
}
