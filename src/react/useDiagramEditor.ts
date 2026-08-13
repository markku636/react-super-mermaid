import { useEffect, useRef, useState } from 'react';
import { createDiagramEditor, type DiagramEditorHandle } from '../core/editor/controller';
import { registerFlowchartAdapter } from '../core/editor/adapters/flowchart';
import { registerStateAdapter } from '../core/editor/adapters/state';
import { registerErAdapter } from '../core/editor/adapters/er';
import { registerClassAdapter } from '../core/editor/adapters/class';
import { registerMindmapAdapter } from '../core/editor/adapters/mindmap';
import { registerSequenceAdapter } from '../core/editor/adapters/sequence';
import { registerRequirementAdapter } from '../core/editor/adapters/requirement';
import { registerQuadrantAdapter } from '../core/editor/adapters/quadrant';
import { registerC4Adapter } from '../core/editor/adapters/c4';
import { registerKanbanAdapter } from '../core/editor/adapters/kanban';
import { registerSankeyAdapter } from '../core/editor/adapters/sankey';
import type { Tool } from '../core/editor/interaction/pointer';
import type { EditorScene } from '../core/editor/scene/types';
import type { EditorLook } from '../core/editor/render/scene-renderer';
import type { MermaidSource } from '../types';

// 確保各圖種 adapter 在 React 端被註冊一次。
registerFlowchartAdapter();
registerStateAdapter();
registerErAdapter();
registerClassAdapter();
registerMindmapAdapter();
registerSequenceAdapter();
registerRequirementAdapter();
registerQuadrantAdapter();
registerC4Adapter();
registerKanbanAdapter();
registerSankeyAdapter();

export interface UseDiagramEditorOptions {
  source?: string;
  scene?: EditorScene;
  mermaid?: MermaidSource;
  dark?: boolean;
  seed?: number;
  fontUrl?: string;
  look?: EditorLook;
  onChange?: (scene: EditorScene) => void;
  onMermaidChange?: (text: string) => void;
  onError?: (err: unknown) => void;
}

export interface UseDiagramEditorResult {
  hostRef: React.RefObject<HTMLDivElement>;
  handle: DiagramEditorHandle | null;
  tool: Tool;
  canUndo: boolean;
  canRedo: boolean;
  zoomPercent: number;
  selection: string[];
  /** 即時產生的 mermaid 原始碼(供內建「原始碼」面板)。 */
  code: string;
  /** 目前圖種(供工具列依型別顯示對應控制項)。 */
  diagramType: string;
}

export function useDiagramEditor(opts: UseDiagramEditorOptions): UseDiagramEditorResult {
  const hostRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<DiagramEditorHandle | null>(null);
  const [handle, setHandle] = useState<DiagramEditorHandle | null>(null);
  const [tool, setTool] = useState<Tool>('select');
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [zoomPercent, setZoomPercent] = useState(100);
  const [selection, setSelection] = useState<string[]>([]);
  const [code, setCode] = useState('');
  const [diagramType, setDiagramType] = useState<string>('flowchart');

  // 回呼用 ref 包,避免重建編輯器。
  const cbRef = useRef(opts);
  cbRef.current = opts;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    const ed = createDiagramEditor(host, {
      source: cbRef.current.source,
      scene: cbRef.current.scene,
      mermaid: cbRef.current.mermaid,
      dark: cbRef.current.dark,
      seed: cbRef.current.seed,
      fontUrl: cbRef.current.fontUrl,
      look: cbRef.current.look,
    });
    handleRef.current = ed;
    setHandle(ed);
    setCode(ed.toMermaid());
    setDiagramType(ed.getScene().diagramType);
    const offs = [
      ed.on('change', (s) => {
        cbRef.current.onChange?.(s as EditorScene);
        setDiagramType((s as EditorScene).diagramType);
        setCode(ed.toMermaid());
      }),
      ed.on('mermaidchange', (t) => {
        cbRef.current.onMermaidChange?.(t as string);
        setCode(t as string);
        setDiagramType(ed.getScene().diagramType);
      }),
      ed.on('error', (e) => cbRef.current.onError?.(e)),
      ed.on('toolchange', (t) => setTool(t as Tool)),
      ed.on('selectionchange', (ids) => setSelection(ids as string[])),
      ed.on('zoomchange', (p) => setZoomPercent(p as number)),
      ed.on('historychange', (h) => {
        const s = h as { canUndo: boolean; canRedo: boolean };
        setCanUndo(s.canUndo);
        setCanRedo(s.canRedo);
      }),
    ];
    return () => {
      offs.forEach((off) => off());
      ed.destroy();
      handleRef.current = null;
      setHandle(null);
    };
    // 只在掛載時建立一次。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // source 受控:外部變更且與目前序列化不同時才重新載入(避免自家編輯造成迴圈)。
  useEffect(() => {
    const ed = handleRef.current;
    if (!ed || opts.source === undefined) return;
    if (opts.source !== ed.toMermaid()) {
      void ed.loadSource(opts.source).catch((e) => cbRef.current.onError?.(e));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.source]);

  // dark 受控。
  useEffect(() => {
    if (handleRef.current && opts.dark !== undefined) handleRef.current.setDark(opts.dark);
  }, [opts.dark]);

  return { hostRef, handle, tool, canUndo, canRedo, zoomPercent, selection, code, diagramType };
}
