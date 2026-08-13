// 看板的版面模型:欄是固定的直向泳道,卡片放在欄裡。
//
// 關鍵設計:**卡片在哪一欄由它的位置決定**,不另存 parentId。看板編輯的核心動作就是「把卡片
// 拖到另一欄」,若同時維護 parentId 與座標兩份真相,拖曳就得同步兩邊,漏一邊就會出現
// 「畫面在 A 欄、存檔卻在 B 欄」。序列化時直接依幾何判欄、依 y 排序,永遠一致。

import type { EditorScene, SceneContainer, SceneNode } from '../../scene/types';

export const LANE = { x0: 40, y0: 40, w: 230, gap: 26, headerH: 44, pad: 14, cardGap: 12 } as const;
export const CARD = { w: LANE.w - LANE.pad * 2, minH: 46 } as const;

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

/** 把場景排成看板版面:欄依序橫排、卡片在欄內依目前 y 的順序上下堆疊。 */
export function layoutKanban(scene: EditorScene): EditorScene {
  const lanes = [...scene.containers].sort(
    (a, b) => (a.sourceIndex ?? 0) - (b.sourceIndex ?? 0),
  );
  if (lanes.length === 0) return scene;
  // 先依幾何把卡片分配到欄(這是唯一真相),再在欄內依 y 排序。
  const buckets: SceneNode[][] = lanes.map(() => []);
  for (const n of scene.nodes) {
    buckets[laneIndexAt(n.x + n.w / 2, lanes.length)].push(n);
  }
  for (const b of buckets) b.sort((a, c) => a.y - c.y);

  const nodes: SceneNode[] = [];
  const containers: SceneContainer[] = [];
  let maxH = LANE.headerH + LANE.pad;
  buckets.forEach((cards, i) => {
    let y = LANE.y0 + LANE.headerH + LANE.pad;
    const x = LANE.x0 + i * (LANE.w + LANE.gap) + LANE.pad;
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
