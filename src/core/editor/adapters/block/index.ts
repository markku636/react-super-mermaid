// block-beta adapter(把積木拖到別的格子 = 重排)。

import { registerAdapter } from '../registry';
import type { DiagramAdapter } from '../types';
import type { EditorScene } from '../../scene/types';
import type { LayoutEngine } from '../../layout/types';
import type { MermaidLike, MermaidSource } from '../../../../types';
import { blockToScene, layoutBlock, sceneToBlock } from '../../round-trip/block';

export const blockAdapter: DiagramAdapter = {
  capabilities: {
    type: 'block',
    // 積木圖的外形與流程圖同一套語法(["方"]/("圓")/{"菱"}…),所以外形選單也一樣。
    shapes: ['rectangle', 'rounded', 'stadium', 'circle', 'diamond', 'hexagon', 'cylinder', 'subroutine', 'odd'],
    quickShapes: ['rectangle', 'rounded', 'circle', 'diamond', 'hexagon'],
    arrowHeads: ['none', 'arrow'],
    lineKinds: ['solid'],
    freeform: true,
    defaults: { nodeShape: 'rectangle', arrowEnd: 'arrow' },
  },
  keywords: ['block-beta', 'block'],

  parse(text: string, _mermaid: MermaidLike) {
    return Promise.resolve(blockToScene(text));
  },

  serialize(scene: EditorScene) {
    return sceneToBlock(scene);
  },

  async layout(scene: EditorScene, _engine: LayoutEngine, _mermaid?: MermaidSource): Promise<EditorScene> {
    return layoutBlock(scene);
  },
};

/** 顯式註冊(非 module side-effect)。 */
export function registerBlockAdapter(): void {
  registerAdapter(blockAdapter);
}
