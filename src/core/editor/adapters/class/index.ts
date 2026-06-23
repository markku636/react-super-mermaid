// classDiagram 圖種 adapter。

import { mermaidSvgLayout } from '../../layout/mermaid-svg-layout';
import type { LayoutEngine } from '../../layout/types';
import { classDbToScene } from '../../round-trip/class/parse';
import { sceneToClass } from '../../round-trip/class/serialize';
import type { EditorScene } from '../../scene/types';
import { registerAdapter } from '../registry';
import type { DiagramAdapter } from '../types';
import type { MermaidLike, MermaidSource } from '../../../../types';

export const classAdapter: DiagramAdapter = {
  capabilities: {
    type: 'class',
    shapes: ['classBox'],
    arrowHeads: ['none', 'triangle', 'diamond', 'diamondFilled', 'open'],
    lineKinds: ['solid', 'dotted'],
    freeform: true,
    defaults: { nodeShape: 'classBox', arrowEnd: 'none' },
  },
  keywords: ['classdiagram', 'classdiagram-v2'],

  parse(text: string, mermaid: MermaidLike) {
    return classDbToScene(text, mermaid);
  },

  serialize(scene: EditorScene) {
    return sceneToClass(scene);
  },

  async layout(scene: EditorScene, engine: LayoutEngine, mermaid?: MermaidSource): Promise<EditorScene> {
    const code = sceneToClass(scene).text;
    return engine.layout(scene, { code, mermaid });
  },
};

/** 顯式註冊(非 module side-effect)。 */
export function registerClassAdapter(): void {
  registerAdapter(classAdapter);
}
