// 小型 SVG/HTML 命名空間建立工具。

export const SVG_NS = 'http://www.w3.org/2000/svg';
export const XHTML_NS = 'http://www.w3.org/1999/xhtml';

export function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs?: Record<string, string | number>,
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

export function clearChildren(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}
