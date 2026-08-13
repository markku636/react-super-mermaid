// 場景 → mindmap 文字。依 parentId 還原樹狀,以縮排表階層;外形用 data.shapeType 還原括號。

import type { DataLossWarning, SerializeResult } from '../../adapters/types';
import type { EditorScene, SceneNode } from '../../scene/types';

const INDENT = '  ';

/** shapeType → 括號包裝。 */
function wrap(shapeType: number, descr: string): string {
  switch (shapeType) {
    case 1:
      return `(${descr})`;
    case 2:
      return `[${descr}]`;
    case 3:
      return `((${descr}))`;
    case 4:
      return `)${descr}(`;
    case 5:
      return `))${descr}((`;
    case 6:
      return `{{${descr}}}`;
    default:
      return descr;
  }
}

function bySourceIndex(a: SceneNode, b: SceneNode): number {
  return (a.sourceIndex ?? Number.MAX_SAFE_INTEGER) - (b.sourceIndex ?? Number.MAX_SAFE_INTEGER);
}

export function sceneToMindmap(scene: EditorScene): SerializeResult {
  // 解析失敗的降級場景(空節點但保有原文)→ 原樣回吐,絕不把原圖覆寫成空。
  if (scene.nodes.length === 0 && scene.raw?.fullSource) {
    return { text: scene.raw.fullSource, warnings: [] };
  }
  const warnings: DataLossWarning[] = [];
  const lines: string[] = ['mindmap'];

  const childrenOf = new Map<string | null, SceneNode[]>();
  for (const n of scene.nodes) {
    const p = n.parentId ?? null;
    const arr = childrenOf.get(p) ?? [];
    arr.push(n);
    childrenOf.set(p, arr);
  }
  for (const arr of childrenOf.values()) arr.sort(bySourceIndex);

  const emit = (n: SceneNode, depth: number): void => {
    const shapeType = n.data?.kind === 'mindmap' ? n.data.shapeType : 0;
    // 括號裡不能是空的:`()` / `[]` / `(())` 都會讓 mermaid 直接語法錯誤。剛拖出來還沒命名的
    // 節點 label 就是空字串,所以退回節點 id 當暫時文字(使用者一改名就會被蓋掉)。
    const descr = n.label && n.label.trim().length > 0 ? n.label : n.id;
    lines.push(`${INDENT.repeat(depth + 1)}${wrap(shapeType, descr)}`);
    for (const c of childrenOf.get(n.id) ?? []) emit(c, depth + 1);
  };

  const roots = childrenOf.get(null) ?? [];
  if (roots.length === 0 && scene.nodes.length > 0) {
    warnings.push({ message: 'mindmap 找不到根節點,輸出可能不完整。' });
  }
  for (const r of roots) emit(r, 0);

  return { text: lines.join('\n') + '\n', warnings };
}
