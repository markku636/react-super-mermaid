// 指標互動狀態機(Pointer Events,統一鼠/筆/觸控)。
// 工具:select | pan | node-create | edge-create。把拖曳/點擊轉成命令交給 host 套用。
// 平滑要點:transform-only 拖曳(放手才重 rough)、rAF 批次、pointer capture、吸附。

import {
  boundingBox,
  edgeAnchors,
  nodeRect,
  perimeterAnchor,
  rectCenter,
  rectsIntersect,
  type Rect,
} from '../scene/geometry';
import { getNode, makeEdge, makeNode, nextEdgeId, nextNodeId } from '../scene/scene-ops';
import type { EditorScene, NodeShape, Point, SceneNode } from '../scene/types';
import {
  cmdAddConnectedNode,
  cmdAddEdge,
  cmdAddNode,
  cmdMoveNodes,
  cmdReconnectEdge,
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
  onSelectionChange(ids: string[]): void;
  onToolChange(tool: Tool): void;
  /** node-create 工具要放的外形。 */
  createShape(): NodeShape;
}

const DRAG_THRESHOLD = 4; // 螢幕 px
const MIN_W = 40;
const MIN_H = 28;
const SNAP_TOL_SCREEN = 6;

type Mode =
  | { kind: 'idle' }
  | { kind: 'maybe-drag'; startWorld: Point; ids: string[]; bases: Map<string, Rect> }
  | { kind: 'move'; startWorld: Point; ids: string[]; bases: Map<string, Rect>; dx: number; dy: number }
  | { kind: 'resize'; nodeId: string; dir: ResizeDir; startRect: Rect; startWorld: Point; cur: Rect }
  | { kind: 'rubber-edge'; sourceId: string; from: Point }
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
  private hitConn(t: Element): string | null {
    const el = t.closest('[data-conn-handle]');
    return el ? el.getAttribute('data-conn-node') : null;
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

  /** 回傳「按壓點靠近其某個邊中點(連線白點)」的節點 id;優先檢查 hover 的節點。 */
  private connectAnchorNode(world: Point, preferId: string | null): string | null {
    const R = 16 / this.host.viewport.getZoom();
    const scene = this.host.getScene();
    const near = (n: SceneNode): boolean => {
      const r = nodeRect(n);
      const a: Point[] = [
        { x: r.x + r.w / 2, y: r.y },
        { x: r.x + r.w, y: r.y + r.h / 2 },
        { x: r.x + r.w / 2, y: r.y + r.h },
        { x: r.x, y: r.y + r.h / 2 },
      ];
      return a.some((p) => Math.hypot(world.x - p.x, world.y - p.y) <= R);
    };
    if (preferId) {
      const pn = getNode(scene, preferId);
      if (pn && near(pn)) return preferId;
    }
    for (let i = scene.nodes.length - 1; i >= 0; i--) {
      if (near(scene.nodes[i])) return scene.nodes[i].id;
    }
    return null;
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

    // resize 控制點。
    const rz = this.hitResize(target);
    if (rz && rz.node) {
      const n = getNode(this.host.getScene(), rz.node);
      if (n) {
        this.mode = { kind: 'resize', nodeId: rz.node, dir: rz.dir, startRect: nodeRect(n), startWorld: world, cur: nodeRect(n) };
        return;
      }
    }

    // 連線控制點 / edge-create 工具在節點上 → 橡皮筋。
    const connNode = this.hitConn(target);
    const nodeId = this.hitNode(target);
    if (connNode || (this.tool === 'edge-create' && nodeId)) {
      const srcId = connNode ?? (nodeId as string);
      const src = getNode(this.host.getScene(), srcId);
      if (src) {
        this.mode = { kind: 'rubber-edge', sourceId: srcId, from: rectCenter(nodeRect(src)) };
        return;
      }
    }

    // 已選取的連線:按住其端點附近 → 重新接線(拖到別的節點)。端點在節點邊上,故須早於節點分支。
    const scene0 = this.host.getScene();
    const reconnectHitR = 12 / this.host.viewport.getZoom();
    for (const eid of this.selection) {
      const edge = scene0.edges.find((x) => x.id === eid);
      if (!edge) continue;
      const anchors = edgeAnchors(edge, getNode(scene0, edge.source), getNode(scene0, edge.target));
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

    // 按在「連線白點」附近(節點 4 邊中點)→ 拉線(像 draw.io)。優先用 hover 中的節點;
    // 純幾何判定,故即使白點凸出到節點邊緣外、DOM 命中抓不到節點,也一定能起連線。
    const connectSrc = this.connectAnchorNode(world, hovered);
    if (connectSrc) {
      const src = getNode(this.host.getScene(), connectSrc);
      if (src) {
        this.mode = { kind: 'rubber-edge', sourceId: connectSrc, from: rectCenter(nodeRect(src)) };
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
    const emptyNow = performance.now();
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

    if (m.kind === 'resize') {
      m.cur = resizeRect(m.startRect, m.dir, world, m.startWorld);
      this.host.renderer.previewResize(m.nodeId, m.cur);
      this.host.overlay.showSelection([{ id: m.nodeId, rect: m.cur }], zoom, { handles: true });
      return;
    }

    if (m.kind === 'rubber-edge') {
      const src = getNode(this.host.getScene(), m.sourceId);
      if (src) {
        const from = perimeterAnchor(nodeRect(src), world);
        this.host.overlay.showRubberBand(from, world, zoom);
      }
      const tgt = this.nodeUnder(c.x, c.y, m.sourceId);
      this.host.overlay.showDropTarget(tgt ? nodeRect(tgt) : null, zoom);
      return;
    }

    if (m.kind === 'reconnect-edge') {
      this.host.overlay.showRubberBand(m.anchorFixed, world, zoom);
      const tgt = this.nodeUnder(c.x, c.y);
      this.host.overlay.showDropTarget(tgt ? nodeRect(tgt) : null, zoom);
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
    if (m.kind === 'resize') {
      this.host.runCommand(cmdResizeNode(m.nodeId, m.cur), 'resize');
      this.host.refreshOverlay();
      return;
    }
    if (m.kind === 'rubber-edge') {
      const target = this.nodeUnder(e.clientX, e.clientY, m.sourceId);
      this.host.overlay.clearTransient();
      this.host.overlay.showDropTarget(null, 1);
      const scene = this.host.getScene();
      if (target && target.id !== m.sourceId) {
        // 放在另一個節點上 → 連到它(白點拉線的主要用途)。
        const edge = makeEdge(nextEdgeId(scene), m.sourceId, target.id);
        this.host.runCommand(cmdAddEdge(edge), 'add-edge');
      } else if (!target && this.tool === 'edge-create') {
        // 只有「明確使用連線工具」拖到空白,才一步建立新節點並連上(draw.io 招牌)。
        const id = nextNodeId(scene);
        const node = makeNode(id, world, {});
        const edge = makeEdge(nextEdgeId(scene), m.sourceId, id);
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
      if (target) {
        this.host.runCommand(cmdReconnectEdge(m.edgeId, m.endpoint, target.id), 'reconnect');
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
