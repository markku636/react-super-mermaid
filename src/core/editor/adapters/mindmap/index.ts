// mindmap 圖種 adapter。

import type { LayoutEngine } from '../../layout/types';
import { mindmapToScene } from '../../round-trip/mindmap/parse';
import { sceneToMindmap } from '../../round-trip/mindmap/serialize';
import type { EditorScene, SceneNode } from '../../scene/types';
import { registerAdapter } from '../registry';
import type { DiagramAdapter } from '../types';
import type { MermaidLike, MermaidSource } from '../../../../types';

/** mindmap 專屬樹狀排版(mermaid 的 mindmap g.node 抓不到座標,改自算):
 *  左→右依深度排 x,葉節點依序佔 y,父節點 y = 子節點 y 中點。 */
function treeLayout(scene: EditorScene): EditorScene {
  const kids = new Map<string, string[]>();
  for (const n of [...scene.nodes].sort(
    (a, b) => (a.sourceIndex ?? 0) - (b.sourceIndex ?? 0),
  )) {
    if (n.parentId) {
      const arr = kids.get(n.parentId) ?? [];
      arr.push(n.id);
      kids.set(n.parentId, arr);
    }
  }
  const byId = new Map(scene.nodes.map((n) => [n.id, n] as const));
  const pos = new Map<string, { x: number; y: number }>();
  const X_GAP = 210;
  const Y_GAP = 62;
  let leaf = 0;
  const assign = (id: string, depth: number): number => {
    const ch = kids.get(id) ?? [];
    const x = depth * X_GAP + 40;
    if (ch.length === 0) {
      const y = leaf * Y_GAP + 40;
      leaf += 1;
      pos.set(id, { x, y });
      return y;
    }
    const ys = ch.map((c) => assign(c, depth + 1));
    const y = (ys[0] + ys[ys.length - 1]) / 2;
    pos.set(id, { x, y });
    return y;
  };
  for (const n of scene.nodes) if (!n.parentId) assign(n.id, 0);
  const nodes: SceneNode[] = scene.nodes.map((n) => {
    const p = pos.get(n.id);
    return p && byId.has(n.id) ? { ...n, x: p.x, y: p.y } : n;
  });
  return { ...scene, nodes, layoutOwner: 'user' };
}

export const mindmapAdapter: DiagramAdapter = {
  capabilities: {
    type: 'mindmap',
    shapes: ['rounded', 'rectangle', 'circle', 'hexagon', 'ellipse'],
    arrowHeads: ['none'],
    lineKinds: ['solid'],
    freeform: true,
    defaults: { nodeShape: 'rounded', arrowEnd: 'none' },
  },
  keywords: ['mindmap'],

  parse(text: string, mermaid: MermaidLike) {
    return mindmapToScene(text, mermaid);
  },

  serialize(scene: EditorScene) {
    return sceneToMindmap(scene);
  },

  // mindmap 自算樹狀排版(不依賴 mermaid SVG scrape)。
  async layout(scene: EditorScene, _engine: LayoutEngine, _mermaid?: MermaidSource): Promise<EditorScene> {
    return treeLayout(scene);
  },
};

/** 顯式註冊(非 module side-effect)。 */
export function registerMindmapAdapter(): void {
  registerAdapter(mindmapAdapter);
}
