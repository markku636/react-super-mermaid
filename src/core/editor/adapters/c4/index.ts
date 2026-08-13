// C4 圖 adapter(Context / Container / Component;人物、系統、容器、元件與邊界)。

import { registerAdapter } from '../registry';
import type { DiagramAdapter } from '../types';
import type { EditorScene } from '../../scene/types';
import type { LayoutEngine } from '../../layout/types';
import type { MermaidLike, MermaidSource } from '../../../../types';
import { c4DbToScene } from '../../round-trip/c4/parse';
import { sceneToC4 } from '../../round-trip/c4/serialize';

export const c4Adapter: DiagramAdapter = {
  capabilities: {
    type: 'c4',
    shapes: ['c4Person', 'c4Box', 'c4Db', 'c4Queue'],
    // C4 的關係只有 Rel / BiRel 與方向變體,箭頭樣式不是使用者要選的東西。
    arrowHeads: ['arrow'],
    lineKinds: ['solid'],
    freeform: true,
    defaults: { nodeShape: 'c4Box', arrowEnd: 'arrow' },
  },
  keywords: ['c4context', 'c4container', 'c4component', 'c4dynamic', 'c4deployment'],

  parse(text: string, mermaid: MermaidLike) {
    return c4DbToScene(text, mermaid);
  },

  serialize(scene: EditorScene) {
    return sceneToC4(scene);
  },

  async layout(scene: EditorScene, engine: LayoutEngine, mermaid?: MermaidSource): Promise<EditorScene> {
    const code = sceneToC4(scene).text;
    return engine.layout(scene, { code, mermaid });
  },
};

/** 顯式註冊(非 module side-effect)。 */
export function registerC4Adapter(): void {
  registerAdapter(c4Adapter);
}
