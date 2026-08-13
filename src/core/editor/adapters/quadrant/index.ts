// quadrantChart adapter(把點拖到象限裡 = 改它的值)。

import { registerAdapter } from '../registry';
import type { DiagramAdapter } from '../types';
import type { EditorScene } from '../../scene/types';
import type { LayoutEngine } from '../../layout/types';
import type { MermaidLike, MermaidSource } from '../../../../types';
import { quadrantToScene } from '../../round-trip/quadrant/parse';
import { sceneToQuadrant } from '../../round-trip/quadrant/serialize';

export const quadrantAdapter: DiagramAdapter = {
  capabilities: {
    type: 'quadrant',
    shapes: ['point'],
    // 象限圖沒有連線。
    arrowHeads: ['none'],
    lineKinds: ['solid'],
    supportsEdges: false,
    freeform: true,
    defaults: { nodeShape: 'point', arrowEnd: 'none' },
  },
  keywords: ['quadrantchart'],

  parse(text: string, _mermaid: MermaidLike) {
    return Promise.resolve(quadrantToScene(text));
  },

  serialize(scene: EditorScene) {
    return sceneToQuadrant(scene);
  },

  async layout(scene: EditorScene, _engine: LayoutEngine, _mermaid?: MermaidSource): Promise<EditorScene> {
    // 位置就是資料 —— 自動排版會直接竄改使用者的數值,所以這張圖永遠不重排。
    return scene;
  },
};

/** 顯式註冊(非 module side-effect)。 */
export function registerQuadrantAdapter(): void {
  registerAdapter(quadrantAdapter);
}
