// requirementDiagram adapter(需求 / 元素 + 七種追溯關係)。

import { registerAdapter } from '../registry';
import type { DiagramAdapter } from '../types';
import type { EditorScene } from '../../scene/types';
import type { LayoutEngine } from '../../layout/types';
import type { MermaidLike, MermaidSource } from '../../../../types';
import { requirementDbToScene } from '../../round-trip/requirement/parse';
import { sceneToRequirement } from '../../round-trip/requirement/serialize';

export const requirementAdapter: DiagramAdapter = {
  capabilities: {
    type: 'requirement',
    // 需求框與元素框是兩種不同的東西(不是外形變體),所以兩個都攤在工具列上。
    shapes: ['requirementBox', 'elementBox'],
    // 關係種類(contains / satisfies / …)不是箭頭樣式,由右鍵選單切換,故這裡只有一種箭頭。
    arrowHeads: ['arrow'],
    lineKinds: ['solid'],
    freeform: true,
    defaults: { nodeShape: 'requirementBox', arrowEnd: 'arrow' },
  },
  keywords: ['requirementdiagram'],

  parse(text: string, mermaid: MermaidLike) {
    return requirementDbToScene(text, mermaid);
  },

  serialize(scene: EditorScene) {
    return sceneToRequirement(scene);
  },

  async layout(scene: EditorScene, engine: LayoutEngine, mermaid?: MermaidSource): Promise<EditorScene> {
    const code = sceneToRequirement(scene).text;
    return engine.layout(scene, { code, mermaid });
  },
};

/** 顯式註冊(非 module side-effect)。 */
export function registerRequirementAdapter(): void {
  registerAdapter(requirementAdapter);
}
