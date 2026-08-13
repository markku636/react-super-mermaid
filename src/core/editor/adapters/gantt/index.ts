// gantt adapter(拖長條 = 改日期;拉右緣 = 改工期;上下拖 = 換 section)。

import { registerAdapter } from '../registry';
import type { DiagramAdapter } from '../types';
import type { EditorScene } from '../../scene/types';
import type { LayoutEngine } from '../../layout/types';
import type { MermaidLike, MermaidSource } from '../../../../types';
import { ganttDbToScene } from '../../round-trip/gantt/parse';
import { sceneToGantt } from '../../round-trip/gantt/serialize';

export const ganttAdapter: DiagramAdapter = {
  capabilities: {
    type: 'gantt',
    shapes: ['ganttBar'],
    arrowHeads: ['none'],
    lineKinds: ['solid'],
    supportsEdges: false,
    freeform: true,
    defaults: { nodeShape: 'ganttBar', arrowEnd: 'none' },
  },
  keywords: ['gantt'],

  parse(text: string, mermaid: MermaidLike) {
    return ganttDbToScene(text, mermaid);
  },

  serialize(scene: EditorScene) {
    return sceneToGantt(scene);
  },

  async layout(scene: EditorScene, _engine: LayoutEngine, _mermaid?: MermaidSource): Promise<EditorScene> {
    // 長條的位置就是日期,自動排版等於竄改行程 —— 這張圖永遠不重排。
    return scene;
  },
};

/** 顯式註冊(非 module side-effect)。 */
export function registerGanttAdapter(): void {
  registerAdapter(ganttAdapter);
}
