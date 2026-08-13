// kanban adapter(把卡片拖到另一欄 = 改它的狀態)。

import { registerAdapter } from '../registry';
import type { DiagramAdapter } from '../types';
import type { EditorScene } from '../../scene/types';
import type { LayoutEngine } from '../../layout/types';
import type { MermaidLike, MermaidSource } from '../../../../types';
import { kanbanDbToScene } from '../../round-trip/kanban/parse';
import { sceneToKanban } from '../../round-trip/kanban/serialize';
import { layoutKanban } from '../../round-trip/kanban/model';

export const kanbanAdapter: DiagramAdapter = {
  capabilities: {
    type: 'kanban',
    shapes: ['kanbanCard'],
    // 看板沒有連線。
    arrowHeads: ['none'],
    lineKinds: ['solid'],
    supportsEdges: false,
    freeform: true,
    defaults: { nodeShape: 'kanbanCard', arrowEnd: 'none' },
  },
  keywords: ['kanban'],

  parse(text: string, mermaid: MermaidLike) {
    return kanbanDbToScene(text, mermaid);
  },

  serialize(scene: EditorScene) {
    return sceneToKanban(scene);
  },

  async layout(scene: EditorScene, _engine: LayoutEngine, _mermaid?: MermaidSource): Promise<EditorScene> {
    // 看板的版面是規則的直向泳道,不需要(也不該)交給 dagre —— 自己排,「整理」就是把卡片
    // 依目前的欄與上下順序重新對齊貼齊。
    return layoutKanban(scene);
  },
};

/** 顯式註冊(非 module side-effect)。 */
export function registerKanbanAdapter(): void {
  registerAdapter(kanbanAdapter);
}
