// 圖內文字搜尋:命中節點高亮(rsm-hit)、其餘變暗(rsm-dim),可逐一跳轉。
// 與框架無關:透過 getSvg() 取得當前 SVG、panTo() 把命中置中(可選)。

import type { SearchState } from '../types';

// 搜尋時要變暗 / 高亮的節點層級(對齊原 viewer 行為)。
const DIMMABLE_SELECTOR = 'g.node, g.cluster, .actor';

const EMPTY: SearchState = { current: 0, total: 0 };

export interface SearchController {
  search(term: string, pan?: boolean): SearchState;
  next(pan?: boolean): SearchState;
  prev(pan?: boolean): SearchState;
  /** 重新跑當前 query(例如重繪後),保持高亮一致。 */
  rerun(pan?: boolean): SearchState;
  clear(): void;
  getQuery(): string;
}

export function createSearch(
  getSvg: () => SVGSVGElement | null,
  panTo?: (el: Element) => void,
): SearchController {
  let matches: Element[] = [];
  let current = -1;
  let query = '';

  function clearHighlights(): void {
    const svg = getSvg();
    if (!svg) {
      return;
    }
    for (const el of Array.from(svg.querySelectorAll('.rsm-dim, .rsm-hit'))) {
      el.classList.remove('rsm-dim', 'rsm-hit');
    }
  }

  function setCurrent(i: number, pan: boolean): SearchState {
    if (matches.length === 0) {
      return EMPTY;
    }
    if (current >= 0) {
      matches[current]?.classList.remove('rsm-hit');
    }
    const next = ((i % matches.length) + matches.length) % matches.length;
    current = next;
    const el = matches[next];
    el.classList.add('rsm-hit');
    if (pan) {
      panTo?.(el);
    }
    return { current: next + 1, total: matches.length };
  }

  function run(term: string, pan: boolean): SearchState {
    query = term;
    clearHighlights();
    matches = [];
    current = -1;
    const svg = getSvg();
    const q = term.trim().toLowerCase();
    if (!svg || !q) {
      return EMPTY;
    }
    const seen = new Set<Element>();
    for (const textEl of Array.from(svg.querySelectorAll('text, .nodeLabel'))) {
      if (!(textEl.textContent ?? '').toLowerCase().includes(q)) {
        continue;
      }
      const target = textEl.closest(DIMMABLE_SELECTOR) ?? textEl;
      if (!seen.has(target)) {
        seen.add(target);
        matches.push(target);
      }
    }
    if (matches.length === 0) {
      return EMPTY;
    }
    for (const el of Array.from(svg.querySelectorAll(DIMMABLE_SELECTOR))) {
      const dimTarget = el.classList.contains('actor') ? (el.parentElement ?? el) : el;
      dimTarget.classList.add('rsm-dim');
    }
    for (const match of matches) {
      match.classList.remove('rsm-dim');
    }
    return setCurrent(0, pan);
  }

  return {
    search: (term, pan = true) => run(term, pan),
    next: (pan = true) => setCurrent(current + 1, pan),
    prev: (pan = true) => setCurrent(current - 1, pan),
    rerun: (pan = false) => (query.trim() ? run(query, pan) : EMPTY),
    clear: () => {
      clearHighlights();
      matches = [];
      current = -1;
      query = '';
    },
    getQuery: () => query,
  };
}
