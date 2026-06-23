// erDiagram 圖種 adapter。

import { mermaidSvgLayout } from '../../layout/mermaid-svg-layout';
import type { LayoutEngine } from '../../layout/types';
import { erDbToScene } from '../../round-trip/er/parse';
import { sceneToEr } from '../../round-trip/er/serialize';
import type { EditorScene } from '../../scene/types';
import { registerAdapter } from '../registry';
import type { DiagramAdapter } from '../types';
import type { MermaidLike, MermaidSource } from '../../../../types';

export const erAdapter: DiagramAdapter = {
  capabilities: {
    type: 'er',
    shapes: ['entity'],
    arrowHeads: ['none', 'crowFootOne', 'crowFootMany'],
    lineKinds: ['solid', 'dotted'],
    freeform: true,
    defaults: { nodeShape: 'entity', arrowEnd: 'none' },
  },
  keywords: ['erdiagram'],

  parse(text: string, mermaid: MermaidLike) {
    return erDbToScene(text, mermaid);
  },

  serialize(scene: EditorScene) {
    return sceneToEr(scene);
  },

  async layout(scene: EditorScene, engine: LayoutEngine, mermaid?: MermaidSource): Promise<EditorScene> {
    const code = sceneToEr(scene).text;
    return engine.layout(scene, { code, mermaid });
  },
};

/** 顯式註冊(非 module side-effect)。 */
export function registerErAdapter(): void {
  registerAdapter(erAdapter);
}
