// flowchart 圖種 adapter。出貨唯一註冊的 adapter。

import { mermaidSvgLayout } from '../../layout/mermaid-svg-layout';
import type { LayoutEngine } from '../../layout/types';
import { flowDbToScene } from '../../round-trip/flowchart/parse';
import { sceneToFlowchart } from '../../round-trip/flowchart/serialize';
import type { EditorScene } from '../../scene/types';
import { registerAdapter } from '../registry';
import type { DiagramAdapter } from '../types';
import type { MermaidLike, MermaidSource } from '../../../../types';

export const flowchartAdapter: DiagramAdapter = {
  capabilities: {
    type: 'flowchart',
    shapes: [
      'rectangle',
      'rounded',
      'stadium',
      'subroutine',
      'cylinder',
      'circle',
      'doubleCircle',
      'diamond',
      'hexagon',
      'odd',
      'trapezoid',
      'trapezoidAlt',
      'parallelogram',
      'parallelogramAlt',
      'ellipse',
    ],
    arrowHeads: ['none', 'arrow', 'open', 'dot', 'cross'],
    lineKinds: ['solid', 'dotted', 'thick', 'invisible'],
    freeform: true,
    defaults: { nodeShape: 'rectangle', arrowEnd: 'arrow' },
  },
  keywords: ['flowchart', 'graph'],

  parse(text: string, mermaid: MermaidLike) {
    return flowDbToScene(text, mermaid);
  },

  serialize(scene: EditorScene) {
    return sceneToFlowchart(scene);
  },

  async layout(scene: EditorScene, engine: LayoutEngine, mermaid?: MermaidSource): Promise<EditorScene> {
    const code = sceneToFlowchart(scene).text;
    return engine.layout(scene, { code, mermaid });
  },
};

/** 顯式註冊(非 module side-effect,讓只用 flowchart 的 host 不被迫 bundle 其他 adapter)。 */
export function registerFlowchartAdapter(): void {
  registerAdapter(flowchartAdapter);
}

export { mermaidSvgLayout };
