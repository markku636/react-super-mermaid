// packet-beta adapter(拉右緣改欄位佔幾個 bit;左右拖改順序)。

import { registerAdapter } from '../registry';
import type { DiagramAdapter } from '../types';
import type { EditorScene } from '../../scene/types';
import type { LayoutEngine } from '../../layout/types';
import type { MermaidLike, MermaidSource } from '../../../../types';
import { layoutPacket, packetToScene, sceneToPacket } from '../../round-trip/packet';

export const packetAdapter: DiagramAdapter = {
  capabilities: {
    type: 'packet',
    shapes: ['packetField'],
    arrowHeads: ['none'],
    lineKinds: ['solid'],
    supportsEdges: false,
    freeform: true,
    defaults: { nodeShape: 'packetField', arrowEnd: 'none' },
  },
  keywords: ['packet-beta', 'packet'],

  parse(text: string, _mermaid: MermaidLike) {
    return Promise.resolve(packetToScene(text));
  },

  serialize(scene: EditorScene) {
    return sceneToPacket(scene);
  },

  async layout(scene: EditorScene, _engine: LayoutEngine, _mermaid?: MermaidSource): Promise<EditorScene> {
    return layoutPacket(scene);
  },
};

/** 顯式註冊(非 module side-effect)。 */
export function registerPacketAdapter(): void {
  registerAdapter(packetAdapter);
}
