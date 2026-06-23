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

export type { EditorLook } from './render/scene-renderer';
export { mermaidSvgLayout } from './layout/mermaid-svg-layout';
export type { LayoutEngine, LayoutContext } from './layout/types';

export { sceneToFlowchart } from './round-trip/flowchart/serialize';
export { flowDbToScene } from './round-trip/flowchart/parse';

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
