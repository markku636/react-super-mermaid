// 排版引擎介面。匯入的圖只有拓樸沒有座標 → 交給 LayoutEngine 填幾何。
// 預設實作(mermaid-svg-layout)重用既有 render-pipeline 抓 mermaid 自身排版座標。

import type { MermaidSource } from '../../../types';
import type { EditorScene, FlowDirection } from '../scene/types';

export interface LayoutContext {
  /** 如何取得 mermaid(預設實作渲染抓座標時需要)。 */
  mermaid?: MermaidSource;
  /** 此場景序列化後的 mermaid 文字(adapter 提供;svg-scrape 引擎據此渲染抓座標)。 */
  code: string;
  direction?: FlowDirection;
  nodeSpacing?: number;
  rankSpacing?: number;
}

export interface LayoutEngine {
  /** 回傳每個 node/container 都有 x/y/w/h、每條 edge(可)有 waypoints 的新場景。 */
  layout(scene: EditorScene, ctx: LayoutContext): Promise<EditorScene>;
}
