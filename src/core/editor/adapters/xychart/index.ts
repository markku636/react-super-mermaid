// xychart-beta adapter(把資料點往上拖 = 把數字調大)。

import { registerAdapter } from '../registry';
import type { DiagramAdapter } from '../types';
import type { EditorScene } from '../../scene/types';
import type { LayoutEngine } from '../../layout/types';
import type { MermaidLike, MermaidSource } from '../../../../types';
import { layoutXychart, sceneToXychart, xychartToScene } from '../../round-trip/xychart';

export const xychartAdapter: DiagramAdapter = {
  capabilities: {
    type: 'xychart',
    shapes: ['xyPoint'],
    arrowHeads: ['none'],
    lineKinds: ['solid'],
    supportsEdges: false,
    freeform: true,
    defaults: { nodeShape: 'xyPoint', arrowEnd: 'none' },
  },
  keywords: ['xychart-beta', 'xychart'],

  parse(text: string, _mermaid: MermaidLike) {
    return Promise.resolve(xychartToScene(text));
  },

  serialize(scene: EditorScene) {
    return sceneToXychart(scene);
  },

  async layout(scene: EditorScene, _engine: LayoutEngine, _mermaid?: MermaidSource): Promise<EditorScene> {
    return layoutXychart(scene);
  },
};

/** 顯式註冊(非 module side-effect)。 */
export function registerXychartAdapter(): void {
  registerAdapter(xychartAdapter);
}
