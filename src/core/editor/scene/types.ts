// 編輯器場景模型(框架無關、純 JSON、零 DOM / React)。
//
// 設計原則:
// - 扁平陣列 + parentId(非巢狀樹)→ 選取、hit-test、undo diff、序列化都簡單。
// - 幾何永遠存在(x/y = 場景座標左上角,w/h px)。由引擎排版的圖種(sequence)仍存幾何,
//   但以 `layoutOwner:'engine'` 標記其座標為衍生值。
// - 型別差異收進判別式 data / meta;新增圖種只加 variant,不動共用形狀。

export type DiagramType = 'flowchart' | 'sequence' | 'class' | 'er' | 'state' | 'mindmap' | 'timeline';

/** 節點外形 — 先填 flowchart / state 值,後續圖種(class/er/sequence)再擴充。 */
export type NodeShape =
  // flowchart
  | 'rectangle'
  | 'rounded'
  | 'stadium'
  | 'subroutine'
  | 'cylinder'
  | 'circle'
  | 'doubleCircle'
  | 'diamond'
  | 'hexagon'
  | 'odd'
  | 'trapezoid'
  | 'trapezoidAlt'
  | 'parallelogram'
  | 'parallelogramAlt'
  | 'ellipse'
  // state
  | 'state'
  | 'stateStart'
  | 'stateEnd'
  | 'fork'
  | 'choice'
  // class / er / sequence(後續階段)
  | 'classBox'
  | 'entity'
  | 'actor'
  | 'participant'
  | 'note'
  // 無法對映的新語法 → 原樣保留
  | 'passthrough';

/** 線條樣式(對映 flowchart 的 normal / thick / dotted / invisible)。 */
export type LineKind = 'solid' | 'dotted' | 'thick' | 'invisible';

/** 箭頭端 — flowchart 用 none/arrow/open/dot/cross;class/er 後續加 variant。 */
export type ArrowHead =
  | 'none'
  | 'arrow'
  | 'open'
  | 'dot'
  | 'cross'
  // class / er(後續)
  | 'triangle'
  | 'diamond'
  | 'diamondFilled'
  | 'crowFootOne'
  | 'crowFootMany';

export interface Point {
  x: number;
  y: number;
}

/**
 * 連線端的「固定錨點」(draw.io 式)。以相對節點 bbox 的分數座標表示(fx/fy ∈ 0..1),
 * 對標 draw.io 的 exitX/exitY / entryX/entryY。未設(undefined)= 浮動錨:動態朝對端中心,
 * 維持原本行為。此為編輯器專屬視覺資訊,mermaid 文字無對應語法(serialize 時略去,如同 waypoints)。
 */
export interface EdgeAnchor {
  fx: number;
  fy: number;
}

/** 內聯樣式 — 對映 mermaid 的 style / classDef。 */
export interface ElementStyle {
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  strokeDasharray?: string;
  color?: string;
  /** round-trip mermaid 的 `:::className`。 */
  classRef?: string;
}

export type LabelKind = 'markdown' | 'string' | 'text';

/** 型別專屬節點資料(判別式聯集)。 */
export type NodeData =
  | { kind: 'flowchart' }
  | { kind: 'state'; isStart?: boolean; isEnd?: boolean; composite?: boolean }
  | { kind: 'sequence'; actor: boolean }
  | { kind: 'class'; members: string[]; methods: string[]; stereotype?: string; generic?: string }
  | { kind: 'er'; attributes: ErAttribute[] }
  | { kind: 'mindmap'; shapeType: number }
  | { kind: 'note'; text: string };

export interface ErAttribute {
  name: string;
  type?: string;
  keys?: string[];
  comment?: string;
}

export interface SceneNode {
  id: string;
  shape: NodeShape;
  /** 作者文字(可能含 <br/> / markdown)。 */
  label: string;
  labelKind?: LabelKind;
  /** 場景座標(左上角)+ 尺寸,px。 */
  x: number;
  y: number;
  w: number;
  h: number;
  /** subgraph / namespace / composite-state 的父容器 id。 */
  parentId?: string | null;
  data?: NodeData;
  style?: ElementStyle;
  /** 使用者手動定位 → 重排版不覆蓋。 */
  pinned?: boolean;
  /** parse 原序,供 serialize 穩定排序。 */
  sourceIndex?: number;
  /** 無法模型化的原始 token(exotic shape `@{...}` 等),serialize 逐字回吐。 */
  raw?: string;
}

export type EdgeData =
  | { kind: 'flowchart' }
  | { kind: 'state' }
  | {
      kind: 'sequence';
      message: 'sync' | 'async' | 'return' | 'create' | 'destroy';
      activate?: boolean;
      order: number;
    }
  | {
      kind: 'class';
      relation: 'inheritance' | 'composition' | 'aggregation' | 'association' | 'dependency' | 'realization';
      cardinalitySource?: string;
      cardinalityTarget?: string;
    }
  | { kind: 'er'; identifying: boolean; cardStart?: ErCardinality; cardEnd?: ErCardinality };

/** ER 連線端的基數(crow's foot)。 */
export type ErCardinality = 'zeroOrOne' | 'onlyOne' | 'zeroOrMore' | 'oneOrMore';

export interface SceneEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  labelKind?: LabelKind;
  lineKind: LineKind;
  arrowStart: ArrowHead;
  arrowEnd: ArrowHead;
  /** 連線秩距(`---->` 的額外破折號數)。預設 1。 */
  minLen?: number;
  /** 使用者拗折的路徑點(Excalidraw 式)。 */
  waypoints?: Point[];
  /** 來源端固定錨點(draw.io 式)。未設 = 浮動(動態朝目標)。 */
  sourceAnchor?: EdgeAnchor;
  /** 目標端固定錨點(draw.io 式)。未設 = 浮動(動態朝來源)。 */
  targetAnchor?: EdgeAnchor;
  data?: EdgeData;
  style?: ElementStyle;
  sourceIndex?: number;
}

/** subgraph / cluster / namespace / composite-state 容器。 */
export interface SceneContainer {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  parentId?: string | null;
  childNodeIds: string[];
  /** 子容器(巢狀 subgraph)。 */
  childContainerIds?: string[];
  /** 容器內方向(per-subgraph direction)。 */
  direction?: FlowDirection;
  sourceIndex?: number;
}

export type FlowDirection = 'TB' | 'TD' | 'BT' | 'LR' | 'RL';

/** 型別專屬場景中繼資料。 */
export type SceneMeta =
  | { type: 'flowchart'; direction: FlowDirection }
  | { type: 'state'; direction?: FlowDirection }
  | { type: 'sequence'; autonumber: boolean }
  | { type: 'class'; direction?: FlowDirection }
  | { type: 'er'; direction?: FlowDirection }
  | { type: 'mindmap' }
  // timeline 等「資料圖表」不吃 node/edge 場景,內容由 form 編輯器自管;此處只保留判別式。
  | { type: 'timeline' };

/** round-trip 時 DB 看不到 / 尚未模型化的內容,逐字保留。 */
export interface SceneRaw {
  /** %% 註解(含 %%{init}%%),帶行錨。 */
  comments?: string[];
  /** classDef / class / style / linkStyle 等樣式行,逐字。 */
  styleLines?: string[];
  /** click / href 等互動指令行,逐字。 */
  clickLines?: string[];
  /** parse 失敗時的完整原文(降級用)。 */
  fullSource?: string;
}

/** sequence 圖以「依序的陳述串」建模(時間序,不吃通用 node/edge)。參與者另鏡像成 nodes 供選取。 */
export interface SeqParticipant {
  id: string;
  label: string;
  actor: boolean;
}
export type SeqStatement =
  | { kind: 'message'; from: string; to: string; arrow: string; text: string; activate?: '+' | '-' }
  | { kind: 'note'; placement: 'left of' | 'right of' | 'over'; actors: string; text: string }
  | { kind: 'fragment'; keyword: string; label: string } // loop/alt/else/opt/par/and/critical/option/break/rect/box/...
  | { kind: 'end' }
  | { kind: 'activate'; actor: string }
  | { kind: 'deactivate'; actor: string }
  | { kind: 'raw'; text: string }; // 未模型化的行,逐字保留
export interface SequenceData {
  autonumber: boolean;
  participants: SeqParticipant[];
  statements: SeqStatement[];
}

export interface EditorScene {
  version: 1;
  diagramType: DiagramType;
  meta: SceneMeta;
  nodes: SceneNode[];
  edges: SceneEdge[];
  containers: SceneContainer[];
  /** sequence 專屬資料(diagramType==='sequence' 時)。 */
  sequence?: SequenceData;
  /** 逐字保留的 YAML frontmatter(--- ... ---)。 */
  frontmatter?: string;
  raw?: SceneRaw;
  layoutOwner: 'user' | 'engine';
}

/** 建立一個空的 flowchart 場景。 */
export function emptyScene(diagramType: DiagramType = 'flowchart'): EditorScene {
  const meta: SceneMeta =
    diagramType === 'flowchart'
      ? { type: 'flowchart', direction: 'TB' }
      : diagramType === 'state'
        ? { type: 'state' }
        : diagramType === 'sequence'
          ? { type: 'sequence', autonumber: false }
          : diagramType === 'class'
            ? { type: 'class' }
            : diagramType === 'mindmap'
              ? { type: 'mindmap' }
              : diagramType === 'timeline'
                ? { type: 'timeline' }
                : { type: 'er' };
  return {
    version: 1,
    diagramType,
    meta,
    nodes: [],
    edges: [],
    containers: [],
    layoutOwner: 'user',
  };
}
