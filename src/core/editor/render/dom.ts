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

/**
 * markdown label(mermaid 反引號標籤)行內格式:**粗體** / *斜體* / `程式碼` / <br>。
 * 以建立 DOM 節點呈現(非 innerHTML)→ 無注入風險。共用於節點與邊標籤。
 */
export function appendInlineMarkdown(parent: HTMLElement, text: string): void {
  const lines = text.split(/<br\s*\/?>/);
  const re = /(\*\*|__)(.+?)\1|(\*|_)(.+?)\3|`([^`]+)`/g;
  lines.forEach((line, li) => {
    if (li > 0) parent.appendChild(document.createElementNS(XHTML_NS, 'br') as unknown as Node);
    let last = 0;
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((m = re.exec(line)) !== null) {
      if (m.index > last) parent.appendChild(document.createTextNode(line.slice(last, m.index)));
      let tag: 'strong' | 'em' | 'code';
      let content: string;
      if (m[1]) {
        tag = 'strong';
        content = m[2];
      } else if (m[3]) {
        tag = 'em';
        content = m[4];
      } else {
        tag = 'code';
        content = m[5];
      }
      const el = document.createElementNS(XHTML_NS, tag) as unknown as HTMLElement;
      el.textContent = content;
      if (tag === 'code') el.setAttribute('style', 'font-family:monospace;font-size:0.9em;');
      parent.appendChild(el as unknown as Node);
      last = re.lastIndex;
    }
    if (last < line.length) parent.appendChild(document.createTextNode(line.slice(last)));
  });
}
