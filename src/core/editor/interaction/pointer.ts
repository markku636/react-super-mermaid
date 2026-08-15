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
  nextEdgeId,
  nextNodeId,
  resolveEdgeAnchors,
} from '../scene/scene-ops';
import { makeEdgeFor, makeNodeFor } from '../scene/node-factory';
import type { ArrowHead, EdgeAnchor, EditorScene, LineKind, NodeShape, Point, SceneNode } from '../scene/types';
import {
  cmdAddConnectedNode,
  cmdAddEdge,
  cmdAddNode,
  cmdMoveNodes,
  cmdReconnectEdge,
  cmdInsertSeqMessage,
  cmdMoveSeqStatement,
  cmdReorderSeqParticipant,
  cmdResizeNode,
  cmdSetParent,
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
  /** 目前圖種有沒有「連線」這回事(象限圖 / 看板 / 旅程圖沒有)。未提供 = 有。 */
  supportsEdges?(): boolean;
}

const DRAG_THRESHOLD = 4; // 螢幕 px
const MIN_W = 40;
const MIN_H = 28;
const SNAP_TOL_SCREEN = 6;
// 連線錨點命中 / 吸附半徑(螢幕 px;除以 zoom 換算世界座標)。
const ANCHOR_HIT_SCREEN = 16;
// sequence 生命線的水平命中寬容(世界 px)。生命線本身只有 1px,不給寬容根本拖不準。
const SEQ_LIFELINE_HIT = 28;
// select 工具抓生命線換序的容差(世界 px)。刻意比 SEQ_LIFELINE_HIT 小很多,理由見 seqLifelineUnder。
const SEQ_LIFELINE_GRAB = 10;
// 訊息兩端的「端點區」最小寬度(世界 px):按在這裡拖 = 只換這一端接到哪條水道。
const SEQ_END_GRAB = 26;

type Mode =
  | { kind: 'idle' }
  | { kind: 'maybe-drag'; startWorld: Point; ids: string[]; bases: Map<string, Rect> }
  | { kind: 'move'; startWorld: Point; ids: string[]; bases: Map<string, Rect>; dx: number; dy: number }
  // sequence 專屬:參與者只能左右拖換序(非自由位移)。targetIndex = 移除被拖者後的插入位置。
  | { kind: 'seq-reorder'; id: string; startWorld: Point; base: Rect; targetIndex: number }
  // sequence 專屬:從生命線拖到另一條 → 插入一則訊息。落點的 Y 決定插在第幾則。
  | { kind: 'seq-msg-draw'; fromId: string; startWorld: Point }
  // sequence 專屬:抓著訊息 / note 拖 —— 上下改時間順序,左右跨水道換收發雙方。
  // grab 決定左右拖的意思:抓箭尾只動寄件方、抓箭頭只動收件方、抓中段整條平移(跨度不變)。
  | {
      kind: 'seq-msg-move';
      idx: number;
      startClient: Point;
      targetIndex: number;
      grab: 'from' | 'to' | 'both';
      /** 原本的收發雙方;非訊息(筆記 / 片段)為空字串 = 不支援跨水道。 */
      fromId: string;
      toId: string;
      /** 按下當時指標所在的水道序號,'both' 用它算位移了幾條。 */
      grabLane: number;
      /** 目前指到的收發雙方;null = 還沒跨過水道。 */
      retarget: { from: string; to: string } | null;
    }
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
   * sequence 專用命中:找出游標所在的參與者。
   *
   * 不能用 nodeUnder —— 那是矩形命中,只涵蓋頂端(與底端)的參與者方框。使用者拖曳時是沿著
   * **生命線**走的,游標多半落在兩個方框之間的長條空白區,矩形命中會回 null。這裡改成只比對
   * X 是否落在該參與者的水平範圍內(生命線就在方框正中央向下延伸),Y 一律接受。
   */
  private seqParticipantUnder(clientX: number, clientY: number, exclude?: string): SceneNode | null {
    const w = this.host.viewport.screenToWorld(clientX, clientY);
    const scene = this.host.getScene();
    if (scene.diagramType !== 'sequence') return null;
    let best: SceneNode | null = null;
    let bestDist = Infinity;
    for (const n of scene.nodes) {
      if (n.id === exclude || n.data?.kind !== 'sequence') continue;
      // 同一個參與者在頂端與底端各有一個框,取水平距離最近的那個中心。
      const cx = n.x + n.w / 2;
      const dist = Math.abs(w.x - cx);
      if (dist <= n.w / 2 + SEQ_LIFELINE_HIT && dist < bestDist) {
        bestDist = dist;
        best = n;
      }
    }
    return best;
  }

  /**
   * 按壓點是不是落在某條「生命線」上(select 工具拖曳換序用)。
   *
   * 與 seqParticipantUnder 的差別在容差要多貪:那個是給訊息工具的,吃掉整個欄位寬度 + 28 是對的
   * (使用者只是想從這根柱子拉一條線出去);select 這裡若照抄,參與者間 56 的間隙會被兩側各 28
   * 完全瓜分,拖空白處平移畫布與框選就再也做不到了。所以只認線本身左右 SEQ_LIFELINE_GRAB 的範圍。
   */
  private seqLifelineUnder(clientX: number, clientY: number): SceneNode | null {
    const w = this.host.viewport.screenToWorld(clientX, clientY);
    const scene = this.host.getScene();
    if (scene.diagramType !== 'sequence') return null;
    let best: SceneNode | null = null;
    let bestDist = Infinity;
    for (const n of scene.nodes) {
      if (n.data?.kind !== 'sequence') continue;
      const dist = Math.abs(w.x - (n.x + n.w / 2));
      if (dist <= SEQ_LIFELINE_GRAB && dist < bestDist) {
        bestDist = dist;
        best = n;
      }
    }
    return best;
  }

  /**
   * 由放開時的螢幕 Y 推出要插在第幾則陳述。
   *
   * 用已渲染的 `[data-seq-msg]` 元素直接比 client 座標,不做世界座標換算 —— 那些元素身上的
   * 屬性值就是 statements 的索引,所以「第一個中心點在放開位置下方的訊息」就是插入點;
   * 都在上方(或圖上還沒有任何訊息)則附加到最後。
   */
  private seqInsertIndexAt(clientY: number): number {
    const total = this.host.getScene().sequence?.statements.length ?? 0;
    const els = [...this.svg.querySelectorAll('[data-seq-msg]')];
    let insertAt = total;
    for (const el of els) {
      const idx = Number(el.getAttribute('data-seq-msg'));
      if (!Number.isFinite(idx)) continue;
      const box = (el as SVGGraphicsElement).getBoundingClientRect();
      if (box.y + box.height / 2 > clientY) {
        insertAt = Math.min(insertAt, idx);
      }
    }
    return insertAt;
  }

  /**
   * 指標落在第幾條水道。
   *
   * 與 seqLifelineUnder 的差別:那個要判斷「有沒有抓到線」,所以給容差;這個是拖曳中的落點判斷,
   * 整片水平空間都必須歸屬於某一條水道,不然指標飄到兩條線中間時回饋就斷掉了。
   */
  private seqLaneAt(clientX: number): { id: string; index: number } | null {
    const w = this.host.viewport.screenToWorld(clientX, 0);
    const cols = this.host.getScene().nodes.filter((n) => n.data?.kind === 'sequence');
    if (cols.length === 0) return null;
    let best = 0;
    let bestDist = Infinity;
    cols.forEach((n, i) => {
      const d = Math.abs(w.x - (n.x + n.w / 2));
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    });
    return { id: cols[best].id, index: best };
  }

  /** 某位參與者的水道中心 X(世界座標);找不到回 null。 */
  private seqLaneCenterX(id: string): number | null {
    const n = this.host.getScene().nodes.find((x) => x.id === id && x.data?.kind === 'sequence');
    return n ? n.x + n.w / 2 : null;
  }

  /**
   * 拖曳訊息換序時的插入指示線:一條橫跨所有生命線、畫在「放手後會落在哪」的高度的線。
   *
   * Y 同樣用已渲染的 `[data-seq-msg]` client 座標推(與 seqInsertIndexAt 同一套依據,
   * 兩者才不會各說各話);插入點指到的若是片段之類沒有命中區的陳述,就取索引大於等於它的
   * 第一個訊息,再不然就落到最後一則下方。X 用參與者欄位的世界座標左右各留 24 的餘裕。
   */
  private seqInsertGuide(insertAt: number): { x1: number; y1: number; x2: number; y2: number } | null {
    const els = [...this.svg.querySelectorAll('[data-seq-msg]')] as SVGGraphicsElement[];
    if (els.length === 0) return null;
    let clientY: number | null = null;
    let bestIdx = Infinity;
    for (const el of els) {
      const idx = Number(el.getAttribute('data-seq-msg'));
      if (!Number.isFinite(idx) || idx < insertAt || idx >= bestIdx) continue;
      bestIdx = idx;
      clientY = el.getBoundingClientRect().y - 5;
    }
    if (clientY == null) {
      const last = els[els.length - 1].getBoundingClientRect();
      clientY = last.y + last.height + 5;
    }
    const cols = this.host.getScene().nodes.filter((n) => n.data?.kind === 'sequence');
    if (cols.length === 0) return null;
    const x1 = Math.min(...cols.map((n) => n.x)) - 24;
    const x2 = Math.max(...cols.map((n) => n.x + n.w)) + 24;
    const y = this.host.viewport.screenToWorld(0, clientY).y;
    return { x1, y1: y, x2, y2: y };
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
      // 節點比容差還小時不給錨點:白點會蓋滿整個節點,連「按住拖曳」的立足之地都不剩。
      if (Math.min(n.w, n.h) < tolWorld * 2.2) return null;
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
      // 選起來 —— 訊息不是 node 也不是 edge,以 `seq:{index}` 這個假 id 進選取集合。
      // mermaid 的參與者 alias 不可能含冒號,不會跟真的 node id 撞名。
      // 有了它,選取框畫得出來、Delete 也知道要刪誰。
      this.setSelection([key]);
      // 單擊不只是「等第二下」:按住拖 = 上下改時間順序、左右跨水道換收發雙方。
      // 之前這裡直接 mode=idle 然後 return,等於在圖上最顯眼的箭頭身上開了一塊死區 ——
      // 拖曳不但不換序,連「拖空白處平移畫布」都被這個 return 一起吃掉,體感就是整張圖卡住。
      // 有沒有真的要搬,交給 processMove 的位移門檻判斷;沒過門檻就還原成單純的一次點擊。
      const st = this.host.getScene().sequence?.statements[i];
      const msg = st?.kind === 'message' ? st : null;
      const fromX = msg ? this.seqLaneCenterX(msg.from) : null;
      const toX = msg ? this.seqLaneCenterX(msg.to) : null;
      // 抓在哪一段決定左右拖的語意。端點區取跨度的 30%,但至少 SEQ_END_GRAB —— 兩條相鄰生命線
      // 之間的訊息很短,按比例算會小到抓不到;跨很多條的長訊息則不該讓端點區吃掉整條。
      let grab: 'from' | 'to' | 'both' = 'both';
      if (fromX != null && toX != null) {
        const wx = world.x;
        const span = Math.abs(toX - fromX);
        const zone = Math.max(SEQ_END_GRAB, span * 0.3);
        if (Math.abs(wx - fromX) <= zone) grab = 'from';
        else if (Math.abs(wx - toX) <= zone) grab = 'to';
      }
      this.mode = {
        kind: 'seq-msg-move',
        idx: i,
        startClient: { x: e.clientX, y: e.clientY },
        targetIndex: -1,
        grab,
        fromId: msg?.from ?? '',
        toId: msg?.to ?? '',
        grabLane: this.seqLaneAt(e.clientX)?.index ?? 0,
        retarget: null,
      };
      return;
    }

    // node-create:放一個節點。
    if (this.tool === 'node-create') {
      const scene = this.host.getScene();
      const id = nextNodeId(scene);
      const node = makeNodeFor(scene, id, world, {
        shape: this.host.createShape(),
        preferParentId: this.getSelection()[0],
      });
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

    // sequence:自由位移 / 縮放對序列圖無意義(拖了不寫回 code、又會弄亂版面),所以在此攔截,
    // 不落入下方 resize 分支。但兩件事是有意義的,分別對應兩個工具:
    //   edge-create → 從生命線拖到另一條生命線 = 插入一則訊息(落點 Y 決定插在第幾則)
    //   select      → 左右拖曳參與者換序 + 雙擊改名
    {
      const seqScene = this.host.getScene();
      if (seqScene.diagramType === 'sequence') {
        // 訊息模式的起點用**幾何**命中,不能用 DOM 命中:使用者是沿著生命線拖的,
        // 起點多半落在兩個參與者方框之間的空白處,那裡沒有 [data-node-id] 元素。
        if (this.tool === 'edge-create') {
          const start = this.seqParticipantUnder(e.clientX, e.clientY);
          if (start) {
            this.setSelection([start.id]);
            this.mode = { kind: 'seq-msg-draw', fromId: start.id, startWorld: world };
            return;
          }
        }
        // 方框用 DOM 命中,生命線改用幾何命中:生命線是 pointerEvents:none 的細線,DOM 抓不到,
        // 但在使用者眼裡「那條線就是這個參與者」,沿著它拖卻變成平移畫布 + 放手清空選取,很莫名。
        const sid = this.hitNode(target) ?? this.seqLifelineUnder(e.clientX, e.clientY)?.id ?? null;
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
    // 沒有連線語法的圖種(象限圖 / 看板 / 旅程圖)完全跳過這一段:它們的節點小,錨點白點會蓋滿
    // 整個節點,按下去會被判成「拉線」而不是「拖曳」—— 象限圖的點會因此完全拖不動。
    const canConnect = this.host.supportsEdges?.() ?? true;
    const connHit = canConnect ? this.hitConn(target) : null;
    const nodeId = this.hitNode(target);
    if (connHit || (canConnect && this.tool === 'edge-create' && nodeId)) {
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
    const connectSrc = canConnect ? this.connectAnchorNode(world, hovered) : null;
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
      const node = makeNodeFor(scene, id, world, {
        shape: this.host.createShape(),
        preferParentId: this.getSelection()[0],
      });
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
  private updateHover(clientX: number, clientY: number, target?: Element | null): void {
    // sequence 不支援自由拉線,不顯示連線控制點以免誤導 —— 但它的訊息可以上下拖換序,
    // 完全不給 hover 回饋就沒人猜得到,所以改成「滑過訊息就把它框起來」。
    if (this.host.getScene().diagramType === 'sequence') {
      const el = target?.closest('[data-seq-msg]') ?? null;
      const idx = el ? Number(el.getAttribute('data-seq-msg')) : NaN;
      const rect = Number.isFinite(idx) ? this.host.renderer.getSeqMsgRect(idx) : undefined;
      const key = rect ? `seq:${idx}` : null;
      if (key === this.hoverNodeId) return;
      this.hoverNodeId = key;
      // 已經選起來的那條不用再畫 hover —— 選取框已經在同一個位置了,疊起來只是變髒。
      if (rect && key && !this.selection.has(key)) {
        this.host.overlay.showHoverRect(rect, this.host.viewport.getZoom());
      } else {
        this.host.overlay.clearHover();
      }
      return;
    }
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
      if (this.tool === 'select') this.updateHover(e.clientX, e.clientY, e.target as Element | null);
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

    if (m.kind === 'seq-msg-draw') {
      // 訊息是水平箭頭:兩端都固定在游標當下的 Y,拖出來的橡皮筋才長得像將要產生的那條訊息。
      const src = getNode(this.host.getScene(), m.fromId);
      const tgt = this.seqParticipantUnder(c.x, c.y, m.fromId);
      if (src) {
        const fromX = nodeRect(src).x + nodeRect(src).w / 2;
        const toX = tgt ? nodeRect(tgt).x + nodeRect(tgt).w / 2 : world.x;
        this.host.overlay.showRubberBand({ x: fromX, y: world.y }, { x: toX, y: world.y }, zoom);
      }
      this.host.overlay.showDropTarget(tgt ? nodeRect(tgt) : null, zoom);
      return;
    }

    if (m.kind === 'seq-msg-move') {
      // 還在點擊容差內就別動:這一下很可能只是雙擊改字的第一擊,提早畫線會像誤觸。
      // 用直線距離而不是只看垂直位移 —— 純左右的跨水道拖曳也必須過得了門檻。
      if (Math.hypot(c.x - m.startClient.x, c.y - m.startClient.y) < DRAG_THRESHOLD) return;
      m.targetIndex = this.seqInsertIndexAt(c.y);
      const guide = this.seqInsertGuide(m.targetIndex);
      if (guide) this.host.overlay.showInsertLine(guide.x1, guide.x2, guide.y1, zoom);
      // 被拖的那則本身給個選取框當「我抓到的是這條」的回饋 —— 訊息不是 node,
      // previewMove 對它無效,所以只移動框、不動真正的圖元,放手才重排。
      const rect = this.host.renderer.getSeqMsgRect(m.idx);
      if (rect) this.host.overlay.showSelection([{ id: `seq:${m.idx}`, rect }], zoom, { handles: false });

      // ── 跨水道 ── 指標橫向落到哪條水道,就把抓住的那一端接過去。
      if (m.fromId && m.toId) {
        const lane = this.seqLaneAt(c.x);
        const cols = this.host.getScene().nodes.filter((n) => n.data?.kind === 'sequence');
        if (lane) {
          let from = m.fromId;
          let to = m.toId;
          if (m.grab === 'from') from = lane.id;
          else if (m.grab === 'to') to = lane.id;
          else {
            // 抓中段 = 整條平移:兩端各移動同樣的水道數,跨度不變。任一端會被推出邊界就整個不動,
            // 免得訊息在畫布邊緣被壓扁成「同一條水道發給自己」。
            const shift = lane.index - m.grabLane;
            const fi = cols.findIndex((n) => n.id === m.fromId) + shift;
            const ti = cols.findIndex((n) => n.id === m.toId) + shift;
            if (fi >= 0 && ti >= 0 && fi < cols.length && ti < cols.length) {
              from = cols[fi].id;
              to = cols[ti].id;
            }
          }
          // 同一條水道發給自己不是合法的目的地,維持上一個有效落點。
          if (from !== to) m.retarget = { from, to };
        }
        const r = m.retarget;
        const fx = r ? this.seqLaneCenterX(r.from) : null;
        const tx = r ? this.seqLaneCenterX(r.to) : null;
        if (fx != null && tx != null) {
          // 橡皮筋畫在指標當下的高度,長得就像放手後會生出來的那條訊息。
          this.host.overlay.showRubberBand({ x: fx, y: world.y }, { x: tx, y: world.y }, zoom);
          const tgt = cols.find((n) => n.id === r!.to);
          this.host.overlay.showDropTarget(tgt ? nodeRect(tgt) : null, zoom);
        }
      }
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
      // 沒有實際位移時不會走 runCommand → 不會重繪 → 落點提示會留在畫面上,這裡自己收掉。
      this.host.renderer.clearDropTarget();
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
    if (m.kind === 'seq-msg-move') {
      this.host.overlay.clearGuides();
      this.host.overlay.clearTransient();
      this.host.overlay.showDropTarget(null, 1);
      // targetIndex 還是 -1 = 從頭到尾沒超過位移門檻 → 這就是一次單純的點擊(可能是雙擊的第一下),
      // 什麼都不做,也不留 undo 紀錄。
      if (m.targetIndex >= 0) {
        // 位置與水道包在同一個指令裡:一次拖曳改了兩件事,undo 也該一次退回去。
        this.host.runCommand(
          cmdMoveSeqStatement(m.idx, m.targetIndex, m.retarget ?? undefined),
          'move-statement',
        );
      } else {
        this.host.refreshOverlay();
      }
      return;
    }
    if (m.kind === 'seq-msg-draw') {
      this.host.overlay.clearTransient();
      this.host.overlay.showDropTarget(null, 1);
      const tgt = this.seqParticipantUnder(e.clientX, e.clientY, m.fromId);
      if (tgt) {
        this.host.runCommand(
          cmdInsertSeqMessage(m.fromId, tgt.id, this.seqInsertIndexAt(e.clientY)),
          'add-message',
        );
      } else {
        this.host.refreshOverlay(); // 放在空白處 = 取消,不留下半條訊息。
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
        // mindmap 沒有連線語法,階層由 parentId 決定 → 拉線 = 把目標改掛到來源之下。
        if (scene.diagramType === 'mindmap') {
          this.host.runCommand(cmdSetParent(target.id, m.sourceId), 'reparent');
          this.setSelection([target.id]);
          this.host.refreshOverlay();
          return;
        }
        // 放在另一個節點上 → 連到它;吸附到目標錨點則一併設 targetAnchor(白點拉線的主要用途)。
        const targetAnchor = this.snapAnchor(target, world) ?? undefined;
        const edge = makeEdgeFor(scene, nextEdgeId(scene), m.sourceId, target.id, {
          ...this.host.createEdgeStyle(),
          sourceAnchor,
          targetAnchor,
        });
        this.host.runCommand(cmdAddEdge(edge), 'add-edge');
      } else if (!target && this.tool === 'edge-create') {
        // 只有「明確使用連線工具」拖到空白,才一步建立新節點並連上(draw.io 招牌)。
        const id = nextNodeId(scene);
        // mindmap:新節點直接掛在來源之下(它本來就沒有邊可以畫)。
        if (scene.diagramType === 'mindmap') {
          const child = makeNodeFor(scene, id, world, { parentId: m.sourceId });
          this.host.runCommand(cmdAddNode(child), 'add-node');
          this.setSelection([id]);
          this.host.requestTextEdit(id);
          this.host.refreshOverlay();
          return;
        }
        const node = makeNodeFor(scene, id, world, {});
        const edge = makeEdgeFor(scene, nextEdgeId(scene), m.sourceId, id, {
          ...this.host.createEdgeStyle(),
          sourceAnchor,
        });
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
