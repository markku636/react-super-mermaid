// sequenceDiagram 圖種 adapter。注意:互動是「時間序」(非自由拖曳),渲染為專屬路徑。
// 目前資料層(parse/serialize)完成且無損;layout 暫 passthrough(渲染器階段再補)。

import type { LayoutEngine } from '../../layout/types';
import { sequenceToScene } from '../../round-trip/sequence/parse';
import { sceneToSequence } from '../../round-trip/sequence/serialize';
import type { EditorScene } from '../../scene/types';
import { registerAdapter } from '../registry';
import type { DiagramAdapter } from '../types';
import type { MermaidLike, MermaidSource } from '../../../../types';

export const sequenceAdapter: DiagramAdapter = {
  capabilities: {
    type: 'sequence',
    shapes: ['participant', 'actor'],
    arrowHeads: ['arrow', 'open'],
    lineKinds: ['solid', 'dotted'],
    freeform: false,
    defaults: { nodeShape: 'participant', arrowEnd: 'arrow' },
  },
  keywords: ['sequencediagram'],

  parse(text: string, mermaid: MermaidLike) {
    return sequenceToScene(text, mermaid);
  },

  serialize(scene: EditorScene) {
    return sceneToSequence(scene);
  },

  async layout(scene: EditorScene, _engine: LayoutEngine, _mermaid?: MermaidSource): Promise<EditorScene> {
    return scene; // 時間序專屬排版於渲染器階段處理。
  },
};

/** 顯式註冊(非 module side-effect)。 */
export function registerSequenceAdapter(): void {
  registerAdapter(sequenceAdapter);
}
