// sankey-beta adapter(流量圖:節點 + 帶流量的連線)。

import { registerAdapter } from '../registry';
import type { DiagramAdapter } from '../types';
import type { EditorScene } from '../../scene/types';
import type { LayoutEngine } from '../../layout/types';
import type { MermaidLike, MermaidSource } from '../../../../types';
import { sankeyToScene, sceneToSankey } from '../../round-trip/sankey';

export const sankeyAdapter: DiagramAdapter = {
  capabilities: {
    type: 'sankey',
    shapes: ['sankeyNode'],
    arrowHeads: ['none'],
    lineKinds: ['solid'],
    freeform: true,
    defaults: { nodeShape: 'sankeyNode', arrowEnd: 'none' },
  },
  keywords: ['sankey-beta', 'sankey'],

  parse(text: string, _mermaid: MermaidLike) {
    return Promise.resolve(sankeyToScene(text));
  },

  serialize(scene: EditorScene) {
    return sceneToSankey(scene);
  },

  async layout(scene: EditorScene, _engine: LayoutEngine, _mermaid?: MermaidSource): Promise<EditorScene> {
    // sankey 的排版在 parse 時就依連線分層算好了;mermaid 自己的渲染器不吐可讀的節點座標,
    // 交給它只會把整張圖疊回原點。這裡不動位置(使用者拖到哪就是哪)。
    return scene;
  },
};

/** 顯式註冊(非 module side-effect)。 */
export function registerSankeyAdapter(): void {
  registerAdapter(sankeyAdapter);
}
