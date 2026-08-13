// pie adapter(繞著圓拖 = 排順序;雙擊 = 改「標籤: 數值」)。

import { registerAdapter } from '../registry';
import type { DiagramAdapter } from '../types';
import type { EditorScene } from '../../scene/types';
import type { LayoutEngine } from '../../layout/types';
import type { MermaidLike, MermaidSource } from '../../../../types';
import { layoutPie, pieToScene, sceneToPie } from '../../round-trip/pie';

export const pieAdapter: DiagramAdapter = {
  capabilities: {
    type: 'pie',
    shapes: ['pieSlice'],
    arrowHeads: ['none'],
    lineKinds: ['solid'],
    supportsEdges: false,
    freeform: true,
    defaults: { nodeShape: 'pieSlice', arrowEnd: 'none' },
  },
  keywords: ['pie'],

  parse(text: string, _mermaid: MermaidLike) {
    return Promise.resolve(pieToScene(text));
  },

  serialize(scene: EditorScene) {
    return sceneToPie(scene);
  },

  async layout(scene: EditorScene, _engine: LayoutEngine, _mermaid?: MermaidSource): Promise<EditorScene> {
    // 「整理」= 依目前角度定序後,把把手擺回各扇形質心。
    return layoutPie(scene);
  },
};

/** 顯式註冊(非 module side-effect)。 */
export function registerPieAdapter(): void {
  registerAdapter(pieAdapter);
}
