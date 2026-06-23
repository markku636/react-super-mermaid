// stateDiagram(-v2) 圖種 adapter。

import { mermaidSvgLayout } from '../../layout/mermaid-svg-layout';
import type { LayoutEngine } from '../../layout/types';
import { stateDbToScene } from '../../round-trip/state/parse';
import { sceneToState } from '../../round-trip/state/serialize';
import type { EditorScene } from '../../scene/types';
import { registerAdapter } from '../registry';
import type { DiagramAdapter } from '../types';
import type { MermaidLike, MermaidSource } from '../../../../types';

export const stateAdapter: DiagramAdapter = {
  capabilities: {
    type: 'state',
    shapes: ['state', 'stateStart', 'stateEnd', 'choice', 'fork'],
    arrowHeads: ['arrow', 'none'],
    lineKinds: ['solid', 'dotted'],
    freeform: true,
    defaults: { nodeShape: 'state', arrowEnd: 'arrow' },
  },
  keywords: ['statediagram', 'statediagram-v2'],

  parse(text: string, mermaid: MermaidLike) {
    return stateDbToScene(text, mermaid);
  },

  serialize(scene: EditorScene) {
    return sceneToState(scene);
  },

  async layout(scene: EditorScene, engine: LayoutEngine, mermaid?: MermaidSource): Promise<EditorScene> {
    const code = sceneToState(scene).text;
    return engine.layout(scene, { code, mermaid });
  },
};

/** 顯式註冊(非 module side-effect)。 */
export function registerStateAdapter(): void {
  registerAdapter(stateAdapter);
}
