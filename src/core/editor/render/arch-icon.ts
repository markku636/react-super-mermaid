// architecture-beta 的服務圖示。
//
// 為什麼是自己畫的:mermaid 那邊靠 iconify 圖庫,離線的擴充包不該為了五個圖示多背一份圖庫。
// 這裡用手寫路徑覆蓋 mermaid 內建的五種(cloud / database / disk / server / internet),
// 其餘名稱回落到首字母 —— 至少還看得出是不同的東西。
//
// 座標一律以 24×24 描述,由呼叫端縮放到節點大小。

import { svgEl } from './dom';

/** 24×24 座標系下的圖示;stroke 用呼叫端給的顏色。 */
type IconDraw = (color: string) => SVGElement[];

const stroke = (d: string, color: string, width = 1.6): SVGElement =>
  svgEl('path', {
    d,
    fill: 'none',
    stroke: color,
    'stroke-width': width,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
  });

const ICONS: Record<string, IconDraw> = {
  cloud: (c) => [
    stroke('M7 18h10.5a3.5 3.5 0 0 0 .3-6.99A5.5 5.5 0 0 0 7.4 9.6 3.7 3.7 0 0 0 7 18Z', c),
  ],
  database: (c) => [
    stroke('M4.5 6.5c0-1.4 3.4-2.5 7.5-2.5s7.5 1.1 7.5 2.5-3.4 2.5-7.5 2.5S4.5 7.9 4.5 6.5Z', c),
    stroke('M4.5 6.5v11c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5v-11', c),
    stroke('M4.5 12c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5', c, 1.2),
  ],
  disk: (c) => [
    stroke('M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v11a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5Z', c),
    stroke('M12 8.6a3.4 3.4 0 1 1 0 6.8 3.4 3.4 0 0 1 0-6.8Z', c, 1.3),
    svgEl('circle', { cx: 12, cy: 12, r: 1.1, fill: c, stroke: 'none' }),
  ],
  server: (c) => [
    stroke('M4 5.2h16v5.2H4Z', c),
    stroke('M4 13.4h16v5.2H4Z', c),
    svgEl('circle', { cx: 7, cy: 7.8, r: 1, fill: c, stroke: 'none' }),
    svgEl('circle', { cx: 7, cy: 16, r: 1, fill: c, stroke: 'none' }),
    stroke('M10.5 7.8h6M10.5 16h6', c, 1.2),
  ],
  internet: (c) => [
    stroke('M12 3.6a8.4 8.4 0 1 1 0 16.8 8.4 8.4 0 0 1 0-16.8Z', c),
    stroke('M3.6 12h16.8', c, 1.2),
    stroke('M12 3.6c2.2 2.3 3.3 5.1 3.3 8.4s-1.1 6.1-3.3 8.4c-2.2-2.3-3.3-5.1-3.3-8.4S9.8 5.9 12 3.6Z', c, 1.2),
  ],
};

export function hasArchIcon(icon: string | undefined): boolean {
  return Boolean(icon && ICONS[icon.toLowerCase()]);
}

/**
 * 畫出一個服務圖示,置中於 (cx, cy),佔 `size` 見方。
 * 認不得的名稱回傳 null,讓呼叫端退回首字母。
 */
export function archIconGroup(
  icon: string | undefined,
  color: string,
  cx: number,
  cy: number,
  size: number,
): SVGGElement | null {
  const draw = icon ? ICONS[icon.toLowerCase()] : undefined;
  if (!draw) return null;
  const k = size / 24;
  const g = svgEl('g', { transform: `translate(${cx - size / 2},${cy - size / 2}) scale(${k})` });
  for (const el of draw(color)) g.appendChild(el);
  g.style.pointerEvents = 'none';
  return g;
}
