// 編輯器場景模型(框架無關、純 JSON、零 DOM / React)。
//
// 設計原則:
// - 扁平陣列 + parentId(非巢狀樹)→ 選取、hit-test、undo diff、序列化都簡單。
// - 幾何永遠存在(x/y = 場景座標左上角,w/h px)。由引擎排版的圖種(sequence)仍存幾何,
//   但以 `layoutOwner:'engine'` 標記其座標為衍生值。
// - 型別差異收進判別式 data / meta;新增圖種只加 variant,不動共用形狀。

export type DiagramType =
  | 'flowchart'
  | 'sequence'
  | 'class'
  | 'er'
  | 'state'
  | 'mindmap'
  | 'requirement'
  | 'quadrant'
  | 'c4'
  | 'kanban'
  | 'sankey'
  | 'journey'
  | 'gantt'
  | 'pie'
  | 'xychart'
  | 'architecture'
  | 'block'
  | 'timeline';

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
  // requirement
  | 'requirementBox'
  | 'elementBox'
  // quadrant chart:一個資料點(位置就是它的值)
  | 'point'
  // C4:人物 / 一般方塊 / 資料庫 / 佇列(細分的型別放在 data.c4Type)
  | 'c4Person'
  | 'c4Box'
  | 'c4Db'
  | 'c4Queue'
  // kanban:一張卡片(它在哪一欄由位置決定)
  | 'kanbanCard'
  // sankey:一個節點(流量的來源 / 去處)
  | 'sankeyNode'
  // journey:一個任務(它屬於哪個 section 由位置決定)
  | 'journeyTask'
  // gantt:一根時間長條(x=開始日、寬=工期、y=section)
  | 'ganttBar'
  // pie:一個扇形(節點是它的質心把手)
  | 'pieSlice'
  // xychart:一個資料點(垂直位置就是它的值)
  | 'xyPoint'
  // architecture:一個服務 / junction
  | 'archNode'
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
  | { kind: 'requirement'; req: RequirementData }
  // 象限圖的點:值就是它在圖上的位置,所以這裡只放樣式類的附加設定。
  | { kind: 'quadrant'; radius?: number; color?: string; strokeColor?: string; strokeWidth?: string }
  | { kind: 'c4'; c4Type: string; techn?: string; descr?: string }
  | { kind: 'kanban'; assigned?: string; ticket?: string; priority?: string }
  | { kind: 'sankey' }
  /** 旅程圖任務:心情分數 1..5 與參與角色。 */
  | { kind: 'journey'; score: number; actors: string[] }
  /** 甘特任務:旗標(done/active/crit/milestone)+ 原始的起訖寫法(保留 after / 工期單位)。 */
  | { kind: 'gantt'; flags: string[]; startRaw: string; endRaw: string; afterId?: string }
  | { kind: 'pie'; value: number }
  /** xychart 資料點:屬於第幾組系列、第幾個類別(值由節點的 y 決定)。 */
  | { kind: 'xy'; series: number; index: number }
  /** architecture 服務:圖示名(cloud/database/disk/server/internet)與是否為 junction。 */
  | { kind: 'architecture'; icon?: string; junction?: boolean }
  /** block 積木:占幾個欄位(位置決定它在網格的哪一格)。 */
  | { kind: 'block'; span: number }
  | { kind: 'note'; text: string };

/** requirementDiagram 的節點:需求(有 id/text/風險/驗證方式)或元素(有型別/文件連結)。 */
export type RequirementData =
  | {
      element: false;
      /** mermaid 關鍵字:requirement / functionalRequirement / …(見 REQ_TYPE_KEYWORD)。 */
      reqType: ReqType;
      reqId?: string;
      text?: string;
      risk?: ReqRisk;
      verifyMethod?: ReqVerify;
    }
  | { element: true; elementType?: string; docRef?: string };

export type ReqType =
  | 'requirement'
  | 'functionalRequirement'
  | 'interfaceRequirement'
  | 'performanceRequirement'
  | 'physicalRequirement'
  | 'designConstraint';
export type ReqRisk = 'low' | 'medium' | 'high';
export type ReqVerify = 'analysis' | 'inspection' | 'test' | 'demonstration';
/** quadrantChart 的圖表外框資訊(標題 / 兩軸端點文字 / 四個象限名)。點本身是場景節點。 */
export interface QuadrantMeta {
  title?: string;
  /** x 軸左右端文字(`x-axis 低 --> 高`);只給左端時 mermaid 也接受。 */
  xAxis?: { left: string; right?: string };
  yAxis?: { bottom: string; top?: string };
  /** quadrant-1..4 的名稱(1=右上、2=左上、3=左下、4=右下,與 mermaid 一致)。 */
  quadrants: [string?, string?, string?, string?];
  /** 未模型化的設定行(%%{init}%% 之外的 `classDef` 等)逐字保留。 */
  extraLines?: string[];
}

/** 甘特圖的圖表層設定。epoch = 第 0 天(UTC 毫秒),座標換算的原點。 */
export interface GanttMeta {
  title?: string;
  dateFormat?: string;
  epoch?: number;
  /** excludes / todayMarker / tickInterval 等 DB 未建模的設定行,逐字保留。 */
  settings: string[];
}

/** xychart 的圖表層資訊。資料值本身由節點的 y 決定,這裡只留類別與系列的骨架。 */
export interface XyChartMeta {
  title?: string;
  xTitle?: string;
  yTitle?: string;
  yMin: number;
  yMax: number;
  categories: string[];
  series: Array<{ kind: 'bar' | 'line'; name?: string; values: number[] }>;
}

export type ReqRelation =
  | 'contains'
  | 'copies'
  | 'derives'
  | 'satisfies'
  | 'verifies'
  | 'refines'
  | 'traces';

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
  | { kind: 'er'; identifying: boolean; cardStart?: ErCardinality; cardEnd?: ErCardinality }
  | { kind: 'requirement'; relation: ReqRelation }
  | { kind: 'c4'; relType: string; techn?: string; descr?: string }
  /** sankey 的連線帶「流量」;線寬也依它決定。 */
  | { kind: 'sankey'; value: number }
  /** architecture 連線:兩端接在節點的哪一邊(T/B/L/R)。 */
  | { kind: 'architecture'; fromSide: string; toSide: string };

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
  /** C4 邊界的種類(ENTERPRISE / SYSTEM / CONTAINER / …),決定序列化用哪個關鍵字。 */
  c4Type?: string;
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
  | { type: 'requirement'; direction?: FlowDirection }
  | { type: 'quadrant'; quadrant: QuadrantMeta }
  /** c4Type = C4Context / C4Container / C4Component / C4Dynamic / C4Deployment(決定標頭關鍵字)。 */
  | { type: 'c4'; c4Type: string; title?: string }
  | { type: 'kanban' }
  | { type: 'sankey' }
  | { type: 'journey'; title?: string }
  | { type: 'gantt'; gantt: GanttMeta }
  | { type: 'pie'; title?: string; showData: boolean }
  | { type: 'xychart'; xy: XyChartMeta }
  | { type: 'architecture' }
  | { type: 'block'; columns: number }
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

/** 各圖種的空 meta(新增圖種時只要在這張表補一列)。 */
const EMPTY_META: Record<DiagramType, SceneMeta> = {
  flowchart: { type: 'flowchart', direction: 'TB' },
  state: { type: 'state' },
  sequence: { type: 'sequence', autonumber: false },
  class: { type: 'class' },
  mindmap: { type: 'mindmap' },
  requirement: { type: 'requirement' },
  quadrant: { type: 'quadrant', quadrant: { quadrants: [] } },
  c4: { type: 'c4', c4Type: 'C4Context' },
  kanban: { type: 'kanban' },
  sankey: { type: 'sankey' },
  journey: { type: 'journey' },
  gantt: { type: 'gantt', gantt: { settings: [] } },
  pie: { type: 'pie', showData: false },
  xychart: { type: 'xychart', xy: { categories: [], series: [], yMin: 0, yMax: 100 } },
  architecture: { type: 'architecture' },
  block: { type: 'block', columns: 1 },
  timeline: { type: 'timeline' },
  er: { type: 'er' },
};

/** 建立一個空的 flowchart 場景。 */
export function emptyScene(diagramType: DiagramType = 'flowchart'): EditorScene {
  const meta: SceneMeta = EMPTY_META[diagramType] ?? EMPTY_META.flowchart;
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
