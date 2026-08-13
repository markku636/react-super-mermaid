// gitGraph adapter(橫拖 = 改提交順序;縱拖到別條泳道 = 換分支)。

import { registerAdapter } from '../registry';
import type { DiagramAdapter } from '../types';
import type { EditorScene } from '../../scene/types';
import type { LayoutEngine } from '../../layout/types';
import type { MermaidLike, MermaidSource } from '../../../../types';
import { gitgraphDbToScene, layoutGitgraph, sceneToGitgraph } from '../../round-trip/gitgraph';

export const gitgraphAdapter: DiagramAdapter = {
  capabilities: {
    type: 'gitgraph',
    shapes: ['gitCommit'],
    arrowHeads: ['none'],
    lineKinds: ['solid'],
    // 連線 = 父子關係,而父子關係是從順序推導的,不能單獨畫。
    supportsEdges: false,
    freeform: true,
    defaults: { nodeShape: 'gitCommit', arrowEnd: 'none' },
  },
  keywords: ['gitGraph', 'gitgraph'],

  parse(text: string, mermaid: MermaidLike) {
    return gitgraphDbToScene(text, mermaid);
  },

  serialize(scene: EditorScene) {
    return sceneToGitgraph(scene);
  },

  async layout(scene: EditorScene, _engine: LayoutEngine, _mermaid?: MermaidSource): Promise<EditorScene> {
    return layoutGitgraph(scene);
  },
};

/** 顯式註冊(非 module side-effect)。 */
export function registerGitgraphAdapter(): void {
  registerAdapter(gitgraphAdapter);
}
