// architecture-beta adapter(服務 / 群組 / 連線)。

import { registerAdapter } from '../registry';
import type { DiagramAdapter } from '../types';
import type { EditorScene } from '../../scene/types';
import type { LayoutEngine } from '../../layout/types';
import type { MermaidLike, MermaidSource } from '../../../../types';
import { architectureToScene, sceneToArchitecture } from '../../round-trip/architecture';

export const architectureAdapter: DiagramAdapter = {
  capabilities: {
    type: 'architecture',
    shapes: ['archNode'],
    arrowHeads: ['none', 'arrow'],
    lineKinds: ['solid'],
    freeform: true,
    defaults: { nodeShape: 'archNode', arrowEnd: 'none' },
  },
  keywords: ['architecture-beta', 'architecture'],

  parse(text: string, _mermaid: MermaidLike) {
    return Promise.resolve(architectureToScene(text));
  },

  serialize(scene: EditorScene) {
    return sceneToArchitecture(scene);
  },

  async layout(scene: EditorScene, engine: LayoutEngine, mermaid?: MermaidSource): Promise<EditorScene> {
    // mermaid 的 architecture 渲染器不吐可讀的節點座標,排版會落到引擎內建的分組格狀後援。
    const code = sceneToArchitecture(scene).text;
    return engine.layout(scene, { code, mermaid });
  },
};

/** 顯式註冊(非 module side-effect)。 */
export function registerArchitectureAdapter(): void {
  registerAdapter(architectureAdapter);
}
