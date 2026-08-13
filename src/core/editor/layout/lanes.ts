// 「直向泳道」版面:欄橫排、卡片在欄內上下堆疊。看板與使用者旅程圖共用。
//
// 核心設計:**卡片屬於哪一欄由它的位置決定**,場景不另存 parentId。這類圖的主要編輯動作就是
// 「把卡片拖到另一欄」,若同時維護座標與 parentId 兩份真相,拖曳就得同步兩邊,漏一邊就會出現
// 「畫面在 A 欄、存檔卻在 B 欄」。序列化時依幾何判欄、依 y 排序,永遠與畫面一致。

import type { EditorScene, SceneContainer, SceneNode } from '../scene/types';

export const LANE = { x0: 40, y0: 40, w: 240, gap: 26, headerH: 44, pad: 16, cardGap: 12 } as const;
// 卡片再內縮一點:卡片有陰影與左緣色條,貼著欄框畫會看起來像「溢出欄外」。
export const CARD = { w: LANE.w - LANE.pad * 2 - 4, minH: 46 } as const;

/** 第 i 欄的矩形(高度由呼叫端依內容決定)。 */
export function laneRect(i: number, h: number): { x: number; y: number; w: number; h: number } {
  return { x: LANE.x0 + i * (LANE.w + LANE.gap), y: LANE.y0, w: LANE.w, h };
}

/**
 * 依卡片中心點找出它落在哪一欄;落在欄與欄之間 / 圖外時取最近的一欄。
 * (欄 i 的卡片中心約在 i + 0.45 欄寬處,四捨五入正好回到 i。)
 */
export function laneIndexAt(cx: number, laneCount: number): number {
  if (laneCount <= 0) return 0;
  const rel = (cx - LANE.x0) / (LANE.w + LANE.gap);
  return Math.max(0, Math.min(laneCount - 1, Math.round(rel)));
}

/** 第 i 欄裡卡片的左上角 x(供初始佈點)。 */
export function laneCardX(i: number): number {
  return LANE.x0 + i * (LANE.w + LANE.gap) + LANE.pad;
}

/** 依幾何把卡片分到各欄,欄內依 y 排序。序列化與版面計算共用同一份判定。 */
export function bucketByLane(scene: EditorScene, lanes: SceneContainer[]): SceneNode[][] {
  const buckets: SceneNode[][] = lanes.map(() => []);
  if (lanes.length === 0) return buckets;
  for (const n of scene.nodes) buckets[laneIndexAt(n.x + n.w / 2, lanes.length)].push(n);
  for (const b of buckets) b.sort((a, c) => a.y - c.y);
  return buckets;
}

/** 依 sourceIndex 取得穩定的欄順序。 */
export function sortedLanes(scene: EditorScene): SceneContainer[] {
  return [...scene.containers].sort((a, b) => (a.sourceIndex ?? 0) - (b.sourceIndex ?? 0));
}

/** 把場景排成泳道版面:欄依序橫排、卡片在欄內依目前 y 的順序上下堆疊。 */
export function layoutLanes(scene: EditorScene): EditorScene {
  const lanes = sortedLanes(scene);
  if (lanes.length === 0) return scene;
  const buckets = bucketByLane(scene, lanes);

  const nodes: SceneNode[] = [];
  const containers: SceneContainer[] = [];
  let maxH = LANE.headerH + LANE.pad;
  buckets.forEach((cards, i) => {
    let y = LANE.y0 + LANE.headerH + LANE.pad;
    const x = laneCardX(i);
    for (const c of cards) {
      nodes.push({ ...c, x, y, w: CARD.w, parentId: lanes[i].id, pinned: true });
      y += c.h + LANE.cardGap;
    }
    maxH = Math.max(maxH, y - LANE.y0 + LANE.pad - LANE.cardGap);
  });
  buckets.forEach((cards, i) => {
    containers.push({ ...lanes[i], ...laneRect(i, maxH), childNodeIds: cards.map((c) => c.id) });
  });
  return { ...scene, nodes, containers, layoutOwner: 'user' };
}
