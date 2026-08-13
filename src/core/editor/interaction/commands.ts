// 命令 + 歷史(undo/redo)。命令為純函式:scene → { scene, patch }。
// 歷史保存 before/after 兩個不可變場景(diagram 不大,快照成本低)+ patch(增量重繪提示)。

import type {
  EdgeAnchor,
  EdgeData,
  EditorScene,
  ElementStyle,
  LineKind,
  NodeData,
  NodeShape,
  Point,
  SceneContainer,
  SceneEdge,
  SceneNode,
} from '../scene/types';
import {
  addEdge,
  addNode,
  deleteEdges,
  deleteNodes,
  groupIntoContainer,
  moveNodes,
  reconnectEdge,
  resizeNode,
  setLabel,
  setShape,
} from '../scene/scene-ops';

/** 增量重繪提示:哪些 id 變了。structural=true 代表拓樸變動(需重繞邊 / 重建)。 */
export interface ScenePatch {
  nodes?: string[];
  edges?: string[];
  containers?: string[];
  structural?: boolean;
}

export interface CommandResult {
  scene: EditorScene;
  patch: ScenePatch;
}

/** 命令 = 給定場景算出新場景 + patch 的純函式。 */
export type Command = (scene: EditorScene) => CommandResult;

// ── 命令工廠 ──

export function cmdAddNode(node: SceneNode): Command {
  return (scene) => ({ scene: addNode(scene, node), patch: { nodes: [node.id], structural: true } });
}

export function cmdAddEdge(edge: SceneEdge): Command {
  return (scene) => ({ scene: addEdge(scene, edge), patch: { edges: [edge.id], structural: true } });
}

/** 拖線到空白處 → 一步新增「節點 + 連到它的邊」(draw.io 招牌操作),只算一次 undo。 */
export function cmdAddConnectedNode(node: SceneNode, edge: SceneEdge): Command {
  return (scene) => ({
    scene: addEdge(addNode(scene, node), edge),
    patch: { nodes: [node.id], edges: [edge.id], structural: true },
  });
}

/** 一次加入多個節點 + 邊(複製 / 貼上 用),只算一次 undo。 */
export function cmdAddElements(nodes: SceneNode[], edges: SceneEdge[]): Command {
  return (scene) => ({
    scene: { ...scene, nodes: [...scene.nodes, ...nodes], edges: [...scene.edges, ...edges] },
    patch: { nodes: nodes.map((n) => n.id), edges: edges.map((e) => e.id), structural: true },
  });
}

export function cmdMoveNodes(ids: string[], dx: number, dy: number): Command {
  const set = new Set(ids);
  return (scene) => {
    const next = moveNodes(scene, set, dx, dy);
    // 受影響的邊 = 任一端在 ids 內。
    const edges = next.edges.filter((e) => set.has(e.source) || set.has(e.target)).map((e) => e.id);
    return { scene: next, patch: { nodes: ids, edges } };
  };
}

export function cmdResizeNode(id: string, rect: { x: number; y: number; w: number; h: number }): Command {
  return (scene) => {
    const next = resizeNode(scene, id, rect);
    const edges = next.edges.filter((e) => e.source === id || e.target === id).map((e) => e.id);
    return { scene: next, patch: { nodes: [id], edges } };
  };
}

export function cmdSetLabel(id: string, label: string): Command {
  return (scene) => ({ scene: setLabel(scene, id, label), patch: { nodes: [id], edges: [id] } });
}

export function cmdSetShape(id: string, shape: NodeShape): Command {
  return (scene) => ({ scene: setShape(scene, id, shape), patch: { nodes: [id] } });
}

/** 設定節點內聯樣式(底色 / 框線)。 */
export function cmdSetNodeStyle(id: string, patch: Partial<ElementStyle>): Command {
  return (scene) => ({
    scene: {
      ...scene,
      nodes: scene.nodes.map((n) => (n.id === id ? { ...n, style: { ...n.style, ...patch } } : n)),
    },
    patch: { nodes: [id] },
  });
}

export type AlignAxis = 'left' | 'centerX' | 'right' | 'top' | 'middleY' | 'bottom';

/** 對齊多個選取節點到共同邊/中線。 */
export function cmdAlignNodes(ids: string[], axis: AlignAxis): Command {
  return (scene) => {
    const sel = scene.nodes.filter((n) => ids.includes(n.id));
    if (sel.length < 2) return { scene, patch: {} };
    const minX = Math.min(...sel.map((n) => n.x));
    const maxR = Math.max(...sel.map((n) => n.x + n.w));
    const minY = Math.min(...sel.map((n) => n.y));
    const maxB = Math.max(...sel.map((n) => n.y + n.h));
    const idset = new Set(ids);
    const nodes = scene.nodes.map((n) => {
      if (!idset.has(n.id)) return n;
      switch (axis) {
        case 'left':
          return { ...n, x: minX };
        case 'right':
          return { ...n, x: maxR - n.w };
        case 'centerX':
          return { ...n, x: (minX + maxR) / 2 - n.w / 2 };
        case 'top':
          return { ...n, y: minY };
        case 'bottom':
          return { ...n, y: maxB - n.h };
        default:
          return { ...n, y: (minY + maxB) / 2 - n.h / 2 };
      }
    });
    return { scene: { ...scene, nodes }, patch: { nodes: ids } };
  };
}

export function cmdReconnectEdge(
  edgeId: string,
  endpoint: 'source' | 'target',
  nodeId: string,
  anchor?: EdgeAnchor | null,
): Command {
  return (scene) => ({
    scene: reconnectEdge(scene, edgeId, endpoint, nodeId, anchor),
    patch: { edges: [edgeId], structural: true },
  });
}

export function cmdDeleteSelection(nodeIds: string[], edgeIds: string[]): Command {
  const nset = new Set(nodeIds);
  const eset = new Set(edgeIds);
  return (scene) => {
    let next = scene;
    const removedEdgeIds: string[] = [...edgeIds];
    if (nset.size > 0) {
      const res = deleteNodes(next, nset);
      next = res.scene;
      for (const e of res.removedEdges) removedEdgeIds.push(e.id);
    }
    if (eset.size > 0) next = deleteEdges(next, eset);
    return { scene: next, patch: { nodes: nodeIds, edges: removedEdgeIds, structural: true } };
  };
}

export function cmdGroup(container: SceneContainer): Command {
  return (scene) => ({
    scene: groupIntoContainer(scene, container),
    patch: { containers: [container.id], nodes: container.childNodeIds, structural: true },
  });
}

/** sequence:新增參與者(附加一欄,座標沿用 parse 的欄位佈局 GAP=56)。 */
export function cmdAddSeqParticipant(): Command {
  return (scene) => {
    if (!scene.sequence) return { scene, patch: {} };
    const ids = new Set(scene.sequence.participants.map((p) => p.id));
    let n = 1;
    while (ids.has(`P${n}`)) n += 1;
    const id = `P${n}`;
    const label = id;
    const w = Math.max(96, label.length * 9 + 28);
    const seqNodes = scene.nodes.filter((x) => x.data?.kind === 'sequence');
    const last = seqNodes[seqNodes.length - 1];
    const x = last ? last.x + last.w + 56 : 40;
    const node: SceneNode = {
      id,
      shape: 'participant',
      label,
      x,
      y: 12,
      w,
      h: 40,
      data: { kind: 'sequence', actor: false },
      sourceIndex: scene.nodes.length,
    };
    return {
      scene: {
        ...scene,
        nodes: [...scene.nodes, node],
        sequence: { ...scene.sequence, participants: [...scene.sequence.participants, { id, label, actor: false }] },
      },
      patch: { structural: true },
    };
  };
}

/** sequence:新增一條訊息(預設在前兩個參與者之間)。 */
export function cmdAddSeqMessage(): Command {
  return (scene) => {
    if (!scene.sequence || scene.sequence.participants.length === 0) return { scene, patch: {} };
    const ps = scene.sequence.participants;
    const from = ps[0].id;
    const to = ps[Math.min(1, ps.length - 1)].id;
    const statements = [
      ...scene.sequence.statements,
      { kind: 'message' as const, from, to, arrow: '->>', text: 'message' },
    ];
    return { scene: { ...scene, sequence: { ...scene.sequence, statements } }, patch: { structural: true } };
  };
}

/**
 * sequence:在指定位置插入一則訊息(拖曳繪製用)。
 *
 * 與 cmdAddSeqMessage 的差別在「插在哪」:拖曳是從一條生命線拉到另一條,落點的垂直位置
 * 就是使用者想插入的時間點,所以必須能插在中間,而不是一律附加到最後。
 * index 以 statements 陣列為準(含 note / loop / alt 等非訊息陳述),超界會夾到合法區間。
 */
export function cmdInsertSeqMessage(
  from: string,
  to: string,
  index: number,
  arrow = '->>',
  text = 'message',
): Command {
  return (scene) => {
    if (!scene.sequence) return { scene, patch: {} };
    const ids = new Set(scene.sequence.participants.map((p) => p.id));
    if (!ids.has(from) || !ids.has(to)) return { scene, patch: {} };
    const statements = [...scene.sequence.statements];
    const i = Math.max(0, Math.min(index, statements.length));
    statements.splice(i, 0, { kind: 'message' as const, from, to, arrow, text });
    return { scene: { ...scene, sequence: { ...scene.sequence, statements } }, patch: { structural: true } };
  };
}

/** sequence:新增 note(預設 over 第一位參與者;新增後可直接編輯文字)。 */
export function cmdAddSeqNote(): Command {
  return (scene) => {
    if (!scene.sequence || scene.sequence.participants.length === 0) return { scene, patch: {} };
    const actors = scene.sequence.participants[0].id;
    const statements = [
      ...scene.sequence.statements,
      { kind: 'note' as const, placement: 'over' as const, actors, text: 'note' },
    ];
    return { scene: { ...scene, sequence: { ...scene.sequence, statements } }, patch: { structural: true } };
  };
}

/** sequence:刪除參與者(同步移除鏡像 node、相關訊息,並重排剩餘欄位)。 */
export function cmdDeleteSeqParticipant(id: string): Command {
  return (scene) => {
    if (!scene.sequence) return { scene, patch: {} };
    const participants = scene.sequence.participants.filter((p) => p.id !== id);
    const statements = scene.sequence.statements.filter(
      (s) => s.kind !== 'message' || (s.from !== id && s.to !== id),
    );
    let px = 40;
    const nodes = scene.nodes
      .filter((n) => n.id !== id)
      .map((n) => {
        if (n.data?.kind !== 'sequence') return n;
        const nn = { ...n, x: px };
        px += n.w + 56;
        return nn;
      });
    return {
      scene: { ...scene, nodes, sequence: { ...scene.sequence, participants, statements } },
      patch: { structural: true },
    };
  };
}

/** sequence:刪除某條陳述(訊息/note 等)。 */
export function cmdDeleteSeqStatement(index: number): Command {
  return (scene) => {
    if (!scene.sequence) return { scene, patch: {} };
    const statements = scene.sequence.statements.filter((_, i) => i !== index);
    return { scene: { ...scene, sequence: { ...scene.sequence, statements } }, patch: { structural: true } };
  };
}

/** sequence:切換某條訊息的實線/虛線箭頭(->> ↔ -->>)。 */
export function cmdToggleSeqArrow(index: number): Command {
  return (scene) => {
    if (!scene.sequence) return { scene, patch: {} };
    const statements = scene.sequence.statements.map((s, i) =>
      i === index && s.kind === 'message'
        ? { ...s, arrow: s.arrow.includes('--') ? '->>' : '-->>' }
        : s,
    );
    return { scene: { ...scene, sequence: { ...scene.sequence, statements } }, patch: { structural: true } };
  };
}

/** sequence:改某條訊息 / note 的文字(scene.sequence.statements[index])。 */
export function cmdSetSeqMessageText(index: number, text: string): Command {
  return (scene) => {
    if (!scene.sequence) return { scene, patch: {} };
    const statements = scene.sequence.statements.map((s, i) =>
      i === index && (s.kind === 'message' || s.kind === 'note') ? { ...s, text } : s,
    );
    return { scene: { ...scene, sequence: { ...scene.sequence, statements } }, patch: { structural: true } };
  };
}

/** sequence:改參與者顯示名(同步更新鏡像 node.label 與 scene.sequence.participants)。 */
export function cmdRenameSeqParticipant(id: string, label: string): Command {
  return (scene) => {
    if (!scene.sequence) return { scene, patch: {} };
    return {
      scene: {
        ...scene,
        nodes: scene.nodes.map((n) => (n.id === id ? { ...n, label } : n)),
        sequence: {
          ...scene.sequence,
          participants: scene.sequence.participants.map((p) => (p.id === id ? { ...p, label } : p)),
        },
      },
      patch: { nodes: [id], structural: true },
    };
  };
}

/**
 * sequence:把參與者移到新的欄位索引(左右換序)。targetIndex 為「移除被拖者後」的插入位置。
 * 同步重排 scene.sequence.participants、鏡像 nodes 的陣列順序與欄位 x(沿用 GAP=56 佈局),
 * 讓渲染 / 命中測試 / serialize 三者一致。serialize 會在順序無法由訊息推斷時補顯式宣告以鎖序。
 */
export function cmdReorderSeqParticipant(id: string, targetIndex: number): Command {
  return (scene) => {
    if (!scene.sequence) return { scene, patch: {} };
    const parts = scene.sequence.participants;
    const from = parts.findIndex((p) => p.id === id);
    if (from < 0) return { scene, patch: {} };
    const clamped = Math.max(0, Math.min(parts.length - 1, targetIndex));
    if (clamped === from) return { scene, patch: {} };
    const nextParts = [...parts];
    const [moved] = nextParts.splice(from, 1);
    nextParts.splice(clamped, 0, moved);
    // 依新序取回鏡像 node 並重算欄位 x(x0=40, GAP=56,與 parse / cmdAdd 一致)。
    const byId = new Map(scene.nodes.map((n) => [n.id, n] as const));
    let px = 40;
    const relaid: SceneNode[] = [];
    for (const p of nextParts) {
      const n = byId.get(p.id);
      if (!n) continue;
      relaid.push({ ...n, x: px });
      px += n.w + 56;
    }
    const nonSeq = scene.nodes.filter((n) => n.data?.kind !== 'sequence');
    return {
      scene: {
        ...scene,
        nodes: [...relaid, ...nonSeq],
        sequence: { ...scene.sequence, participants: nextParts },
      },
      patch: { nodes: relaid.map((n) => n.id), structural: true },
    };
  };
}

/** 新增一個容器(看板 / 旅程圖的欄位;不含任何子節點)。 */
export function cmdAddContainer(container: SceneContainer): Command {
  return (scene) => ({
    scene: { ...scene, containers: [...scene.containers, container] },
    patch: { containers: [container.id], structural: true },
  });
}

/** 改容器標籤(看板欄名 / 旅程圖 section 名)。 */
export function cmdSetContainerLabel(id: string, label: string): Command {
  return (scene) => ({
    scene: { ...scene, containers: scene.containers.map((c) => (c.id === id ? { ...c, label } : c)) },
    patch: { containers: [id], structural: true },
  });
}

/** 刪除容器(連同它目前涵蓋的子節點一起,語意上等於「刪掉這一欄」)。 */
export function cmdDeleteContainer(id: string, childIds: string[]): Command {
  const kill = new Set(childIds);
  return (scene) => ({
    scene: {
      ...scene,
      containers: scene.containers.filter((c) => c.id !== id),
      nodes: scene.nodes.filter((n) => !kill.has(n.id)),
      edges: scene.edges.filter((e) => !kill.has(e.source) && !kill.has(e.target)),
    },
    patch: { structural: true },
  });
}

/** 設定連線的型別專屬資料(需求圖的關係種類 / ER 基數等)。 */
export function cmdSetEdgeData(edgeId: string, data: EdgeData): Command {
  return (scene) => ({
    scene: { ...scene, edges: scene.edges.map((e) => (e.id === edgeId ? { ...e, data } : e)) },
    patch: { edges: [edgeId], structural: true },
  });
}

/** 設定節點的 label + data(+ 重算尺寸)。供 ER 屬性 / class 成員結構化編輯。 */
export function cmdSetNodeData(
  id: string,
  patch: { label?: string; data?: NodeData; w?: number; h?: number },
): Command {
  return (scene) => ({
    scene: {
      ...scene,
      nodes: scene.nodes.map((n) =>
        n.id === id
          ? {
              ...n,
              label: patch.label ?? n.label,
              data: patch.data ?? n.data,
              w: patch.w ?? n.w,
              h: patch.h ?? n.h,
            }
          : n,
      ),
    },
    patch: { nodes: [id] },
  });
}

/** 解除群組:移除容器,並清掉其子節點的 parentId(節點本身保留)。 */
export function cmdUngroup(containerId: string): Command {
  return (scene) => ({
    scene: {
      ...scene,
      containers: scene.containers.filter((c) => c.id !== containerId),
      nodes: scene.nodes.map((n) => (n.parentId === containerId ? { ...n, parentId: undefined } : n)),
    },
    patch: { structural: true },
  });
}

/** 均分:把 3+ 個選取節點在水平('h')或垂直('v')方向等距分佈(頭尾固定)。 */
export function cmdDistributeNodes(ids: string[], axis: 'h' | 'v'): Command {
  return (scene) => {
    const sel = scene.nodes.filter((n) => ids.includes(n.id));
    if (sel.length < 3) return { scene, patch: {} };
    const cOf = (n: SceneNode): number => (axis === 'h' ? n.x + n.w / 2 : n.y + n.h / 2);
    const sorted = [...sel].sort((a, b) => cOf(a) - cOf(b));
    const firstC = cOf(sorted[0]);
    const lastC = cOf(sorted[sorted.length - 1]);
    const step = (lastC - firstC) / (sorted.length - 1);
    const target = new Map<string, number>();
    sorted.forEach((n, i) => target.set(n.id, firstC + step * i));
    const nodes = scene.nodes.map((n) => {
      const c = target.get(n.id);
      if (c == null) return n;
      return axis === 'h' ? { ...n, x: c - n.w / 2 } : { ...n, y: c - n.h / 2 };
    });
    return { scene: { ...scene, nodes }, patch: { nodes: ids } };
  };
}

export function cmdSetDirection(direction: 'TB' | 'TD' | 'BT' | 'LR' | 'RL'): Command {
  return (scene) => {
    // flowchart / state / class / er 的序列化都會輸出 `direction`(flowchart 是寫在標頭)。
    // 先前只放行 flowchart,於是狀態圖 / 類別圖 / ER 圖的方向下拉是顆死按鈕。
    const m = scene.meta;
    if (m.type !== 'flowchart' && m.type !== 'state' && m.type !== 'class' && m.type !== 'er') {
      return { scene, patch: {} };
    }
    return { scene: { ...scene, meta: { ...m, direction } }, patch: { structural: true } };
  };
}

/**
 * 把節點掛到新的父節點底下(或解除,parentId=undefined)。
 *
 * mindmap 沒有連線語法,階層完全由 parentId 決定 → 在心智圖上「拉一條線」語意上就是改父子關係。
 * 會擋掉會造成循環的接法(把節點掛到自己的後代之下),否則序列化會無窮遞迴。
 */
export function cmdSetParent(nodeId: string, parentId: string | undefined): Command {
  return (scene) => {
    const node = scene.nodes.find((n) => n.id === nodeId);
    if (!node || nodeId === parentId) return { scene, patch: {} };
    // 循環偵測:沿著 parentId 往上爬,若遇到 nodeId 代表 parent 是它的後代。
    let cur = parentId;
    const seen = new Set<string>();
    while (cur) {
      if (cur === nodeId) return { scene, patch: {} };
      if (seen.has(cur)) break;
      seen.add(cur);
      cur = scene.nodes.find((n) => n.id === cur)?.parentId ?? undefined;
    }
    return {
      scene: { ...scene, nodes: scene.nodes.map((n) => (n.id === nodeId ? { ...n, parentId } : n)) },
      patch: { structural: true },
    };
  };
}

export function cmdAddWaypoint(edgeId: string, waypoints: Point[]): Command {
  return (scene) => ({
    scene: { ...scene, edges: scene.edges.map((e) => (e.id === edgeId ? { ...e, waypoints } : e)) },
    patch: { edges: [edgeId] },
  });
}

export function cmdSetLineKind(edgeId: string, lineKind: LineKind): Command {
  return (scene) => ({
    scene: { ...scene, edges: scene.edges.map((e) => (e.id === edgeId ? { ...e, lineKind } : e)) },
    patch: { edges: [edgeId] },
  });
}

/** 一次設定連線樣式(線型 / 箭頭),供右鍵選單用。 */
export function cmdSetEdgeStyle(
  edgeId: string,
  patch: Partial<Pick<SceneEdge, 'lineKind' | 'arrowStart' | 'arrowEnd'>>,
): Command {
  return (scene) => ({
    scene: { ...scene, edges: scene.edges.map((e) => (e.id === edgeId ? { ...e, ...patch } : e)) },
    patch: { edges: [edgeId] },
  });
}

/** 批次設定多條連線的樣式(線型 / 箭頭),只算一次 undo。供工具列「套用到選取連線」。 */
export function cmdSetEdgesStyle(
  edgeIds: string[],
  patch: Partial<Pick<SceneEdge, 'lineKind' | 'arrowStart' | 'arrowEnd'>>,
): Command {
  const set = new Set(edgeIds);
  return (scene) => ({
    scene: { ...scene, edges: scene.edges.map((e) => (set.has(e.id) ? { ...e, ...patch } : e)) },
    patch: { edges: edgeIds },
  });
}

// ── 歷史 ──

interface HistoryEntry {
  before: EditorScene;
  after: EditorScene;
  patch: ScenePatch;
  label: string;
}

const MAX_HISTORY = 200;

export class History {
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];

  /** 套用命令,推入歷史。回傳新場景 + patch。 */
  run(scene: EditorScene, command: Command, label: string): CommandResult {
    const { scene: after, patch } = command(scene);
    this.undoStack.push({ before: scene, after, patch, label });
    if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
    this.redoStack = [];
    return { scene: after, patch };
  }

  /**
   * 合併到上一筆(相同 label,如連續拖曳):把 after/patch 換掉,before 維持原本。
   * 若上一筆 label 不符則退化為一般 run。
   */
  amend(scene: EditorScene, command: Command, label: string): CommandResult {
    const last = this.undoStack[this.undoStack.length - 1];
    if (!last || last.label !== label) return this.run(scene, command, label);
    const { scene: after, patch } = command(last.before);
    last.after = after;
    last.patch = mergePatch(last.patch, patch);
    this.redoStack = [];
    return { scene: after, patch: last.patch };
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undo(): { scene: EditorScene; patch: ScenePatch } | null {
    const entry = this.undoStack.pop();
    if (!entry) return null;
    this.redoStack.push(entry);
    return { scene: entry.before, patch: entry.patch };
  }

  redo(): { scene: EditorScene; patch: ScenePatch } | null {
    const entry = this.redoStack.pop();
    if (!entry) return null;
    this.undoStack.push(entry);
    return { scene: entry.after, patch: entry.patch };
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }
}

function mergePatch(a: ScenePatch, b: ScenePatch): ScenePatch {
  return {
    nodes: [...new Set([...(a.nodes ?? []), ...(b.nodes ?? [])])],
    edges: [...new Set([...(a.edges ?? []), ...(b.edges ?? [])])],
    containers: [...new Set([...(a.containers ?? []), ...(b.containers ?? [])])],
    structural: a.structural || b.structural,
  };
}
