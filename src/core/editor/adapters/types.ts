// 圖種轉接器契約。每種 mermaid 圖一個 adapter,負責 parse / serialize / layout。
// adapter 為純資料物件(非 class)以利 tree-shake;host 只 bundle 它 import 的 adapter。

import type { LayoutEngine } from '../layout/types';
import type {
  ArrowHead,
  DiagramType,
  EditorScene,
  LineKind,
  NodeShape,
} from '../scene/types';
import type { MermaidLike, MermaidSource } from '../../../types';

export interface DiagramCapabilities {
  type: DiagramType;
  /** 此圖種支援的節點外形(供工具列 shape 選單)。 */
  shapes: NodeShape[];
  arrowHeads: ArrowHead[];
  lineKinds: LineKind[];
  /** 節點可自由拖曳(flowchart=true)?或由引擎排版(sequence=false)? */
  freeform: boolean;
  defaults: { nodeShape: NodeShape; arrowEnd: ArrowHead };
}

export interface ParseWarning {
  message: string;
  /** 原始碼行號(若可定位)。 */
  line?: number;
}

export interface DataLossWarning {
  message: string;
  elementId?: string;
}

export interface ParseResult {
  scene: EditorScene;
  warnings: ParseWarning[];
}

export interface SerializeResult {
  text: string;
  warnings: DataLossWarning[];
}

export interface DiagramAdapter {
  capabilities: DiagramCapabilities;
  /** 小寫首關鍵字(detectDiagramType 比對用),如 ['flowchart','graph']。 */
  keywords: string[];
  /**
   * mermaid 文字 → 場景。需要 DOM(透過 mermaid 解析),故 async + browser-scoped。
   * 失敗時應降級並回傳可編輯骨架 + warnings,而非拋例外。
   */
  parse(text: string, mermaid: MermaidLike): Promise<ParseResult>;
  /** 場景 → mermaid 文字。純函式、同步、必須永遠輸出合法 mermaid。 */
  serialize(scene: EditorScene): SerializeResult;
  /** 為缺座標的場景(匯入)填入 x/y/w/h + edge waypoints。mermaid 供排版引擎渲染抓座標。 */
  layout(scene: EditorScene, engine: LayoutEngine, mermaid?: MermaidSource): Promise<EditorScene>;
}
