// user journey adapter(把任務拖到別的 section = 改它的階段)。

import { registerAdapter } from '../registry';
import type { DiagramAdapter } from '../types';
import type { EditorScene } from '../../scene/types';
import type { LayoutEngine } from '../../layout/types';
import type { MermaidLike, MermaidSource } from '../../../../types';
import { journeyToScene, sceneToJourney } from '../../round-trip/journey';
import { layoutLanes } from '../../layout/lanes';

export const journeyAdapter: DiagramAdapter = {
  capabilities: {
    type: 'journey',
    shapes: ['journeyTask'],
    arrowHeads: ['none'],
    lineKinds: ['solid'],
    freeform: true,
    defaults: { nodeShape: 'journeyTask', arrowEnd: 'none' },
  },
  keywords: ['journey'],

  parse(text: string, _mermaid: MermaidLike) {
    return Promise.resolve(journeyToScene(text));
  },

  serialize(scene: EditorScene) {
    return sceneToJourney(scene);
  },

  async layout(scene: EditorScene, _engine: LayoutEngine, _mermaid?: MermaidSource): Promise<EditorScene> {
    return layoutLanes(scene);
  },
};

/** 顯式註冊(非 module side-effect)。 */
export function registerJourneyAdapter(): void {
  registerAdapter(journeyAdapter);
}
