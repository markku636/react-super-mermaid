// 把檢查提示掛到已渲染的 SVG 上:有提示的節點加一顆角標,並標記節點本身。
//
// 關鍵設計:角標 <g> 直接 append 進**節點自己的 <g>**,座標取節點 bbox 的右上角。
// 這樣它自動繼承節點的 transform —— svg-pan-zoom 之後會把內容整包搬進 `.svg-pan-zoom_viewport`,
// 若角標掛在 SVG root 就得自己補償那層 transform,掛在節點內則完全免疫掛載順序問題。

import type { CheckSeverity, DiagramCheck } from '../../types';
import { findDiagramNode, nodeLabelText } from '../node-index';

/** 角標半徑(SVG 使用者座標);與節點邊界的內縮量。 */
const BADGE_R = 11;
const BADGE_INSET = 2;
/**
 * 命中區倍率。角標跟著圖一起縮放,整張圖 fit 進面板時實測只有 ~8px —— 太難點。
 * 疊一顆放大的透明圓專門吃點擊(fill:transparent 仍參與命中測試,fill:none 則不會),
 * 視覺不變但好按得多。
 */
const HIT_SCALE = 1.7;

/** 按下到放開的位移超過這個像素數就視為拖曳、不是點擊(手抖的正常點擊仍算數)。 */
const DRAG_SLOP = 4;

/** 依嚴重度取角標字符 —— 用文字而非圖檔,匯出 SVG / PNG 時不需外部資源。 */
const GLYPH: Record<CheckSeverity, string> = {
  info: 'i',
  warn: '!',
  error: '!',
};

/**
 * 角標的「離線」配色,以 presentation attribute 寫死在元素上。
 *
 * 為什麼不能只靠 CSS:匯出時 SVG 會被序列化成獨立檔(PNG 還會再丟進 <img> 點陣化),
 * 那時 <head> 裡的套件樣式表根本不在 —— 角標會退回瀏覽器預設(黑色實心),
 * 放大的透明命中圓更會變成一坨黑塊。寫成屬性後匯出自帶顏色;
 * 畫面上則仍由 CSS(帶 !important)決定,深色模式與 hover 一樣有效。
 */
const BADGE_FILL: Record<CheckSeverity, string> = {
  info: '#2563eb',
  warn: '#d97706',
  error: '#dc2626',
};

const SVG_NS = 'http://www.w3.org/2000/svg';

const BADGE_STYLE_CLASS = 'rsm-check-style';

/**
 * 角標樣式必須注入 SVG **內部**,不能只放在 <head> 的套件樣式表。
 *
 * 兩個理由疊在一起:
 * 1. mermaid 自己會在 SVG 裡塞一段 <style>(含 `.node circle { fill: … }` 這類規則),
 *    而**任何** CSS 規則的優先序都高於 presentation attribute → 光寫 fill="#2563eb" 會被蓋掉。
 * 2. 匯出時 SVG 被序列化成獨立檔(PNG 還會再丟進 <img> 點陣化),<head> 的樣式表根本不存在。
 *
 * 顏色寫成 `var(--x, 預設值)`:畫面上沿用主題變數(深色模式有效),
 * 匯出成獨立檔時變數解不到,自動落到括號內的預設調色盤。
 */
const BADGE_CSS = `
.rsm-check-badge-hit { fill: transparent !important; stroke: none !important; filter: none !important; }
.rsm-check-badge-bg {
  stroke: var(--rsm-surface, #ffffff) !important;
  stroke-width: 2px !important;
  stroke-dasharray: none !important;
  filter: none !important;
}
.rsm-check-info .rsm-check-badge-bg { fill: var(--rsm-check-info, #2563eb) !important; }
.rsm-check-warn .rsm-check-badge-bg { fill: var(--rsm-check-warn, #d97706) !important; }
.rsm-check-error .rsm-check-badge-bg { fill: var(--rsm-check-error, #dc2626) !important; }
.rsm-check-badge-text {
  fill: #ffffff !important;
  stroke: none !important;
  font-size: 13px !important;
  font-weight: 700 !important;
  font-family: ui-sans-serif, system-ui, sans-serif !important;
}
`;

/** 在 SVG 內注入一次角標樣式(重複呼叫不會疊加)。 */
function ensureBadgeStyle(svg: SVGSVGElement): void {
  if (svg.querySelector(`style.${BADGE_STYLE_CLASS}`)) {
    return;
  }
  const style = document.createElementNS(SVG_NS, 'style');
  style.setAttribute('class', BADGE_STYLE_CLASS);
  style.textContent = BADGE_CSS;
  // 放最後,確保排在 mermaid 自己那段 <style> 之後(同為 !important 時後者勝)。
  svg.appendChild(style);
}

/** 一個已解析到 DOM 的提示群組(同一節點可掛多則)。 */
export interface ResolvedCheckGroup {
  /** 該節點上的所有提示。 */
  checks: DiagramCheck[];
  /** 節點元素。 */
  node: Element;
  /** 角標元素(供 host 定位跳窗)。 */
  badge: SVGGElement;
  /** 群組中最高的嚴重度。 */
  severity: CheckSeverity;
  /** 用於 React key / 對焦查找。 */
  key: string;
}

export interface AnnotateOptions {
  /** 本次 render 的 id(節點 DOM id 前綴)。 */
  renderId?: string;
  /** 點擊角標或節點時觸發。 */
  onActivate?: (group: ResolvedCheckGroup) => void;
  /** 初始是否顯示角標。 */
  visible?: boolean;
}

export interface ChecksController {
  /** 已成功掛上的提示群組(target 找不到的會被略過)。 */
  groups: ResolvedCheckGroup[];
  /** 未能在圖上定位的 target —— 供 host 除錯。 */
  unresolved: string[];
  setVisible(visible: boolean): void;
  /** 高亮某個節點(側邊清單點擊時用);傳 undefined 清除。 */
  focus(key: string | undefined): void;
  destroy(): void;
}

const SEVERITY_RANK: Record<CheckSeverity, number> = { info: 0, warn: 1, error: 2 };

function highestSeverity(checks: DiagramCheck[]): CheckSeverity {
  let best: CheckSeverity = 'info';
  for (const c of checks) {
    const s = c.severity ?? 'info';
    if (SEVERITY_RANK[s] > SEVERITY_RANK[best]) {
      best = s;
    }
  }
  return best;
}

/** 依 target 分組(同一 target 的多則提示共用一顆角標)。 */
function groupByTarget(checks: DiagramCheck[]): Map<string, DiagramCheck[]> {
  const map = new Map<string, DiagramCheck[]>();
  for (const check of checks) {
    const key = `${check.match ?? 'id'}:${check.target}`;
    const list = map.get(key);
    if (list) {
      list.push(check);
    } else {
      map.set(key, [check]);
    }
  }
  return map;
}

/** severity 的人話標籤,用於 tooltip 與無障礙名稱。 */
const SEVERITY_WORD: Record<CheckSeverity, string> = {
  info: '參考',
  warn: '注意',
  error: '重點',
};

/** 組 hover tooltip / 無障礙名稱的文字:標題(+ 則數)+ 首則說明。 */
function badgeTooltip(checks: DiagramCheck[], severity: CheckSeverity): string {
  const first = checks[0];
  const head =
    checks.length > 1
      ? `檢查提示（${checks.length} 則）`
      : `檢查提示・${SEVERITY_WORD[severity]}`;
  const title = first.title ?? first.target;
  const desc = checks.length === 1 && first.desc ? `\n${first.desc}` : '';
  return `${head}：${title}${desc}`;
}

/**
 * 建立角標 <g>:圓底 + 字符(+ 多則時的數量)。
 *
 * `<title>` 一箭雙鵰 —— 瀏覽器原生 hover tooltip,同時就是這顆按鈕的無障礙名稱
 * (否則讀屏只念得出 `i` / `!` / 數字)。純 SVG,不需要 JS,也會跟著匯出走。
 */
function createBadge(severity: CheckSeverity, count: number, tooltip: string): SVGGElement {
  const g = document.createElementNS(SVG_NS, 'g') as SVGGElement;
  g.setAttribute('class', `rsm-check-badge rsm-check-${severity}`);
  g.setAttribute('role', 'button');
  g.setAttribute('tabindex', '0');
  g.setAttribute('aria-label', tooltip.replace(/\n/g, '，'));

  const titleEl = document.createElementNS(SVG_NS, 'title');
  titleEl.textContent = tooltip;
  g.appendChild(titleEl);

  const hit = document.createElementNS(SVG_NS, 'circle');
  hit.setAttribute('r', String(Math.round(BADGE_R * HIT_SCALE)));
  hit.setAttribute('class', 'rsm-check-badge-hit');
  hit.setAttribute('fill', 'transparent');
  hit.setAttribute('stroke', 'none');
  g.appendChild(hit);

  const circle = document.createElementNS(SVG_NS, 'circle');
  circle.setAttribute('r', String(BADGE_R));
  circle.setAttribute('class', 'rsm-check-badge-bg');
  circle.setAttribute('fill', BADGE_FILL[severity]);
  circle.setAttribute('stroke', '#ffffff');
  circle.setAttribute('stroke-width', '2');
  g.appendChild(circle);

  const text = document.createElementNS(SVG_NS, 'text');
  text.setAttribute('class', 'rsm-check-badge-text');
  text.setAttribute('text-anchor', 'middle');
  // dominant-baseline 在部分 renderer 對 tspan 不穩,改用固定位移讓字視覺置中。
  text.setAttribute('dy', '0.34em');
  text.setAttribute('fill', '#ffffff');
  text.setAttribute('stroke', 'none');
  text.setAttribute('font-size', '13px');
  text.setAttribute('font-weight', '700');
  text.setAttribute('font-family', 'ui-sans-serif, system-ui, sans-serif');
  text.textContent = count > 1 ? String(count) : GLYPH[severity];
  g.appendChild(text);

  return g;
}

/** 取節點在自身座標系中的 bbox;取不到(display:none / 非圖形元素)回 undefined。 */
function localBox(el: Element): DOMRect | undefined {
  const g = el as SVGGraphicsElement;
  if (typeof g.getBBox !== 'function') {
    return undefined;
  }
  try {
    const box = g.getBBox();
    return box.width > 0 || box.height > 0 ? box : undefined;
  } catch {
    return undefined;
  }
}

/**
 * 把提示掛上 SVG。回傳 controller 供 host 控制顯示 / 對焦 / 卸載。
 * 任何一則提示定位失敗都只是被略過(記進 unresolved),不影響其餘提示與圖表本身。
 */
export function annotateChecks(
  svg: SVGSVGElement,
  checks: DiagramCheck[],
  opts: AnnotateOptions = {},
): ChecksController {
  const groups: ResolvedCheckGroup[] = [];
  const unresolved: string[] = [];
  const cleanups: (() => void)[] = [];

  ensureBadgeStyle(svg);

  for (const [key, list] of groupByTarget(checks)) {
    const first = list[0];
    const node = findDiagramNode(svg, first.target, {
      renderId: opts.renderId,
      match: first.match,
    });
    if (!node) {
      unresolved.push(first.target);
      continue;
    }
    const box = localBox(node);
    if (!box) {
      unresolved.push(first.target);
      continue;
    }

    // 標題省略時以節點文字遞補,讓卡片一定有可讀抬頭。
    const label = nodeLabelText(node);
    const resolvedChecks = list.map((c) => (c.title ? c : { ...c, title: label || c.target }));

    const severity = highestSeverity(resolvedChecks);
    const badge = createBadge(
      severity,
      resolvedChecks.length,
      badgeTooltip(resolvedChecks, severity),
    );
    badge.setAttribute(
      'transform',
      `translate(${box.x + box.width - BADGE_INSET}, ${box.y + BADGE_INSET})`,
    );

    const group: ResolvedCheckGroup = { checks: resolvedChecks, node, badge, severity, key };

    node.classList.add('rsm-has-check', `rsm-has-check-${severity}`);
    node.appendChild(badge);
    groups.push(group);

    const activate = (e: Event): void => {
      e.stopPropagation();
      e.preventDefault();
      opts.onActivate?.(group);
    };
    const onKey = (e: Event): void => {
      const ke = e as KeyboardEvent;
      if (ke.key === 'Enter' || ke.key === ' ') {
        activate(e);
      }
    };
    // 拖曳平移時,svg-pan-zoom 讓整個 viewport 跟著游標走 —— 角標始終黏在游標下,
    // 於是 mousedown / mouseup 都落在它身上,瀏覽器照樣補一個 click。
    // 沒有位移門檻的話,「只是想拖曳畫布」會被誤判成點開提示。
    let downAt: { x: number; y: number } | undefined;
    const onDown = (e: Event): void => {
      const pe = e as PointerEvent;
      downAt = { x: pe.clientX, y: pe.clientY };
    };
    const onClick = (e: Event): void => {
      const me = e as MouseEvent;
      if (downAt) {
        const moved = Math.hypot(me.clientX - downAt.x, me.clientY - downAt.y);
        downAt = undefined;
        if (moved > DRAG_SLOP) {
          return;
        }
      }
      activate(e);
    };
    // 只綁在角標上:整顆節點都可點會和 svg-pan-zoom 的拖曳搶事件。
    badge.addEventListener('pointerdown', onDown);
    badge.addEventListener('click', onClick);
    badge.addEventListener('keydown', onKey);
    cleanups.push(() => {
      badge.removeEventListener('pointerdown', onDown);
      badge.removeEventListener('click', onClick);
      badge.removeEventListener('keydown', onKey);
    });
  }

  const setVisible = (visible: boolean): void => {
    for (const g of groups) {
      g.badge.style.display = visible ? '' : 'none';
      g.node.classList.toggle('rsm-check-hidden', !visible);
    }
  };
  setVisible(opts.visible ?? true);

  const focus = (key: string | undefined): void => {
    for (const g of groups) {
      g.node.classList.toggle('rsm-check-focus', g.key === key);
    }
  };

  return {
    groups,
    unresolved,
    setVisible,
    focus,
    destroy: () => {
      for (const fn of cleanups) {
        fn();
      }
      cleanups.length = 0;
      for (const g of groups) {
        g.badge.remove();
        g.node.classList.remove(
          'rsm-has-check',
          `rsm-has-check-${g.severity}`,
          'rsm-check-focus',
          'rsm-check-hidden',
        );
      }
      groups.length = 0;
    },
  };
}
