import { useEffect, useRef, useState } from 'react';
import { createDiagramEditor, type DiagramEditorHandle } from '../core/editor/controller';
import { registerFlowchartAdapter } from '../core/editor/adapters/flowchart';
import type { Tool } from '../core/editor/interaction/pointer';
import type { EditorScene } from '../core/editor/scene/types';
import type { EditorLook } from '../core/editor/render/scene-renderer';
import type { MermaidSource } from '../types';

// 確保 flowchart adapter 在 React 端被註冊一次。
registerFlowchartAdapter();

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
    const offs = [
      ed.on('change', (s) => {
        cbRef.current.onChange?.(s as EditorScene);
        setCode(ed.toMermaid());
      }),
      ed.on('mermaidchange', (t) => {
        cbRef.current.onMermaidChange?.(t as string);
        setCode(t as string);
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

  return { hostRef, handle, tool, canUndo, canRedo, zoomPercent, selection, code };
}
