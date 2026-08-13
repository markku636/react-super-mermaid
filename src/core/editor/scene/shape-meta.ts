// 節點外形的顯示中繼資料(字形 + 中文名)。
//
// 刻意放在框架無關的 core:React 工具列與 VS Code webview 工具列先前各自硬寫一份 *flowchart*
// 外形清單,於是 class / er / state / mindmap 也被塞進「菱形 / 圓柱 / 梯形」這些它們根本無法
// 序列化的外形。單一真相 + adapter 能力(capabilities.shapes)驅動後,每種圖只會看到自己畫得出來的外形。

import type { NodeShape } from './types';

export interface ShapeMeta {
  /** 按鈕上的字形(單一字元,免圖檔)。 */
  glyph: string;
  /** 中文名(按鈕文字 / title)。 */
  label: string;
}

const META: Record<NodeShape, ShapeMeta> = {
  // flowchart
  rectangle: { glyph: '▭', label: '方框' },
  rounded: { glyph: '⬭', label: '圓角' },
  stadium: { glyph: '⬮', label: '膠囊' },
  subroutine: { glyph: '⧈', label: '子流程' },
  cylinder: { glyph: '⛁', label: '資料庫' },
  circle: { glyph: '◯', label: '圓形' },
  doubleCircle: { glyph: '◎', label: '雙圈' },
  diamond: { glyph: '◇', label: '菱形' },
  hexagon: { glyph: '⬡', label: '六角' },
  odd: { glyph: '⬠', label: '旗標' },
  trapezoid: { glyph: '⏢', label: '梯形' },
  trapezoidAlt: { glyph: '⏏', label: '梯形(倒)' },
  parallelogram: { glyph: '▱', label: '平行四邊形' },
  parallelogramAlt: { glyph: '▰', label: '平行四邊形(左)' },
  ellipse: { glyph: '⬭', label: '橢圓' },
  // state
  state: { glyph: '▢', label: '狀態' },
  stateStart: { glyph: '●', label: '起始' },
  stateEnd: { glyph: '◉', label: '結束' },
  fork: { glyph: '▬', label: '分岔/匯合' },
  choice: { glyph: '◈', label: '選擇' },
  // class / er / sequence
  classBox: { glyph: '🏷', label: '類別' },
  entity: { glyph: '▤', label: '實體' },
  actor: { glyph: '☻', label: '角色' },
  participant: { glyph: '▭', label: '參與者' },
  note: { glyph: '🗒', label: '筆記' },
  // 未模型化
  passthrough: { glyph: '▭', label: '原樣保留' },
};

export function shapeMeta(shape: NodeShape): ShapeMeta {
  return META[shape] ?? { glyph: '▭', label: shape };
}
