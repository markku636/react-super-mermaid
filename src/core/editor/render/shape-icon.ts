// 外形按鈕的迷你圖示(inline SVG 標記)。
//
// 為什麼不用字形:工具列原本靠 ⬭ ⬡ ⛁ 🏷 這類字元當縮圖,但這些字元在多數系統 UI 字型裡沒有字身,
// 實際畫面上「圓角 / 橢圓 / 六角」三顆按鈕全都退化成同一個圓圈,類別 🏷 更是縮成一個小點。
// 改成自己畫的 SVG:每個外形長什麼樣一眼可辨,而且跨平台一致。
//
// 回傳的是字串而不是元素,好讓 React 工具列(dangerouslySetInnerHTML)與 VS Code webview
// 工具列(innerHTML)共用同一份 —— 內容全是常數,沒有任何使用者輸入。

import type { NodeShape } from '../scene/types';

const W = 24;
const H = 16;

/** 共用描邊屬性:顏色跟著按鈕文字走,縮放時線寬不變。 */
const S = 'fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"';
const FILL = 'fill="currentColor" stroke="none"';

function body(shape: NodeShape): string {
  switch (shape) {
    case 'rounded':
      return `<rect x="2" y="3" width="20" height="10" rx="4" ${S}/>`;
    case 'stadium':
      return `<rect x="2" y="3" width="20" height="10" rx="5" ${S}/>`;
    case 'subroutine':
      return `<rect x="2" y="3" width="20" height="10" ${S}/><path d="M6 3v10M18 3v10" ${S}/>`;
    case 'cylinder':
      return `<path d="M3 5v6a9 2.5 0 0 0 18 0V5" ${S}/><ellipse cx="12" cy="5" rx="9" ry="2.5" ${S}/>`;
    case 'circle':
      return `<circle cx="12" cy="8" r="6" ${S}/>`;
    case 'doubleCircle':
      return `<circle cx="12" cy="8" r="6.4" ${S}/><circle cx="12" cy="8" r="3.8" ${S}/>`;
    case 'diamond':
      return `<path d="M12 2l9 6-9 6-9-6z" ${S}/>`;
    case 'hexagon':
      return `<path d="M7 3h10l4 5-4 5H7L3 8z" ${S}/>`;
    case 'odd':
      return `<path d="M3 3h18v10H3l3-5z" ${S}/>`;
    case 'trapezoid':
      return `<path d="M6 3h12l4 10H2z" ${S}/>`;
    case 'trapezoidAlt':
      return `<path d="M2 3h20l-4 10H6z" ${S}/>`;
    case 'parallelogram':
      return `<path d="M6 3h16l-4 10H2z" ${S}/>`;
    case 'parallelogramAlt':
      return `<path d="M2 3h16l4 10H6z" ${S}/>`;
    case 'ellipse':
      return `<ellipse cx="12" cy="8" rx="10" ry="5.5" ${S}/>`;
    // ── state ──
    case 'state':
      return `<rect x="2" y="3" width="20" height="10" rx="3" ${S}/>`;
    case 'stateStart':
      return `<circle cx="12" cy="8" r="5" ${FILL}/>`;
    case 'stateEnd':
      return `<circle cx="12" cy="8" r="6" ${S}/><circle cx="12" cy="8" r="3.2" ${FILL}/>`;
    case 'fork':
      return `<rect x="2" y="6.5" width="20" height="3.5" rx="1" ${FILL}/>`;
    case 'choice':
      return `<path d="M12 2l7 6-7 6-7-6z" ${S}/>`;
    // ── class / er / sequence ──
    case 'classBox':
      return `<rect x="3" y="2" width="18" height="12" rx="1" ${S}/><path d="M3 6h18" ${S}/><path d="M6 9.5h9M6 11.8h6" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" opacity="0.65"/>`;
    case 'entity':
      return `<rect x="3" y="2" width="18" height="12" rx="1" ${S}/><path d="M3 6h18M3 10h18" ${S}/>`;
    case 'actor':
      return `<circle cx="12" cy="4" r="2.2" ${S}/><path d="M12 6.5v4.5M8.5 8h7M12 11l-2.5 3M12 11l2.5 3" ${S} stroke-linecap="round"/>`;
    case 'participant':
      return `<rect x="3" y="4" width="18" height="8" rx="1" ${S}/>`;
    case 'note':
      return `<path d="M4 2h11l5 5v9H4z" ${S}/><path d="M15 2v5h5" ${S}/>`;
    // ── requirement ──
    case 'requirementBox':
      return `<rect x="3" y="2" width="18" height="12" rx="1" ${S}/><path d="M3 7h18" ${S}/><path d="M6 10h12" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" opacity="0.65"/>`;
    case 'elementBox':
      return `<rect x="3" y="2" width="18" height="12" rx="1" stroke-dasharray="3 2" ${S}/><path d="M3 7h18" ${S}/>`;
    case 'point':
      return `<path d="M12 2v12M6 8h12" stroke="currentColor" stroke-width="1" opacity="0.45"/><circle cx="15" cy="5.5" r="3" ${FILL}/>`;
    // ── C4 ──
    case 'c4Person':
      return `<circle cx="12" cy="4" r="2.6" ${S}/><rect x="4" y="7.5" width="16" height="7" rx="1.5" ${S}/>`;
    case 'c4Box':
      return `<rect x="3" y="3" width="18" height="10" rx="1.5" ${S}/><path d="M6 6.5h8" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" opacity="0.6"/>`;
    case 'c4Db':
      return `<path d="M4 5v6a8 2.2 0 0 0 16 0V5" ${S}/><ellipse cx="12" cy="5" rx="8" ry="2.2" ${S}/>`;
    case 'c4Queue':
      return `<rect x="3" y="4" width="18" height="8" rx="4" ${S}/><path d="M9 4v8M15 4v8" stroke="currentColor" stroke-width="1.1" opacity="0.6"/>`;
    case 'sankeyNode':
      return `<rect x="3" y="2" width="4" height="12" rx="1" ${FILL}/><path d="M8 6h9" stroke="currentColor" stroke-width="3.4" opacity="0.5" stroke-linecap="round"/><path d="M8 11h6" stroke="currentColor" stroke-width="1.8" opacity="0.5" stroke-linecap="round"/><rect x="18" y="2" width="3" height="12" rx="1" ${FILL}/>`;
    case 'xyPoint':
      return `<path d="M3 14V2M3 14h18" stroke="currentColor" stroke-width="1.2" opacity="0.5" fill="none"/><path d="M6 11l4-4 4 3 5-6" ${S}/>`;
    case 'pieSlice':
      return `<circle cx="12" cy="8" r="6" ${S}/><path d="M12 8 L12 2 A6 6 0 0 1 17.2 11 Z" ${FILL}/>`;
    case 'ganttBar':
      return `<rect x="2" y="4" width="11" height="3.5" rx="1.5" ${FILL}/><rect x="7" y="9" width="14" height="3.5" rx="1.5" ${FILL}/>`;
    case 'journeyTask':
    case 'kanbanCard':
      return `<rect x="3" y="3" width="18" height="10" rx="2" ${S}/><rect x="3" y="3" width="2.6" height="10" rx="1" ${FILL}/><path d="M9 6.5h9M9 9.5h6" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" opacity="0.6"/>`;
    case 'rectangle':
    default:
      return `<rect x="2" y="3" width="20" height="10" ${S}/>`;
  }
}

/** 某個外形的迷你 SVG 圖示標記(24×16,顏色沿用 currentColor)。 */
export function shapeIconMarkup(shape: NodeShape): string {
  return `<svg class="rsm-shape-icon" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true" focusable="false">${body(shape)}</svg>`;
}
