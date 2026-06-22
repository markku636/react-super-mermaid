// Headless 編輯器控制器:組裝 renderer + viewport + overlay + pointer + history,
// 提供命令式 handle 與事件。框架無關;React 與 VS Code webview 各自包裝 UI。

import { assertBrowser } from '../../env';
import { loadMermaid } from '../load-mermaid';
import {
  prepareSvgElement,
  rasterizeToBlob,
  svgBlob,
  downloadBlob,
} from '../export';
import type { ExportRasterOptions, MermaidSource, MermaidTheme } from '../../types';
import { getAdapter, detectDiagramType } from './adapters/registry';
import { mermaidSvgLayout } from './layout/mermaid-svg-layout';
import {
  History,
  cmdAddElements,
  cmdAddNode,
  cmdAlignNodes,
  cmdDeleteSelection,
  cmdGroup,
  cmdMoveNodes,
  cmdSetDirection,
  cmdSetEdgeStyle,
  cmdSetLabel,
  cmdSetNodeStyle,
  cmdSetShape,
  type AlignAxis,
  type Command,
} from './interaction/commands';
import { NODE_PALETTE } from './render/palette';
import { makeNode, nextEdgeId, nextNodeId } from './scene/scene-ops';
import { PointerController, type PointerHost, type Tool } from './interaction/pointer';
import { openTextEditor } from './interaction/text-edit';
import { Viewport } from './interaction/viewport';
import { Overlay } from './interaction/overlay';
import { SceneRenderer, type EditorLook } from './render/scene-renderer';
import { ensureEditorStyles } from './render/editor-styles';
import { ensureStyles } from '../ensure-styles';
import { svgEl } from './render/dom';
import { boundingBox, nodeRect } from './scene/geometry';
import { edgePoints } from './render/edges';
import { emptyScene } from './scene/types';
import type { ArrowHead, DiagramType, EditorScene, FlowDirection, LineKind, NodeShape, Point } from './scene/types';
import { renderDiagram } from '../render-pipeline';

export type EditorEvent =
  | 'change'
  | 'mermaidchange'
  | 'selectionchange'
  | 'toolchange'
  | 'historychange'
  | 'zoomchange'
  | 'error';

export interface DiagramEditorOptions {
  /** 初始 mermaid 文字(優先於 scene)。 */
  source?: string;
  /** 初始場景(無 source 時使用)。 */
  scene?: EditorScene;
  /** 如何取得 mermaid(parse / layout / 預覽用)。 */
  mermaid?: MermaidSource;
  dark?: boolean;
  seed?: number;
  fontUrl?: string;
  /** 視覺風格:'sketch' 手繪(預設) / 'clean' 俐落圓角+柔和陰影(貼近 colorful)。 */
  look?: EditorLook;
  /** mermaidchange 防抖毫秒,預設 250。 */
  debounceMs?: number;
}

export interface DiagramEditorHandle {
  getScene(): EditorScene;
  toMermaid(): string;
  loadSource(text: string): Promise<void>;
  loadScene(scene: EditorScene): void;

  setTool(tool: Tool): void;
  getTool(): Tool;
  setCreateShape(shape: NodeShape): void;
  /** 直接在畫布中央放一個節點(可選外形),選取並進入改名。回傳新節點 id。 */
  addNode(shape?: NodeShape): string;
  /** 變更既有節點的外形。 */
  setNodeShape(id: string, shape: NodeShape): void;
  /** 變更 flowchart 方向(TB/LR/…)。 */
  setDirection(dir: FlowDirection): void;
  /** 變更連線樣式(線型 / 箭頭)。 */
  setEdgeStyle(edgeId: string, patch: Partial<{ lineKind: LineKind; arrowStart: ArrowHead; arrowEnd: ArrowHead }>): void;

  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;

  selectAll(): void;
  clearSelection(): void;
  deleteSelection(): void;
  getSelection(): string[];

  zoomIn(): void;
  zoomOut(): void;
  fit(): void;
  resetView(): void;
  getZoomPercent(): number;
  /** 用排版引擎重新整理目前圖的座標(一鍵整版)。 */
  tidy(): Promise<void>;
  /** 複製選取的節點(+其間的邊)並貼上偏移副本。 */
  duplicateSelection(): void;
  /** 把選取的節點群組成一個 subgraph 容器。 */
  groupSelection(): void;
  /** 設定節點底色 + 框線色。 */
  setNodeColor(id: string, fill: string, stroke: string): void;
  /** 對齊多個選取節點。 */
  alignSelection(axis: AlignAxis): void;

  setDark(dark: boolean): void;

  getSvg(): SVGSVGElement;
  exportSvg(): string;
  exportPng(opts?: ExportRasterOptions): Promise<Blob>;
  downloadSvg(filename?: string): void;
  downloadPng(filename?: string, opts?: ExportRasterOptions): Promise<void>;

  /** 用既有 render-pipeline 在 container 渲染目前場景的「美化預覽」。 */
  renderPreview(container: HTMLElement, theme?: MermaidTheme): Promise<void>;

  on(event: EditorEvent, cb: (payload?: unknown) => void): () => void;
  destroy(): void;
}

// 右鍵選單可快速切換的常用外形。
const CTX_SHAPES: Array<[NodeShape, string]> = [
  ['rectangle', '▭'],
  ['rounded', '⬭'],
  ['stadium', '⬮'],
  ['diamond', '◇'],
  ['circle', '◯'],
  ['hexagon', '⬡'],
  ['cylinder', '⛁'],
];

export function createDiagramEditor(host: HTMLElement, opts: DiagramEditorOptions = {}): DiagramEditorHandle {
  assertBrowser('createDiagramEditor');
  ensureStyles(); // 基礎 .rsm-toolbar / .rsm-btn 樣式(讓內建工具列不依賴頁面是否另有 MermaidViewer)
  ensureEditorStyles();

  // 容器結構。
  if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
  host.classList.add('rsm-editor-root');
  if (opts.look === 'clean') host.classList.add('rsm-clean');
  let dark = opts.dark ?? false;
  if (dark) host.classList.add('rsm-dark');

  const svg = svgEl('svg', { class: 'rsm-editor-svg' }) as SVGSVGElement;
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  host.appendChild(svg);

  const listeners = new Map<EditorEvent, Set<(p?: unknown) => void>>();
  const emit = (e: EditorEvent, p?: unknown): void => {
    listeners.get(e)?.forEach((cb) => cb(p));
  };

  const renderer = new SceneRenderer({ dark, seed: opts.seed, fontUrl: opts.fontUrl, look: opts.look });
  const viewport = new Viewport(svg, {
    onChange: () => emit('zoomchange', viewport.getZoomPercent()),
  });
  svg.appendChild(viewport.group);
  renderer.mount(viewport.group);
  const overlay = new Overlay(renderer.overlayLayer);
  const history = new History();

  let scene: EditorScene = opts.scene ?? emptyScene('flowchart');
  let diagramType: DiagramType = scene.diagramType;
  let createShape: NodeShape = 'rectangle';
  let cancelTextEdit: (() => void) | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const adapterFor = (type: DiagramType) => getAdapter(type) ?? getAdapter('flowchart');

  const emitMermaidDebounced = (): void => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      try {
        emit('mermaidchange', handle.toMermaid());
      } catch (err) {
        emit('error', err);
      }
    }, opts.debounceMs ?? 250);
  };

  const refreshOverlay = (): void => {
    const ids = pointer.getSelection();
    const idSet = new Set(ids);
    const zoom = viewport.getZoom();
    const nodeRects = ids
      .map((id) => scene.nodes.find((n) => n.id === id))
      .filter((n): n is NonNullable<typeof n> => Boolean(n))
      .map((n) => ({ id: n.id, rect: nodeRect(n) }));
    overlay.showSelection(nodeRects, zoom, { handles: nodeRects.length === 1 });
    // 選取的連線高亮(點到線即可選取並看到回饋)。
    const edgePathsList = scene.edges
      .filter((e) => idSet.has(e.id))
      .map((e) => edgePoints(scene, e))
      .filter((p): p is Point[] => Boolean(p));
    overlay.showEdges(edgePathsList, zoom);
  };

  const setScene = (next: EditorScene, opts2: { render?: boolean } = {}): void => {
    scene = next;
    diagramType = next.diagramType;
    if (opts2.render !== false) renderer.render(scene);
    refreshOverlay();
    emit('change', scene);
    emit('historychange', { canUndo: history.canUndo(), canRedo: history.canRedo() });
    emitMermaidDebounced();
  };

  const pointerHost: PointerHost = {
    getScene: () => scene,
    viewport,
    renderer,
    overlay,
    runCommand: (cmd: Command, label: string) => {
      const { scene: next } = history.run(scene, cmd, label);
      setScene(next);
    },
    refreshOverlay,
    requestTextEdit: (nodeId: string) => openEditor(nodeId),
    requestEdgeLabelEdit: (edgeId: string) => openEdgeEditor(edgeId),
    onSelectionChange: (ids) => emit('selectionchange', ids),
    onToolChange: (tool) => emit('toolchange', tool),
    createShape: () => createShape,
  };

  const pointer = new PointerController(svg, pointerHost);

  function openEditor(nodeId: string): void {
    const node = scene.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    cancelTextEdit?.();
    const tl = viewport.worldToScreen({ x: node.x, y: node.y });
    const z = viewport.getZoom();
    const nodeW = node.w;
    const nodeH = node.h;
    const initial = node.label;
    // 延後到目前 click/pointer 事件完全結束才建立並聚焦 textarea。否則原生點擊收尾會把焦點
    // 搶回畫布,textarea 一聚焦就立刻 blur 關閉 → 看起來「雙擊無法編輯」。
    const timer = setTimeout(() => {
      cancelTextEdit = openTextEditor(
        host,
        { left: tl.x, top: tl.y, width: nodeW * z, height: nodeH * z },
        initial,
        (value) => {
          cancelTextEdit = null;
          // 只有 label 真的改變才入命令 —— 避免新增節點後 blur 自動 commit 空字串產生贅餘 undo。
          const cur = scene.nodes.find((n) => n.id === nodeId);
          if (cur && value !== cur.label) {
            pointerHost.runCommand(cmdSetLabel(nodeId, value), 'label');
          }
        },
        () => {
          cancelTextEdit = null;
        },
      );
    }, 0);
    cancelTextEdit = () => clearTimeout(timer);
  }

  function openEdgeEditor(edgeId: string): void {
    const edge = scene.edges.find((e) => e.id === edgeId);
    if (!edge) return;
    const pts = edgePoints(scene, edge);
    if (!pts || pts.length === 0) return;
    const i = Math.floor((pts.length - 1) / 2);
    const mid = { x: (pts[i].x + pts[Math.min(i + 1, pts.length - 1)].x) / 2, y: (pts[i].y + pts[Math.min(i + 1, pts.length - 1)].y) / 2 };
    const s = viewport.worldToScreen(mid);
    const initial = edge.label ?? '';
    cancelTextEdit?.();
    const timer = setTimeout(() => {
      cancelTextEdit = openTextEditor(
        host,
        { left: s.x - 60, top: s.y - 14, width: 120, height: 28 },
        initial,
        (value) => {
          cancelTextEdit = null;
          const cur = scene.edges.find((e) => e.id === edgeId);
          if (cur && value !== (cur.label ?? '')) {
            pointerHost.runCommand(cmdSetLabel(edgeId, value), 'edge-label');
          }
        },
        () => {
          cancelTextEdit = null;
        },
      );
    }, 0);
    cancelTextEdit = () => clearTimeout(timer);
  }

  // 剪貼簿(複製/貼上選取的子圖)。
  let clipboard: { nodes: typeof scene.nodes; edges: typeof scene.edges } | null = null;

  /** 由選取的節點(+其間的邊)複製出帶新 id 的副本,偏移 (dx,dy);回傳新元素與新節點 id。 */
  const cloneSelection = (
    srcNodes: typeof scene.nodes,
    srcEdges: typeof scene.edges,
    dx: number,
    dy: number,
  ): { nodes: typeof scene.nodes; edges: typeof scene.edges; nodeIds: string[] } => {
    let work = scene;
    const idMap = new Map<string, string>();
    const nodes: typeof scene.nodes = [];
    for (const n of srcNodes) {
      const nid = nextNodeId(work);
      const copy = { ...n, id: nid, x: n.x + dx, y: n.y + dy, parentId: null, pinned: true };
      idMap.set(n.id, nid);
      nodes.push(copy);
      work = { ...work, nodes: [...work.nodes, copy] };
    }
    const edges: typeof scene.edges = [];
    for (const ed of srcEdges) {
      if (idMap.has(ed.source) && idMap.has(ed.target)) {
        const eid = nextEdgeId(work);
        const copy = { ...ed, id: eid, source: idMap.get(ed.source)!, target: idMap.get(ed.target)! };
        edges.push(copy);
        work = { ...work, edges: [...work.edges, copy] };
      }
    }
    return { nodes, edges, nodeIds: [...idMap.values()] };
  };

  const pasteClone = (
    srcNodes: typeof scene.nodes,
    srcEdges: typeof scene.edges,
    dx: number,
    dy: number,
  ): void => {
    if (srcNodes.length === 0) return;
    const cloned = cloneSelection(srcNodes, srcEdges, dx, dy);
    pointerHost.runCommand(cmdAddElements(cloned.nodes, cloned.edges), 'paste');
    pointer.setSelection(cloned.nodeIds);
  };

  // 鍵盤(掛在 host;編輯文字時 textarea 已 stopPropagation)。
  const onKeyDown = (e: KeyboardEvent): void => {
    const active = document.activeElement;
    if (active && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT')) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (mod && k === 'z' && !e.shiftKey) {
      e.preventDefault();
      handle.undo();
    } else if (mod && (k === 'y' || (k === 'z' && e.shiftKey))) {
      e.preventDefault();
      handle.redo();
    } else if (mod && k === 'a') {
      e.preventDefault();
      pointer.selectAll();
    } else if (mod && k === 'd') {
      e.preventDefault();
      handle.duplicateSelection();
    } else if (mod && k === 'g') {
      e.preventDefault();
      handle.groupSelection();
    } else if (mod && k === 'c') {
      const ids = new Set(pointer.getSelection());
      const sn = scene.nodes.filter((n) => ids.has(n.id));
      if (sn.length) clipboard = { nodes: sn, edges: scene.edges.filter((ed) => ids.has(ed.source) && ids.has(ed.target)) };
    } else if (mod && k === 'v') {
      e.preventDefault();
      if (clipboard) pasteClone(clipboard.nodes, clipboard.edges, 24, 24);
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      handle.deleteSelection();
    } else if (e.key.startsWith('Arrow')) {
      // 方向鍵微調選取節點(Shift=10px)。
      const ids = pointer.getSelection().filter((id) => scene.nodes.some((n) => n.id === id));
      if (ids.length) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        pointerHost.runCommand(cmdMoveNodes(ids, dx, dy), 'nudge');
      }
    } else if (e.key === 'Escape') {
      pointer.clearSelection();
      pointer.setTool('select');
    } else if (k === 'v') {
      pointer.setTool('select');
    } else if (k === 'n') {
      pointer.setTool('node-create');
    } else if (k === 'e') {
      pointer.setTool('edge-create');
    }
  };
  host.setAttribute('tabindex', host.getAttribute('tabindex') ?? '0');
  host.addEventListener('keydown', onKeyDown);

  // ── 右鍵選單(改外形 / 改名 / 複製 / 刪除;邊:改文字 / 刪除;空白:新增 / 貼上 / 整理 / 全選)──
  let ctxMenu: HTMLElement | null = null;
  const closeContextMenu = (): void => {
    ctxMenu?.remove();
    ctxMenu = null;
  };
  const onContextMenu = (e: MouseEvent): void => {
    e.preventDefault();
    closeContextMenu();
    const t = e.target as Element;
    const nodeEl = t.closest('[data-node-id]');
    const edgeEl = t.closest('[data-edge-hit]');
    const menu = document.createElement('div');
    menu.className = 'rsm-ctx';
    const addItem = (label: string, fn: () => void): void => {
      const it = document.createElement('div');
      it.className = 'rsm-ctx-item';
      it.textContent = label;
      it.addEventListener('click', () => {
        closeContextMenu();
        fn();
      });
      menu.appendChild(it);
    };
    const addSep = (): void => {
      const s = document.createElement('div');
      s.className = 'rsm-ctx-sep';
      menu.appendChild(s);
    };
    if (nodeEl) {
      const id = nodeEl.getAttribute('data-node-id') as string;
      // 右鍵已選取的節點 → 保留多選(才能用對齊/群組);否則改選此節點。
      if (!pointer.getSelection().includes(id)) pointer.setSelection([id]);
      const strip = document.createElement('div');
      strip.className = 'rsm-ctx-shapes';
      for (const [shape, glyph] of CTX_SHAPES) {
        const sb = document.createElement('button');
        sb.type = 'button';
        sb.textContent = glyph;
        sb.title = shape;
        sb.addEventListener('click', () => {
          closeContextMenu();
          handle.setNodeShape(id, shape);
        });
        strip.appendChild(sb);
      }
      menu.appendChild(strip);
      // 顏色色票列。
      const colors = document.createElement('div');
      colors.className = 'rsm-ctx-shapes';
      for (const pal of NODE_PALETTE) {
        const cb = document.createElement('button');
        cb.type = 'button';
        cb.title = '上色';
        cb.style.background = pal.fill;
        cb.style.minHeight = '16px';
        cb.addEventListener('click', () => {
          closeContextMenu();
          handle.setNodeColor(id, pal.fill, pal.stroke);
        });
        colors.appendChild(cb);
      }
      menu.appendChild(colors);
      addSep();
      addItem('改名', () => openEditor(id));
      addItem('複製', () => handle.duplicateSelection());
      if (pointer.getSelection().length > 1) {
        addItem('群組成 subgraph', () => handle.groupSelection());
        addSep();
        addItem('靠左對齊', () => handle.alignSelection('left'));
        addItem('水平置中', () => handle.alignSelection('centerX'));
        addItem('靠右對齊', () => handle.alignSelection('right'));
        addItem('靠上對齊', () => handle.alignSelection('top'));
        addItem('垂直置中', () => handle.alignSelection('middleY'));
        addItem('靠下對齊', () => handle.alignSelection('bottom'));
        addSep();
      }
      addItem('刪除', () => handle.deleteSelection());
    } else if (edgeEl) {
      const id = edgeEl.getAttribute('data-edge-hit') as string;
      pointer.setSelection([id]);
      addItem('編輯文字', () => openEdgeEditor(id));
      addItem('實線', () => handle.setEdgeStyle(id, { lineKind: 'solid' }));
      addItem('虛線', () => handle.setEdgeStyle(id, { lineKind: 'dotted' }));
      addItem('粗線', () => handle.setEdgeStyle(id, { lineKind: 'thick' }));
      addItem('切換箭頭', () => {
        const ed = scene.edges.find((x) => x.id === id);
        handle.setEdgeStyle(id, { arrowEnd: ed && ed.arrowEnd === 'none' ? 'arrow' : 'none' });
      });
      addSep();
      addItem('刪除', () => handle.deleteSelection());
    } else {
      const world = viewport.screenToWorld(e.clientX, e.clientY);
      addItem('在此新增節點', () => {
        const nid = nextNodeId(scene);
        const n = makeNode(nid, world, { shape: createShape });
        pointerHost.runCommand(cmdAddNode(n), 'add-node');
        pointer.setSelection([nid]);
        openEditor(nid);
      });
      addItem('貼上', () => {
        if (clipboard) pasteClone(clipboard.nodes, clipboard.edges, 24, 24);
      });
      addItem('整理排版', () => void handle.tidy());
      addItem('全選', () => pointer.selectAll());
    }
    const rect = host.getBoundingClientRect();
    menu.style.left = `${e.clientX - rect.left}px`;
    menu.style.top = `${e.clientY - rect.top}px`;
    host.appendChild(menu);
    ctxMenu = menu;
    setTimeout(() => document.addEventListener('pointerdown', closeContextMenu, { once: true }), 0);
  };
  host.addEventListener('contextmenu', onContextMenu);

  function exportClone(): SVGSVGElement {
    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.querySelector('.rsm-overlay')?.remove();
    const vp = clone.querySelector<SVGGElement>('.rsm-viewport');
    if (vp) {
      vp.removeAttribute('transform');
      vp.style.transform = '';
    }
    const bb = boundingBox(scene.nodes.map(nodeRect));
    const pad = 24;
    if (bb) {
      clone.setAttribute('viewBox', `${bb.x - pad} ${bb.y - pad} ${bb.w + pad * 2} ${bb.h + pad * 2}`);
    }
    return clone;
  }

  const handle: DiagramEditorHandle = {
    getScene: () => scene,
    toMermaid: () => {
      const adapter = adapterFor(diagramType);
      if (!adapter) return '';
      return adapter.serialize(scene).text;
    },
    loadScene: (next) => {
      setScene(next);
      handle.fit();
    },
    loadSource: async (text: string) => {
      try {
        const type = detectDiagramType(text) ?? 'flowchart';
        const adapter = adapterFor(type);
        if (!adapter) throw new Error(`找不到圖種 adapter:${type}`);
        const mermaid = await loadMermaid({ source: opts.mermaid });
        const { scene: parsed } = await adapter.parse(text, mermaid);
        const laid =
          parsed.layoutOwner === 'engine'
            ? await adapter.layout(parsed, mermaidSvgLayout, opts.mermaid)
            : parsed;
        history.clear();
        setScene(laid);
        handle.fit();
      } catch (err) {
        emit('error', err);
        throw err;
      }
    },

    setTool: (tool) => pointer.setTool(tool),
    getTool: () => pointer.getTool(),
    setCreateShape: (shape) => {
      createShape = shape;
    },
    setNodeShape: (id, shape) => {
      pointerHost.runCommand(cmdSetShape(id, shape), 'shape');
    },
    setDirection: (dir) => {
      pointerHost.runCommand(cmdSetDirection(dir), 'direction');
    },
    setEdgeStyle: (edgeId, patch) => {
      pointerHost.runCommand(cmdSetEdgeStyle(edgeId, patch), 'edge-style');
    },
    addNode: (shape) => {
      const rect = svg.getBoundingClientRect();
      // 視窗中央(世界座標);多次新增稍微錯開,避免完全疊在一起。
      const center = viewport.screenToWorld(rect.left + rect.width / 2, rect.top + rect.height / 2);
      const off = (scene.nodes.length % 8) * 18;
      const id = nextNodeId(scene);
      const node = makeNode(id, { x: center.x + off, y: center.y + off }, { shape: shape ?? createShape });
      pointerHost.runCommand(cmdAddNode(node), 'add-node');
      pointer.setTool('select'); // 新增後回到選取,讓使用者可立即拖曳/選取(預設就是選取)。
      pointer.setSelection([id]);
      openEditor(id);
      return id;
    },

    undo: () => {
      const res = history.undo();
      if (res) setScene(res.scene);
    },
    redo: () => {
      const res = history.redo();
      if (res) setScene(res.scene);
    },
    canUndo: () => history.canUndo(),
    canRedo: () => history.canRedo(),

    selectAll: () => pointer.selectAll(),
    clearSelection: () => pointer.clearSelection(),
    deleteSelection: () => {
      const ids = new Set(pointer.getSelection());
      if (ids.size === 0) return;
      const nodeIds = scene.nodes.filter((n) => ids.has(n.id)).map((n) => n.id);
      const edgeIds = scene.edges.filter((e) => ids.has(e.id)).map((e) => e.id);
      pointerHost.runCommand(cmdDeleteSelection(nodeIds, edgeIds), 'delete');
      pointer.clearSelection();
    },
    getSelection: () => pointer.getSelection(),

    zoomIn: () => {
      viewport.zoomBy(1.2);
      refreshOverlay();
    },
    zoomOut: () => {
      viewport.zoomBy(1 / 1.2);
      refreshOverlay();
    },
    fit: () => {
      viewport.fit(boundingBox(scene.nodes.map(nodeRect)));
      refreshOverlay();
    },
    resetView: () => {
      viewport.setZoom(1);
      handle.fit();
    },
    getZoomPercent: () => viewport.getZoomPercent(),
    tidy: async () => {
      const adapter = adapterFor(diagramType);
      if (!adapter) return;
      try {
        const laid = await adapter.layout(scene, mermaidSvgLayout, opts.mermaid);
        setScene(laid);
        handle.fit();
      } catch (err) {
        emit('error', err);
      }
    },
    duplicateSelection: () => {
      const ids = new Set(pointer.getSelection());
      const sn = scene.nodes.filter((n) => ids.has(n.id));
      if (sn.length === 0) return;
      const se = scene.edges.filter((ed) => ids.has(ed.source) && ids.has(ed.target));
      pasteClone(sn, se, 24, 24);
    },
    groupSelection: () => {
      const ids = pointer.getSelection().filter((id) => scene.nodes.some((n) => n.id === id));
      if (ids.length === 0) return;
      const taken = new Set(scene.containers.map((c) => c.id));
      let k = 1;
      while (taken.has(`sub${k}`)) k += 1;
      pointerHost.runCommand(
        cmdGroup({ id: `sub${k}`, label: '群組', x: 0, y: 0, w: 0, h: 0, childNodeIds: ids }),
        'group',
      );
    },
    setNodeColor: (id, fill, stroke) => {
      pointerHost.runCommand(cmdSetNodeStyle(id, { fill, stroke }), 'color');
    },
    alignSelection: (axis) => {
      const ids = pointer.getSelection().filter((id) => scene.nodes.some((n) => n.id === id));
      if (ids.length >= 2) pointerHost.runCommand(cmdAlignNodes(ids, axis), 'align');
    },

    setDark: (d) => {
      dark = d;
      host.classList.toggle('rsm-dark', d);
      renderer.setDark(d);
      refreshOverlay();
    },

    getSvg: () => svg,
    exportSvg: () => prepareSvgElement(exportClone()).serialized,
    exportPng: async (rasterOpts) => {
      const prepared = prepareSvgElement(exportClone());
      return rasterizeToBlob(prepared, { ...rasterOpts, dark });
    },
    downloadSvg: (filename = 'diagram.svg') => {
      downloadBlob(svgBlob(handle.exportSvg()), filename);
    },
    downloadPng: async (filename = 'diagram.png', rasterOpts) => {
      const blob = await handle.exportPng(rasterOpts);
      downloadBlob(blob, filename);
    },

    renderPreview: async (container, theme = 'colorful') => {
      await renderDiagram({ code: handle.toMermaid(), container, theme, dark, mermaid: opts.mermaid });
    },

    on: (event, cb) => {
      let set = listeners.get(event);
      if (!set) {
        set = new Set();
        listeners.set(event, set);
      }
      set.add(cb);
      return () => set!.delete(cb);
    },
    destroy: () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      cancelTextEdit?.();
      pointer.destroy();
      host.removeEventListener('keydown', onKeyDown);
      host.removeEventListener('contextmenu', onContextMenu);
      closeContextMenu();
      svg.remove();
      host.classList.remove('rsm-editor-root', 'rsm-dark', 'rsm-clean');
      listeners.clear();
    },
  };

  // 初始載入。
  if (opts.source) {
    void handle.loadSource(opts.source);
  } else {
    renderer.render(scene);
    handle.fit();
  }

  return handle;
}
