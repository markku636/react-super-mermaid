// core/editor 內部桶狀匯出(框架無關)。

export { createDiagramEditor } from './controller';
export type {
  DiagramEditorHandle,
  DiagramEditorOptions,
  EditorEvent,
} from './controller';

export { registerAdapter, getAdapter, listAdapters, detectDiagramType, firstKeyword } from './adapters/registry';
export type {
  DiagramAdapter,
  DiagramCapabilities,
  ParseResult,
  SerializeResult,
  ParseWarning,
  DataLossWarning,
} from './adapters/types';
export { flowchartAdapter, registerFlowchartAdapter } from './adapters/flowchart';
export { stateAdapter, registerStateAdapter } from './adapters/state';
export { erAdapter, registerErAdapter } from './adapters/er';
export { classAdapter, registerClassAdapter } from './adapters/class';
export { mindmapAdapter, registerMindmapAdapter } from './adapters/mindmap';
export { sequenceAdapter, registerSequenceAdapter } from './adapters/sequence';
export { requirementAdapter, registerRequirementAdapter } from './adapters/requirement';
export { quadrantAdapter, registerQuadrantAdapter } from './adapters/quadrant';
export { PLOT as QUADRANT_PLOT, valueToScene, sceneToValue } from './round-trip/quadrant/model';

export type { EditorLook } from './render/scene-renderer';
export { mermaidSvgLayout } from './layout/mermaid-svg-layout';
export type { LayoutEngine, LayoutContext } from './layout/types';

export { sceneToFlowchart } from './round-trip/flowchart/serialize';
export { flowDbToScene } from './round-trip/flowchart/parse';

// timeline 等資料圖表的 form 子編輯器(由 controller 在偵測到 timeline 時惰性接管)。
export { createTimelineForm } from './form/timeline-editor';
export type { TimelineFormHandle, TimelineFormOptions } from './form/timeline-editor';
export {
  parseTimeline,
  serializeTimeline,
  emptyTimelineModel,
} from './form/timeline-model';
export type { TimelineModel, TimelineSection, TimelinePeriod } from './form/timeline-model';

export type { Tool } from './interaction/pointer';
export { History } from './interaction/commands';
export type { Command, ScenePatch } from './interaction/commands';
export * as commands from './interaction/commands';

export { emptyScene } from './scene/types';
export type {
  EditorScene,
  SceneNode,
  SceneEdge,
  SceneContainer,
  SceneMeta,
  SceneRaw,
  NodeShape,
  ArrowHead,
  LineKind,
  NodeData,
  EdgeData,
  DiagramType,
  FlowDirection,
  Point,
  ElementStyle,
  LabelKind,
} from './scene/types';
export * as sceneOps from './scene/scene-ops';
export * as geometry from './scene/geometry';

// 建立元素的單一真相(依圖種給對的外形 / data / 父節點)+ 外形顯示中繼資料(工具列共用)。
export {
  makeNodeFor,
  makeEdgeFor,
  defaultShapeFor,
  defaultSizeFor,
  mindmapParent,
  mindmapShapeType,
} from './scene/node-factory';
export type { MakeNodeOptions, MakeEdgeOptions } from './scene/node-factory';
export { shapeMeta } from './scene/shape-meta';
export type { ShapeMeta } from './scene/shape-meta';
export { shapeIconMarkup } from './render/shape-icon';
export {
  classBoxSize,
  erEntitySize,
  contentSize,
  fitToContent,
  textWidth,
} from './render/node-metrics';
