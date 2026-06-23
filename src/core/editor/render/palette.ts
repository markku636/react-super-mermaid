// 編輯畫布配色 —— 與「Edit Diagram」(Colorful 主題,core/themes/colorize.ts)**完全對齊**:
// 同一組顏色 + 同一順序。Colorful 依節點 DOM 順序取 NODE_PALETTE[i%8],本編輯器依場景節點
// 順序 paletteByIndex(i),兩者順序一致 → 同一節點在 Draw 與 Edit Diagram 得到相同顏色。

export interface PaletteEntry {
  fill: string;
  stroke: string;
}

export const NODE_PALETTE: PaletteEntry[] = [
  { fill: '#DBEAFE', stroke: '#3B82F6' }, // blue
  { fill: '#DCFCE7', stroke: '#22C55E' }, // green
  { fill: '#FFEDD5', stroke: '#F97316' }, // orange
  { fill: '#F3E8FF', stroke: '#A855F7' }, // purple
  { fill: '#FEE2E2', stroke: '#EF4444' }, // red
  { fill: '#CFFAFE', stroke: '#06B6D4' }, // cyan
  { fill: '#FEF9C3', stroke: '#EAB308' }, // yellow
  { fill: '#EDE9FE', stroke: '#8B5CF6' }, // violet
];

// 叢集 / subgraph 底色(對齊 colorize.ts CLUSTER_PALETTE:同色相、16% 濃度)。
export const CLUSTER_PALETTE: PaletteEntry[] = [
  { fill: 'rgba(59, 130, 246, 0.16)', stroke: '#3B82F6' },
  { fill: 'rgba(34, 197, 94, 0.16)', stroke: '#22C55E' },
  { fill: 'rgba(249, 115, 22, 0.16)', stroke: '#F97316' },
  { fill: 'rgba(168, 85, 247, 0.16)', stroke: '#A855F7' },
  { fill: 'rgba(239, 68, 68, 0.16)', stroke: '#EF4444' },
  { fill: 'rgba(6, 182, 212, 0.16)', stroke: '#06B6D4' },
  { fill: 'rgba(234, 179, 8, 0.16)', stroke: '#EAB308' },
  { fill: 'rgba(139, 92, 246, 0.16)', stroke: '#8B5CF6' },
];

// 文字色對齊 colorize.ts NODE_TEXT。
export const INK = '#1F2937';
export const INK_DARK = '#e9ecef';

/** 依容器順序取叢集底色(對齊 Edit Diagram 的 subgraph 上色)。 */
export function clusterByIndex(i: number): PaletteEntry {
  const n = CLUSTER_PALETTE.length;
  return CLUSTER_PALETTE[((i % n) + n) % n];
}

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
