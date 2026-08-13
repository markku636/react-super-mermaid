// Headless 編輯器控制器:組裝 renderer + viewport + overlay + pointer + history,
// 提供命令式 handle 與事件。框架無關;React 與 VS Code webview 各自包裝 UI。

import { assertBrowser } from '../../env';
import { loadMermaid } from '../load-mermaid';
import {
  prepareSvgElement,
  rasterizeToBlob,
  svgBlob,
  downloadBlob,
  flattenForeignObjects,
} from '../export';
import type { ExportRasterOptions, MermaidSource, MermaidTheme } from '../../types';
import { getAdapter, detectDiagramType, firstKeyword } from './adapters/registry';
import type { DiagramCapabilities } from './adapters/types';
import { createTimelineForm, type TimelineFormHandle } from './form/timeline-editor';
import { mermaidSvgLayout } from './layout/mermaid-svg-layout';
import {
  History,
  cmdAddConnectedNode,
  cmdAddContainer,
  cmdAddElements,
  cmdAddNode,
  cmdAddSeqMessage,
  cmdAddSeqNote,
  cmdAddSeqParticipant,
  cmdDeleteContainer,
  cmdDeleteSeqParticipant,
  cmdDeleteSeqStatement,
  cmdSetContainerLabel,
  cmdToggleSeqArrow,
  cmdAlignNodes,
  cmdDeleteSelection,
  cmdDistributeNodes,
  cmdGroup,
  cmdMoveNodes,
  cmdUngroup,
  cmdSetDirection,
  cmdSetEdgeData,
  cmdSetEdgeStyle,
  cmdSetEdgesStyle,
  cmdRenameSeqParticipant,
  cmdSetSeqMessageText,
  cmdSetLabel,
  cmdSetNodeData,
  cmdSetNodeStyle,
  cmdSetParent,
  cmdSetShape,
  type AlignAxis,
  type Command,
} from './interaction/commands';
import { NODE_PALETTE } from './render/palette';
import { classBoxSize, erEntitySize, requirementBoxSize, requirementRows } from './render/node-metrics';
import { containerRect, nextEdgeId, nextNodeId } from './scene/scene-ops';
import { defaultShapeFor, makeEdgeFor, makeNodeFor } from './scene/node-factory';
import { laneRect } from './layout/lanes';
import { shapeMeta } from './scene/shape-meta';
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
import type {
  ArrowHead,
  DiagramType,
  EditorScene,
  FlowDirection,
  LineKind,
  NodeShape,
  Point,
  ReqRelation,
  RequirementData,
  SceneNode,
} from './scene/types';
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
  /** 目前圖種的能力(支援的外形 / 線型 / 箭頭),供工具列建構控制項。null = 找不到 adapter。 */
  getCapabilities(): DiagramCapabilities | null;
  /** 「新連線」目前的預設樣式(線型 / 箭頭)。 */
  getEdgeStyleDefault(): { lineKind: LineKind; arrowStart: ArrowHead; arrowEnd: ArrowHead };
  /**
   * 套用連線樣式:更新「新連線」預設,並一併套到目前選取的連線(若有,單一 undo)。
   * 會過濾掉目前圖種不支援的線型 / 箭頭,確保永遠序列化成合法 mermaid。
   */
  applyEdgeStyle(patch: Partial<{ lineKind: LineKind; arrowStart: ArrowHead; arrowEnd: ArrowHead }>): void;

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
  /** 均分:3+ 個選取節點在水平/垂直方向等距分佈。 */
  distributeSelection(axis: 'h' | 'v'): void;
  /** 解除節點所屬的 subgraph 群組(若有)。 */
  ungroupNode(nodeId: string): void;

  setDark(dark: boolean): void;

  getSvg(): SVGSVGElement;
  exportSvg(): string;
  exportPng(opts?: ExportRasterOptions): Promise<Blob>;
  downloadSvg(filename?: string): void;
  downloadPng(filename?: string, opts?: ExportRasterOptions): Promise<void>;
  /** 把目前圖以 PNG 寫入剪貼簿(對標 draw.io / Excalidraw 的「複製為圖片」)。需安全環境 + 使用者手勢。 */
  copyPngToClipboard(opts?: ExportRasterOptions): Promise<void>;
  /** 顯示 / 隱藏鍵盤快捷鍵說明浮層(? 鍵亦可)。 */
  toggleHelp(show?: boolean): void;
  /** 切換手繪(sketch)/ 簡潔(clean)外觀(致敬 Excalidraw 的手繪風)。 */
  setLook(look: EditorLook): void;
  getLook(): EditorLook;

  /** 用既有 render-pipeline 在 container 渲染目前場景的「美化預覽」。 */
  renderPreview(container: HTMLElement, theme?: MermaidTheme): Promise<void>;

  on(event: EditorEvent, cb: (payload?: unknown) => void): () => void;
  destroy(): void;
}

// 走 form 子編輯器(而非畫布)的圖種關鍵字。timeline 是資料圖表,內容為 section/period/event。
const FORM_KEYWORDS = new Set(['timeline']);

// 右鍵可快速切換的外形 = 目前圖種 adapter 宣告支援的外形。
// (先前寫死 flowchart 那 11 種,於是在狀態圖 / 類別圖 / ER 圖上按右鍵會看到一排「圓柱、梯形」,
//  按下去就把節點改成該圖種序列化不出來的外形。)
const ctxShapesFor = (caps: DiagramCapabilities | null): NodeShape[] => caps?.shapes ?? [];

// requirementDiagram 的七種追溯關係(右鍵切換用;它取代了一般圖種的線型 / 箭頭選單)。
const REQ_RELATIONS: ReqRelation[] = [
  'contains',
  'copies',
  'derives',
  'satisfies',
  'verifies',
  'refines',
  'traces',
];
const REQ_RELATION_LABEL: Record<ReqRelation, string> = {
  contains: 'contains(包含)',
  copies: 'copies(複製)',
  derives: 'derives(衍生)',
  satisfies: 'satisfies(滿足)',
  verifies: 'verifies(驗證)',
  refines: 'refines(細化)',
  traces: 'traces(追溯)',
};

/** ER 實體 / class 節點 → 可編輯多行文字(第一行=名稱,其餘=屬性 / 成員)。 */
function nodeToEditText(node: SceneNode): string {
  if (node.data?.kind === 'er') {
    const rows = node.data.attributes.map((a) =>
      `${a.type ?? ''} ${a.name}${a.keys && a.keys.length ? ' ' + a.keys.join(',') : ''}${a.comment ? ' "' + a.comment + '"' : ''}`.trim(),
    );
    return [node.label, ...rows].join('\n');
  }
  if (node.data?.kind === 'class') {
    const rows = [
      ...(node.data.stereotype ? [`<<${node.data.stereotype}>>`] : []),
      ...node.data.members,
      ...node.data.methods,
    ];
    return [node.label, ...rows].join('\n');
  }
  if (node.data?.kind === 'requirement') {
    return [node.label, ...requirementRows(node.data.req)].join('\n');
  }
  return node.label;
}

/** 「欄位: 值」多行文字 → 需求 / 元素資料。欄位名不分大小寫,未知欄位忽略。 */
function parseRequirementText(prev: RequirementData, rest: string[]): RequirementData {
  const field = new Map<string, string>();
  for (const line of rest) {
    const m = /^([A-Za-z]+)\s*[:：]\s*(.*)$/.exec(line);
    if (m) field.set(m[1].toLowerCase(), m[2].trim());
  }
  if (prev.element) {
    return {
      element: true,
      elementType: field.get('type') ?? prev.elementType,
      docRef: field.get('docref') ?? prev.docRef,
    };
  }
  const risk = field.get('risk');
  const verify = field.get('verify') ?? field.get('verifymethod');
  const oneOf = <T extends string>(list: readonly T[], v: string | undefined, fallback: T | undefined): T | undefined =>
    (list as readonly string[]).includes(v ?? '') ? (v as T) : fallback;
  return {
    element: false,
    reqType: prev.reqType,
    reqId: field.get('id') ?? prev.reqId,
    text: field.get('text') ?? prev.text,
    risk: oneOf(['low', 'medium', 'high'] as const, risk?.toLowerCase(), prev.risk),
    verifyMethod: oneOf(
      ['analysis', 'inspection', 'test', 'demonstration'] as const,
      verify?.toLowerCase(),
      prev.verifyMethod,
    ),
  };
}

/** 多行編輯文字 → 節點 patch(label + data + 重算尺寸)。 */
function parseEditText(
  node: SceneNode,
  value: string,
): { label: string; data: SceneNode['data']; w: number; h: number } | null {
  const lines = value.split('\n');
  const label = (lines[0] ?? '').trim() || node.id;
  const rest = lines.slice(1).map((l) => l.trim()).filter(Boolean);
  if (node.data?.kind === 'er') {
    const attributes = rest.map((line) => {
      let comment: string | undefined;
      let body = line.replace(/"([^"]*)"\s*$/, (_m, c) => {
        comment = c;
        return '';
      });
      const tok = body.trim().split(/\s+/);
      const type = tok[0] ?? 'string';
      const name = tok[1] ?? tok[0] ?? '';
      const keys = tok
        .slice(2)
        .flatMap((k) => k.split(','))
        .filter((k) => /^(PK|FK|UK)$/i.test(k))
        .map((k) => k.toUpperCase());
      return { name, type, keys: keys.length ? keys : undefined, comment };
    });
    return { label, data: { kind: 'er', attributes }, ...erEntitySize(label, attributes) };
  }
  if (node.data?.kind === 'class') {
    let stereotype: string | undefined;
    const members: string[] = [];
    const methods: string[] = [];
    for (const l of rest) {
      const st = l.match(/^«?<<?\s*(.+?)\s*>>?»?$/);
      if (st && /<</.test(l)) {
        stereotype = st[1];
        continue;
      }
      if (l.includes('(')) methods.push(l);
      else members.push(l);
    }
    const generic = node.data?.kind === 'class' ? node.data.generic : undefined;
    return {
      label,
      data: { kind: 'class', members, methods, stereotype, generic },
      ...classBoxSize(label, { members, methods, stereotype, generic }),
    };
  }
  if (node.data?.kind === 'requirement') {
    const req = parseRequirementText(node.data.req, rest);
    return { label, data: { kind: 'requirement', req }, ...requirementBoxSize(label, req) };
  }
  return null;
}

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

  // 空白畫布引導提示(對標 Excalidraw / draw.io)。grace 期間隱藏,避免載入既有圖時閃現。
  const emptyHint = document.createElement('div');
  emptyHint.className = 'rsm-empty-hint';
  host.appendChild(emptyHint);
  let emptyHintGrace = true;
  const graceTimer = setTimeout(() => {
    emptyHintGrace = false;
    updateEmptyHint();
  }, 600);
  // 空白畫布的起手範本(對標付費工具的範本庫)。每個可拖拉繪製的圖種都要有一個入口 ——
  // 否則使用者在空白畫布上根本無從得知這個編輯器還會畫看板 / 象限圖 / C4。
  const STARTERS: Array<[string, string]> = [
    ['流程圖', 'flowchart TD\n  A[開始] --> B{判斷}\n  B -->|是| C[處理]\n  B -->|否| D[結束]'],
    ['序列圖', 'sequenceDiagram\n  使用者->>系統: 請求\n  系統-->>使用者: 回應'],
    ['類別圖', 'classDiagram\n  class Animal {\n    +name string\n    +move()\n  }\n  Animal <|-- Dog'],
    ['狀態圖', 'stateDiagram-v2\n  [*] --> 閒置\n  閒置 --> 執行中: 啟動\n  執行中 --> [*]: 完成'],
    ['ER 圖', 'erDiagram\n  CUSTOMER ||--o{ ORDER : places\n  ORDER {\n    int id PK\n    int customerId FK\n  }'],
    ['心智圖', 'mindmap\n  root((主題))\n    分支A\n    分支B\n      子項'],
    [
      'C4 情境圖',
      'C4Context\n  title 系統情境圖\n  Person(user, "使用者", "使用系統的人")\n' +
        '  System(app, "本系統", "提供服務")\n  Rel(user, app, "使用", "HTTPS")',
    ],
    [
      '需求圖',
      'requirementDiagram\n  requirement req1 {\n    id: 1\n    text: "待填寫需求描述"\n    risk: medium\n    verifymethod: test\n  }\n' +
        '  element impl {\n    type: simulation\n  }\n  impl - satisfies -> req1',
    ],
    ['看板', 'kanban\n  todo[待辦]\n    [第一張卡片]\n  doing[進行中]\n  done[完成]'],
    ['旅程圖', 'journey\n  title 我的一天\n  section 早上\n    起床: 3: 我\n  section 下午\n    寫程式: 5: 我'],
    [
      '象限圖',
      'quadrantChart\n  title 專案評估\n  x-axis 低成本 --> 高成本\n  y-axis 低效益 --> 高效益\n' +
        '  quadrant-1 該做\n  quadrant-2 快贏\n  quadrant-3 別做\n  quadrant-4 再想想\n  範例: [0.4, 0.6]',
    ],
    ['流量圖', 'sankey-beta\n\nGrid,Homes,30\nGrid,Industry,45'],
    ['時間軸', 'timeline\n  title 時間軸標題\n  section 區段一\n    時間點 : 事件'],
  ];
  function updateEmptyHint(): void {
    if (formActive) {
      emptyHint.classList.remove('rsm-empty-show');
      return; // form 模式有自己的 UI,畫布引導提示永遠不顯示
    }
    const seqHasParts = scene.diagramType === 'sequence' && (scene.sequence?.participants.length ?? 0) > 0;
    const empty = scene.nodes.length === 0 && scene.containers.length === 0 && !seqHasParts;
    if (emptyHintGrace || !empty) {
      emptyHint.classList.remove('rsm-empty-show');
      return;
    }
    while (emptyHint.firstChild) emptyHint.removeChild(emptyHint.firstChild);
    const hintText = document.createElement('div');
    hintText.className = 'rsm-empty-text';
    hintText.textContent =
      scene.diagramType === 'sequence'
        ? '空白序列圖 — 在空白處按右鍵：新增參與者 / 訊息'
        : scene.diagramType === 'mindmap'
          ? '空白心智圖 — 點上方外形按鈕放下主題，再從節點拉線長出分支'
          : scene.diagramType === 'quadrant'
            ? '空白象限圖 — 雙擊格線上任一處放一個資料點，拖曳它就是在改它的值'
            : '空白畫布 — 點上方外形按鈕新增節點，從節點邊緣白點拉出連線';
    emptyHint.appendChild(hintText);
    const sub = document.createElement('div');
    sub.className = 'rsm-empty-sub';
    sub.textContent = '或從範本開始：';
    emptyHint.appendChild(sub);
    const row = document.createElement('div');
    row.className = 'rsm-empty-starters';
    for (const [label, src] of STARTERS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'rsm-empty-starter';
      btn.textContent = label;
      btn.addEventListener('click', () => void handle.loadSource(src).catch(() => {}));
      row.appendChild(btn);
    }
    emptyHint.appendChild(row);
    emptyHint.classList.add('rsm-empty-show');
  }

  let scene: EditorScene = opts.scene ?? emptyScene('flowchart');
  let diagramType: DiagramType = scene.diagramType;
  let createShape: NodeShape = 'rectangle';
  // 「新連線」的預設樣式(線型 / 箭頭);工具列可改,拉新線時套用。隨圖種重設(見 resetEdgeDefault)。
  let createEdge: { lineKind: LineKind; arrowStart: ArrowHead; arrowEnd: ArrowHead } = {
    lineKind: 'solid',
    arrowStart: 'none',
    arrowEnd: 'arrow',
  };
  let cancelTextEdit: (() => void) | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  // timeline 等「資料圖表」不吃畫布拖拉,改走結構化 form 子編輯器(惰性建立、接管 handle 子集)。
  let form: TimelineFormHandle | null = null;
  let formActive = false;

  const adapterFor = (type: DiagramType) => getAdapter(type) ?? getAdapter('flowchart');

  // 載入新圖時把「新節點外形 / 新連線樣式」重設成該圖種的合宜值
  // (避免上一張流程圖選的菱形、箭頭被帶到類別圖那種根本畫不出來的圖種)。
  const resetEdgeDefault = (): void => {
    const caps = adapterFor(diagramType)?.capabilities;
    createEdge = { lineKind: 'solid', arrowStart: 'none', arrowEnd: caps?.defaults.arrowEnd ?? 'arrow' };
    createShape = caps?.defaults.nodeShape ?? defaultShapeFor(diagramType);
  };

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
    // sequence 參與者不可自由縮放(寬度由標籤決定、放手不寫回 code)→ 不顯示縮放控制點。
    overlay.showSelection(nodeRects, zoom, { handles: nodeRects.length === 1 && scene.diagramType !== 'sequence' });
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
    updateEmptyHint();
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
    requestSeqMessageEdit: (index: number) => openSeqMessageEditor(index),
    onSelectionChange: (ids) => emit('selectionchange', ids),
    onToolChange: (tool) => emit('toolchange', tool),
    createShape: () => createShape,
    createEdgeStyle: () => createEdge,
    supportsEdges: () => adapterFor(diagramType)?.capabilities.supportsEdges !== false,
  };

  const pointer = new PointerController(svg, pointerHost);

  function openEditor(nodeId: string): void {
    const node = scene.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    cancelTextEdit?.();
    const tl = viewport.worldToScreen({ x: node.x, y: node.y });
    const z = viewport.getZoom();
    // ER 實體 / class 用「多行結構編輯」(第一行=名稱,其餘=屬性 / 成員)。
    const structured =
      node.data?.kind === 'er' || node.data?.kind === 'class' || node.data?.kind === 'requirement';
    const initial = structured ? nodeToEditText(node) : node.label;
    const editW = Math.max(node.w, structured ? 200 : 0);
    const editH = Math.max(node.h, structured ? 120 : 0);
    // 延後到目前 click/pointer 事件完全結束才建立並聚焦 textarea。否則原生點擊收尾會把焦點
    // 搶回畫布,textarea 一聚焦就立刻 blur 關閉 → 看起來「雙擊無法編輯」。
    const timer = setTimeout(() => {
      cancelTextEdit = openTextEditor(
        host,
        { left: tl.x, top: tl.y, width: editW * z, height: editH * z },
        initial,
        (value) => {
          cancelTextEdit = null;
          const cur = scene.nodes.find((n) => n.id === nodeId);
          if (!cur) return;
          if (structured) {
            const patch = parseEditText(cur, value);
            if (patch) pointerHost.runCommand(cmdSetNodeData(nodeId, patch), 'edit-node');
          } else if (cur.data?.kind === 'sequence') {
            // sequence 參與者:改名同步到 scene.sequence(序列化來源)。
            if (value !== cur.label) pointerHost.runCommand(cmdRenameSeqParticipant(nodeId, value), 'rename');
          } else if (value !== cur.label) {
            // 只有 label 真的改變才入命令 —— 避免新增節點後 blur 自動 commit 空字串產生贅餘 undo。
            pointerHost.runCommand(cmdSetLabel(nodeId, value), 'label');
          }
        },
        () => {
          cancelTextEdit = null;
        },
        { multiline: structured },
      );
    }, 0);
    cancelTextEdit = () => clearTimeout(timer);
  }

  function openSeqMessageEditor(index: number): void {
    if (!scene.sequence) return;
    const stmt = scene.sequence.statements[index];
    if (!stmt || stmt.kind !== 'message') return;
    const rect = renderer.getSeqMsgRect(index);
    if (!rect) return;
    const z = viewport.getZoom();
    const s = viewport.worldToScreen({ x: rect.x, y: rect.y });
    const initial = stmt.text ?? '';
    cancelTextEdit?.();
    const timer = setTimeout(() => {
      cancelTextEdit = openTextEditor(
        host,
        { left: s.x, top: s.y, width: Math.max(120, rect.w * z), height: 26 },
        initial,
        (value) => {
          cancelTextEdit = null;
          const cur = scene.sequence?.statements[index];
          if (cur && cur.kind === 'message' && value !== (cur.text ?? '')) {
            pointerHost.runCommand(cmdSetSeqMessageText(index, value), 'seq-msg');
          }
        },
        () => {
          cancelTextEdit = null;
        },
      );
    }, 0);
    cancelTextEdit = () => clearTimeout(timer);
  }

  /** 泳道欄名的就地編輯(欄標題就畫在欄框左上角)。 */
  function openLaneEditor(containerId: string): void {
    const lane = scene.containers.find((c) => c.id === containerId);
    if (!lane) return;
    const z = viewport.getZoom();
    const s = viewport.worldToScreen({ x: lane.x + 8, y: lane.y + 4 });
    cancelTextEdit?.();
    const timer = setTimeout(() => {
      cancelTextEdit = openTextEditor(
        host,
        { left: s.x, top: s.y, width: Math.max(120, (lane.w - 16) * z), height: 28 },
        lane.label,
        (value) => {
          cancelTextEdit = null;
          const cur = scene.containers.find((c) => c.id === containerId);
          if (cur && value !== cur.label) pointerHost.runCommand(cmdSetContainerLabel(containerId, value), 'lane-name');
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
    // sankey 的連線沒有自由文字,它的「標籤」就是流量數值 → 編輯的是數字。
    const isFlow = edge.data?.kind === 'sankey';
    const pts = edgePoints(scene, edge);
    if (!pts || pts.length === 0) return;
    const i = Math.floor((pts.length - 1) / 2);
    const mid = { x: (pts[i].x + pts[Math.min(i + 1, pts.length - 1)].x) / 2, y: (pts[i].y + pts[Math.min(i + 1, pts.length - 1)].y) / 2 };
    const s = viewport.worldToScreen(mid);
    const initial = isFlow && edge.data?.kind === 'sankey' ? String(edge.data.value) : (edge.label ?? '');
    cancelTextEdit?.();
    const timer = setTimeout(() => {
      cancelTextEdit = openTextEditor(
        host,
        { left: s.x - 60, top: s.y - 14, width: 120, height: 28 },
        initial,
        (value) => {
          cancelTextEdit = null;
          const cur = scene.edges.find((e) => e.id === edgeId);
          if (!cur) return;
          if (isFlow) {
            const num = Number(value.trim());
            // 打了不是數字的東西就當作沒改(而不是把流量變成 NaN 讓整張圖壞掉)。
            if (Number.isFinite(num) && cur.data?.kind === 'sankey' && num !== cur.data.value) {
              pointerHost.runCommand(cmdSetEdgeData(edgeId, { kind: 'sankey', value: num }), 'flow');
            }
            return;
          }
          if (value !== (cur.label ?? '')) {
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
  // 鍵盤快捷鍵說明浮層(對標 Excalidraw 的「?」)。
  const HELP_ROWS: Array<[string, string]> = [
    ['V', '選取 / 移動'],
    ['E', '連線(從節點拉線)'],
    ['N', '新增節點工具'],
    ['雙擊節點', '編輯文字'],
    ['雙擊空白', '在該處新增節點'],
    ['Tab', '在選取節點旁新增相連節點'],
    ['Del / ⌫', '刪除選取'],
    ['Ctrl/⌘ Z / Y', '復原 / 重做'],
    ['Ctrl/⌘ C / V', '複製 / 貼上'],
    ['Ctrl/⌘ D', '原地複製'],
    ['Ctrl/⌘ G', '群組 subgraph'],
    ['Ctrl/⌘ A', '全選'],
    ['方向鍵', '微調位置'],
    ['右鍵', '情境選單(外形 / 顏色 / 對齊)'],
    ['Esc', '取消選取 / 關閉'],
    ['?', '顯示 / 隱藏此說明'],
  ];
  let helpOverlay: HTMLElement | null = null;
  const toggleHelp = (show?: boolean): void => {
    const want = show ?? !helpOverlay;
    if (!want) {
      helpOverlay?.remove();
      helpOverlay = null;
      return;
    }
    if (helpOverlay) return;
    helpOverlay = document.createElement('div');
    helpOverlay.className = 'rsm-help-overlay';
    const panel = document.createElement('div');
    panel.className = 'rsm-help-panel';
    const h = document.createElement('div');
    h.className = 'rsm-help-title';
    h.textContent = '鍵盤快捷鍵';
    panel.appendChild(h);
    const grid = document.createElement('div');
    grid.className = 'rsm-help-grid';
    for (const [key, desc] of HELP_ROWS) {
      const kb = document.createElement('kbd');
      kb.textContent = key;
      const d = document.createElement('span');
      d.textContent = desc;
      grid.appendChild(kb);
      grid.appendChild(d);
    }
    panel.appendChild(grid);
    helpOverlay.appendChild(panel);
    helpOverlay.addEventListener('pointerdown', (ev) => {
      if (ev.target === helpOverlay) toggleHelp(false); // 點背景關閉
    });
    host.appendChild(helpOverlay);
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    const active = document.activeElement;
    if (active && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT')) return;
    if (e.key === '?' || (e.key === '/' && e.shiftKey)) {
      e.preventDefault();
      toggleHelp();
      return;
    }
    if (helpOverlay && e.key === 'Escape') {
      toggleHelp(false);
      return;
    }
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
    } else if (e.key === 'Tab') {
      // Tab:選取單一節點 → 在其右側新增一個已連線的節點(draw.io 式快速建圖)。
      const sel = pointer.getSelection();
      const src = sel.length === 1 ? scene.nodes.find((n) => n.id === sel[0]) : undefined;
      if (src) {
        e.preventDefault();
        const id = nextNodeId(scene);
        const pos = { x: src.x + src.w + 80, y: src.y };
        const node = {
          ...makeNodeFor(scene, id, pos, { shape: src.shape, parentId: src.parentId }),
          x: pos.x,
          y: pos.y,
          w: src.w,
          h: src.h,
        };
        // mindmap 沒有邊,Tab 的「接續一個節點」= 在來源底下長一個子節點。
        if (scene.diagramType === 'mindmap') {
          pointerHost.runCommand(cmdAddNode({ ...node, parentId: src.id }), 'add-node');
        } else {
          const edge = makeEdgeFor(scene, nextEdgeId(scene), src.id, id, createEdge);
          pointerHost.runCommand(cmdAddConnectedNode(node, edge), 'add-connected');
        }
        pointer.setSelection([id]);
        openEditor(id);
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
  let ctxEsc: ((e: KeyboardEvent) => void) | null = null;
  const closeContextMenu = (): void => {
    ctxMenu?.remove();
    ctxMenu = null;
    if (ctxEsc) {
      document.removeEventListener('keydown', ctxEsc);
      ctxEsc = null;
    }
  };
  const onContextMenu = (e: MouseEvent): void => {
    e.preventDefault();
    closeContextMenu();
    const t = e.target as Element;
    const nodeEl = t.closest('[data-node-id]');
    const edgeEl = t.closest('[data-edge-hit]');
    const seqMsgEl = t.closest('[data-seq-msg]');
    const laneEl = t.closest('[data-container-id]');
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
    if (seqMsgEl) {
      // sequence 訊息 / note 右鍵:編輯文字 /(訊息才有)切換箭頭 / 刪除。
      const idx = Number(seqMsgEl.getAttribute('data-seq-msg'));
      const isNote = scene.sequence?.statements[idx]?.kind === 'note';
      addItem('編輯文字', () => openSeqMessageEditor(idx));
      if (!isNote) addItem('切換實/虛箭頭', () => pointerHost.runCommand(cmdToggleSeqArrow(idx), 'seq-arrow'));
      addSep();
      addItem(isNote ? '刪除筆記' : '刪除訊息', () => pointerHost.runCommand(cmdDeleteSeqStatement(idx), 'del-seq-msg'));
    } else if (
      nodeEl &&
      scene.nodes.find((n) => n.id === nodeEl.getAttribute('data-node-id'))?.data?.kind === 'sequence'
    ) {
      // sequence 參與者右鍵:改名 / 刪除(同步移除 scene.sequence 條目,避免脫鉤)。
      const id = nodeEl.getAttribute('data-node-id') as string;
      addItem('改名', () => openEditor(id));
      addSep();
      addItem('刪除參與者', () => pointerHost.runCommand(cmdDeleteSeqParticipant(id), 'del-participant'));
    } else if (nodeEl) {
      const id = nodeEl.getAttribute('data-node-id') as string;
      // 右鍵已選取的節點 → 保留多選(才能用對齊/群組);否則改選此節點。
      if (!pointer.getSelection().includes(id)) pointer.setSelection([id]);
      const ctxShapes = ctxShapesFor(handle.getCapabilities());
      if (ctxShapes.length > 1) {
        const strip = document.createElement('div');
        strip.className = 'rsm-ctx-shapes';
        for (const shape of ctxShapes) {
          const m = shapeMeta(shape);
          const sb = document.createElement('button');
          sb.type = 'button';
          sb.textContent = m.glyph;
          sb.title = m.label;
          sb.addEventListener('click', () => {
            closeContextMenu();
            handle.setNodeShape(id, shape);
          });
          strip.appendChild(sb);
        }
        menu.appendChild(strip);
      }
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
      if (scene.diagramType === 'mindmap') {
        // 心智圖的「連線」就是父子關係,所以建子節點是這裡最常用的動作。
        addItem('新增子節點', () => {
          const src = scene.nodes.find((n) => n.id === id);
          if (!src) return;
          const nid = nextNodeId(scene);
          const at = { x: src.x + src.w + 90, y: src.y + src.h / 2 };
          pointerHost.runCommand(cmdAddNode(makeNodeFor(scene, nid, at, { parentId: id })), 'add-node');
          pointer.setSelection([nid]);
          openEditor(nid);
        });
        if (scene.nodes.find((n) => n.id === id)?.parentId) {
          addItem('升為上一層', () => {
            const cur = scene.nodes.find((n) => n.id === id);
            const grand = scene.nodes.find((n) => n.id === cur?.parentId)?.parentId ?? undefined;
            // 沒有祖父 = 目前父節點就是根 → 保持掛在根下(mindmap 只能有一個根)。
            if (grand) pointerHost.runCommand(cmdSetParent(id, grand), 'reparent');
          });
        }
      }
      addItem('複製', () => handle.duplicateSelection());
      if (scene.nodes.find((n) => n.id === id)?.parentId) {
        addItem('解除群組', () => handle.ungroupNode(id));
      }
      if (pointer.getSelection().length > 1) {
        addItem('群組成 subgraph', () => handle.groupSelection());
        addSep();
        addItem('靠左對齊', () => handle.alignSelection('left'));
        addItem('水平置中', () => handle.alignSelection('centerX'));
        addItem('靠右對齊', () => handle.alignSelection('right'));
        addItem('靠上對齊', () => handle.alignSelection('top'));
        addItem('垂直置中', () => handle.alignSelection('middleY'));
        addItem('靠下對齊', () => handle.alignSelection('bottom'));
        if (pointer.getSelection().length > 2) {
          addSep();
          addItem('水平均分', () => handle.distributeSelection('h'));
          addItem('垂直均分', () => handle.distributeSelection('v'));
        }
        addSep();
      }
      addItem('刪除', () => handle.deleteSelection());
    } else if (edgeEl && scene.diagramType === 'requirement') {
      // 需求圖的連線沒有「線型 / 箭頭」可調 —— 它的意義完全由關係種類決定。
      const id = edgeEl.getAttribute('data-edge-hit') as string;
      pointer.setSelection([id]);
      const cur = scene.edges.find((e) => e.id === id);
      const now = cur?.data?.kind === 'requirement' ? cur.data.relation : undefined;
      for (const rel of REQ_RELATIONS) {
        addItem(`${rel === now ? '● ' : '　'}${REQ_RELATION_LABEL[rel]}`, () =>
          pointerHost.runCommand(cmdSetEdgeData(id, { kind: 'requirement', relation: rel }), 'req-relation'),
        );
      }
      addSep();
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
    } else if (scene.diagramType === 'sequence') {
      // sequence:空白右鍵 → 新增參與者 / 新增訊息(可從零建構),新增後直接進入編輯。
      addItem('新增參與者', () => {
        const ids = new Set(scene.sequence?.participants.map((p) => p.id) ?? []);
        let n = 1;
        while (ids.has(`P${n}`)) n += 1;
        const newId = `P${n}`;
        pointerHost.runCommand(cmdAddSeqParticipant(), 'add-participant');
        setTimeout(() => openEditor(newId), 0);
      });
      addItem('新增訊息', () => {
        const idx = scene.sequence?.statements.length ?? 0;
        pointerHost.runCommand(cmdAddSeqMessage(), 'add-message');
        setTimeout(() => openSeqMessageEditor(idx), 0);
      });
      addItem('新增筆記', () => {
        const idx = scene.sequence?.statements.length ?? 0;
        pointerHost.runCommand(cmdAddSeqNote(), 'add-note');
        setTimeout(() => openSeqMessageEditor(idx), 0);
      });
      addSep();
      addItem('整理排版', () => void handle.tidy());
    } else if (laneEl && (scene.diagramType === 'kanban' || scene.diagramType === 'journey')) {
      // 欄位本身的右鍵:改名 / 刪整欄(卡片一起走)。
      const cid = laneEl.getAttribute('data-container-id') as string;
      const lane = scene.containers.find((c) => c.id === cid);
      const isJourney = scene.diagramType === 'journey';
      addItem(isJourney ? '改 section 名稱' : '改欄位名稱', () => openLaneEditor(cid));
      addSep();
      addItem(isJourney ? '刪除這個 section' : '刪除這一欄', () => {
        pointerHost.runCommand(cmdDeleteContainer(cid, lane?.childNodeIds ?? []), 'del-lane');
        void handle.tidy();
      });
    } else if (scene.diagramType === 'kanban' || scene.diagramType === 'journey') {
      // 泳道圖:空白處右鍵 → 新增欄位 / 卡片。沒有這個入口就沒有辦法從零開一塊看板
      // (卡片一定要落在某一欄裡,而欄只能從這裡長出來)。
      const isJourney = scene.diagramType === 'journey';
      addItem(isJourney ? '新增 section' : '新增欄位', () => {
        const taken = new Set(scene.containers.map((c) => c.id));
        let k = scene.containers.length + 1;
        while (taken.has(`col${k}`)) k += 1;
        const id = `col${k}`;
        pointerHost.runCommand(
          cmdAddContainer({
            id,
            label: isJourney ? `階段 ${k}` : `欄位 ${k}`,
            ...laneRect(scene.containers.length, 260),
            parentId: null,
            childNodeIds: [],
            sourceIndex: scene.containers.length,
          }),
          'add-lane',
        );
        void handle.tidy();
      });
      if (scene.containers.length > 0) {
        addItem(isJourney ? '新增任務' : '新增卡片', () => {
          const nid = nextNodeId(scene);
          const world2 = viewport.screenToWorld(e.clientX, e.clientY);
          pointerHost.runCommand(cmdAddNode(makeNodeFor(scene, nid, world2, {})), 'add-node');
          pointer.setSelection([nid]);
          openEditor(nid);
        });
      }
      addSep();
      addItem('整理排版', () => void handle.tidy());
      addItem('全選', () => pointer.selectAll());
    } else {
      const world = viewport.screenToWorld(e.clientX, e.clientY);
      addItem('在此新增節點', () => {
        const nid = nextNodeId(scene);
        const n = makeNodeFor(scene, nid, world, {
          shape: createShape,
          preferParentId: pointer.getSelection()[0],
        });
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
    host.appendChild(menu);
    ctxMenu = menu;
    // 夾在 host 範圍內,避免靠近右/下緣時選單溢出看不到。
    const mw = menu.offsetWidth || 160;
    const mh = menu.offsetHeight || 200;
    let lx = e.clientX - rect.left;
    let ly = e.clientY - rect.top;
    if (lx + mw > rect.width) lx = Math.max(4, rect.width - mw - 4);
    if (ly + mh > rect.height) ly = Math.max(4, rect.height - mh - 4);
    menu.style.left = `${lx}px`;
    menu.style.top = `${ly}px`;
    setTimeout(() => {
      document.addEventListener('pointerdown', closeContextMenu, { once: true });
      ctxEsc = (ev: KeyboardEvent) => {
        if (ev.key === 'Escape') closeContextMenu();
      };
      document.addEventListener('keydown', ctxEsc);
    }, 0);
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
    // 用與 fit() 相同的內容範圍:sequence 用 renderer.getContentBounds()(節點只含頂端參與者列,
    // 用 node bbox 會把訊息 / 生命線裁掉);其餘退回節點 + 容器 bbox。
    const containerRects = scene.containers
      .map((c) => containerRect(scene, c.id))
      .filter((r): r is NonNullable<typeof r> => Boolean(r));
    const bb =
      renderer.getContentBounds() ?? boundingBox([...scene.nodes.map(nodeRect), ...containerRects]);
    const pad = 24;
    if (bb) {
      clone.setAttribute('viewBox', `${bb.x - pad} ${bb.y - pad} ${bb.w + pad * 2} ${bb.h + pad * 2}`);
    }
    return clone;
  }

  const handle: DiagramEditorHandle = {
    getScene: () => scene,
    toMermaid: () => {
      if (formActive && form) return form.toMermaid();
      const adapter = adapterFor(diagramType);
      if (!adapter) return '';
      return adapter.serialize(scene).text;
    },
    loadScene: (next) => {
      setScene(next);
      resetEdgeDefault();
      handle.fit();
    },
    loadSource: async (text: string) => {
      try {
        // timeline 等資料圖表 → form 子編輯器(惰性建立、隱藏畫布)。
        if (FORM_KEYWORDS.has(firstKeyword(text))) {
          if (!form) {
            form = createTimelineForm(host, {
              mermaid: opts.mermaid,
              dark,
              fontUrl: opts.fontUrl,
              // change 事件補帶 timeline 場景(host 期望 payload 為 scene);其餘原樣轉發。
              emit: (e, p) => emit(e as EditorEvent, e === 'change' ? scene : p),
            });
          }
          formActive = true;
          scene = emptyScene('timeline');
          diagramType = 'timeline';
          svg.style.display = 'none';
          emptyHint.style.display = 'none';
          form.show();
          form.loadSource(text);
          return;
        }
        // 畫布圖種:若先前在 form 模式,收起 form、還原畫布。
        if (formActive) {
          formActive = false;
          form?.hide();
          svg.style.display = '';
          emptyHint.style.display = '';
        }
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
        resetEdgeDefault();
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
    getCapabilities: () => adapterFor(diagramType)?.capabilities ?? null,
    getEdgeStyleDefault: () => ({ ...createEdge }),
    applyEdgeStyle: (patch) => {
      const caps = adapterFor(diagramType)?.capabilities;
      // 只接受目前圖種支援的值('none' 永遠合法,代表「無箭頭」)。
      const clean: Partial<{ lineKind: LineKind; arrowStart: ArrowHead; arrowEnd: ArrowHead }> = {};
      if (patch.lineKind && (!caps || caps.lineKinds.includes(patch.lineKind))) clean.lineKind = patch.lineKind;
      const headOk = (h: ArrowHead): boolean => h === 'none' || !caps || caps.arrowHeads.includes(h);
      if (patch.arrowStart !== undefined && headOk(patch.arrowStart)) clean.arrowStart = patch.arrowStart;
      if (patch.arrowEnd !== undefined && headOk(patch.arrowEnd)) clean.arrowEnd = patch.arrowEnd;
      if (Object.keys(clean).length === 0) return;
      createEdge = { ...createEdge, ...clean };
      // 套到目前選取的連線(若有);沒有選取時僅更新「新連線」預設。
      const ids = pointer.getSelection().filter((id) => scene.edges.some((e) => e.id === id));
      if (ids.length) pointerHost.runCommand(cmdSetEdgesStyle(ids, clean), 'edge-style');
    },
    addNode: (shape) => {
      const rect = svg.getBoundingClientRect();
      // 視窗中央(世界座標);多次新增稍微錯開,避免完全疊在一起。
      const center = viewport.screenToWorld(rect.left + rect.width / 2, rect.top + rect.height / 2);
      const off = (scene.nodes.length % 8) * 18;
      const id = nextNodeId(scene);
      const node = makeNodeFor(
        scene,
        id,
        { x: center.x + off, y: center.y + off },
        { shape: shape ?? createShape, preferParentId: pointer.getSelection()[0] },
      );
      pointerHost.runCommand(cmdAddNode(node), 'add-node');
      pointer.setTool('select'); // 新增後回到選取,讓使用者可立即拖曳/選取(預設就是選取)。
      pointer.setSelection([id]);
      openEditor(id);
      return id;
    },

    undo: () => {
      if (formActive && form) return form.undo();
      const res = history.undo();
      if (res) setScene(res.scene);
    },
    redo: () => {
      if (formActive && form) return form.redo();
      const res = history.redo();
      if (res) setScene(res.scene);
    },
    canUndo: () => (formActive && form ? form.canUndo() : history.canUndo()),
    canRedo: () => (formActive && form ? form.canRedo() : history.canRedo()),

    selectAll: () => pointer.selectAll(),
    clearSelection: () => pointer.clearSelection(),
    deleteSelection: () => {
      const ids = new Set(pointer.getSelection());
      if (ids.size === 0) return;
      // sequence:刪除參與者要同步清 scene.sequence(否則 node 沒了但 mermaid 還留著 → 脫鉤)。
      if (scene.diagramType === 'sequence') {
        const partIds = scene.nodes.filter((n) => ids.has(n.id) && n.data?.kind === 'sequence').map((n) => n.id);
        for (const pid of partIds) pointerHost.runCommand(cmdDeleteSeqParticipant(pid), 'del-participant');
        pointer.clearSelection();
        return;
      }
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
      if (formActive) return; // form 模式無畫布視窗
      // sequence:內容延伸到節點下方,用渲染器回報的整張範圍;其他圖種用節點 bbox。
      viewport.fit(renderer.getContentBounds() ?? boundingBox(scene.nodes.map(nodeRect)));
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
    distributeSelection: (axis) => {
      const ids = pointer.getSelection().filter((id) => scene.nodes.some((n) => n.id === id));
      if (ids.length >= 3) pointerHost.runCommand(cmdDistributeNodes(ids, axis), 'distribute');
    },
    ungroupNode: (nodeId) => {
      const node = scene.nodes.find((n) => n.id === nodeId);
      if (node?.parentId) pointerHost.runCommand(cmdUngroup(node.parentId), 'ungroup');
    },

    setDark: (d) => {
      dark = d;
      host.classList.toggle('rsm-dark', d);
      renderer.setDark(d);
      form?.setDark(d);
      refreshOverlay();
    },

    getSvg: () => svg,
    exportSvg: () => (formActive && form ? form.exportSvg() : prepareSvgElement(exportClone()).serialized),
    exportPng: async (rasterOpts) => {
      if (formActive && form) return form.exportPng(rasterOpts);
      // foreignObject(HTML 標籤)會污染 canvas → 點陣化前先攤平成 SVG <text>。
      const clone = exportClone();
      flattenForeignObjects(clone);
      const prepared = prepareSvgElement(clone);
      return rasterizeToBlob(prepared, { ...rasterOpts, dark });
    },
    downloadSvg: (filename = 'diagram.svg') => {
      downloadBlob(svgBlob(handle.exportSvg()), filename);
    },
    downloadPng: async (filename = 'diagram.png', rasterOpts) => {
      const blob = await handle.exportPng(rasterOpts);
      downloadBlob(blob, filename);
    },
    toggleHelp: (show) => toggleHelp(show),
    setLook: (look) => {
      renderer.setLook(look);
      refreshOverlay();
    },
    getLook: () => renderer.getLook(),
    copyPngToClipboard: async (rasterOpts) => {
      const nav = (globalThis as { navigator?: Navigator }).navigator;
      const CI = (globalThis as { ClipboardItem?: typeof ClipboardItem }).ClipboardItem;
      if (!nav?.clipboard?.write || !CI) {
        throw new Error('此環境不支援將圖片寫入剪貼簿。');
      }
      const blob = await handle.exportPng(rasterOpts);
      await nav.clipboard.write([new CI({ [blob.type]: blob })]);
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
      clearTimeout(graceTimer);
      cancelTextEdit?.();
      form?.destroy();
      pointer.destroy();
      host.removeEventListener('keydown', onKeyDown);
      host.removeEventListener('contextmenu', onContextMenu);
      closeContextMenu();
      emptyHint.remove();
      helpOverlay?.remove();
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
