// 指標互動狀態機(Pointer Events,統一鼠/筆/觸控)。
// 工具:select | pan | node-create | edge-create。把拖曳/點擊轉成命令交給 host 套用。
// 平滑要點:transform-only 拖曳(放手才重 rough)、rAF 批次、pointer capture、吸附。

import {
  anchorPoint,
  boundingBox,
  nearestAnchor,
  nodeRect,
  perimeterAnchor,
  rectCenter,
  rectsIntersect,
  SIDE_ANCHORS,
  type Rect,
} from '../scene/geometry';
import {
  getNode,
  makeEdge,
  makeNode,
  nextEdgeId,
  nextNodeId,
  resolveEdgeAnchors,
} from '../scene/scene-ops';
import type { ArrowHead, EdgeAnchor, EditorScene, LineKind, NodeShape, Point, SceneNode } from '../scene/types';
import {
  cmdAddConnectedNode,
  cmdAddEdge,
  cmdAddNode,
  cmdMoveNodes,
  cmdReconnectEdge,
  cmdReorderSeqParticipant,
  cmdResizeNode,
  type Command,
} from './commands';
import { computeSnap } from './snap';
import type { Overlay, ResizeDir } from './overlay';
import type { Viewport } from './viewport';
import type { SceneRenderer } from '../render/scene-renderer';

export type Tool = 'select' | 'pan' | 'node-create' | 'edge-create';

export interface PointerHost {
  getScene(): EditorScene;
  viewport: Viewport;
  renderer: SceneRenderer;
  overlay: Overlay;
  /** 套用命令(含 history + 重繪 + overlay 更新)。 */
  runCommand(cmd: Command, label: string): void;
  refreshOverlay(): void;
  requestTextEdit(nodeId: string): void;
  requestEdgeLabelEdit(edgeId: string): void;
  /** sequence:雙擊訊息要求編輯其文字(statement index)。 */
  requestSeqMessageEdit?(index: number): void;
  onSelectionChange(ids: string[]): void;
  onToolChange(tool: Tool): void;
  /** node-create 工具要放的外形。 */
  createShape(): NodeShape;
  /** 新連線的預設樣式(線型 / 箭頭),由工具列設定。 */
  createEdgeStyle(): { lineKind: LineKind; arrowStart: ArrowHead; arrowEnd: ArrowHead };
}

const DRAG_THRESHOLD = 4; // 螢幕 px
const MIN_W = 40;
const MIN_H = 28;
const SNAP_TOL_SCREEN = 6;
// 連線錨點命中 / 吸附半徑(螢幕 px;除以 zoom 換算世界座標)。
const ANCHOR_HIT_SCREEN = 16;

type Mode =
  | { kind: 'idle' }
  | { kind: 'maybe-drag'; startWorld: Point; ids: string[]; bases: Map<string, Rect> }
  | { kind: 'move'; startWorld: Point; ids: string[]; bases: Map<string, Rect>; dx: number; dy: number }
  // sequence 專屬:參與者只能左右拖換序(非自由位移)。targetIndex = 移除被拖者後的插入位置。
  | { kind: 'seq-reorder'; id: string; startWorld: Point; base: Rect; targetIndex: number }
  | { kind: 'resize'; nodeId: string; dir: ResizeDir; startRect: Rect; startWorld: Point; cur: Rect }
  // fromAnchor:從來源節點哪個固定錨點起拉(null = 從節點本體拉 → 浮動來源錨)。
  | { kind: 'rubber-edge'; sourceId: string; from: Point; fromAnchor: EdgeAnchor | null }
  | { kind: 'reconnect-edge'; edgeId: string; endpoint: 'source' | 'target'; anchorFixed: Point }
  | { kind: 'marquee'; startWorld: Point; additive: boolean }
  | { kind: 'pan'; lastClient: Point; deselectAt?: Point };

export class PointerController {
  private tool: Tool = 'select';
  private selection = new Set<string>();
  private mode: Mode = { kind: 'idle' };
  private rafId = 0;
  private pendingClient: Point | null = null;
  private activePointers = new Set<number>();
  private boundHandlers: Array<[string, EventListener]> = [];
  private hoverNodeId: string | null = null;
  // 手動偵測雙擊(setPointerCapture 會抑制瀏覽器原生 dblclick,故不依賴它)。
  private lastClickNodeId: string | null = null;
  private lastClickTime = 0;
  private lastClickEdgeId: string | null = null;
  private lastEdgeClickTime = 0;
  private lastEmptyClickTime = 0;

  constructor(
    private svg: SVGSVGElement,
    private host: PointerHost,
  ) {
    this.bind();
  }

  getTool(): Tool {
    return this.tool;
  }
  setTool(tool: Tool): void {
    this.tool = tool;
    this.svg.style.cursor = tool === 'pan' ? 'grab' : tool === 'select' ? 'default' : 'crosshair';
    this.host.onToolChange(tool);
  }

  getSelection(): string[] {
    return [...this.selection];
  }
  setSelection(ids: string[]): void {
    this.selection = new Set(ids);
    this.host.onSelectionChange(this.getSelection());
    this.host.refreshOverlay();
  }
  clearSelection(): void {
    this.setSelection([]);
  }
  selectAll(): void {
    this.setSelection(this.host.getScene().nodes.map((n) => n.id));
  }

  private bind(): void {
    const add = (type: string, fn: EventListener, opts?: AddEventListenerOptions): void => {
      this.svg.addEventListener(type, fn, opts);
      this.boundHandlers.push([type, fn]);
    };
    add('pointerdown', this.onPointerDown as EventListener);
    add('pointermove', this.onPointerMove as EventListener);
    add('pointerup', this.onPointerUp as EventListener);
    add('pointercancel', this.onPointerCancel as EventListener);
    add('wheel', this.onWheel as EventListener, { passive: false });
    add('pointerleave', this.onPointerLeave as EventListener);
  }

  destroy(): void {
    for (const [type, fn] of this.boundHandlers) this.svg.removeEventListener(type, fn);
    this.boundHandlers = [];
    if (this.rafId) cancelAnimationFrame(this.rafId);
  }

  // ── 命中測試 ──
  private hitResize(t: Element): { node: string; dir: ResizeDir } | null {
    const el = t.closest('[data-resize]');
    if (!el) return null;
    return { node: el.getAttribute('data-resize-node') ?? '', dir: el.getAttribute('data-resize') as ResizeDir };
  }
  private hitConn(t: Element): { nodeId: string; anchor: EdgeAnchor | null } | null {
    const el = t.closest('[data-conn-handle]');
    if (!el) return null;
    const nodeId = el.getAttribute('data-conn-node');
    if (!nodeId) return null;
    const fx = el.getAttribute('data-conn-fx');
    const fy = el.getAttribute('data-conn-fy');
    const anchor = fx != null && fy != null ? { fx: Number(fx), fy: Number(fy) } : null;
    return { nodeId, anchor };
  }
  private hitNode(t: Element): string | null {
    const el = t.closest('[data-node-id]');
    return el ? el.getAttribute('data-node-id') : null;
  }
  private hitEdge(t: Element): string | null {
    const el = t.closest('[data-edge-hit]');
    return el ? el.getAttribute('data-edge-hit') : null;
  }

  private nodeUnder(clientX: number, clientY: number, exclude?: string): SceneNode | null {
    const w = this.host.viewport.screenToWorld(clientX, clientY);
    const scene = this.host.getScene();
    // 由上而下(後繪在上)。
    for (let i = scene.nodes.length - 1; i >= 0; i--) {
      const n = scene.nodes[i];
      if (n.id === exclude) continue;
      if (w.x >= n.x && w.x <= n.x + n.w && w.y >= n.y && w.y <= n.y + n.h) return n;
    }
    return null;
  }

  /**
   * 回傳「按壓點靠近其某個固定錨點(8 點:4 邊中點 + 4 角)」的節點與該錨點;優先檢查 hover 的節點。
   * 純幾何判定 → 即使白點凸出到節點外、DOM 命中抓不到,也能起連線。
   */
  private connectAnchorNode(
    world: Point,
    preferId: string | null,
  ): { nodeId: string; anchor: EdgeAnchor } | null {
    const tolWorld = ANCHOR_HIT_SCREEN / this.host.viewport.getZoom();
    const scene = this.host.getScene();
    const check = (n: SceneNode): { nodeId: string; anchor: EdgeAnchor } | null => {
      // 已選取節點:4 角是縮放控制點 → 連線只取 4 邊中點(與畫面上顯示的控制點一致)。
      const cands = this.selection.has(n.id) ? SIDE_ANCHORS : undefined;
      const a = nearestAnchor(nodeRect(n), world, tolWorld, cands);
      return a ? { nodeId: n.id, anchor: a } : null;
    };
    if (preferId) {
      const pn = getNode(scene, preferId);
      if (pn) {
        const hit = check(pn);
        if (hit) return hit;
      }
    }
    for (let i = scene.nodes.length - 1; i >= 0; i--) {
      const hit = check(scene.nodes[i]);
      if (hit) return hit;
    }
    return null;
  }

  /** 拖線端落在 node 上時,吸附到最近的固定錨點(8 點);皆超出容差 → null(浮動,接整個節點)。 */
  private snapAnchor(node: SceneNode, world: Point): EdgeAnchor | null {
    const tolWorld = ANCHOR_HIT_SCREEN / this.host.viewport.getZoom();
    return nearestAnchor(nodeRect(node), world, tolWorld);
  }

  private onPointerDown = (e: PointerEvent): void => {
    this.activePointers.add(e.pointerId);
    if (this.activePointers.size >= 2) {
      // 多指 → 交給觸控縮放(此處不處理),取消單指操作。
      this.mode = { kind: 'idle' };
      return;
    }
    const target = e.target as Element;
    this.svg.setPointerCapture(e.pointerId);
    const hovered = this.hoverNodeId; // 清掉前記住目前 hover 的節點(白點所屬)
    this.host.overlay.clearHover();
    this.hoverNodeId = null;
    const world = this.host.viewport.screenToWorld(e.clientX, e.clientY);

    // sequence 訊息:雙擊命中區 → 編輯訊息文字(訊息非 node/edge,獨立處理)。
    const seqMsgEl = target.closest('[data-seq-msg]');
    if (seqMsgEl && this.host.requestSeqMessageEdit) {
      const i = Number(seqMsgEl.getAttribute('data-seq-msg'));
      const key = `seq:${i}`;
      const tnow = performance.now();
      if (this.lastClickEdgeId === key && tnow - this.lastEdgeClickTime < 350) {
        this.lastEdgeClickTime = 0;
        this.lastClickEdgeId = null;
        this.mode = { kind: 'idle' };
        this.host.requestSeqMessageEdit(i);
        return;
      }
      this.lastEdgeClickTime = tnow;
      this.lastClickEdgeId = key;
      this.mode = { kind: 'idle' };
      return;
    }

    // node-create:放一個節點。
    if (this.tool === 'node-create') {
      const scene = this.host.getScene();
      const id = nextNodeId(scene);
      const node = makeNode(id, world, { shape: this.host.createShape() });
      this.host.runCommand(cmdAddNode(node), 'add-node');
      this.setSelection([id]);
      this.setTool('select');
      this.host.requestTextEdit(id);
      return;
    }

    // pan 工具 / 中鍵 → 平移。
    if (this.tool === 'pan' || e.button === 1) {
      this.mode = { kind: 'pan', lastClient: { x: e.clientX, y: e.clientY } };
      this.svg.style.cursor = 'grabbing';
      return;
    }

    // sequence:參與者只接「左右拖換序」+ 雙擊改名。自由位移 / 縮放 / 連線對序列圖無意義
    // (拖了不寫回 code、又會弄亂版面),故在此攔截並提早返回,不落入下方 resize / 連線分支。
    {
      const seqScene = this.host.getScene();
      if (seqScene.diagramType === 'sequence') {
        const sid = this.hitNode(target);
        const snode = sid ? getNode(seqScene, sid) : null;
        if (snode && snode.data?.kind === 'sequence') {
          const now = performance.now();
          if (this.lastClickNodeId === sid && now - this.lastClickTime < 350) {
            this.lastClickTime = 0;
            this.lastClickNodeId = null;
            this.mode = { kind: 'idle' };
            this.setSelection([sid as string]);
            this.host.requestTextEdit(sid as string);
            return;
          }
          this.lastClickTime = now;
          this.lastClickNodeId = sid;
          this.setSelection([sid as string]);
          this.mode = { kind: 'seq-reorder', id: sid as string, startWorld: world, base: nodeRect(snode), targetIndex: -1 };
          return;
        }
      }
    }

    // resize 控制點。
    const rz = this.hitResize(target);
    if (rz && rz.node) {
      const n = getNode(this.host.getScene(), rz.node);
      if (n) {
        this.mode = { kind: 'resize', nodeId: rz.node, dir: rz.dir, startRect: nodeRect(n), startWorld: world, cur: nodeRect(n) };
        return;
      }
    }

    // 連線控制點 / edge-create 工具在節點上 → 橡皮筋。從錨點起拉時記下該錨點(→ sourceAnchor)。
    const connHit = this.hitConn(target);
    const nodeId = this.hitNode(target);
    if (connHit || (this.tool === 'edge-create' && nodeId)) {
      const srcId = connHit?.nodeId ?? (nodeId as string);
      const src = getNode(this.host.getScene(), srcId);
      if (src) {
        this.mode = {
          kind: 'rubber-edge',
          sourceId: srcId,
          from: rectCenter(nodeRect(src)),
          fromAnchor: connHit?.anchor ?? null,
        };
        return;
      }
    }

    // 已選取的連線:按住其端點附近 → 重新接線(拖到別的節點)。端點在節點邊上,故須早於節點分支。
    const scene0 = this.host.getScene();
    const reconnectHitR = 12 / this.host.viewport.getZoom();
    for (const eid of this.selection) {
      const edge = scene0.edges.find((x) => x.id === eid);
      if (!edge) continue;
      const anchors = resolveEdgeAnchors(scene0, edge);
      if (!anchors) continue;
      if (Math.hypot(world.x - anchors.start.x, world.y - anchors.start.y) <= reconnectHitR) {
        this.mode = { kind: 'reconnect-edge', edgeId: eid, endpoint: 'source', anchorFixed: anchors.end };
        return;
      }
      if (Math.hypot(world.x - anchors.end.x, world.y - anchors.end.y) <= reconnectHitR) {
        this.mode = { kind: 'reconnect-edge', edgeId: eid, endpoint: 'target', anchorFixed: anchors.start };
        return;
      }
    }

    // 按在「連線白點」附近(節點 8 個固定錨點)→ 從該位置拉線(像 draw.io)。優先用 hover 中的節點。
    const connectSrc = this.connectAnchorNode(world, hovered);
    if (connectSrc) {
      const src = getNode(this.host.getScene(), connectSrc.nodeId);
      if (src) {
        this.mode = {
          kind: 'rubber-edge',
          sourceId: connectSrc.nodeId,
          from: rectCenter(nodeRect(src)),
          fromAnchor: connectSrc.anchor,
        };
        return;
      }
    }

    // 點到節點 → 選取 + 預備拖曳。
    if (nodeId) {
      // 手動雙擊偵測:同一節點 350ms 內再次按下 → 進入改名(取代被抑制的原生 dblclick)。
      const now = performance.now();
      if (this.lastClickNodeId === nodeId && now - this.lastClickTime < 350) {
        this.lastClickTime = 0;
        this.lastClickNodeId = null;
        this.mode = { kind: 'idle' };
        this.setSelection([nodeId]);
        this.host.requestTextEdit(nodeId);
        return;
      }
      this.lastClickTime = now;
      this.lastClickNodeId = nodeId;
      if (!this.selection.has(nodeId)) {
        this.setSelection(e.shiftKey ? [...this.selection, nodeId] : [nodeId]);
      } else if (e.shiftKey) {
        const next = new Set(this.selection);
        next.delete(nodeId);
        this.setSelection([...next]);
      }
      const ids = this.getSelection();
      const bases = new Map<string, Rect>();
      const scene = this.host.getScene();
      for (const id of ids) {
        const n = getNode(scene, id);
        if (n) bases.set(id, nodeRect(n));
      }
      this.mode = { kind: 'maybe-drag', startWorld: world, ids, bases };
      return;
    }

    // 點到邊 → 選取邊;雙擊邊 → 編輯連線文字。
    const edgeId = this.hitEdge(target);
    if (edgeId) {
      const tnow = performance.now();
      if (this.lastClickEdgeId === edgeId && tnow - this.lastEdgeClickTime < 350) {
        this.lastEdgeClickTime = 0;
        this.lastClickEdgeId = null;
        this.mode = { kind: 'idle' };
        this.host.requestEdgeLabelEdit(edgeId);
        return;
      }
      this.lastEdgeClickTime = tnow;
      this.lastClickEdgeId = edgeId;
      this.setSelection([edgeId]);
      this.mode = { kind: 'idle' };
      return;
    }

    // 雙擊空白 → 在該處新增節點(Excalidraw/draw.io 式,直覺好發現)。
    // sequence 例外:自由節點對它無意義(會變孤兒節點),改由右鍵選單新增參與者 / 訊息 / 筆記。
    const emptyNow = performance.now();
    if (this.host.getScene().diagramType === 'sequence') {
      this.lastEmptyClickTime = emptyNow;
      if (e.shiftKey) {
        this.mode = { kind: 'marquee', startWorld: world, additive: true };
      } else {
        this.mode = { kind: 'pan', lastClient: { x: e.clientX, y: e.clientY }, deselectAt: { x: e.clientX, y: e.clientY } };
        this.svg.style.cursor = 'grabbing';
      }
      return;
    }
    if (!e.shiftKey && emptyNow - this.lastEmptyClickTime < 350) {
      this.lastEmptyClickTime = 0;
      this.mode = { kind: 'idle' };
      const scene = this.host.getScene();
      const id = nextNodeId(scene);
      const node = makeNode(id, world, { shape: this.host.createShape() });
      this.host.runCommand(cmdAddNode(node), 'add-node');
      this.setSelection([id]);
      this.host.requestTextEdit(id);
      return;
    }
    this.lastEmptyClickTime = emptyNow;

    // 空白處:Shift+拖曳 → 框選(保留多選能力);一般拖曳 → 平移畫布(放開後仍是選取工具);
    // 純點擊未拖曳 → 取消選取。
    if (e.shiftKey) {
      this.mode = { kind: 'marquee', startWorld: world, additive: true };
      return;
    }
    this.mode = { kind: 'pan', lastClient: { x: e.clientX, y: e.clientY }, deselectAt: { x: e.clientX, y: e.clientY } };
    this.svg.style.cursor = 'grabbing';
  };

  /** 閒置時:滑過節點顯示連線控制點(讓「點到節點就能拉線」直覺可發現)。 */
  private updateHover(clientX: number, clientY: number): void {
    // sequence 不支援自由拉線(訊息由右鍵選單新增),不顯示連線控制點以免誤導。
    if (this.host.getScene().diagramType === 'sequence') return;
    const n = this.nodeUnder(clientX, clientY);
    const id = n?.id ?? null;
    if (id === this.hoverNodeId) return;
    this.hoverNodeId = id;
    if (n && !this.selection.has(n.id)) {
      this.host.overlay.showHoverHandles(n.id, nodeRect(n), this.host.viewport.getZoom());
    } else {
      this.host.overlay.clearHover();
    }
  }

  private onPointerLeave = (): void => {
    this.hoverNodeId = null;
    this.host.overlay.clearHover();
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (this.mode.kind === 'idle') {
      if (this.tool === 'select') this.updateHover(e.clientX, e.clientY);
      return;
    }
    this.pendingClient = { x: e.clientX, y: e.clientY };
    if (this.rafId) return;
    this.rafId = requestAnimationFrame(() => {
      this.rafId = 0;
      const c = this.pendingClient;
      if (c) this.processMove(c);
    });
  };

  private processMove(c: Point): void {
    const world = this.host.viewport.screenToWorld(c.x, c.y);
    const zoom = this.host.viewport.getZoom();
    const m = this.mode;

    if (m.kind === 'pan') {
      this.host.viewport.panBy(c.x - m.lastClient.x, c.y - m.lastClient.y);
      m.lastClient = { x: c.x, y: c.y };
      this.host.refreshOverlay();
      return;
    }

    if (m.kind === 'maybe-drag') {
      const start = this.host.viewport.worldToScreen(m.startWorld);
      if (Math.hypot(c.x - start.x, c.y - start.y) < DRAG_THRESHOLD) return;
      this.mode = { kind: 'move', startWorld: m.startWorld, ids: m.ids, bases: m.bases, dx: 0, dy: 0 };
      return this.processMove(c);
    }

    if (m.kind === 'move') {
      const rawDx = world.x - m.startWorld.x;
      const rawDy = world.y - m.startWorld.y;
      const movingRects = [...m.bases.values()];
      const ids = new Set(m.ids);
      const staticRects = this.host
        .getScene()
        .nodes.filter((n) => !ids.has(n.id))
        .map(nodeRect);
      const snap = computeSnap(movingRects, staticRects, rawDx, rawDy, SNAP_TOL_SCREEN / zoom);
      m.dx = snap.dx;
      m.dy = snap.dy;
      this.host.renderer.previewMove(ids, snap.dx, snap.dy);
      this.host.overlay.showGuides(snap.guides, zoom);
      // 選取框跟著預覽位置。
      const rects = m.ids.map((id) => {
        const b = m.bases.get(id)!;
        return { id, rect: { x: b.x + snap.dx, y: b.y + snap.dy, w: b.w, h: b.h } };
      });
      this.host.overlay.showSelection(rects, zoom, { handles: rects.length === 1 });
      return;
    }

    if (m.kind === 'seq-reorder') {
      const dx = world.x - m.startWorld.x;
      // 參與者欄不進 nodeCache(renderSequence 直接畫),previewMove 對它無效 → 拖曳回饋
      // 只移動「選取框」+ 一條插入指示線,實際欄位放手後才重排,絕不出現重疊亂掉的暫態。
      this.host.overlay.showSelection([{ id: m.id, rect: { ...m.base, x: m.base.x + dx } }], zoom, { handles: false });
      const seqNodes = this.host.getScene().nodes.filter((n) => n.data?.kind === 'sequence');
      const draggedCx = m.base.x + m.base.w / 2 + dx;
      const others = seqNodes.filter((n) => n.id !== m.id);
      let target = 0;
      for (const n of others) if (n.x + n.w / 2 < draggedCx) target += 1;
      m.targetIndex = target;
      const top = seqNodes[0]?.y ?? 12;
      let gx: number;
      if (others.length === 0) gx = draggedCx;
      else if (target <= 0) gx = others[0].x - 14;
      else if (target >= others.length) gx = others[others.length - 1].x + others[others.length - 1].w + 14;
      else gx = (others[target - 1].x + others[target - 1].w + others[target].x) / 2;
      this.host.overlay.showGuides([{ x1: gx, y1: top - 10, x2: gx, y2: top + 64 }], zoom);
      return;
    }

    if (m.kind === 'resize') {
      m.cur = resizeRect(m.startRect, m.dir, world, m.startWorld);
      this.host.renderer.previewResize(m.nodeId, m.cur);
      this.host.overlay.showSelection([{ id: m.nodeId, rect: m.cur }], zoom, { handles: true });
      return;
    }

    if (m.kind === 'rubber-edge') {
      const tgt = this.nodeUnder(c.x, c.y, m.sourceId);
      const snap = tgt ? this.snapAnchor(tgt, world) : null;
      // 端點:吸附到目標錨點時貼齊該點,否則跟著游標。
      const to = snap && tgt ? anchorPoint(nodeRect(tgt), snap) : world;
      const src = getNode(this.host.getScene(), m.sourceId);
      if (src) {
        // 起點:從固定錨點起 → 用該錨點;否則用朝向終點的浮動周界錨。
        const from = m.fromAnchor ? anchorPoint(nodeRect(src), m.fromAnchor) : perimeterAnchor(nodeRect(src), to);
        this.host.overlay.showRubberBand(from, to, zoom);
      }
      this.host.overlay.showDropTarget(tgt ? nodeRect(tgt) : null, zoom);
      this.host.overlay.showAnchorPoints(tgt ? nodeRect(tgt) : null, zoom, snap);
      return;
    }

    if (m.kind === 'reconnect-edge') {
      const tgt = this.nodeUnder(c.x, c.y);
      const snap = tgt ? this.snapAnchor(tgt, world) : null;
      const to = snap && tgt ? anchorPoint(nodeRect(tgt), snap) : world;
      this.host.overlay.showRubberBand(m.anchorFixed, to, zoom);
      this.host.overlay.showDropTarget(tgt ? nodeRect(tgt) : null, zoom);
      this.host.overlay.showAnchorPoints(tgt ? nodeRect(tgt) : null, zoom, snap);
      return;
    }

    if (m.kind === 'marquee') {
      this.host.overlay.showMarquee(m.startWorld, world, zoom);
      return;
    }
  }

  private onPointerUp = (e: PointerEvent): void => {
    this.activePointers.delete(e.pointerId);
    try {
      this.svg.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    const m = this.mode;
    const world = this.host.viewport.screenToWorld(e.clientX, e.clientY);
    this.mode = { kind: 'idle' };

    if (m.kind === 'move') {
      if (m.dx !== 0 || m.dy !== 0) this.host.runCommand(cmdMoveNodes(m.ids, m.dx, m.dy), 'move');
      this.host.overlay.clearGuides();
      this.host.refreshOverlay();
      return;
    }
    if (m.kind === 'seq-reorder') {
      this.host.overlay.clearGuides();
      const fromIdx = this.host.getScene().sequence?.participants.findIndex((p) => p.id === m.id) ?? -1;
      if (m.targetIndex >= 0 && m.targetIndex !== fromIdx) {
        this.host.runCommand(cmdReorderSeqParticipant(m.id, m.targetIndex), 'reorder-participant');
      } else {
        this.host.refreshOverlay(); // 沒換序(或只是點一下)→ 選取框彈回原位。
      }
      return;
    }
    if (m.kind === 'resize') {
      this.host.runCommand(cmdResizeNode(m.nodeId, m.cur), 'resize');
      this.host.refreshOverlay();
      return;
    }
    if (m.kind === 'rubber-edge') {
      const target = this.nodeUnder(e.clientX, e.clientY, m.sourceId);
      this.host.overlay.clearTransient();
      this.host.overlay.showDropTarget(null, 1);
      this.host.overlay.clearAnchorPoints();
      const scene = this.host.getScene();
      const sourceAnchor = m.fromAnchor ?? undefined;
      if (target && target.id !== m.sourceId) {
        // 放在另一個節點上 → 連到它;吸附到目標錨點則一併設 targetAnchor(白點拉線的主要用途)。
        const targetAnchor = this.snapAnchor(target, world) ?? undefined;
        const edge = makeEdge(nextEdgeId(scene), m.sourceId, target.id, {
          ...this.host.createEdgeStyle(),
          sourceAnchor,
          targetAnchor,
        });
        this.host.runCommand(cmdAddEdge(edge), 'add-edge');
      } else if (!target && this.tool === 'edge-create') {
        // 只有「明確使用連線工具」拖到空白,才一步建立新節點並連上(draw.io 招牌)。
        const id = nextNodeId(scene);
        const node = makeNode(id, world, {});
        const edge = makeEdge(nextEdgeId(scene), m.sourceId, id, { ...this.host.createEdgeStyle(), sourceAnchor });
        this.host.runCommand(cmdAddConnectedNode(node, edge), 'add-connected');
        this.setSelection([id]);
        this.host.requestTextEdit(id);
      } else if (!target) {
        // 從白點拉線(select 模式)放到空白 → 取消,不自動新增形狀,僅選取來源節點。
        this.setSelection([m.sourceId]);
      }
      this.host.refreshOverlay();
      return;
    }
    if (m.kind === 'reconnect-edge') {
      const target = this.nodeUnder(e.clientX, e.clientY);
      this.host.overlay.clearTransient();
      this.host.overlay.showDropTarget(null, 1);
      this.host.overlay.clearAnchorPoints();
      if (target) {
        // 重接同時更新該端錨點:吸附到候選點 → 設錨;放在節點本體 → 清成浮動。
        const anchor = this.snapAnchor(target, world);
        this.host.runCommand(cmdReconnectEdge(m.edgeId, m.endpoint, target.id, anchor), 'reconnect');
      }
      this.host.refreshOverlay();
      return;
    }
    if (m.kind === 'marquee') {
      const marquee: Rect = {
        x: Math.min(m.startWorld.x, world.x),
        y: Math.min(m.startWorld.y, world.y),
        w: Math.abs(m.startWorld.x - world.x),
        h: Math.abs(m.startWorld.y - world.y),
      };
      this.host.overlay.clearTransient();
      if (marquee.w > 3 || marquee.h > 3) {
        const hits = this.host
          .getScene()
          .nodes.filter((n) => rectsIntersect(marquee, nodeRect(n)))
          .map((n) => n.id);
        this.setSelection(m.additive ? [...new Set([...this.getSelection(), ...hits])] : hits);
      }
      return;
    }
    if (m.kind === 'pan') {
      this.svg.style.cursor = this.tool === 'pan' ? 'grab' : 'default';
      // 從空白處按下且幾乎沒拖曳 → 視為點擊空白 → 取消選取。
      if (m.deselectAt && Math.hypot(e.clientX - m.deselectAt.x, e.clientY - m.deselectAt.y) < 4) {
        this.clearSelection();
      }
    }
  };

  private onPointerCancel = (e: PointerEvent): void => {
    this.activePointers.delete(e.pointerId);
    // 還原預覽:用目前模型重畫。
    this.host.renderer.render(this.host.getScene());
    this.host.overlay.clearGuides();
    this.host.overlay.clearTransient();
    this.host.overlay.showDropTarget(null, 1);
    this.host.overlay.clearAnchorPoints();
    this.host.refreshOverlay();
    this.mode = { kind: 'idle' };
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    this.host.viewport.zoomAtClient(factor, e.clientX, e.clientY);
    this.host.refreshOverlay();
  };

  /** 內容外框(供 fit)。 */
  contentBounds(): Rect | null {
    return boundingBox(this.host.getScene().nodes.map(nodeRect));
  }
}

/** 依拖動方向 dir 計算 resize 後的矩形(對角固定)。 */
function resizeRect(start: Rect, dir: ResizeDir, world: Point, startWorld: Point): Rect {
  let { x, y, w, h } = start;
  const dx = world.x - startWorld.x;
  const dy = world.y - startWorld.y;
  if (dir.includes('e')) w = start.w + dx;
  if (dir.includes('s')) h = start.h + dy;
  if (dir.includes('w')) {
    w = start.w - dx;
    x = start.x + dx;
  }
  if (dir.includes('n')) {
    h = start.h - dy;
    y = start.y + dy;
  }
  // 夾住最小值(維持對角固定)。
  if (w < MIN_W) {
    if (dir.includes('w')) x -= MIN_W - w;
    w = MIN_W;
  }
  if (h < MIN_H) {
    if (dir.includes('n')) y -= MIN_H - h;
    h = MIN_H;
  }
  return { x, y, w, h };
}
