// 編輯畫布的手繪配色(Excalidraw Open Color 元素底色 + 對應描邊),
// 與 sketch 主題視覺一致。依節點 id 雜湊穩定取色,改動不變色。

export interface PaletteEntry {
  fill: string;
  stroke: string;
}

export const NODE_PALETTE: PaletteEntry[] = [
  { fill: '#a5d8ff', stroke: '#1971c2' }, // blue
  { fill: '#b2f2bb', stroke: '#2f9e44' }, // green
  { fill: '#ffd8a8', stroke: '#e8590c' }, // orange
  { fill: '#d0bfff', stroke: '#6741d9' }, // violet
  { fill: '#99e9f2', stroke: '#0c8599' }, // cyan
  { fill: '#ffc9c9', stroke: '#e03131' }, // red
  { fill: '#ffec99', stroke: '#f08c00' }, // yellow
  { fill: '#eebefa', stroke: '#9c36b5' }, // grape
];

export const INK = '#1e1e1e';
export const INK_DARK = '#e9ecef';

/** 字串 → 32-bit 雜湊(取色 / 取 seed 用,穩定且確定性)。 */
export function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}

export function paletteFor(id: string): PaletteEntry {
  return NODE_PALETTE[hashStr(id) % NODE_PALETTE.length];
}

/** 依節點順序(非雜湊)循序取色 → 相鄰節點色彩和諧,不像 hash 那樣亂跳。 */
export function paletteByIndex(i: number): PaletteEntry {
  const n = NODE_PALETTE.length;
  return NODE_PALETTE[((i % n) + n) % n];
}

export function seedFor(id: string, base: number): number {
  return (hashStr(id) ^ base) >>> 0;
}
