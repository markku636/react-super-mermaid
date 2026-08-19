// ORID 的語意配色與 CSS 類名 —— 轉譯器(產生 classDef)與 colorful 後處理上色器
// (在 SVG 上重畫)兩邊共用的單一真相。
//
// 色相是刻意選的,不是輪播調色盤:
//   O 客觀事實 → 藍(冷靜、可查證的事實)
//   R 感受反應 → 橘(情緒溫度)
//   I 意義詮釋 → 紫(洞察)
//   D 決定行動 → 綠(GO、往前走)
// 四段一眼分得出來,而且顏色本身就在講 ORID 的推進節奏。

import type { OridStageKey } from './model';

export interface OridPaletteEntry {
  /** 項目方塊的底色 / 邊框。 */
  itemFill: string;
  itemStroke: string;
  /** 階段容器(subgraph)的底色 / 邊框。 */
  stageFill: string;
  stageStroke: string;
  /** 深色主題下的項目底色(colorful 後處理用;classDef 走淺色版即可)。 */
  itemFillDark: string;
  stageFillDark: string;
}

/** 項目方塊在淺色底上的文字色(對齊 colorize 的 NODE_TEXT)。 */
export const ORID_ITEM_TEXT = '#1F2937';

export const ORID_PALETTE: Record<OridStageKey, OridPaletteEntry> = {
  objective: {
    itemFill: '#DBEAFE',
    itemStroke: '#3B82F6',
    stageFill: '#3B82F61F',
    stageStroke: '#3B82F6',
    itemFillDark: '#1E3A5F',
    stageFillDark: '#3B82F633',
  },
  reflective: {
    itemFill: '#FFEDD5',
    itemStroke: '#F97316',
    stageFill: '#F973161F',
    stageStroke: '#F97316',
    itemFillDark: '#5C3211',
    stageFillDark: '#F9731633',
  },
  interpretive: {
    itemFill: '#F3E8FF',
    itemStroke: '#A855F7',
    stageFill: '#A855F71F',
    stageStroke: '#A855F7',
    itemFillDark: '#432069',
    stageFillDark: '#A855F733',
  },
  decisional: {
    itemFill: '#DCFCE7',
    itemStroke: '#22C55E',
    stageFill: '#22C55E1F',
    stageStroke: '#22C55E',
    itemFillDark: '#14432A',
    stageFillDark: '#22C55E33',
  },
};

/** 階段代號字母(節點 id 前綴 / CSS 類名字尾):objective → O。 */
export const ORID_LETTER: Record<OridStageKey, string> = {
  objective: 'O',
  reflective: 'R',
  interpretive: 'I',
  decisional: 'D',
};

/** 項目方塊的 CSS 類名(mermaid `:::className` → SVG g.node 的 class)。 */
export const oridItemClass = (key: OridStageKey): string => `oridItem${ORID_LETTER[key]}`;
/** 階段容器的 CSS 類名(mermaid `class ORID_O oridStageO` → SVG g.cluster 的 class)。 */
export const oridStageClass = (key: OridStageKey): string => `oridStage${ORID_LETTER[key]}`;

/** 空階段的佔位方塊類名(虛線、淡色,提醒「這段還沒填」)。 */
export const ORID_EMPTY_CLASS = 'oridEmpty';
/** 空階段佔位方塊的文字。 */
export const ORID_EMPTY_LABEL = '（待填）';

/** 由 SVG 上的 class 反查階段;非 ORID 類名回 undefined(colorful 後處理用)。 */
export function oridStageFromClassList(classes: DOMTokenList | string[]): OridStageKey | undefined {
  const list = Array.isArray(classes) ? classes : Array.from(classes);
  for (const key of Object.keys(ORID_PALETTE) as OridStageKey[]) {
    if (list.includes(oridItemClass(key)) || list.includes(oridStageClass(key))) return key;
  }
  return undefined;
}
